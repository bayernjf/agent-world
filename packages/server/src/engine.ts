import {
  BranchConfig,
  ComplianceConfig,
  CodeNodeConfig,
  PublishConfig,
  buildPublishPackage,
  publishArtifact,
  checkCompliance,
  complianceArtifact,
  GenericConfig,
  ImageGenConfig,
  VideoGenConfig,
  AudioGenConfig,
  TextGenConfig,
  FanoutConfig,
  SelectConfig,
  DatabaseConfig,
  FileParseConfig,
  HttpNodeConfig,
  LoopConfig,
  MapConfig,
  ParallelConfig,
  TableConfig,
  TranslateConfig,
  OcrConfig,
  ConvertConfig,
  SearchConfig,
  NotifyConfig,
  VcsConfig,
  SubprocessConfig,
  compile,
  applyTableSteps,
  buildNodeContext,
  collectColumns,
  evaluateCondition,
  evaluateTemplate,
  extractArtifacts,
  getByPath,
  incoming,
  nodeById,
  outgoing,
  primaryValue,
  rowsToCsv,
  tableInputFrom,
  transformJson,
  type Artifact,
  type ContentPart,
  type DraftEvent,
  type Graph,
  type GraphNode,
  type Plan,
  type ProductConnector,
  type RunEvent,
  type SkillMount,
  type TableInput,
  type Usage,
} from "@agent-world/core";
import { spawn } from "node:child_process";
import { HaltRequested, type ToolDefinition, type Worker } from "./worker.js";
import { ProviderError } from "./providers/openai-compatible.js";
import { sanitizeError } from "./sanitize.js";
import { MAX_INLINE_BYTES } from "./artifact-reader.js";
import { getSkill, resolveTools, executeBuiltinTool } from "./skills/registry.js";
import { guardToolCall, isDangerousTool, loadPermissionConfig, type PermissionConfig } from "./permissions.js";
import { notifyFailed, notifyHalt } from "./notify.js";
import { resolveConnector, type ResolvedMaterial } from "./connectors.js";
import { createSqliteDriver } from "./db-drivers.js";
import { dataUriToBuffer, parseDocument, extractPdfImages } from "./parse-file.js";
import { ocrImage } from "./ocr.js";
import { decodeImage, encodeJpeg, encodePng } from "./convert.js";
import { searchWeb, SearchAuthError } from "./search.js";
import { sendNotification, NotifyAuthError, NotifyProviderError } from "./notifier.js";
import { executeVcs, VcsAuthError, VcsProviderError } from "./vcs.js";
import { withRetry } from "./retry.js";
import { createCodeWorkdir, cleanupCodeWorkdir, resolveSandbox, type CodeSandboxLimits } from "./code-sandbox.js";
import { trimEnv } from "./isolation.js";
import { allowPrivateNetwork, guardedFetch, hostIsInternal } from "./ssrf.js";
import { childProxyEnv, getCodeProxyUrl, registerNetToken, unregisterNetToken } from "./code-proxy.js";

/**
 * Append free-text layout directives (manual image-position overrides) to an
 * agent's base prompt. Returns the prompt unchanged when no directives exist.
 */
export function withLayoutDirectives(base: string, directives?: string): string {
  const d = directives?.trim();
  if (!d) return base;
  return `${base}\n\n排版附加要求（必须遵守）：\n${d}`;
}

// ---------------------------------------------------------------------------
// F1: fanout / select variant lanes.
// ---------------------------------------------------------------------------

/** Flow-edge descendants of `id` (excludes `id`). */
function descendants(graph: Graph, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of outgoing(graph, cur, "flow")) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      stack.push(e.to);
    }
  }
  return seen;
}

/** Flow-edge ancestors of `id` (excludes `id`). */
function ancestors(graph: Graph, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of incoming(graph, cur, "flow")) {
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      stack.push(e.from);
    }
  }
  return seen;
}

/** One variant lane's differentiated parameters. */
interface VariantParam {
  id: string;
  prompt?: string;
  temperature?: number;
  model?: string;
}

/** Expand a fanout config into N per-lane parameter sets. */
function buildVariantParams(cfg: FanoutConfig, fallbackModel: string): VariantParam[] {
  const count = cfg.count;
  const out: VariantParam[] = [];
  for (let i = 0; i < count; i++) {
    const v: VariantParam = { id: `v${i + 1}` };
    if (cfg.strategy === "prompt") {
      const p = cfg.prompts?.[i];
      if (p != null && p.trim() !== "") v.prompt = p;
    } else if (cfg.strategy === "temperature") {
      v.temperature = cfg.temperatures?.[i] ?? 0.3 + (0.9 - 0.3) * (i / Math.max(1, count - 1));
    } else if (cfg.strategy === "model") {
      v.model = cfg.models?.[i] ?? fallbackModel;
    }
    out.push(v);
  }
  return out;
}

/** Apply a variant's differentiated params onto a cloned node (textGen only — other kinds are copied verbatim). */
function applyVariantConfig(n: GraphNode, v: VariantParam): GraphNode {
  if (n.kind !== "textGen" || !n.textGen) return { ...n };
  const tg = { ...n.textGen };
  if (v.prompt != null) tg.prompt = v.prompt;
  if (v.temperature != null) tg.temperature = v.temperature;
  if (v.model != null) tg.model = v.model;
  return { ...n, textGen: tg };
}

/** Ids of the lane nodes strictly between a fanout and its select (exclusive). */
function variantLaneIds(graph: Graph, fanoutId: string, selectId: string): string[] {
  const down = descendants(graph, fanoutId);
  const up = ancestors(graph, selectId);
  return [...down].filter((id) => id !== fanoutId && id !== selectId && up.has(id));
}

/** Clone the lane into a self-contained sub-graph (source → lane → sink). */
function buildVariantGraph(
  graph: Graph,
  fanoutId: string,
  selectId: string,
  laneIds: string[],
  v: VariantParam,
): Graph {
  const SOURCE = "__lane_source__";
  const SINK = "__lane_sink__";
  const nodes: GraphNode[] = graph.nodes.filter((n) => laneIds.includes(n.id)).map((n) => applyVariantConfig(n, v));
  nodes.push({ id: SOURCE, kind: "source", name: "变体输入", x: 0, y: 0 });
  nodes.push({ id: SINK, kind: "sink", name: "变体输出", x: 0, y: 0 });
  const edges = graph.edges
    .filter((e) => e.kind === "flow" && laneIds.includes(e.from) && laneIds.includes(e.to))
    .map((e) => ({ ...e }));
  const entryIds = laneIds.filter((id) => incoming(graph, id, "flow").some((e) => e.from === fanoutId));
  const exitIds = laneIds.filter((id) => outgoing(graph, id, "flow").some((e) => e.to === selectId));
  for (const id of entryIds) edges.push({ id: `e-${SOURCE}-${id}`, from: SOURCE, to: id, kind: "flow" as const });
  for (const id of exitIds) edges.push({ id: `e-${id}-${SINK}`, from: id, to: SINK, kind: "flow" as const });
  return { id: `${fanoutId}-lane-${v.id}`, name: `变体泳道 ${v.id}`, nodes, edges };
}

/** The select node reconverging a fanout's lanes (first one found downstream). */
function firstSelectDownstream(graph: Graph, fanoutId: string): string | null {
  const down = descendants(graph, fanoutId);
  for (const id of down) if (nodeById(graph, id)?.kind === "select") return id;
  return null;
}

/** The fanout node feeding a select's lanes (first one found upstream). */
function firstFanoutUpstream(graph: Graph, selectId: string): string | null {
  const up = ancestors(graph, selectId);
  for (const id of up) if (nodeById(graph, id)?.kind === "fanout") return id;
  return null;
}

/**
 * E.2 — collect prompt text from every mounted `prompt-module` skill, including
 * multi-level `equips` dependencies, de-duplicated by skill id (BFS, cycle-safe).
 * Returns the ordered module prompts to inject into the agent's system prompt.
 */
/** Normalize a skill entry (id string or mount) into a full SkillMount. */
function toMount(s: string | SkillMount): SkillMount {
  return typeof s === "string" ? { id: s, config: {}, enabled: true } : { ...s, config: s.config ?? {} };
}

export function collectPromptModules(mounts: SkillMount[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue: SkillMount[] = [...mounts];
  while (queue.length) {
    const m = queue.shift()!;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const skill = getSkill(m.id);
    if (!skill) continue;
    const config = { ...(skill.config ?? {}), ...(m.config ?? {}) };
    if (skill.kind === "prompt-module" && typeof config.prompt === "string" && config.prompt.trim()) {
      out.push(config.prompt);
    }
    const equips = Array.isArray(config.equips) ? (config.equips as string[]) : [];
    for (const id of equips) {
      if (!seen.has(id)) queue.push({ id, config: {}, enabled: true });
    }
  }
  return out;
}

/**
 * E.3 — find the output contract (JSON-schema) declared by a mounted
 * `output-contract` skill, if any. Returns the schema object or null.
 */
export function getOutputContract(mounts: SkillMount[]): Record<string, unknown> | null {
  for (const m of mounts) {
    const skill = getSkill(m.id);
    if (!skill || skill.kind !== "output-contract") continue;
    const config = { ...(skill.config ?? {}), ...(m.config ?? {}) };
    if (config.schema && typeof config.schema === "object") {
      return config.schema as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * E.3 — validate an agent's output against a JSON-schema contract. Strips
 * optional ```json fences, requires a JSON object, enforces `required` keys and
 * per-property `type`. Returns a human-readable failure reason or null if valid.
 */
export function validateContract(output: string, schema: Record<string, unknown>): string | null {
  let text = output.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence && fence[1]) text = fence[1].trim();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return "输出不是合法 JSON";
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return "输出必须是 JSON 对象";
  }
  const obj = data as Record<string, unknown>;
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const key of required) {
    if (!(key in obj)) return `缺少必填字段 "${key}"`;
  }
  const props =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, { type?: string }>)
      : {};
  for (const [key, spec] of Object.entries(props)) {
    if (!(key in obj)) continue;
    const expected = spec?.type;
    if (expected) {
      const actual = Array.isArray(obj[key]) ? "array" : typeof obj[key];
      if (actual !== expected) return `字段 "${key}" 类型应为 ${expected}，实际为 ${actual}`;
    }
  }
  return null;
}

export interface ExecuteOptions {
  runId: string;
  graph: Graph;
  plan: Plan;
  worker: Worker;
  /** Raw material fed to the source node. Falls back to a placeholder. */
  input?: string;
  /** Answers for `form` connectors, keyed by field name (filled at run time). */
  connectorValues?: Record<string, string>;
  /** Hard ceiling. Cost is metered after each call, so this trips late by one node. */
  budgetUsd: number | null;
  /**
   * Soft monthly cap (advisory only). When set, the engine warns at 80% and
   * 100% of `monthSpentUsd + this run's cost` but never hard-trips on it.
   */
  monthlyBudgetUsd?: number | null;
  /** Cost already spent this month before this run started. */
  monthSpentUsd?: number;
  /** Fallback model for nodes that don't specify one. */
  defaultModel?: string;
  signal?: AbortSignal;
  /** Injected so runs are reproducible in tests. */
  now?: () => number;
  /** Injected so retry backoff is controllable in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Persists generated image bytes and returns a stable URI (e.g. /api/artifacts/:id). */
  storeBinary?: (data: Buffer, mimeType: string, label?: string) => string | Promise<string>;
  /** Resolves a /api/artifacts/<id> URI to a data URI for cloud models. */
  readArtifact?: (uri: string) => Promise<string | null>;
  /**
   * Absolute origin (e.g. http://localhost:8791). Relative artifact URIs are
   * prefixed with it when exposed to agent prompts, so downstream nodes and
   * gate judges see fully-qualified URLs instead of /api/artifacts/<id> paths.
   */
  publicUrl?: string;
  /** Tool-call permission governance. Defaults to the env-derived config. */
  permissionConfig?: PermissionConfig;
  /**
   * Resolves a subprocess node's referenced graph (another saved graph) into
   * a Graph. Injected by the HTTP layer (db lookup); absent in unit tests that
   * don't exercise subprocess nodes.
   */
  loadSubgraph?: (graphId: string) => Graph | null;
  /**
   * Graph variables for this run (cross-run persisted state). Passed by
   * reference: the engine mutates the same map the caller holds, so the caller
   * can persist it back to the DB after the run finishes.
   */
  initialVariables?: Map<string, unknown>;
  /**
   * The calling user's supplementary banned-word library (banned_terms table),
   * comma-joined. Merged into every compliance node's word list at run time.
   */
  bannedTerms?: string;
  /** Resolves a `product` connector against the user's product library (injected by the HTTP layer). */
  loadProducts?: (connector: ProductConnector) => Promise<ResolvedMaterial>;
}

/**
 * Built-in graph-variable tools (cross-run persisted state). They are appended
 * to every agent's tool list; the engine routes their execution to the run's
 * variables map (see `handleVariableTool`). Safe tools — no approval needed.
 */
const VARIABLE_TOOLS: ToolDefinition[] = [
  {
    name: "set_variable",
    description:
      "Write/update a graph variable (persisted across runs, read via ${var.xxx} or get_variable). " +
      "Value can be a string, number, boolean, object or array.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Variable name, dot path supported (e.g. stats.count)." },
        value: { description: "Value to store (JSON-serializable)." },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "get_variable",
    description:
      "Read a graph variable (persisted across runs; the same value ${var.xxx} resolves). " +
      "Returns null when the key does not exist.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Variable name, dot path supported (e.g. stats.count)." },
      },
      required: ["key"],
    },
  },
];

type Status = "done" | "failed" | "halted" | "tripped" | "cancelled";
/**
 * - skipped: a branch node did not route here; the node is never launched and
 *   its own un-routed subtree is skipped the same way.
 */
type NodeState = "pending" | "running" | "done" | "failed" | "skipped";

const RETRYABLE: ReadonlySet<string> = new Set(["TIMEOUT", "RATE_LIMIT", "PROVIDER_ERROR"]);

/** Connector pull resilience: how many extra attempts and the gap between them. */
const CONNECTOR_MAX_RETRIES = 2;
const CONNECTOR_RETRY_DELAY_MS = 1000;
/** Max plants welding at once. Keeps a burst of parallel branches from hammering the provider. */
const MAX_CONCURRENCY = 6;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Hard-truncate a body to `maxChars`, keeping the tail and a small head marker.
 * Used as the deterministic fallback when a `summary` policy has no summarizer
 * or the summarizer fails.
 */
function truncateText(body: string, maxChars: number): string {
  const head = `...[前 ${body.length - maxChars} 字符已截断]...\n`;
  return head + body.slice(body.length - maxChars + head.length);
}

/**
 * Replace a node's artifacts with a single text artifact. Used when a node
 * finishes with a text output (agent/source/sink/gate).
 */
function setTextArtifact(artifacts: Map<string, Artifact[]>, nodeId: string, text: string): Artifact {
  const headingMatch = text.match(/^\s*#\s+(.+?)\s*$/m);
  const label = headingMatch ? headingMatch[1] : undefined;
  const artifact: Artifact = {
    id: `${nodeId}-text`,
    kind: "text",
    content: text,
    mimeType: "text/markdown",
    ...(label ? { label } : {}),
  };
  artifacts.set(nodeId, [artifact]);
  return artifact;
}

/**
 * Inlines a relative /api/artifacts/<id> URI as a data:<mime>;base64,... URI
 * when readArtifact can resolve it. Other URIs (https://, data:, already-
 * absolute CDN URLs) pass through unchanged. Centralised so the same logic
 * applies to any image-content path the engine hands to a model.
 */
export async function inlineImageUrl(uri: string, readArtifact: (uri: string) => Promise<string | null>): Promise<string> {
  if (!uri.startsWith("/api/artifacts/")) return uri;
  try {
    const resolved = await readArtifact(uri);
    return resolved ?? uri;
  } catch {
    return uri;
  }
}

/**
 * Supplemental judging rule appended to every gate criterion. Locally stored
 * artifacts surface as …/api/artifacts/<id> URLs (often on a localhost origin),
 * and model judges otherwise reject them as "not a real upstream URL" — even
 * though they ARE the real upstream output. Enforced here at engine level so
 * no graph config can trip over it.
 */
const ARTIFACT_URL_NOTE =
  "\n补充判定规则：凡 URL 路径中包含 /api/artifacts/ 的图片或媒体链接，都是本系统产物库中由上游节点真实产出的存储地址，属于有效的上游真实 URL；不得仅因其域名是本机或内网地址（如 localhost、127.0.0.1）而判定为无效、编造或不符合「真实 URL」要求。";

/**
 * Collect all image URIs reachable from a node via its flow-upstream artifacts
 * (transitive closure, deduped). Replaces the old createImageResolver + extraImages
 * mechanism: images now flow as typed artifacts through the artifacts Map.
 */
function collectUpstreamImages(
  graph: Graph,
  artifacts: Map<string, Artifact[]>,
  nodeId: string,
): string[] {
  const uris: string[] = [];
  const visited = new Set<string>();
  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const arts = artifacts.get(id);
    if (arts) {
      for (const a of arts) {
        if (a.kind === "image" && a.uri) uris.push(a.uri);
      }
    }
    for (const e of incoming(graph, id, "flow")) {
      walk(e.from);
    }
  };
  for (const e of incoming(graph, nodeId, "flow")) {
    walk(e.from);
  }
  return [...new Set(uris)];
}

/**
 * Assemble upstream artifacts into a nodes input according to its input policy.
 * - all: concatenate every upstream output (default)
 * - last: only the most recent upstream output
 * - truncate: concatenate but cap at maxChars, keeping the tail
 * (`summary` mode is handled in `inputFor`, which can call an async summarizer.)
 */
function assembleInput(
  parts: string[],
  policy: { mode: "all" | "last" | "truncate" | "summary"; maxChars?: number },
): string {
  if (parts.length === 0) return "";
  if (policy.mode === "last") return parts[parts.length - 1] ?? "";
  const body = parts.join("\n\n");
  if (policy.mode === "truncate" && policy.maxChars && body.length > policy.maxChars) {
    return truncateText(body, policy.maxChars);
  }
  return body;
}

/**
 * Build the source brief: the raw material fed at run time plus the structured
 * product/brand/audience fields configured on the source node. This text flows
 * downstream as the first node's artifact, so every writer sees it.
 */
function buildSourceBrief(node: GraphNode, sourceInput: string | undefined): string {
  const src = node.source;
  const lines: string[] = [];
  if (src?.productName) lines.push(`商品名称：${src.productName}`);
  if (src?.brand) lines.push(`品牌/店铺：${src.brand}`);
  if (src?.audience) lines.push(`目标人群：${src.audience}`);
  if (src?.priceRange) lines.push(`价格定位：${src.priceRange}`);
  if (src?.tone) lines.push(`语气调性：${src.tone}`);
  if (src?.prohibited?.trim()) lines.push(`禁用词/禁用说法：${src.prohibited.trim()}`);
  if (src?.brandTerms?.trim()) lines.push(`品牌词（建议融入）：${src.brandTerms.trim()}`);
  if (src?.notes?.trim()) lines.push(`补充说明：${src.notes.trim()}`);
  const raw = sourceInput?.trim();
  const hasBrief = lines.length > 0;
  if (raw) lines.push(hasBrief ? `商品描述/原料:\n${raw}` : raw);
  if (lines.length === 0) return `Task intake at ${node.name}`;
  return lines.join("\n");
}

/**
 * Collect prohibited terms declared on any upstream `source` node (reached via
 * flow edges). Splitting on common separators keeps the input forgiving
 * (comma / 空格 / 换行 / 中英文顿号分号 all work). De-duplicated.
 */
function upstreamProhibitedTerms(graph: Graph, nodeId: string): string[] {
  const seen = new Set<string>();
  const stack = [nodeId];
  const terms = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of incoming(graph, id, "flow")) {
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      const n = nodeById(graph, e.from);
      if (n?.kind === "source" && n.source?.prohibited?.trim()) {
        for (const raw of n.source.prohibited.split(/[\n,，、;；\s]+/)) {
          const t = raw.trim();
          if (t) terms.add(t);
        }
      }
      stack.push(e.from);
    }
  }
  return [...terms];
}

/**
 * Collect brand terms declared on any upstream `source` node (reached via flow
 * edges). Splitting mirrors upstreamProhibitedTerms. De-duplicated.
 */
function upstreamBrandTerms(graph: Graph, nodeId: string): string[] {
  const seen = new Set<string>();
  const stack = [nodeId];
  const terms = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of incoming(graph, id, "flow")) {
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      const n = nodeById(graph, e.from);
      if (n?.kind === "source" && n.source?.brandTerms?.trim()) {
        for (const raw of n.source.brandTerms.split(/[\n,，、;；\s]+/)) {
          const t = raw.trim();
          if (t) terms.add(t);
        }
      }
      stack.push(e.from);
    }
  }
  return [...terms];
}

/** Returns the prohibited terms actually present in `text` (empty if none). */
function detectProhibited(text: string, terms: string[]): string[] {
  if (terms.length === 0 || !text) return [];
  return terms.filter((t) => text.includes(t));
}

/** Short context snippets around each hit so rework feedback names the exact offending phrases. */
function prohibitedSnippets(text: string, hits: string[], maxSnippets = 3): string[] {
  const out: string[] = [];
  for (const h of hits.slice(0, maxSnippets)) {
    const i = text.indexOf(h);
    if (i < 0) continue;
    const start = Math.max(0, i - 12);
    const end = Math.min(text.length, i + h.length + 12);
    const core = text.slice(start, end).replace(/\s+/g, "");
    out.push(`“${start > 0 ? "…" : ""}${core}${end < text.length ? "…" : ""}”`);
  }
  return out;
}

/** Build a banner-generation prompt from the upstream source's product brief. */
function buildImagePrompt(node: GraphNode, graph: Graph): string {
  const seen = new Set<string>();
  const stack = [node.id];
  let src: GraphNode | undefined;
  while (stack.length && !src) {
    const id = stack.pop()!;
    for (const e of incoming(graph, id, "flow")) {
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      const n = nodeById(graph, e.from);
      if (n?.kind === "source") {
        src = n;
        break;
      }
      stack.push(e.from);
    }
  }
  const s = src?.source;
  const parts: string[] = [];
  const name = s?.productName || node.name || "商品";
  parts.push(`为电商商品「${name}」生成一张高质量主图/Banner`);
  if (s?.brand) parts.push(`品牌调性：${s.brand}`);
  if (s?.audience) parts.push(`目标人群：${s.audience}`);
  if (s?.tone) parts.push(`风格语气：${s.tone}`);
  if (s?.priceRange) parts.push(`价格定位：${s.priceRange}`);
  parts.push("构图干净、留白充足、突出卖点，适合作为商品详情页主视觉");
  return parts.join("；");
}

/** Default storeBinary: inline the bytes as a data URI (used in tests / when no artifact store is wired). */
function defaultStoreBinary(data: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

/**
 * Prefix every node-scoped event with a subprocess scope id
 * (`<subNode>#sub:`), so child-graph events can't collide with parent nodes.
 * Run-level events (run.started/run.finished) pass through untouched.
 */
function prefixEvent(e: RunEvent, prefix: string): RunEvent {
  if (!("nodeId" in e) || e.nodeId === undefined) return e;
  return { ...e, nodeId: prefix + e.nodeId };
}

/** Simple async event queue so many concurrent node workers can feed one ordered stream. */
class EventQueue {
  private items: RunEvent[] = [];
  private waiters: Array<(e: RunEvent | null) => void> = [];
  private closed = false;
  push(e: RunEvent) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w(e);
    else this.items.push(e);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters) w(null);
  }
  async *stream(): AsyncGenerator<RunEvent> {
    while (true) {
      const e = this.items.shift();
      if (e !== undefined) {
        yield e;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<RunEvent | null>((r) => this.waiters.push(r));
      if (next === null) {
        // drain any final events pushed at close
        while (this.items.length) yield this.items.shift()!;
        return;
      }
      yield next;
    }
  }
}

interface SchedulerInit {
  artifacts: Map<string, Artifact[]>;
  attempts: Map<string, number>;
  nodeCostUsd: Map<string, number>;
  totalCostUsd: number;
  states: Map<string, NodeState>;
  /** Tools approved for execution this run (4D.7 dangerous-action halt). */
  approvedTools: string[];
  /** Flow edges that already carried a packet (branch-aware scheduling). */
  packetEdges: Set<string>;
  /** Graph variables (cross-run persisted state); shared with sub-process runs. */
  variables: Map<string, unknown>;
}

interface SchedulerOptions {
  runId: string;
  graph: Graph;
  plan: Plan;
  worker: Worker;
  budgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  monthSpentUsd: number;
  fallbackModel: string;
  startSeq: number;
  sourceInput?: string;
  /** Answers for `form` connectors, keyed by field name. Filled at run time (UI/webhook). */
  connectorValues?: Record<string, string>;
  signal?: AbortSignal;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  init: SchedulerInit;
  /** When resuming, the halted gate is pre-approved. */
  approveGate?: { nodeId: string; attempt: number };
  /** Halt reason of the run being resumed — routes approve/reject semantics (human: vs gate/dangerous-tool). */
  haltReason?: string;
  /** When resuming a human node with "reject": pre-mark it failed so error edges can catch (else the run fails). */
  rejectHuman?: { nodeId: string; attempt: number };
  /** True when continuing an existing run (resume/retry): don't re-emit run.started. */
  resuming?: boolean;
  /** Persists generated image bytes and returns a stable URI (e.g. /api/artifacts/:id). */
  storeBinary: (data: Buffer, mimeType: string, label?: string) => string | Promise<string>;
  /** Resolves a /api/artifacts/<id> URI to a data URI for cloud models. */
  readArtifact?: (uri: string) => Promise<string | null>;
  /** Absolute origin prefixed to relative artifact URIs in agent prompts. */
  publicUrl?: string;
  /** Tool-call permission governance. Defaults to the env-derived config. */
  permissionConfig?: PermissionConfig;
  /** Human-edited product overrides, keyed by node id (4.7 human-in-the-loop). */
  editOutput?: Record<string, string>;
  /** Tools the operator has approved for execution this run (4D.7 dangerous-action halt). */
  approveTools?: string[];
  /** Resolves a subprocess node's referenced graph (db lookup, injected by the HTTP layer). */
  loadSubgraph?: (graphId: string) => Graph | null;
  /** Subprocess call depth (0 at the top-level run); guards against recursion. */
  subprocessDepth?: number;
  /**
   * Graph variables for this run (cross-run persisted state). Passed by
   * reference: the engine mutates the same map the caller holds, so the caller
   * can persist it back to the DB after the run finishes.
   */
  initialVariables?: Map<string, unknown>;
  /** User's banned-word library (comma-joined), merged into compliance nodes. */
  bannedTerms?: string;
  /** Resolves a `product` connector against the user's product library (injected by the HTTP layer). */
  loadProducts?: (connector: ProductConnector) => Promise<ResolvedMaterial>;
}

/**
 * Concurrent dataflow engine. A plant starts welding the moment all of its
 * flow predecessors are done; independent plants run in parallel (bounded by a
 * semaphore). A single plant failing (e.g. over its own budget) does not stop
 * unrelated branches — only its downstream stays unstarted. The whole-line
 * budget and abort trip the entire run.
 */
async function runScheduler(opts: SchedulerOptions): Promise<AsyncGenerator<RunEvent>> {
  const { runId, graph, plan, worker, budgetUsd, fallbackModel } = opts;
  const permCfg = opts.permissionConfig ?? loadPermissionConfig();
  const approved = new Set<string>(opts.approveTools ?? []);
  const monthlyBudgetUsd = opts.monthlyBudgetUsd ?? null;
  const monthSpentUsd = opts.monthSpentUsd ?? 0;
  const queue = new EventQueue();

  let seq = opts.startSeq;
  /** Last failure recorded per node, so error edges can carry the cause to catch nodes. */
  const lastError = new Map<string, { error: string; errorCode?: string }>();
  const emit = (e: DraftEvent): RunEvent => {
    // Artifact ids are node-scoped (e.g. `video-0`) and repeat across runs;
    // they are the DB primary key, so INSERT OR IGNORE silently drops every
    // later run's artifacts. Prefix with the run id to keep them unique.
    if (e.type === "artifact.produced") {
      e = { ...e, artifact: { ...e.artifact, id: `${runId.slice(0, 8)}-${e.artifact.id}` } };
    }
    const ev = { ...e, seq: seq++, ts: opts.now() } as RunEvent;
    queue.push(ev);
    if (ev.type === "node.failed") {
      lastError.set(ev.nodeId, { error: ev.error, errorCode: ev.errorCode });
    }
    return ev;
  };

  const artifacts = opts.init.artifacts;
  const imagesFor = (nodeId: string) => collectUpstreamImages(graph, artifacts, nodeId);
  const attempts = opts.init.attempts;
  const nodeCostUsd = opts.init.nodeCostUsd;
  const states = opts.init.states;
  // A rejected human node is pre-marked failed so error edges can catch it.
  if (opts.rejectHuman) {
    const { nodeId, attempt } = opts.rejectHuman;
    states.set(nodeId, "failed");
    attempts.set(nodeId, attempt);
    lastError.set(nodeId, { error: "Rejected by human operator", errorCode: "VALIDATION" });
  }
  let totalCostUsd = opts.init.totalCostUsd;
  const BUDGET_WARN = 0.8;
  let budgetWarned =
    budgetUsd !== null && budgetUsd > 0 && totalCostUsd >= budgetUsd * BUDGET_WARN;
  let monthlyWarned80 =
    monthlyBudgetUsd !== null &&
    monthlyBudgetUsd > 0 &&
    monthSpentUsd + totalCostUsd >= monthlyBudgetUsd * BUDGET_WARN;
  let monthlyWarned100 =
    monthlyBudgetUsd !== null &&
    monthlyBudgetUsd > 0 &&
    monthSpentUsd + totalCostUsd >= monthlyBudgetUsd;

  const reworkNotes = new Map<string, string>();
  const loopByGate = new Map(plan.loops.map((l) => [l.gateId, l]));
  /**
   * Per-node loop-item context (set by loop nodes while executing their loop
   * body). Keyed by node id so independent branches running concurrently never
   * read each other's item.
   */
  const loopItemByNode = new Map<string, unknown>();
  /** Graph variables (cross-run persisted state). Shared with the caller by reference. */
  const variables = opts.initialVariables ?? new Map<string, unknown>();
  /**
   * Built-in variable tools: set_variable / get_variable. Safe, no approval.
   * Sub-process runs share the same map, so writes land in the parent's state.
   */
  const handleVariableTool = (name: string, args: unknown): unknown => {
    const a = (args ?? {}) as { key?: unknown; value?: unknown };
    if (typeof a.key !== "string" || !a.key) throw new Error(`${name}: key is required (dot path, e.g. stats.count)`);
    if (name === "set_variable") {
      const value = a.value ?? null;
      variables.set(a.key, value);
      return { ok: true, key: a.key, value };
    }
    return { key: a.key, value: variables.get(a.key) ?? null };
  };
  /** buildNodeContext with the loop item (if this node is inside a loop body). */
  const nodeCtx = (nodeId: string): Record<string, unknown> => {
    const item = loopItemByNode.get(nodeId);
    // Resolve variables fresh so sub-process writes are visible to the parent.
    return buildNodeContext(
      nodeId,
      artifacts,
      graph,
      item !== undefined ? { item } : undefined,
      Object.fromEntries(variables),
    );
  };
  /** Response metadata of http nodes (ok/status/url/method). Artifacts carry
   * only the payload, but branch conditions and notify messages need to
   * inspect `${probe.ok}` / `${probe.status}` (dogfood tpl-patrol-alert). */
  const httpMeta = new Map<string, Record<string, unknown>>();
  /** nodeCtx enriched with http response metadata. A direct flow upstream from
   * an http node becomes its metadata merged with the payload (payload fields
   * win on collision; a text payload sits under `content`, so `${nodeId}`
   * still resolves to the body via primaryValue). Metadata of non-adjacent
   * http nodes is exposed under their own ids so downstream notify messages
   * can embed `${probe.url}` across the branch hop. Code-node stdin
   * deliberately stays on plain nodeCtx so scripts keep seeing raw payloads. */
  const interpCtx = (nodeId: string): Record<string, unknown> => {
    const ctx = nodeCtx(nodeId);
    for (const e of incoming(graph, nodeId, "flow")) {
      const meta = httpMeta.get(e.from);
      if (!meta) continue;
      const cur = ctx[e.from];
      ctx[e.from] =
        cur && typeof cur === "object" && !Array.isArray(cur)
          ? { ...meta, ...(cur as Record<string, unknown>) }
          : { ...meta, content: cur };
    }
    for (const [id, meta] of httpMeta) {
      if (!(id in ctx)) ctx[id] = meta;
    }
    return ctx;
  };
  /** Flow edges that actually carried a packet this run (branch nodes only emit
   *  on the edges they routed to). Drives branch-aware scheduling. */
  const packetEdges = opts.init.packetEdges;

  let status: Status = "done";
  let running = 0;
  let aborted = false;
  let finished = false;
  let haltNodeId: string | undefined;
  let haltReason: string | undefined;

  // Relative artifact URIs (/api/artifacts/<id>) are meaningless to downstream
  // prompts and gate judges — publish them as absolute URLs when an origin is
  // configured, so products carry fully-qualified image links.
  const absUrl = (uri: string): string =>
    uri.startsWith("/") && opts.publicUrl ? opts.publicUrl + uri : uri;

  const inputFor = async (node: GraphNode, includeNote = true): Promise<string> => {
    const parts: string[] = [];
    const item = loopItemByNode.get(node.id);
    if (item !== undefined) parts.push(`[循环项数据] ${primaryValue(item)}`);
    for (const e of [...incoming(graph, node.id, "flow"), ...incoming(graph, node.id, "error")]) {
      const arts = artifacts.get(e.from) ?? [];
      for (const a of arts) {
        if (a.kind === "text" || a.kind === "json") {
          if (a.content) parts.push(a.content);
        } else if (a.kind === "image") {
          const label = a.label ?? "上游图片";
          const uriPart = a.uri ? ` — URL: ${absUrl(a.uri)}` : "";
          parts.push(`[图片: ${label}${uriPart}]`);
        } else if (a.kind === "video") {
          parts.push(`[视频: ${a.label ?? (a.uri ? absUrl(a.uri) : "上游视频")}]`);
        } else if (a.kind === "audio") {
          parts.push(`[音频: ${a.label ?? (a.uri ? absUrl(a.uri) : "上游音频")}]`);
        } else if (a.kind === "file") {
          parts.push(`[文件: ${a.label ?? (a.uri ? absUrl(a.uri) : "上游文件")}]`);
        } else if (a.kind === "uri") {
          parts.push(`[链接: ${a.uri ? absUrl(a.uri) : ""}]`);
        }
      }
    }
    const policy = node.textGen?.inputPolicy ?? { mode: "all" as const };
    let body: string;
    if (policy.mode === "summary") {
      const full = parts.join("\n\n");
      const max = policy.maxChars ?? Infinity;
      if (full.length > max && worker.summarize) {
        // Rolling summary: compress via the model instead of hard truncation.
        try {
          body = await worker.summarize({
            text: full,
            maxChars: max,
            model: node.textGen?.model,
            signal: opts.signal,
          });
        } catch {
          body = truncateText(full, max);
        }
        if (!body || body.trim().length === 0) body = truncateText(full, max);
      } else if (full.length > max) {
        body = truncateText(full, max);
      } else {
        body = full;
      }
    } else {
      body = assembleInput(parts, policy);
    }

    // NOTE: upstream prohibited/brand terms are NOT injected into the user
    // input body here — they are injected into the agent SYSTEM prompt at the
    // run site (see runNode's agent branch), which is authoritative and
    // survives input truncation/summarization.

    const note = includeNote ? reworkNotes.get(node.id) : undefined;
    if (!note) return body;
    return `${body}\n\n[质检站退回原因] ${note}`;
  };

  /**
   * Branch-aware readiness: every flow predecessor must be terminal (done or
   * skipped), each done predecessor must have actually sent a packet on its
   * edge (branch nodes only emit on routed edges — a non-branch predecessor
   * that is done always sent its packets), and at least one packet must have
   * arrived so un-routed branch tails stay unlaunched.
   */
  const predecessorsReady = (id: string) => {
    // Catch nodes (with error edges in): ready as soon as any error predecessor
    // has failed and sent its error packet. They don't wait for flow preds.
    const errIns = incoming(graph, id, "error");
    if (errIns.length > 0) {
      return errIns.some((e) => states.get(e.from) === "failed" && packetEdges.has(e.id));
    }
    const ins = incoming(graph, id, "flow");
    if (ins.length === 0) return true; // entry nodes (sources / isolated) start immediately
    let anyPacket = false;
    for (const e of ins) {
      const st = states.get(e.from);
      if (st === "skipped") continue;
      if (st === "failed") {
        // A failed flow predecessor must not hold a merge point hostage when
        // its failure was handled: every error edge led to a catch node that
        // finished done. Waiting for it would strand the merge forever while
        // the run still reports done — a silent drop (dogfood tpl-doc-ingest:
        // combine never ran after ocr failed, ocrFallback finished, and the
        // run ended "done" with no sink output).
        const errOut = outgoing(graph, e.from, "error");
        const handled =
          errOut.length > 0 && errOut.every((ee) => states.get(ee.to) === "done");
        if (!handled) return false;
        continue;
      }
      if (st !== "done") return false;
      if (packetEdges.has(e.id)) {
        anyPacket = true;
      } else if (nodeById(graph, e.from)?.kind !== "branch") {
        return false;
      }
    }
    return anyPacket;
  };

  /**
   * Mark the un-routed tail of a branch node as skipped, propagating down the
   * flow graph until a merge point (a node that also receives input from a
   * routed or independent predecessor) is reached — that node keeps executing.
   */
  const markBranchSkipped = (branchId: string, routedTarget?: string) => {
    const seeds = outgoing(graph, branchId, "flow")
      .map((e) => e.to)
      .filter((to) => to !== routedTarget);
    const skipped = new Set<string>();
    const queue = [...seeds];
    while (queue.length) {
      const id = queue.shift()!;
      if (skipped.has(id)) continue;
      const flowIn = incoming(graph, id, "flow");
      const hasIndependentSource = flowIn.some((e) => e.from !== branchId && !skipped.has(e.from));
      if (hasIndependentSource) continue; // merge point — it still receives data
      skipped.add(id);
      for (const e of outgoing(graph, id, "flow")) queue.push(e.to);
    }
    for (const id of skipped) {
      states.set(id, "skipped");
      // The un-routed tail must be visible in the event log: without a
      // node.skipped event a resume cannot reconstruct the skip and re-seeds
      // the node as pending, which strands every downstream merge point
      // (dogfood tpl-customer-service: after a human approve the notify →
      // depot tail never ran and the run still reported done).
      emit({
        type: "node.skipped",
        nodeId: id,
        attempt: attempts.get(id) ?? 1,
        reason: "branch not taken",
      });
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    let strandedNote: string | undefined;
    // A failed node is "handled" if it has an error edge to a catch node that
    // finished done — such failures don't sink the run (the catch produced a
    // fallback). Unhandled failures downgrade done → failed.
    if (status !== "halted" && status !== "cancelled" && status !== "tripped") {
      const isHandled = (id: string) =>
        outgoing(graph, id, "error").some((e) => states.get(e.to) === "done");
      // Child-graph failures (prefix `#sub:`) are judged by the sub-flow's own
      // finish — they must not sink the parent when the child run itself ended
      // done (e.g. an error edge inside the sub-flow caught the failure).
      // Variant lanes (`#var:`) are judged by the fanout/select that spawned
      // them, so a failed sibling lane must not sink the parent run either.
      const isNamespaced = (id: string) => id.includes("#sub:") || id.includes("#var:");
      const unhandled = [...states.entries()].some(
        ([id, s]) => s === "failed" && !isNamespaced(id) && !isHandled(id),
      );
      // Nodes still pending here were never scheduled, so their products are
      // silently missing. Recomputing the status from failures alone used to
      // overwrite the scheduler's stranded verdict with "done" — the exact
      // silent drop e6dc2c9 set out to outlaw (dogfood tpl-customer-service).
      const stranded = [...states.entries()]
        .filter(([id, s]) => s === "pending" && !isNamespaced(id))
        .map(([id]) => id);
      if (stranded.length > 0) {
        strandedNote = `以下节点从未被调度、产物缺失：${stranded
          .map((id) => nodeById(graph, id)?.name ?? id)
          .join("、")}`;
      }
      status = unhandled || stranded.length > 0 ? "failed" : "done";
      if (status === "failed") {
        // Alert the operator: which nodes failed (unhandled by a catch), which
        // were stranded, and how many downstream nodes got skipped.
        // Fire-and-forget, never blocks.
        void notifyFailed({
          runId,
          graphId: graph.id,
          failedNodes: [
            ...[...states.entries()]
              .filter(([id, s]) => s === "failed" && !isHandled(id))
              .map(([id]) => {
                const le = lastError.get(id);
                return { nodeId: id, error: le?.error ?? "node failed", errorCode: le?.errorCode };
              }),
            ...stranded.map((id) => ({
              nodeId: id,
              error: "节点从未被调度（stranded pending），产物缺失",
              errorCode: "STRANDED",
            })),
          ],
          skippedCount: [...states.values()].filter((s) => s === "skipped").length,
        });
      }
    }
    emit({
      type: "run.finished",
      runId,
      status,
      ...(strandedNote ? { reason: strandedNote } : {}),
      ...(haltNodeId ? { haltedNodeId: haltNodeId, reason: haltReason } : {}),
    });
    queue.close();
  };

  const sendPackets = (nodeId: string, summary: string, artifactKind?: Artifact["kind"]) => {
    // Loop-body nodes DO send their packets: downstream merge points need the
    // packet for branch-aware readiness, and their artifacts are overwritten
    // each round so no data actually duplicates. The loop node's running state
    // already prevents the scheduler from launching body nodes itself.
    for (const e of outgoing(graph, nodeId, "flow")) {
      packetEdges.add(e.id);
      emit({ type: "packet.sent", edgeId: e.id, from: nodeId, to: e.to, summary, artifactKind });
    }
  };

  /**
   * Best structured value a node produced: JSON artifacts win, then text that
   * happens to hold JSON, then the raw text. Used to aggregate loop rounds and
   * subprocess sink outputs.
   */
  const artifactValue = (id: string): unknown => {
    const arts = artifacts.get(id) ?? [];
    const json = arts.find((a) => a.kind === "json");
    if (json?.content) {
      try {
        return JSON.parse(json.content);
      } catch {
        return json.content;
      }
    }
    const text = arts.find((a) => a.kind === "text");
    if (text?.content) {
      try {
        return JSON.parse(text.content);
      } catch {
        return text.content;
      }
    }
    return null;
  };

  /** Produce typed artifacts from a node's output and emit events. Returns the primary kind. */
  const produceArtifacts = (nodeId: string, output: string, attempt?: number): Artifact["kind"] => {
    const extracted = extractArtifacts(output, nodeId);
    let primary: Artifact["kind"] = "text";
    // Persist the node's own text note (set by setTextArtifact) so plain-text
    // products are attributable to their pipeline and appear in the gallery.
    const note = (artifacts.get(nodeId) ?? []).find((a) => a.kind === "text");
    if (note) emit({ type: "artifact.produced", nodeId, attempt, artifact: note });
    for (const a of extracted) {
      emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
      if (a.kind !== "text") primary = a.kind;
    }
    return primary;
  };

  /**
   * Subprocess namespace helpers: a child graph's state lives under a
   * `<subNode>#sub:` prefix in the parent's maps. When a child halts, its
   * state is persisted there so a later resume can re-extract it and continue
   * the sub-flow exactly where it paused (already-done child nodes stay done,
   * the halted node was pre-marked by the resume's approve/reject handling).
   */
  const extractSubInit = (prefix: string, childGraph: Graph): SchedulerInit | null => {
    let found = false;
    const childStates = new Map<string, NodeState>(
      childGraph.nodes.map((n) => [n.id, "pending" as NodeState]),
    );
    for (const [k, v] of states) {
      if (!k.startsWith(prefix)) continue;
      found = true;
      childStates.set(k.slice(prefix.length), v);
    }
    if (!found) return null; // first invocation — no saved child state yet
    const childArtifacts = new Map<string, Artifact[]>();
    const childAttempts = new Map<string, number>();
    const childCosts = new Map<string, number>();
    for (const [k, v] of artifacts) if (k.startsWith(prefix)) childArtifacts.set(k.slice(prefix.length), v);
    for (const [k, v] of attempts) if (k.startsWith(prefix)) childAttempts.set(k.slice(prefix.length), v);
    for (const [k, v] of nodeCostUsd) if (k.startsWith(prefix)) childCosts.set(k.slice(prefix.length), v);
    // Packets the paused sub-flow had already sent: the parent log records child
    // edge ids verbatim, so intersect the parent's set with the child's edges.
    const childEdgeIds = new Set(childGraph.edges.map((e) => e.id));
    const childPackets = new Set<string>();
    for (const e of packetEdges) if (childEdgeIds.has(e)) childPackets.add(e);
    // A child node that is already done when the sub-flow re-enters (e.g. the
    // human node the operator just approved) never re-sends its packets: the
    // resume pre-marks the PREFIXED id, and `sendPackets` looks the node up in
    // the parent graph, which has no such node or edge — so nothing is sent.
    // Without the packet, branch-aware readiness keeps the child's downstream
    // pending forever and the sub-flow used to report done with its sink never
    // run (a silent drop; exposed by the stranded-pending guard). Restore the
    // "done ⇒ packets sent" invariant for non-branch nodes — a branch only ever
    // packets the edge it routed, which the log intersection above preserves.
    for (const [id, v] of childStates) {
      if (v !== "done") continue;
      if (nodeById(childGraph, id)?.kind === "branch") continue;
      for (const e of outgoing(childGraph, id, "flow")) childPackets.add(e.id);
    }
    return {
      artifacts: childArtifacts,
      attempts: childAttempts,
      nodeCostUsd: childCosts,
      // Prior spend already joined the parent's ledger on halt — count only
      // fresh spend from here on (avoids double-counting across resumes).
      totalCostUsd: 0,
      states: childStates,
      approvedTools: [...approved],
      packetEdges: childPackets,
      // Shared by reference: sub-process runs read/write the parent's variables.
      variables,
    };
  };

  const mergeSubInit = (prefix: string, childInit: SchedulerInit) => {
    for (const [k, v] of childInit.states) states.set(prefix + k, v);
    for (const [k, v] of childInit.artifacts) artifacts.set(prefix + k, v);
    for (const [k, v] of childInit.attempts) attempts.set(prefix + k, v);
    for (const [k, v] of childInit.nodeCostUsd) nodeCostUsd.set(prefix + k, v);
  };

  // --- Per-node-kind execution bodies, extracted from runNode's if-chain (2.1).
  // They close over the scheduler's shared state and are invoked from runNode's
  // dispatch switch. `node`/`nodeId`/`attempt` are runNode-local, so passed in.

  const runHuman = async (node: GraphNode, nodeId: string, attempt: number) => {
    // Pause the run at an arbitrary point for an operator decision. The
    // upstream text becomes the pending review; approve/edit passes it
    // downstream, reject fails the node (error edges can catch it).
    const output = await inputFor(node);
    emit({ type: "node.started", nodeId, attempt });
    emit({ type: "human.review", nodeId, attempt, content: output });
    haltNodeId = nodeId;
    haltReason = `human:${node.human?.prompt || node.name}`;
    status = "halted";
    aborted = true;
    void notifyHalt({ runId, graphId: graph.id, nodeId, reason: haltReason });
  };

  const runCompliance = async (node: GraphNode, nodeId: string, attempt: number) => {
    emit({ type: "node.started", nodeId, attempt });
    try {
      const cfg = ComplianceConfig.parse(node.compliance ?? {});
      const output = await inputFor(node);
      if (!output.trim()) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: "合规节点没有收到可校验的文本",
          errorCode: "VALIDATION",
        });
        return;
      }
      // Merge the user's stored banned terms with the node's extra list, so
      // the vocabulary library is honoured without the user re-typing it.
      const extra = [cfg.extraBanned, opts.bannedTerms ?? ""].filter(Boolean).join(",");
      const result = checkCompliance({
        platform: cfg.platform,
        extraBanned: extra,
        autoFix: cfg.autoFix,
        text: output,
      });
      const payload = complianceArtifact(result);
      const jsonArtifact: Artifact = {
        id: `${nodeId}-compliance`,
        kind: "json",
        content: JSON.stringify(payload),
        mimeType: "application/json",
      };
      const produced: Artifact[] = [jsonArtifact];
      // Downstream nodes consume the sanitized text (autoFix on) or the
      // original (autoFix off / no violations).
      const downstreamText = result.sanitized || result.original;
      setTextArtifact(artifacts, nodeId, downstreamText);
      artifacts.set(nodeId, [...produced, ...(artifacts.get(nodeId) ?? [])]);
      for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });

      if (cfg.failOnViolation && !result.passed) {
        const first = result.violations[0];
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `合规校验未通过（${result.violations.length} 处违规，首条：${first?.rule ?? ""}）`,
          errorCode: "VALIDATION",
        });
        return;
      }

      states.set(nodeId, "done");
      const summary = result.passed
        ? "合规校验通过"
        : `合规校验发现 ${result.violations.length} 处违规（已${cfg.autoFix ? "自动修复" : "标注"}）`;
      emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
      sendPackets(nodeId, summary, "json");
    } catch (err) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `合规校验节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const runPublish = async (node: GraphNode, nodeId: string, attempt: number) => {
    emit({ type: "node.started", nodeId, attempt });
    try {
      const cfg = PublishConfig.parse(node.publish ?? {});
      const output = await inputFor(node);
      if (!output.trim()) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: "发布节点没有收到可整理的文本",
          errorCode: "VALIDATION",
        });
        return;
      }
      const pkg = buildPublishPackage(output, cfg);
      const payload = publishArtifact(pkg);
      const jsonArtifact: Artifact = {
        id: `${nodeId}-publish`,
        kind: "json",
        content: JSON.stringify(payload),
        mimeType: "application/json",
      };
      const produced: Artifact[] = [jsonArtifact];
      // Downstream nodes consume the assembled body (falls back to the title).
      const downstreamText = pkg.body || pkg.title;
      setTextArtifact(artifacts, nodeId, downstreamText);
      artifacts.set(nodeId, [...produced, ...(artifacts.get(nodeId) ?? [])]);
      for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });

      states.set(nodeId, "done");
      const summary = `已整理为${pkg.platformLabel}待发布包（标题 ${pkg.title.length} 字 / 正文 ${pkg.body.length} 字）`;
      emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
      sendPackets(nodeId, summary, "json");
    } catch (err) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `发布节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const runMap = async (node: GraphNode, nodeId: string, attempt: number) => {
    emit({ type: "node.started", nodeId, attempt });
    try {
      const cfg = MapConfig.parse(node.map ?? {});
      const ctx = nodeCtx(nodeId);
      const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
      const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
      if (!sourceId) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: "Map 节点需要恰好一个上游节点（或在设置中指定 source）",
          errorCode: "VALIDATION",
        });
        return;
      }
      let template: unknown;
      try {
        template = JSON.parse(cfg.template);
      } catch {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error:
            "映射模板不是合法的 JSON：模板整体须是 JSON 文档，${...} 占位符请写在字符串值内（如 \"age\": \"${item.age}\"，纯占位符会自动保留数字/对象类型）",
          errorCode: "VALIDATION",
        });
        return;
      }
      const sourceVal = ctx[sourceId];
      let out: unknown;
      if (cfg.iterate) {
        const arr = getByPath(sourceVal, cfg.iterate);
        if (!Array.isArray(arr)) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `iterate 路径 "${cfg.iterate}" 解析结果不是数组`,
            errorCode: "VALIDATION",
          });
          return;
        }
        out = arr.map((item) => transformJson(template, { ...ctx, item }));
      } else {
        out = transformJson(template, { ...ctx, item: sourceVal });
      }
      const content = JSON.stringify(out);
      const artifact: Artifact = {
        id: `${nodeId}-map-json`,
        kind: "json",
        content,
        mimeType: "application/json",
      };
      artifacts.set(nodeId, [artifact]);
      emit({ type: "artifact.produced", nodeId, attempt, artifact });
      states.set(nodeId, "done");
      const summary =
        cfg.iterate && Array.isArray(out)
          ? `映射 ${out.length} 项 → ${truncateText(content, 60)}`
          : `映射完成 → ${truncateText(content, 60)}`;
      emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
      sendPackets(nodeId, summary, "json");
    } catch (err) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `Map 节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const runParallel = async (node: GraphNode, nodeId: string, attempt: number) => {
    emit({ type: "node.started", nodeId, attempt });
    try {
      const cfg = ParallelConfig.parse(node.parallel ?? {});
      const ins = incoming(graph, nodeId, "flow");
      const values: unknown[] = [];
      const byId: Record<string, unknown> = {};
      for (const e of ins) {
        const arts = artifacts.get(e.from) ?? [];
        const json = arts.find((a) => a.kind === "json");
        let val: unknown = null;
        if (json?.content) {
          try {
            val = JSON.parse(json.content);
          } catch {
            val = json.content;
          }
        } else {
          const text = arts.find((a) => a.kind === "text");
          val = text?.content ?? "";
        }
        if (cfg.pick) {
          const picked = getByPath(val, cfg.pick);
          if (picked !== undefined) val = picked;
        }
        values.push(val);
        byId[e.from] = val;
      }
      const out = cfg.asObject ? byId : values;
      const content = JSON.stringify(out);
      const artifact: Artifact = {
        id: `${nodeId}-parallel-json`,
        kind: "json",
        content,
        mimeType: "application/json",
      };
      artifacts.set(nodeId, [artifact]);
      emit({ type: "artifact.produced", nodeId, attempt, artifact });
      states.set(nodeId, "done");
      const summary = `聚合 ${ins.length} 个分支 → ${truncateText(content, 60)}`;
      emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
      sendPackets(nodeId, summary, "json");
    } catch (err) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `Parallel 节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const runDatabase = async (node: GraphNode, nodeId: string, attempt: number) => {
    emit({ type: "node.started", nodeId, attempt });
    try {
      const cfg = DatabaseConfig.parse(node.database ?? {});
      if (!cfg.sql.trim()) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: "数据库节点需要填写 SQL 语句",
          errorCode: "VALIDATION",
        });
        return;
      }
      const driver = createSqliteDriver(cfg.path);
      try {
        driver.setup(cfg.setupSql);
        const result = driver.query(cfg.sql, {
          positional: cfg.positionalParams,
          named: cfg.namedParams,
        });
        if (result.rows !== undefined) {
          const content = JSON.stringify({
            rows: result.rows,
            count: result.rows.length,
            columns: result.columns ?? [],
          });
          const produced: Artifact[] = [
            { id: `${nodeId}-db-json`, kind: "json", content, mimeType: "application/json" },
          ];
          artifacts.set(nodeId, produced);
          for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
          states.set(nodeId, "done");
          const summary = `数据库查询完成：${result.rows.length} 行 × ${(result.columns ?? []).length} 列`;
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          sendPackets(nodeId, summary, "json");
        } else {
          const content = JSON.stringify({
            affectedRows: result.affectedRows ?? 0,
            lastInsertId: result.lastInsertId ?? null,
          });
          const produced: Artifact[] = [
            { id: `${nodeId}-db-json`, kind: "json", content, mimeType: "application/json" },
          ];
          artifacts.set(nodeId, produced);
          for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
          states.set(nodeId, "done");
          const summary = `数据库执行完成：影响 ${result.affectedRows ?? 0} 行`;
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          sendPackets(nodeId, summary, "json");
        }
      } finally {
        driver.close();
      }
    } catch (err) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `数据库节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // Runs a single source/sink/gate/agent to completion. Resolves when the node
  // reaches a terminal state (done/failed) so the scheduler can relaunch.
  const runNode = async (nodeId: string) => {
    const node = nodeById(graph, nodeId);
    if (!node) return;

    if (opts.signal?.aborted) {
      aborted = true;
      return;
    }

    states.set(nodeId, "running");
    const attempt = (attempts.get(nodeId) ?? 0) + 1;
    attempts.set(nodeId, attempt);

    try {
      if (node.kind === "fanout") {
        const cfg: FanoutConfig = node.fanout ?? FanoutConfig.parse({});
        const input = await inputFor(node);
        const variants = buildVariantParams(cfg, opts.fallbackModel);
        const variantIds = variants.map((v) => v.id);
        emit({ type: "node.started", nodeId, attempt });
        emit({ type: "variants.spawned", nodeId, variantIds });

        const selectId = firstSelectDownstream(graph, nodeId);
        if (!selectId) {
          states.set(nodeId, "failed");
          emit({ type: "node.failed", nodeId, attempt, error: "扇出节点缺少下游择优节点", errorCode: "VALIDATION" });
          return;
        }
        const laneIds = variantLaneIds(graph, nodeId, selectId);

        // Each lane runs as an isolated sub-run (same mechanism as a subprocess
        // node): one lane failing only ends that lane, never its siblings.
        const results: Array<{ variant: string; output: string; ok: boolean; error?: string }> = [];
        for (const v of variants) {
          const subGraph = buildVariantGraph(graph, nodeId, selectId, laneIds, v);
          const { plan: subPlan } = compile(subGraph);
          if (!subPlan) {
            results.push({ variant: v.id, output: "", ok: false, error: "泳道子图编译失败" });
            continue;
          }
          const prefix = `${nodeId}#var:${v.id}:`;
          const childInit: SchedulerInit = {
            artifacts: new Map(),
            attempts: new Map(),
            nodeCostUsd: new Map(),
            totalCostUsd: 0,
            states: new Map(subGraph.nodes.map((n) => [n.id, "pending" as NodeState])),
            approvedTools: [...approved],
            packetEdges: new Set(),
            variables,
          };
          const depth = opts.subprocessDepth ?? 0;
          const childGen = await runScheduler({
            runId,
            graph: subGraph,
            plan: subPlan,
            worker,
            budgetUsd: null,
            monthlyBudgetUsd: null,
            monthSpentUsd: 0,
            fallbackModel: opts.fallbackModel,
            startSeq: 0,
            sourceInput: input,
            connectorValues: opts.connectorValues,
            signal: opts.signal,
            now: opts.now,
            sleep: opts.sleep,
            init: childInit,
            initialVariables: variables,
            resuming: true,
            subprocessDepth: depth + 1,
            storeBinary: opts.storeBinary,
            readArtifact: opts.readArtifact,
            publicUrl: opts.publicUrl,
            permissionConfig: opts.permissionConfig,
            bannedTerms: opts.bannedTerms,
            loadProducts: opts.loadProducts,
          });
          let childStatus: Status | undefined;
          for await (const e of childGen) {
            if (e.type === "run.finished") {
              childStatus = e.status;
              break;
            }
            emit(prefixEvent(e, prefix));
          }
          mergeSubInit(prefix, childInit);
          totalCostUsd += childInit.totalCostUsd;
          const sinkNode = subGraph.nodes.find((n) => n.kind === "sink");
          const output = sinkNode ? artifactValue(prefix + sinkNode.id) : null;
          const text = typeof output === "string" ? output : output == null ? "" : JSON.stringify(output);
          results.push(childStatus === "done" ? { variant: v.id, output: text, ok: true } : { variant: v.id, output: "", ok: false, error: childStatus ?? "failed" });
        }

        const payload = JSON.stringify({ variants: results });
        artifacts.set(nodeId, [{ id: `${nodeId}-variants`, kind: "json", content: payload, mimeType: "application/json" }]);
        states.set(nodeId, "done");
        emit({ type: "node.finished", nodeId, attempt, output: payload, usage: zeroUsage() });
        produceArtifacts(nodeId, payload, attempt);
        sendPackets(nodeId, `${results.length} 条变体`, "json");
        return;
      }

      if (node.kind === "select") {
        const cfg: SelectConfig = node.select ?? SelectConfig.parse({});
        const fanoutId = firstFanoutUpstream(graph, nodeId);
        if (!fanoutId) {
          states.set(nodeId, "failed");
          emit({ type: "node.failed", nodeId, attempt, error: "择优节点缺少上游扇出节点", errorCode: "VALIDATION" });
          return;
        }
        const raw = artifacts.get(fanoutId) ?? [];
        const summaryArt = raw.find((a) => a.kind === "json");
        let variants: Array<{ variant: string; output: string; ok: boolean; error?: string }> = [];
        try {
          variants = (JSON.parse(summaryArt?.content ?? "{}") as { variants: typeof variants }).variants ?? [];
        } catch {
          variants = [];
        }
        const failed = variants.filter((v) => !v.ok).map((v) => v.variant);
        const alive = variants.filter((v) => v.ok);

        // Failure semantics: zero surviving lanes → select fails loudly, never
        // "chooses 0 of an empty set" (the 2797011 class).
        if (alive.length === 0) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `全部变体泳道均失败，无法择优${failed.length ? `（失败：${failed.join("、")}）` : ""}`,
            errorCode: "SUBPROCESS",
          });
          return;
        }

        // Rank by the configured mode (llm_score via the shared judge channel,
        // or a deterministic rule).
        let ranking: Array<{ variant: string; score: number; reason: string }>;
        if (cfg.mode === "rule") {
          const field = cfg.rule?.field ?? "length";
          const desc = cfg.rule?.desc ?? true;
          ranking = alive
            .map((a) => {
              let score = 0;
              if (field === "length") score = a.output.length;
              else if (field === "brandCoverage") {
                const terms = upstreamBrandTerms(graph, nodeId);
                const hits = terms.filter((t) => a.output.includes(t));
                score = terms.length ? hits.length / terms.length : 0;
              } else {
                try {
                  const val = getByPath(JSON.parse(a.output), cfg.rule?.path ?? "");
                  score = typeof val === "number" ? val : String(val ?? "").length;
                } catch {
                  score = 0;
                }
              }
              return { variant: a.variant, score, reason: `规则排序 ${field}` };
            })
            .sort((x, y) => (desc ? y.score - x.score : x.score - y.score));
        } else {
          ranking = [];
          for (const a of alive) {
            const verdict = await worker.judge({
              node,
              attempt,
              input: a.output,
              output: a.output,
              criterion: cfg.rubric || "请根据文案质量、卖点表达、可读性综合打分（0-10）",
              signal: opts.signal,
            });
            ranking.push({ variant: a.variant, score: verdict.score ?? 0, reason: verdict.reason });
          }
          ranking.sort((x, y) => y.score - x.score);
        }

        const topK = Math.min(cfg.topK, ranking.length);
        const chosen = ranking.slice(0, topK).map((r) => r.variant);
        emit({
          type: "variants.ranked",
          nodeId,
          ranking,
          chosen,
          ...(failed.length ? { failed } : {}),
        });

        const chosenEntries = ranking.slice(0, topK).map((r) => {
          const a = alive.find((x) => x.variant === r.variant);
          return { variant: r.variant, score: r.score, reason: r.reason, content: a?.output ?? "" };
        });
        const output =
          cfg.topK === 1 && chosenEntries.length === 1
            ? chosenEntries[0]!.content
            : JSON.stringify(chosenEntries, null, 2);
        setTextArtifact(artifacts, nodeId, output);
        states.set(nodeId, "done");
        emit({ type: "node.started", nodeId, attempt });
        emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
        produceArtifacts(nodeId, output, attempt);
        sendPackets(nodeId, output.slice(0, 120), "text");
        return;
      }

      if (node.kind === "source" || node.kind === "sink") {
        if (node.kind === "sink") {
          const output = await inputFor(node);
          setTextArtifact(artifacts, nodeId, output);
          states.set(nodeId, "done");
          emit({ type: "node.started", nodeId, attempt });
          emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
          produceArtifacts(nodeId, output, attempt);
          sendPackets(nodeId, output.slice(0, 120), "text");
          return;
        }

        // source: optionally pull raw material from a connector before welding.
        let sourceText = opts.sourceInput ?? "";
        let sourceImages = node.source?.images ?? [];
        const sourceFiles = node.source?.files ?? [];
        const conn = node.source?.connector;
        if (conn) {
          let ok = false;
          let lastErr: unknown;
          for (let i = 0; i <= CONNECTOR_MAX_RETRIES && !ok; i++) {
            try {
              const m = await resolveConnector(conn, opts.connectorValues, opts.loadProducts);
              sourceText = m.text || opts.sourceInput || "";
              sourceImages = [...m.images, ...(node.source?.images ?? [])];
              ok = true;
            } catch (err) {
              lastErr = err;
              if (i < CONNECTOR_MAX_RETRIES) await opts.sleep(CONNECTOR_RETRY_DELAY_MS);
            }
          }
          if (!ok) {
            const msg = `Connector "${conn.type}" 拉取失败：${
              lastErr instanceof Error ? lastErr.message : String(lastErr)
            }`;
            states.set(nodeId, "failed");
            status = "failed";
            emit({ type: "node.failed", nodeId, attempt, error: msg, errorCode: "CONNECTOR" });
            return;
          }
        }

        const output = buildSourceBrief(node, sourceText);
        setTextArtifact(artifacts, nodeId, output);
        states.set(nodeId, "done");
        emit({ type: "node.started", nodeId, attempt });
        emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
        let primaryKind: Artifact["kind"] | undefined;
        // Uploaded documents become first-class file artifacts next to the text
        // note, so a downstream fileParse node can find its `kind === "file"`
        // input. Before this, no source node could produce a file at all — a
        // 「合同文件」 intake left fileParse failing with 没有产出文件产物
        // (dogfood 2026-09-01, tpl-contract-review).
        if (sourceFiles.length) {
          const nodeArts = artifacts.get(nodeId)!;
          for (const [i, f] of sourceFiles.entries()) {
            const a: Artifact = {
              id: `${nodeId}-file${i}`,
              kind: "file",
              uri: f.uri,
              mimeType: f.mimeType,
              label: f.label,
              sizeBytes: f.sizeBytes,
            };
            nodeArts.push(a);
            emit({ type: "artifact.produced", nodeId, artifact: a });
          }
        }
        if (sourceImages.length) {
          const nodeArts = artifacts.get(nodeId)!;
          for (const [i, url] of sourceImages.entries()) {
            const a: Artifact = { id: `${nodeId}-img${i}`, kind: "image", uri: url };
            nodeArts.push(a);
            emit({ type: "artifact.produced", nodeId, artifact: a });
          }
          primaryKind = "image";
        } else {
          primaryKind = produceArtifacts(nodeId, output, attempt);
        }
        sendPackets(nodeId, output.slice(0, 120), primaryKind);
        return;
      }

      if (node.kind === "http") {
        emit({ type: "node.started", nodeId, attempt });
        const cfg: HttpNodeConfig = HttpNodeConfig.parse(node.http ?? {});

        const ctx = interpCtx(nodeId);
        const interpolatedUrl = evaluateTemplate(cfg.url, ctx);
        if (!interpolatedUrl.trim()) {
          states.set(nodeId, "failed");
          status = "failed";
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: "HTTP 节点 URL 为空",
            errorCode: "VALIDATION",
          });
          return;
        }

        let targetUrl: URL;
        try {
          targetUrl = new URL(interpolatedUrl);
        } catch {
          states.set(nodeId, "failed");
          status = "failed";
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `HTTP 节点 URL 不合法: ${interpolatedUrl}`,
            errorCode: "VALIDATION",
          });
          return;
        }

        for (const [key, raw] of Object.entries(cfg.query ?? {})) {
          try {
            targetUrl.searchParams.set(key, evaluateTemplate(raw, ctx));
          } catch {
            // skip invalid params
          }
        }

        const headers: Record<string, string> = {};
        for (const [key, raw] of Object.entries(cfg.headers ?? {})) {
          headers[key] = evaluateTemplate(raw, ctx);
        }
        const contentType = headers["content-type"] ?? headers["Content-Type"];
        const body = cfg.body ? evaluateTemplate(cfg.body, ctx) : undefined;

        // SSRF guard: refuse private/internal targets (resolved at fetch time,
        // so DNS rebinding can't smuggle an internal address past the check).
        if (!allowPrivateNetwork() && (await hostIsInternal(targetUrl.hostname))) {
          states.set(nodeId, "failed");
          status = "failed";
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: "HTTP 节点拒绝访问内网或私网地址（SSRF 防护）",
            errorCode: "VALIDATION",
          });
          return;
        }

        let response: Response;
        try {
          response = await withRetry(
            async () => {
              // All outbound traffic leaves through guardedFetch: the DNS
              // answer that passes the internal check is the one the TCP/TLS
              // connection is pinned to (no check-vs-connect TOCTOU, audit
              // H3), and redirects are re-validated on every hop (audit C3).
              const abort = new AbortController();
              const timer = setTimeout(() => abort.abort(), cfg.timeoutMs);
              try {
                const r = await guardedFetch(targetUrl.toString(), {
                  method: cfg.method,
                  headers,
                  body: body && cfg.method !== "GET" ? body : undefined,
                  signal: abort.signal,
                  maxRedirects: 5,
                });
                // 5xx triggers the retry path; deterministic guard rejections
                // (GuardedFetchError) are excluded from retry below.
                // failOnError: false means the caller wants the status as data
                // (health checks), so 5xx must complete the node, not retry.
                if (cfg.failOnError && r.status >= 500) throw new Error(`HTTP ${r.status}`);
                return r;
              } finally {
                clearTimeout(timer);
              }
            },
            cfg.retry,
            // AbortError means the attempt timed out; deterministic failures
            // (SSRF rejection, redirect budget exhausted) must not be retried.
            (err) =>
              !(err instanceof Error && err.name === "AbortError") &&
              !(err instanceof Error && /SSRF 防护|重定向超过/.test(err.message)),
            opts.sleep,
          );
        } catch (err) {
          states.set(nodeId, "failed");
          status = "failed";
          const msg = err instanceof Error ? err.message : String(err);
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `HTTP 请求失败: ${msg}`,
            errorCode: msg.includes("SSRF 防护") ? "VALIDATION" : "PROVIDER_ERROR",
          });
          return;
        }

        // Expose response metadata for branch / notify interpolation
        // (`${nodeId.ok}` etc.); the artifact below carries only the payload.
        httpMeta.set(nodeId, {
          ok: response.ok,
          status: response.status,
          url: targetUrl.toString(),
          method: cfg.method,
        });

        if (cfg.outputMode === "file") {
          let arrayBuf: ArrayBuffer;
          try {
            arrayBuf = await response.arrayBuffer();
          } catch (err) {
            states.set(nodeId, "failed");
            status = "failed";
            const msg = err instanceof Error ? err.message : String(err);
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `读取 HTTP 响应失败: ${msg}`,
              errorCode: "PROVIDER_ERROR",
            });
            return;
          }
          if (cfg.failOnError && (response.status < 200 || response.status >= 300)) {
            states.set(nodeId, "failed");
            status = "failed";
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `HTTP ${cfg.method} ${targetUrl.toString()} 返回 ${response.status}`,
              errorCode: "PROVIDER_ERROR",
            });
            return;
          }
          const bytes = Buffer.from(arrayBuf);
          const ctHeader = response.headers.get("content-type") ?? "";
          const mime = (ctHeader.split(";")[0] ?? "").trim() || "application/octet-stream";
          const fileName = fileLabelFromUrl(targetUrl);
          const uri = await opts.storeBinary(bytes, mime, fileName);
          const artifact: Artifact = {
            id: `${nodeId}-file`,
            kind: "file",
            uri,
            mimeType: mime,
            label: fileName,
            sizeBytes: bytes.length,
          };
          artifacts.set(nodeId, [artifact]);
          emit({ type: "artifact.produced", nodeId, attempt, artifact });
          states.set(nodeId, "done");
          const summary = `已下载文件：${fileName}（${bytes.length} 字节，${mime}）`;
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          sendPackets(nodeId, summary, "file");
          return;
        }

        let responseText: string;
        try {
          responseText = await response.text();
        } catch (err) {
          states.set(nodeId, "failed");
          status = "failed";
          const msg = err instanceof Error ? err.message : String(err);
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `读取 HTTP 响应失败: ${msg}`,
            errorCode: "PROVIDER_ERROR",
          });
          return;
        }

        const contentTypeHeader = response.headers.get("content-type") ?? "";
        const isJsonByHeader = /application\/json|text\/json/i.test(contentTypeHeader);
        const canParseJson = (() => {
          try {
            JSON.parse(responseText);
            return true;
          } catch {
            return false;
          }
        })();
        const asJson = cfg.outputMode === "json" || (cfg.outputMode === "auto" && isJsonByHeader && canParseJson);

        if (cfg.failOnError && (response.status < 200 || response.status >= 300)) {
          states.set(nodeId, "failed");
          status = "failed";
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `HTTP ${cfg.method} ${targetUrl.toString()} 返回 ${response.status}: ${responseText.slice(0, 200)}`,
            errorCode: "PROVIDER_ERROR",
          });
          return;
        }

        const output = asJson ? JSON.stringify(JSON.parse(responseText), null, 2) : responseText;
        const artifact: Artifact = asJson
          ? { id: `${nodeId}-json`, kind: "json", content: output, mimeType: "application/json" }
          : { id: `${nodeId}-text`, kind: "text", content: output, mimeType: "text/plain" };
        artifacts.set(nodeId, [artifact]);
        emit({ type: "artifact.produced", nodeId, attempt, artifact });
        states.set(nodeId, "done");
        emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
        sendPackets(nodeId, output.slice(0, 120), artifact.kind);
        return;
      }

      if (node.kind === "code") {
        emit({ type: "node.started", nodeId, attempt });
        const cfg = CodeNodeConfig.parse(node.code ?? {});
        if (!cfg.code.trim()) {
          states.set(nodeId, "failed");
          status = "failed";
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: "代码节点脚本为空",
            errorCode: "VALIDATION",
          });
          return;
        }
        // net 策略：none = 不注入任何出口（子进程环境里没有代理变量）；
        // allowlist = rlimit/noop 后端下经本地 SSRF 校验代理放行 TOOL_NETWORK_ALLOW
        // 白名单（协作式：约束走 HTTP(S)_PROXY 的客户端，裸 socket 可绕过，
        // 见 design-code-sandbox.md §10）。bwrap / sandbox-exec 后端硬断网
        //（unshare-net / deny network*），代理不可达——诚实拒绝，绝不静默降级。
        let netToken: string | undefined;
        let netProxyEnv: Record<string, string> = {};
        if (cfg.net === "allowlist") {
          const backendName = resolveSandbox().name;
          if (backendName === "bwrap" || backendName === "sandbox-exec") {
            states.set(nodeId, "failed");
            status = "failed";
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `代码节点 net: "allowlist" 需要校验代理，但 ${backendName} 后端是硬断网（仅支持 net: "none"）`,
              errorCode: "VALIDATION",
            });
            return;
          }
          const netAllow = loadPermissionConfig().networkAllow;
          if (!netAllow || netAllow.length === 0) {
            states.set(nodeId, "failed");
            status = "failed";
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: '代码节点 net: "allowlist" 需要服务端配置 TOOL_NETWORK_ALLOW（逗号分隔的域名白名单）',
              errorCode: "VALIDATION",
            });
            return;
          }
          const proxyUrl = await getCodeProxyUrl();
          // Only 80/443 are reachable by default (audit L4: don't let code use
          // the proxy as an arbitrary-port jump host). TOOL_NETWORK_EXTRA_PORTS
          // is a comma-separated opt-in for non-standard ports (also the test
          // hook for loopback fixtures on ephemeral ports).
          const extraPorts = (process.env.TOOL_NETWORK_EXTRA_PORTS ?? "")
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535);
          netToken = registerNetToken({ runId, nodeId, allowlist: netAllow, extraConnectPorts: extraPorts });
          netProxyEnv = childProxyEnv(netToken, proxyUrl);
        }
        // fs 策略：allowlist = 在 workdir 之外额外授予只读访问
        // （TOOL_FS_ALLOW 前缀）。写入仍然仅限 workdir。
        const extraFsReadPaths =
          cfg.fs === "allowlist" ? (loadPermissionConfig().fsAllow ?? []) : [];
        // P0 sandbox: isolate cwd (per-run temp dir) + env allowlist + absolute
        // interpreter path. The temp dir is removed even on failure/timeout.
        const workdir = await createCodeWorkdir(runId, nodeId, attempt);
        try {
          const ctx = nodeCtx(nodeId);
          const inputJson = JSON.stringify({ inputs: ctx });
          // 代理 env 由 sandbox 注入（含 token），不走 trimEnv 的声明白名单
          const childEnv = { ...trimEnv(cfg.env), ...netProxyEnv };
          // P1+P2 sandbox: backend selected via CODE_SANDBOX (rlimit default;
          // bwrap / sandbox-exec / noop opt-in with loud degrade warnings).
          const cfgLimits = (cfg as unknown as { limits?: CodeSandboxLimits }).limits;
          const plan = resolveSandbox().planSpawn({
            language: cfg.language,
            code: cfg.code,
            workdir,
            limits: cfgLimits,
            extraFsReadPaths,
          });
          const spawnStartedAt = Date.now();
          const { stdout, stderr, killed, code } = await withRetry(
            async () => {
              const child = spawn(plan.command, plan.args, {
                stdio: ["pipe", "pipe", "pipe"],
                cwd: workdir,
                env: childEnv,
              });
              // If the interpreter dies before draining stdin (syntax error,
              // early exit), feeding it the input emits 'error' (EPIPE) on the
              // stream; with no listener that error event is unhandled and kills
              // the whole engine process (dogfood tpl-doc-ingest: a broken code
              // node took down the server). The failure is already reported via
              // the child's exit code + stderr, so swallow the pipe error here.
              child.stdin.on("error", () => {});
              child.stdin.end(inputJson);
              let stdout = "";
              let stderr = "";
              let killed = false;
              const cap = 1_000_000;
              child.stdout.on("data", (chunk: Buffer) => {
                if (stdout.length < cap) stdout += chunk.toString().slice(0, cap - stdout.length);
              });
              child.stderr.on("data", (chunk: Buffer) => {
                if (stderr.length < cap) stderr += chunk.toString().slice(0, cap - stderr.length);
              });
              const r = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
                const timer = setTimeout(() => {
                  killed = true;
                  child.kill("SIGKILL");
                  resolve({ code: null, signal: "timeout" });
                }, cfg.timeoutMs);
                child.on("error", (err) => {
                  clearTimeout(timer);
                  resolve({ code: -1, signal: err.message });
                });
                child.on("close", (code, signal) => {
                  clearTimeout(timer);
                  resolve({ code, signal });
                });
              });
              // Spawn failure (binary missing, etc.) → throw so withRetry can retry.
              // Non-zero exit and timeout are business errors, returned as-is.
              if (r.code === -1) throw new Error(`代码节点子进程启动失败: ${r.signal}`);
              return { stdout, stderr, killed, code: r.code };
            },
            cfg.retry,
            () => true,
            opts.sleep,
          );
          // 取证：单个 code 节点耗时超过 5 秒，几乎总是 CI 机器饥饿（2-vCPU
          // runner + 冷页缓存），而不是回归——2026-09-01 PR #98 就是在这一小段上
          // 把 vitest 的测试预算耗光的。打出来，让下一次红 CI 自己给出答案。
          const spawnWallMs = Date.now() - spawnStartedAt;
          if (spawnWallMs > 5000) {
            console.warn(
              `[engine:${nodeId}] code 节点子进程墙钟耗时 ${spawnWallMs}ms（怀疑 runner 负载/饥饿，不一定是回归）`,
            );
          }
          if (killed) {
            states.set(nodeId, "failed");
            status = "failed";
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `代码执行超时（${cfg.timeoutMs}ms）${stderr.slice(0, 200)}`,
              errorCode: "TIMEOUT",
            });
            return;
          }
          if (code !== 0) {
            states.set(nodeId, "failed");
            status = "failed";
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `代码执行失败（退出码 ${code}）: ${(stderr || "无 stderr 输出").slice(0, 300)}`,
              errorCode: "SCRIPT_ERROR",
            });
            return;
          }
          const raw = stdout.trim();
          let output = raw;
          let asJson = false;
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed !== null && typeof parsed === "object") asJson = true;
            } catch {
              // plain text output
            }
          }
          if (asJson) output = JSON.stringify(JSON.parse(raw), null, 2);
          const artifact: Artifact = asJson
            ? { id: `${nodeId}-code-json`, kind: "json", content: output, mimeType: "application/json" }
            : { id: `${nodeId}-code-text`, kind: "text", content: output, mimeType: "text/plain" };
          artifacts.set(nodeId, [artifact]);
          emit({ type: "artifact.produced", nodeId, attempt, artifact });
          states.set(nodeId, "done");
          emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
          sendPackets(nodeId, output.slice(0, 120), artifact.kind);
          return;
        } catch (err) {
          // 子进程根本起不来（解释器缺失、fork 被 EAGAIN 拒绝…）时 withRetry 会
          // 重试后抛错。必须落成诚实的 node.failed：裸抛会让节点停在 "running"，
          // 事件流里既没有 finished 也没有 failed，只留下一个查不出原因的缺失。
          states.set(nodeId, "failed");
          status = "failed";
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `代码节点无法执行: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
            errorCode: "SUBPROCESS",
          });
          return;
        } finally {
          if (netToken) unregisterNetToken(netToken);
          await cleanupCodeWorkdir(workdir);
        }
      }

      if (node.kind === "branch") {
        emit({ type: "node.started", nodeId, attempt });
        const cfg: BranchConfig = BranchConfig.parse(node.branch ?? {});
        const ctx = interpCtx(nodeId);
        let target: string | undefined;
        let matchedRule: string | undefined;
        for (const rule of cfg.rules ?? []) {
          if (evaluateCondition(rule.when, ctx)) {
            target = rule.target;
            matchedRule = rule.id;
            break;
          }
        }
        if (!target && cfg.defaultTarget) {
          target = cfg.defaultTarget;
          matchedRule = undefined;
        }
        if (target) {
          const edge = outgoing(graph, nodeId, "flow").find((e) => e.to === target);
          if (edge) {
            packetEdges.add(edge.id);
            emit({
              type: "packet.sent",
              edgeId: edge.id,
              from: nodeId,
              to: target,
              summary: matchedRule ? `命中分支 ${matchedRule}` : "默认分支",
              artifactKind: "text",
            });
          }
        }
        states.set(nodeId, "done");
        markBranchSkipped(nodeId, target);
        const output = target
          ? `路由 → ${nodeById(graph, target)?.name ?? target}${matchedRule ? `（${matchedRule}）` : "（默认）"}`
          : "未命中任何分支，报文被丢弃";
        emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
        return;
      }

      if (node.kind === "map") {
        await runMap(node, nodeId, attempt);
        return;
      }

      if (node.kind === "loop") {
        emit({ type: "node.started", nodeId, attempt });
        const bodyIds = new Set<string>();
        try {
          const cfg = LoopConfig.parse(node.loop ?? {});
          const ctx = nodeCtx(nodeId);
          const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
          const defaultSource = sources.length === 1 ? sources[0] : undefined;
          const itemsExpr = cfg.items ?? (defaultSource ? `\${${defaultSource}}` : "");
          if (!itemsExpr) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: "Loop 节点需要 items 表达式（或恰好一个上游节点提供数组）",
              errorCode: "VALIDATION",
            });
            return;
          }
          const raw = transformJson(itemsExpr, ctx);
          if (!Array.isArray(raw)) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `items 表达式求值结果不是数组（当前: ${typeof raw}）`,
              errorCode: "VALIDATION",
            });
            return;
          }
          const max = cfg.maxIterations ?? 100;
          const slice = raw.slice(0, max);

          // Loop body: BFS from the loop's flow edges. A node is part of the
          // body iff every flow predecessor is the loop itself or already in
          // the body — this stops at merge points that have outside inputs.
          const queue = outgoing(graph, nodeId, "flow").map((e) => e.to);
          while (queue.length > 0) {
            const id = queue.shift()!;
            if (bodyIds.has(id)) continue;
            const ins = incoming(graph, id, "flow");
            const allInside = ins.every((e) => e.from === nodeId || bodyIds.has(e.from));
            if (!allInside) continue;
            bodyIds.add(id);
            for (const e of outgoing(graph, id, "flow")) queue.push(e.to);
          }
          const bodyOrder = plan.order.filter((id) => bodyIds.has(id));
          if (bodyOrder.length === 0) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: "Loop 节点没有可执行的循环体，请连接下游节点",
              errorCode: "VALIDATION",
            });
            return;
          }
          // Terminal nodes of the body: all flow edges point outside it.
          const endNodes = bodyOrder.filter((id) =>
            outgoing(graph, id, "flow").every((e) => !bodyIds.has(e.to)),
          );
          const results: unknown[] = [];
          for (let i = 0; i < slice.length; i++) {
            const item = slice[i];
            for (const bodyId of bodyOrder) loopItemByNode.set(bodyId, item);
            for (const bodyId of bodyOrder) {
              // Borrow a running slot: runNode's finally decrements it, so
              // this keeps the run open while the loop executes its body
              // inline (otherwise running hits 0 mid-loop and the run closes).
              running++;
              await runNode(bodyId);
              if (states.get(bodyId) === "failed") {
                throw new Error(`循环体节点「${nodeById(graph, bodyId)?.name ?? bodyId}」执行失败`);
              }
            }
            if (endNodes.length === 1) {
              results.push(artifactValue(endNodes[0]!));
            } else {
              const round: Record<string, unknown> = {};
              for (const id of endNodes) round[id] = artifactValue(id);
              results.push(round);
            }
          }
          for (const bodyId of bodyIds) loopItemByNode.delete(bodyId);
          const content = JSON.stringify({ results });
          const artifact: Artifact = {
            id: `${nodeId}-loop-json`,
            kind: "json",
            content,
            mimeType: "application/json",
          };
          artifacts.set(nodeId, [artifact]);
          emit({ type: "artifact.produced", nodeId, attempt, artifact });
          states.set(nodeId, "done");
          const summary = `循环 ${slice.length} 次完成`;
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          sendPackets(nodeId, summary, "json");
        } catch (err) {
          for (const bodyId of bodyIds) loopItemByNode.delete(bodyId);
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `Loop 节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }

      if (node.kind === "subprocess") {
        emit({ type: "node.started", nodeId, attempt });
        try {
          const cfg = SubprocessConfig.parse(node.subprocess ?? {});
          const depth = opts.subprocessDepth ?? 0;
          if (depth >= cfg.maxDepth) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `子流程调用深度超限（第 ${depth + 1} 层超过 maxDepth ${cfg.maxDepth}），可能存在循环调用`,
              errorCode: "VALIDATION",
            });
            return;
          }
          const childGraph = opts.loadSubgraph?.(cfg.graphId);
          if (!childGraph) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `找不到子流程图「${cfg.graphId}」`,
              errorCode: "VALIDATION",
            });
            return;
          }
          const { plan: childPlan, diagnostics } = compile(childGraph);
          if (!childPlan) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `子流程图编译失败：${diagnostics.map((d) => d.message).join("；")}`,
              errorCode: "VALIDATION",
            });
            return;
          }

          // Isolated namespace: every child node id is prefixed with
          // `<subNode>#sub:` in the parent's maps/events so child ids can't
          // collide with (or leak into) the parent graph.
          const prefix = `${nodeId}#sub:`;
          const saved = extractSubInit(prefix, childGraph);
          const childInit: SchedulerInit = saved ?? {
            artifacts: new Map(),
            attempts: new Map(),
            nodeCostUsd: new Map(),
            totalCostUsd: 0,
            states: new Map(childGraph.nodes.map((n) => [n.id, "pending" as NodeState])),
            approvedTools: [...approved],
            packetEdges: new Set(),
            // Shared by reference: sub-process runs read/write the parent's variables.
            variables,
          };
          const sourceText = await inputFor(node);
          const childGen = await runScheduler({
            runId,
            graph: childGraph,
            plan: childPlan,
            worker,
            budgetUsd: null,
            monthlyBudgetUsd: null,
            monthSpentUsd: 0,
            fallbackModel: opts.fallbackModel,
            startSeq: 0,
            sourceInput: sourceText,
            connectorValues: opts.connectorValues,
            signal: opts.signal,
            now: opts.now,
            sleep: opts.sleep,
            init: childInit,
            // Shared by reference: sub-process runs read/write the parent's variables.
            initialVariables: variables,
            // Skip run.started (the parent already announced the run); the
            // child's run.finished is intercepted below and re-emitted by the
            // parent's own finish.
            resuming: true,
            subprocessDepth: depth + 1,
            storeBinary: opts.storeBinary,
            readArtifact: opts.readArtifact,
            publicUrl: opts.publicUrl,
            permissionConfig: opts.permissionConfig,
            bannedTerms: opts.bannedTerms,
            loadProducts: opts.loadProducts,
          });

          let childStatus: Status | undefined;
          let childHaltedId: string | undefined;
          let childHaltedReason: string | undefined;
          for await (const e of childGen) {
            if (e.type === "run.finished") {
              childStatus = e.status;
              childHaltedId = e.haltedNodeId;
              childHaltedReason = e.reason;
              break;
            }
            emit(prefixEvent(e, prefix));
          }
          // Persist the child's state under the prefix (whatever the outcome):
          // a halt must survive a resume so the sub-flow continues in place,
          // and a done child's sink products feed the aggregation below.
          mergeSubInit(prefix, childInit);
          // Shared budget: the child's spend joins the parent's ledger (V1 —
          // the child does not run its own budget check, documented limitation).
          totalCostUsd += childInit.totalCostUsd;

          if (childStatus === "halted") {
            haltNodeId = childHaltedId ? prefix + childHaltedId : nodeId;
            haltReason = childHaltedReason;
            status = "halted";
            aborted = true;
            return;
          }
          if (childStatus === "failed" || childStatus === "cancelled" || childStatus === "tripped") {
            if (aborted) return; // parent abort won the race — let the parent finish it
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error:
                childStatus === "failed"
                  ? "子流程执行失败"
                  : `子流程中止（${childStatus}）`,
              errorCode: "SUBPROCESS",
            });
            return;
          }

          // Child finished done: aggregate its sink outputs as this node's
          // product (single sink → its value; multiple sinks → {sinkId: value}).
          const sinks = childGraph.nodes.filter((n) => n.kind === "sink");
          const values = sinks.map((s) => [s.id, artifactValue(prefix + s.id)] as const);
          const content =
            sinks.length === 1
              ? JSON.stringify(values[0]?.[1] ?? null)
              : JSON.stringify(Object.fromEntries(values));
          const artifact: Artifact = {
            id: `${nodeId}-sub-json`,
            kind: "json",
            content,
            mimeType: "application/json",
          };
          artifacts.set(nodeId, [artifact]);
          emit({ type: "artifact.produced", nodeId, attempt, artifact });
          states.set(nodeId, "done");
          const summary = `子流程「${childGraph.name}」完成`;
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          sendPackets(nodeId, summary, "json");
        } catch (err) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `Subprocess 节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
            errorCode: "SUBPROCESS",
          });
        }
        return;
      }

      if (node.kind === "parallel") {
        await runParallel(node, nodeId, attempt);
        return;
      }

      if (node.kind === "table") {
        emit({ type: "node.started", nodeId, attempt });
        try {
          const cfg = TableConfig.parse(node.table ?? {});
          const ctx = nodeCtx(nodeId);
          const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
          const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
          if (!sourceId) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: "Table 节点需要恰好一个上游节点（或在设置中指定 source）",
              errorCode: "VALIDATION",
            });
            return;
          }
          let input: TableInput;
          try {
            input = tableInputFrom(ctx[sourceId]);
          } catch (err) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: err instanceof Error ? err.message : String(err),
              errorCode: "VALIDATION",
            });
            return;
          }
          const { rows, output } = applyTableSteps(input, cfg.steps);
          const columns = collectColumns(rows);
          const content = JSON.stringify({ rows, count: rows.length, columns });
          const produced: Artifact[] = [
            { id: `${nodeId}-table-json`, kind: "json", content, mimeType: "application/json" },
          ];
          if (output === "csv") {
            produced.push({
              id: `${nodeId}-table-csv`,
              kind: "text",
              content: rowsToCsv(rows, columns),
              mimeType: "text/csv",
            });
          }
          artifacts.set(nodeId, produced);
          for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
          states.set(nodeId, "done");
          const summary = `表格处理完成：${rows.length} 行 × ${columns.length} 列（${output === "csv" ? "CSV" : "JSON"} 输出）`;
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          sendPackets(nodeId, summary, "json");
        } catch (err) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `Table 节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }

      if (node.kind === "database") {
        await runDatabase(node, nodeId, attempt);
        return;
      }

      if (node.kind === "fileParse") {
        emit({ type: "node.started", nodeId, attempt });
        try {
          const cfg = FileParseConfig.parse(node.fileParse ?? {});
          const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
          const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
          if (!sourceId) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: "文件解析节点需要唯一上游，或在配置中显式指定数据来源",
              errorCode: "VALIDATION",
            });
            return;
          }
          const arts = artifacts.get(sourceId) ?? [];
          const fileArts = arts.filter((a) => a.kind === "file" && a.uri);
          if (fileArts.length === 0) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `上游「${nodeById(graph, sourceId)?.name ?? sourceId}」没有产出文件产物`,
              errorCode: "VALIDATION",
            });
            return;
          }
          // Parse every uploaded document (was: first only — a batch of contracts
          // or due-diligence files silently dropped all but the first). Multi-doc
          // text is joined under per-file headers so downstream textGen can tell
          // the documents apart; the single-doc path stays byte-identical.
          const blocks: string[] = [];
          const images: { data: Buffer; mimeType: string; label: string }[] = [];
          let unresolvedCount = 0;
          for (const [i, fileArt] of fileArts.entries()) {
            const resolved = opts.readArtifact ? await opts.readArtifact(fileArt.uri!) : null;
            if (!resolved) {
              unresolvedCount++;
              continue;
            }
            const parsed = await parseDocument(dataUriToBuffer(resolved), fileArt.mimeType);
            const label = fileArt.label ?? `文档 ${i + 1}`;
            const header = fileArts.length > 1 ? `===== ${label} =====` : "";
            blocks.push(header ? `${header}\n${parsed.text}` : parsed.text);
            for (const img of parsed.images) {
              images.push({ data: Buffer.from(img.data), mimeType: img.mimeType, label: `${label} 图片 ${images.length + 1}` });
            }
          }
          if (blocks.length === 0) {
            const capMb = Math.floor(MAX_INLINE_BYTES / (1024 * 1024));
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `无法读取文件内容（${fileArts[0]!.uri}）：产物字节不存在，或文件超过解析上限 ${capMb}MB（上传允许 25MB，但解析需要整体内联读入）`,
              errorCode: "PROVIDER_ERROR",
            });
            return;
          }
          const output = blocks.join("\n\n");
          const produced: Artifact[] = [
            { id: `${nodeId}-txt`, kind: "text", content: output, mimeType: "text/plain" },
          ];
          for (const [idx, img] of images.slice(0, cfg.maxImages).entries()) {
            const ext =
              img.mimeType === "image/png"
                ? "png"
                : img.mimeType === "image/jpeg"
                  ? "jpg"
                  : (img.mimeType.split("/")[1] ?? "bin");
            const uri = await opts.storeBinary(
              Buffer.from(img.data),
              img.mimeType,
              `${node.name || "file-parse"}-${idx + 1}.${ext}`,
            );
            produced.push({
              id: `${nodeId}-img-${idx}`,
              kind: "image",
              uri,
              mimeType: img.mimeType,
              label: img.label,
            });
          }
          artifacts.set(nodeId, produced);
          for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
          states.set(nodeId, "done");
          const imgCount = produced.length - 1;
          const parsedCount = fileArts.length - unresolvedCount;
          const summary = `解析完成：${parsedCount} 个文档，${output.length} 字符文本${imgCount ? `，提取 ${imgCount} 张图片` : ""}${unresolvedCount > 0 ? `；另有 ${unresolvedCount} 个文档无法读取` : ""}`;
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          sendPackets(nodeId, summary, "text");
        } catch (err) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `文件解析节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }

      if (node.kind === "translate") {
        emit({ type: "node.started", nodeId, attempt });
        const cfg = TranslateConfig.parse(node.translate ?? {});
        const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
        const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
        if (!sourceId) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: "翻译节点需要唯一上游，或在配置中显式指定数据来源",
            errorCode: "VALIDATION",
          });
          return;
        }
        const arts = artifacts.get(sourceId) ?? [];
        const textArt = arts.find((a) => a.kind === "text");
        const jsonArt = arts.find((a) => a.kind === "json");
        let sourceText = textArt?.content ?? "";
        if (!sourceText && jsonArt) {
          sourceText =
            typeof jsonArt.content === "string" ? jsonArt.content : JSON.stringify(jsonArt.content, null, 2);
        }
        if (!sourceText.trim()) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `上游「${nodeById(graph, sourceId)?.name ?? sourceId}」没有产出可翻译的文本`,
            errorCode: "VALIDATION",
          });
          return;
        }
        const config = {
          model: cfg.model || fallbackModel,
          prompt: [
            `你是专业的翻译引擎。请把用户提供的文本翻译成${cfg.target}。`,
            "要求：忠实原文、不增删内容、不解释不改写；保留原文的换行、编号与段落结构；",
            "直接输出译文本身，不要加任何说明、引号或前后缀。",
          ].join("\n"),
          skills: [],
          temperature: cfg.temperature,
          timeoutMs: 120000,
          inputPolicy: { mode: "all" as const },
          retry: cfg.retry,
        };
        let result: { output: string; usage: Usage } | null = null;
        let lastError: { message: string; code?: string } | null = null;
        const maxAttempts = 1 + config.retry.maxRetries;
        for (let tryIdx = 0; tryIdx < maxAttempts; tryIdx++) {
          if (opts.signal?.aborted || aborted) {
            aborted = true;
            return;
          }
          try {
            const gen = worker.runTextGen({
              node,
              config,
              attempt,
              input: sourceText,
              signal: opts.signal,
            });
            let output = "";
            let usage: Usage | null = null;
            while (true) {
              const step = await gen.next();
              if (step.done) {
                output = step.value.output;
                usage = step.value.usage;
                break;
              }
              if (opts.signal?.aborted || aborted) {
                aborted = true;
                return;
              }
              if (step.value.type === "text-delta") {
                emit({ type: "node.delta", nodeId, attempt, text: step.value.text });
              }
            }
            result = { output, usage: usage ?? zeroUsage() };
            break;
          } catch (err) {
            const code = err instanceof ProviderError ? err.code : "UNKNOWN";
            lastError = { message: (err as Error).message, code };
            if (!RETRYABLE.has(code) || tryIdx >= maxAttempts - 1) break;
            await opts.sleep(Math.min(config.retry.maxDelayMs, config.retry.baseDelayMs * 2 ** tryIdx));
          }
        }
        if (!result) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: sanitizeError(lastError?.message ?? "翻译调用失败，无输出"),
            errorCode: (lastError?.code as
              | "TIMEOUT"
              | "RATE_LIMIT"
              | "PROVIDER_ERROR"
              | "SCRIPT_ERROR"
              | "AUTH"
              | "VALIDATION"
              | "UNKNOWN"
              | "UNSUPPORTED"
              | undefined) ?? "UNKNOWN",
          });
          status = "failed";
          return;
        }
        // Same contract as the textGen branch: a 200 with no text is not a
        // translation. Shipping an empty artifact here means the run reports
        // done with nothing translated.
        if (!result.output.trim()) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `模型 ${config.model} 返回了空译文（无正文可交付）`,
            errorCode: "PROVIDER_ERROR",
          });
          status = "failed";
          return;
        }
        setTextArtifact(artifacts, nodeId, result.output);
        states.set(nodeId, "done");
        emit({ type: "node.finished", nodeId, attempt, output: result.output, usage: result.usage });
        const primaryKind = produceArtifacts(nodeId, result.output, attempt);
        totalCostUsd += result.usage.costUsd;
        emit({ type: "power.metered", totalCostUsd, budgetUsd });
        const nodeSpent = (nodeCostUsd.get(nodeId) ?? 0) + result.usage.costUsd;
        nodeCostUsd.set(nodeId, nodeSpent);
        const nodeBudget = cfg.budgetUsd;
        if (nodeBudget != null && nodeBudget > 0 && nodeSpent > nodeBudget) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `节点预算 $${nodeBudget.toFixed(4)} 已超出（已花 $${nodeSpent.toFixed(4)}）`,
            errorCode: "BUDGET",
          });
          status = "failed";
          return;
        }
        sendPackets(nodeId, result.output.slice(0, 120), primaryKind);
        return;
      }

      if (node.kind === "ocr") {
        emit({ type: "node.started", nodeId, attempt });
        try {
          const cfg = OcrConfig.parse(node.ocr ?? {});
          const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
          const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
          if (!sourceId) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: "OCR 节点需要唯一上游，或在配置中显式指定数据来源",
              errorCode: "VALIDATION",
            });
            return;
          }
          const arts = artifacts.get(sourceId) ?? [];
          const images = arts.filter((a) => a.kind === "image" && a.uri);
          if (images.length === 0) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `上游「${nodeById(graph, sourceId)?.name ?? sourceId}」没有产出可识别的图片（需要 image 产物）`,
              errorCode: "VALIDATION",
            });
            return;
          }
          const blocks: string[] = [];
          let totalConfidence = 0;
          for (const art of images) {
            const resolved = opts.readArtifact ? await opts.readArtifact(art.uri!) : null;
            if (!resolved) {
              states.set(nodeId, "failed");
              emit({
                type: "node.failed",
                nodeId,
                attempt,
                error: `无法读取图片内容（${art.uri}）`,
                errorCode: "PROVIDER_ERROR",
              });
              return;
            }
            const buf = dataUriToBuffer(resolved);
            let res: { text: string; confidence: number };
            try {
              res = await ocrImage(buf, cfg);
            } catch (err) {
              states.set(nodeId, "failed");
              emit({
                type: "node.failed",
                nodeId,
                attempt,
                error: `OCR 识别失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
                errorCode: "PROVIDER_ERROR",
              });
              return;
            }
            blocks.push(res.text);
            totalConfidence += res.confidence;
          }
          const output = blocks.join("\n\n").trim();
          setTextArtifact(artifacts, nodeId, output);
          states.set(nodeId, "done");
          const avgConf = images.length ? Math.round(totalConfidence / images.length) : 0;
          const summary = output
            ? `识别完成：${images.length} 张图片，${output.length} 字符，平均置信度 ${avgConf}%`
            : "识别完成：未识别到文字";
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          const primaryKind = produceArtifacts(nodeId, output, attempt);
          sendPackets(nodeId, summary, primaryKind);
        } catch (err) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `OCR 节点执行出错: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
          });
        }
        return;
      }

      if (node.kind === "convert") {
        emit({ type: "node.started", nodeId, attempt });
        try {
          const cfg = ConvertConfig.parse(node.convert ?? {});
          const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
          const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
          if (!sourceId) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: "文件转换节点需要唯一上游，或在配置中显式指定数据来源",
              errorCode: "VALIDATION",
            });
            return;
          }
          const arts = artifacts.get(sourceId) ?? [];
          const produced: Artifact[] = [];
          const ext = (mime: string) => (mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : (mime.split("/")[1] ?? "bin"));
          if (cfg.to === "image") {
            // pdf → image: extract every embedded image (scanned pages = one image each).
            const fileArt = arts.find((a) => a.kind === "file" && a.uri);
            if (!fileArt) {
              states.set(nodeId, "failed");
              emit({
                type: "node.failed",
                nodeId,
                attempt,
                error: `上游「${nodeById(graph, sourceId)?.name ?? sourceId}」没有产出可转换的文件产物（PDF → 图片需要 file 产物）`,
                errorCode: "VALIDATION",
              });
              return;
            }
            const resolved = opts.readArtifact ? await opts.readArtifact(fileArt.uri!) : null;
            if (!resolved) {
              states.set(nodeId, "failed");
              emit({
                type: "node.failed",
                nodeId,
                attempt,
                error: `无法读取文件内容（${fileArt.uri}）`,
                errorCode: "PROVIDER_ERROR",
              });
              return;
            }
            const buf = dataUriToBuffer(resolved);
            const images = await extractPdfImages(
              new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
            );
            if (images.length === 0) {
              states.set(nodeId, "failed");
              emit({
                type: "node.failed",
                nodeId,
                attempt,
                error: "文件中没有可提取的图片（纯文本 PDF 无法转为图片）",
                errorCode: "VALIDATION",
              });
              return;
            }
            for (const [idx, img] of images.entries()) {
              const uri = await opts.storeBinary(
                Buffer.from(img.data),
                img.mimeType,
                `${node.name || "convert"}-${idx + 1}.${ext(img.mimeType)}`,
              );
              produced.push({
                id: `${nodeId}-img-${idx}`,
                kind: "image",
                uri,
                mimeType: img.mimeType,
                label: `${fileArt.label ?? "文件"} 图片 ${idx + 1}`,
              });
            }
          } else {
            // image → png/jpeg: re-encode every upstream image artifact.
            const inputs = arts.filter(
              (a) =>
                a.uri &&
                (a.kind === "image" || (a.kind === "file" && (a.mimeType ?? "").startsWith("image/"))),
            );
            if (inputs.length === 0) {
              states.set(nodeId, "failed");
              emit({
                type: "node.failed",
                nodeId,
                attempt,
                error: `上游「${nodeById(graph, sourceId)?.name ?? sourceId}」没有产出可转换的图片（需要 image 产物或图片类文件）`,
                errorCode: "VALIDATION",
              });
              return;
            }
            const mime = cfg.to === "jpeg" ? "image/jpeg" : "image/png";
            for (const [idx, art] of inputs.entries()) {
              const resolved = opts.readArtifact ? await opts.readArtifact(art.uri!) : null;
              if (!resolved) {
                states.set(nodeId, "failed");
                emit({
                  type: "node.failed",
                  nodeId,
                  attempt,
                  error: `无法读取图片内容（${art.uri}）`,
                  errorCode: "PROVIDER_ERROR",
                });
                return;
              }
              const buf = dataUriToBuffer(resolved);
              let out: Buffer;
              try {
                const decoded = decodeImage(buf);
                out = cfg.to === "jpeg" ? encodeJpeg(decoded, cfg.quality) : encodePng(decoded);
              } catch (err) {
                states.set(nodeId, "failed");
                emit({
                  type: "node.failed",
                  nodeId,
                  attempt,
                  error: `图片转换失败: ${err instanceof Error ? err.message : String(err)}`,
                  errorCode: "PROVIDER_ERROR",
                });
                return;
              }
              const uri = await opts.storeBinary(
                out,
                mime,
                `${node.name || "convert"}-${idx + 1}.${cfg.to}`,
              );
              produced.push({
                id: `${nodeId}-img-${idx}`,
                kind: "image",
                uri,
                mimeType: mime,
                label: `${art.label ?? "图片"} → ${cfg.to.toUpperCase()}`,
              });
            }
          }
          artifacts.set(nodeId, produced);
          for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
          states.set(nodeId, "done");
          const summary =
            cfg.to === "image"
              ? `转换完成：提取 ${produced.length} 张图片`
              : `转换完成：${produced.length} 张图片转为 ${cfg.to.toUpperCase()}`;
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          sendPackets(nodeId, summary, "image");
        } catch (err) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `文件转换节点执行出错: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
          });
        }
        return;
      }

      if (node.kind === "search") {
        emit({ type: "node.started", nodeId, attempt });
        try {
          const cfg = SearchConfig.parse(node.search ?? {});
          let query = cfg.query.trim();
          if (!query) {
            // Fall back to the first upstream text artifact — lets an agent
            // generate the query and a search node execute it.
            const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
            for (const s of sources) {
              const t = (artifacts.get(s) ?? []).find((a) => a.kind === "text")?.content;
              if (t?.trim()) {
                query = t.trim().slice(0, 300);
                break;
              }
            }
          }
          if (!query) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: "没有可用的搜索词（请在配置中填写 query，或连接产出 text 的上游）",
              errorCode: "VALIDATION",
            });
            return;
          }
          let hits: { title: string; url: string; snippet: string }[];
          try {
            hits = await searchWeb(query, cfg);
          } catch (err) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `搜索失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
              errorCode: err instanceof SearchAuthError ? "AUTH" : "PROVIDER_ERROR",
            });
            return;
          }
          const listing = hits
            .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ""}`)
            .join("\n\n");
          const output = listing || `没有找到与「${query}」相关的结果`;
          const produced: Artifact[] = [
            { id: `${nodeId}-txt`, kind: "text", content: output, mimeType: "text/plain" },
            {
              id: `${nodeId}-json`,
              kind: "json",
              content: JSON.stringify({ query, provider: cfg.provider, results: hits }, null, 2),
              mimeType: "application/json",
            },
          ];
          artifacts.set(nodeId, produced);
          for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
          states.set(nodeId, "done");
          const summary = `搜索完成：「${query}」→ ${hits.length} 条结果（${cfg.provider}）`;
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          sendPackets(nodeId, summary, "text");
        } catch (err) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `搜索节点执行出错: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
          });
        }
        return;
      }

      if (node.kind === "notify") {
        emit({ type: "node.started", nodeId, attempt });
        try {
          const cfg = NotifyConfig.parse(node.notify ?? {});
          let message = cfg.message.trim();
          if (!message) {
            // Fall back to the upstream text artifact — the "produce → notify" tail.
            const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
            for (const s of sources) {
              const t = (artifacts.get(s) ?? []).find((a) => a.kind === "text")?.content;
              if (t?.trim()) {
                message = t.trim();
                break;
              }
            }
          }
          if (!message) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: "没有可发送的消息（请在配置中填写 message，或连接产出 text 的上游）",
              errorCode: "VALIDATION",
            });
            return;
          }
          // Interpolate `${nodeId.field}` placeholders — e.g. patrol alarms
          // embedding `${probe.url}` / `${probe.status}` (dogfood
          // tpl-patrol-alert; the probe sits behind a branch hop, which
          // interpCtx covers via the http-metadata registry).
          message = evaluateTemplate(message, interpCtx(nodeId));
          if (cfg.provider === "slack" && !cfg.channel) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: "缺少 channel（Slack 通知需要填写 channel id）",
              errorCode: "VALIDATION",
            });
            return;
          }
          if (cfg.provider !== "email" && cfg.provider !== "slack" && !cfg.webhookUrl) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `缺少 webhookUrl（${cfg.provider} 群机器人需要 webhook 地址）`,
              errorCode: "VALIDATION",
            });
            return;
          }
          if (cfg.provider === "email" && !cfg.to) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: "缺少收件人（email 通知需要填写 to）",
              errorCode: "VALIDATION",
            });
            return;
          }
          const subject = cfg.subject?.trim() || node.name || "Agent World 通知";
          let result: { provider: string; detail: string };
          try {
            result = await sendNotification(cfg, message, subject);
          } catch (err) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `通知发送失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
              errorCode: err instanceof NotifyAuthError
                ? "AUTH"
                : err instanceof NotifyProviderError
                  ? "PROVIDER_ERROR"
                  : "PROVIDER_ERROR",
            });
            return;
          }
          const artifact: Artifact = {
            id: `${nodeId}-json`,
            kind: "json",
            content: JSON.stringify({ sent: true, ...result, chars: message.length }, null, 2),
            mimeType: "application/json",
          };
          artifacts.set(nodeId, [artifact]);
          emit({ type: "artifact.produced", nodeId, attempt, artifact });
          states.set(nodeId, "done");
          const summary = `通知已发送：${result.provider} → ${result.detail}（${message.length} 字符）`;
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          sendPackets(nodeId, summary, "json");
        } catch (err) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `通知节点执行出错: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
          });
        }
        return;
      }

      if (node.kind === "vcs") {
        emit({ type: "node.started", nodeId, attempt });
        try {
          const cfg = VcsConfig.parse(node.vcs ?? {});
          const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
          const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
          if (cfg.source && !sources.includes(cfg.source)) {
            states.set(nodeId, "failed");
            emit({ type: "node.failed", nodeId, attempt, error: `数据来源 ${cfg.source} 不是上游节点`, errorCode: "VALIDATION" });
            return;
          }
          let body = cfg.body.trim();
          if (!body && (cfg.action === "create_pr" || cfg.action === "comment_issue") && sourceId) {
            const t = (artifacts.get(sourceId) ?? []).find((a) => a.kind === "text")?.content;
            if (t?.trim()) body = t.trim();
          }
          // An empty title used to fall back to the node name ("创建 PR"), so
          // every PR created by the template carried the same meaningless
          // title (dogfood tpl-release-pr). Derive one from the body instead:
          // first non-empty, non-horizontal-rule line, markdown heading marks
          // stripped, clamped to a sane length. Explicit cfg.title still wins.
          let title = cfg.title?.trim();
          if (!title && cfg.action === "create_pr" && body) {
            const line = body
              .split("\n")
              .map((l) => l.trim())
              .find((l) => l && !/^[-=_*]{3,}$/.test(l));
            if (line) title = line.replace(/^#{1,6}\s*/, "").trim().slice(0, 120);
          }
          if (!title) title = node.name || cfg.action;
          let result: { provider: string; action: string; detail: string; data: unknown };
          try {
            result = await executeVcs(cfg, body, title);
          } catch (err) {
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `VCS 操作失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
              errorCode: err instanceof VcsAuthError ? "AUTH" : "PROVIDER_ERROR",
            });
            return;
          }
          const artifact: Artifact = {
            id: `${nodeId}-json`,
            kind: "json",
            content: JSON.stringify(result.data, null, 2),
            mimeType: "application/json",
          };
          artifacts.set(nodeId, [artifact]);
          emit({ type: "artifact.produced", nodeId, attempt, artifact });
          states.set(nodeId, "done");
          const summary = `${result.provider} ${result.action} 完成：${result.detail}`;
          emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
          sendPackets(nodeId, summary, "json");
        } catch (err) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `VCS 节点执行出错: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
          });
        }
        return;
      }

      if (node.kind === "human") {
        await runHuman(node, nodeId, attempt);
        return;
      }

      if (node.kind === "compliance") {
        await runCompliance(node, nodeId, attempt);
        return;
      }

      if (node.kind === "publish") {
        await runPublish(node, nodeId, attempt);
        return;
      }

      if (node.kind === "gate") {
        emit({ type: "node.started", nodeId, attempt });
        const output = await inputFor(node);
        const modelVerdict = await worker.judge({
          node,
          attempt,
          input: output,
          output,
          criterion: (node.gate?.criterion ?? "") + ARTIFACT_URL_NOTE,
          signal: opts.signal,
        });

        // Hard rule: any prohibited term declared on an upstream source must
        // never pass, regardless of what the model judge decides. Deterministic
        // so forbidden copy is always caught even if the model slips it in.
        const prohibitedHits = detectProhibited(output, upstreamProhibitedTerms(graph, nodeId));

        // Brand-term coverage: how many of the upstream brand words actually
        // appear in the artifact. An optional gate threshold fails the gate
        // (and triggers a rewrite) when coverage is too low.
        const brandAll = upstreamBrandTerms(graph, nodeId);
        const brandHits = brandAll.filter((t) => output.includes(t));
        const brandCoverage = brandAll.length ? brandHits.length / brandAll.length : 1;
        const minBrand = node.gate?.minBrandCoverage;

        const minScore = node.gate?.minScore;
        const belowScore =
          minScore != null && modelVerdict.score != null && modelVerdict.score < minScore;
        const belowBrand = minBrand != null && brandCoverage < minBrand;

        let verdict = modelVerdict;
        if (prohibitedHits.length > 0) {
          // Actionable rework feedback: name the exact offending phrases and
          // the attempt number. Varying the note per attempt matters — with a
          // deterministic endpoint, an identical rework note produces identical
          // input and the model regenerates the same violating copy forever.
          const snippets = prohibitedSnippets(output, prohibitedHits);
          const where = snippets.length ? `，出现位置：${snippets.join("、")}` : "";
          verdict = {
            passed: false,
            reason: `命中禁用词：${prohibitedHits.join("、")}（第 ${attempt} 次质检${where}）。重写时必须完全避开这些词及任何包含它们的短语，已退回上游重写`,
            score: modelVerdict.score,
          };
        } else if (belowBrand) {
          verdict = {
            passed: false,
            reason: `品牌词覆盖率 ${Math.round(brandCoverage * 100)}% 低于门槛 ${Math.round(minBrand! * 100)}%（已退回上游重写）`,
            score: modelVerdict.score,
          };
        } else if (belowScore) {
          verdict = {
            passed: false,
            reason: `质量分 ${modelVerdict.score} 低于门槛 ${minScore}（已退回上游重写）`,
            score: modelVerdict.score,
          };
        }

        emit({
          type: "gate.verdict",
          nodeId,
          attempt,
          passed: verdict.passed,
          reason: verdict.reason,
          ...(verdict.score != null ? { score: verdict.score } : {}),
        });

        if (verdict.passed) {
          const artifact = setTextArtifact(artifacts, nodeId, output);
          states.set(nodeId, "done");
          // A failed gate emits node.failed, but a passing one used to slip
          // through with only gate.verdict — no node.finished and no
          // artifact.produced in the timeline, unlike every other node kind
          // (dogfood tpl-recipe). Announce both for observability parity.
          emit({ type: "artifact.produced", nodeId, attempt, artifact });
          emit({ type: "node.finished", nodeId, attempt, output: verdict.reason, usage: zeroUsage() });
          sendPackets(nodeId, verdict.reason, "text");
          return;
        }

        const loop = loopByGate.get(nodeId);
        if (!loop) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: verdict.reason,
            errorCode: "VALIDATION",
          });
          status = "failed";
          return;
        }

        if (attempt >= loop.maxAttempts) {
          const policy = node.gate?.onExhausted ?? "halt";
          emit({ type: "gate.exhausted", nodeId, attempts: attempt, policy });
          if (policy === "pass") {
            const artifact = setTextArtifact(artifacts, nodeId, output);
            states.set(nodeId, "done");
            emit({ type: "artifact.produced", nodeId, attempt, artifact });
            emit({ type: "node.finished", nodeId, attempt, output: verdict.reason, usage: zeroUsage() });
            sendPackets(nodeId, verdict.reason, "text");
            return;
          }
          states.set(nodeId, "failed");
          status = policy === "halt" ? "halted" : "failed";
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: verdict.reason,
            errorCode: "VALIDATION",
          });
          if (policy === "halt") {
            haltNodeId = nodeId;
            haltReason = verdict.reason;
            void notifyHalt({ runId, graphId: graph.id, nodeId, reason: verdict.reason });
          }
          aborted = true;
          return;
        }

        // Rework: reset the loop body so it welds again, and tell the entry why.
        reworkNotes.set(loop.entryId, verdict.reason);
        emit({
          type: "packet.sent",
          edgeId: loop.edge.id,
          from: nodeId,
          to: loop.entryId,
          summary: verdict.reason,
          artifactKind: "text",
        });
        for (const bodyId of loop.body) {
          states.set(bodyId, "pending");
          artifacts.set(bodyId, []);
        }
        return;
      }

  // --- Video generation node: produce a short video clip from a prompt ---
  if (node.kind === "videoGen") {
    emit({ type: "node.started", nodeId, attempt });
    const cfg = node.videoGen ?? { model: "video-gen", n: 1 };
    if (!worker.generateVideo) {
      // Honest failure: media nodes are often the run's product (dogfood
      // 2026-09-01). Silent skip reported done with no artifact. Templates
      // that want a fallback should add an error edge instead.
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: "worker 无视频生成能力", errorCode: "VALIDATION" });
      return;
    }
    const prompt = cfg.prompt?.trim() || (await inputFor(node));
    try {
      const results = await worker.generateVideo({ node, config: cfg, input: prompt, signal: opts.signal });
      // Zero results is never a success: the node asked for n ≥ 1 clips and got
      // none, which means the provider does not actually serve this modality or
      // model (routingWorker hands back [] for a worker without the method).
      // Reporting done with no artifact is the same fake success b6de7d9 removed
      // for the throw path; audit item L8 flagged this empty-result half.
      if (results.length === 0) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `视频生成未返回任何结果（模型 ${cfg.model} 可能不支持该模态，或 provider 未提供该能力）`,
          errorCode: "UNSUPPORTED",
        });
        return;
      }
      let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: {} };
      const videoArts: Artifact[] = [];
      for (let idx = 0; idx < results.length; idx++) {
        const res = results[idx]!;
        const ext = res.mimeType.includes("mp4") ? "mp4" : res.mimeType.includes("webm") ? "webm" : "mp4";
        const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "ai-video"}-${idx + 1}.${ext}`);
        const a: Artifact = {
          id: `${nodeId}-vid-${idx}`,
          kind: "video",
          uri,
          sizeBytes: res.data.length,
          mimeType: res.mimeType,
          label: results.length > 1 ? `${node.name || "AI 视频"} #${idx + 1}` : node.name || "AI 视频",
        };
        videoArts.push(a);
        emit({ type: "artifact.produced", nodeId, artifact: a });
        usage = {
          tokensIn: (usage.tokensIn ?? 0) + (res.usage.tokensIn ?? 0),
          tokensOut: (usage.tokensOut ?? 0) + (res.usage.tokensOut ?? 0),
          costUsd: (usage.costUsd ?? 0) + (res.usage.costUsd ?? 0),
          units: { ...usage.units, ...res.usage.units },
        };
      }
      artifacts.set(nodeId, videoArts);
      emit({ type: "node.finished", nodeId, attempt, output: "", usage });
      states.set(nodeId, "done");
      sendPackets(nodeId, `生成视频 ${results.length} 段`, "video");
    } catch (err) {
      console.warn(`[videoGen:${nodeId}] generation failed:`, (err as Error).message);
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: `视频生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
    }
    return;
  }

  // --- Audio generation node: TTS / music from text ---
  if (node.kind === "audioGen") {
    emit({ type: "node.started", nodeId, attempt });
    const cfg = node.audioGen ?? { model: "tts-1", format: "mp3", n: 1 };
    if (!worker.generateAudio) {
      // Honest failure: audio is often the run's product (dogfood 2026-09-01,
      // tpl-news-podcast). Templates wanting a fallback add an error edge.
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: "worker 无音频生成能力", errorCode: "VALIDATION" });
      return;
    }
    const prompt = cfg.prompt?.trim() || (await inputFor(node));
    try {
      const results = await worker.generateAudio({ node, config: cfg, input: prompt, signal: opts.signal });
      // See the videoGen branch: an empty result set means no audio was made,
      // which for an audio-first pipeline is a failed run, not a done one.
      if (results.length === 0) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `音频生成未返回任何结果（模型 ${cfg.model} 可能不支持该模态，或 provider 未提供该能力）`,
          errorCode: "UNSUPPORTED",
        });
        return;
      }
      let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: {} };
      const audioArts: Artifact[] = [];
      for (let idx = 0; idx < results.length; idx++) {
        const res = results[idx]!;
        const ext = res.mimeType.includes("wav") ? "wav" : res.mimeType.includes("ogg") ? "ogg" : res.mimeType.includes("opus") ? "opus" : "mp3";
        const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "ai-audio"}-${idx + 1}.${ext}`);
        const a: Artifact = {
          id: `${nodeId}-aud-${idx}`,
          kind: "audio",
          uri,
          sizeBytes: res.data.length,
          mimeType: res.mimeType,
          label: results.length > 1 ? `${node.name || "AI 音频"} #${idx + 1}` : node.name || "AI 音频",
        };
        audioArts.push(a);
        emit({ type: "artifact.produced", nodeId, artifact: a });
        usage = {
          tokensIn: (usage.tokensIn ?? 0) + (res.usage.tokensIn ?? 0),
          tokensOut: (usage.tokensOut ?? 0) + (res.usage.tokensOut ?? 0),
          costUsd: (usage.costUsd ?? 0) + (res.usage.costUsd ?? 0),
          units: { ...usage.units, ...res.usage.units },
        };
      }
      artifacts.set(nodeId, audioArts);
      emit({ type: "node.finished", nodeId, attempt, output: "", usage });
      states.set(nodeId, "done");
      sendPackets(nodeId, `生成音频 ${results.length} 段`, "audio");
    } catch (err) {
      console.warn(`[audioGen:${nodeId}] generation failed:`, (err as Error).message);
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: `音频生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
    }
    return;
  }

  // --- Image generation node: produce a banner/scene image when source lacks photos ---
  if (node.kind === "imageGen") {
    emit({ type: "node.started", nodeId, attempt });
    const cfg = node.imageGen ?? { model: "agnes-image", prompt: "", n: 1 };
    const prompt = cfg.prompt?.trim() || buildImagePrompt(node, graph);
    try {
      const results = await worker.generateImage({ node, config: cfg, input: prompt, signal: opts.signal });
      // See the videoGen branch: zero images means nothing was produced.
      if (results.length === 0) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `配图生成未返回任何结果（模型 ${cfg.model} 可能不支持该模态，或 provider 未提供该能力）`,
          errorCode: "UNSUPPORTED",
        });
        return;
      }
      let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { images: 0 } };
      const imageArts: Artifact[] = [];
      for (let idx = 0; idx < results.length; idx++) {
        const res = results[idx]!;
        const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "ai-image"}-${idx + 1}.png`);
        const a: Artifact = {
          id: `${nodeId}-img-${idx}`,
          kind: "image",
          uri,
          sizeBytes: res.data.length,
          mimeType: res.mimeType,
          label: results.length > 1 ? `${node.name || "AI 配图"} #${idx + 1}` : node.name || "AI 配图",
        };
        imageArts.push(a);
        emit({ type: "artifact.produced", nodeId, artifact: a });
        usage = {
          tokensIn: (usage.tokensIn ?? 0) + (res.usage.tokensIn ?? 0),
          tokensOut: (usage.tokensOut ?? 0) + (res.usage.tokensOut ?? 0),
          costUsd: (usage.costUsd ?? 0) + (res.usage.costUsd ?? 0),
          units: { ...usage.units, images: (usage.units?.images ?? 0) + (res.usage.units?.images ?? 0) },
        };
      }
      artifacts.set(nodeId, imageArts);
      emit({ type: "node.finished", nodeId, attempt, output: "", usage });
      states.set(nodeId, "done");
      sendPackets(nodeId, `生成配图 ${results.length} 张`, "image");
    } catch (err) {
      // Same rule as videoGen/audioGen: a throw is not a degrade-and-continue.
      // 配图往往就是这条产线的产物（2026-08-31 狗粮撞过 agnes 图片 503），标 done
      // 会交出一条没有图的成品；旧的兜底还往下游发一个 text 包「生图失败（已降级
      // 跳过）」，写手会把这句报错当素材写进正文。要兜底就接 error 边。
      console.warn(`[imageGen:${nodeId}] generation failed:`, (err as Error).message);
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: `配图生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
    }
    return;
  }

      // agent
     

  // --- Generic node: auto-dispatches by user-picked modality ---
  if (node.kind === "generic") {
    emit({ type: "node.started", nodeId, attempt });
    const gcfg: GenericConfig = node.generic ?? { model: "agnes-2.0-flash", modality: "text", skills: [], format: "mp3", n: 1 };
    const modality = gcfg.modality ?? "text";
    // Prompts may reference upstream artifacts (`${craft}` / `${probe.status}`),
    // same contract as http url/body and notify messages — without this the
    // placeholder reaches the model verbatim (dogfood tpl-custom-model).
    const rawPrompt = gcfg.prompt?.trim()
      ? evaluateTemplate(gcfg.prompt.trim(), interpCtx(nodeId))
      : "";
    const prompt = rawPrompt || (await inputFor(node));

    if (modality === "text") {
      const textCfg: TextGenConfig = {
        model: gcfg.model,
        prompt: rawPrompt,
        skills: (gcfg.skills ?? []).map(s => typeof s === "string" ? { id: s, config: {}, enabled: true } : s),
        temperature: gcfg.temperature ?? 0.7,
        timeoutMs: gcfg.timeoutMs ?? 120000,
        inputPolicy: gcfg.inputPolicy ?? { mode: "all" },
        budgetUsd: gcfg.budgetUsd ?? null,
        retry: gcfg.retry ?? { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 },
      };
      try {
        const gen = worker.runTextGen({ node, config: textCfg, attempt, input: prompt, signal: opts.signal });
        let out = "";
        let usage: Usage = zeroUsage();
        while (true) {
          const step = await gen.next();
          if (step.done) {
            out = step.value.output;
            usage = step.value.usage;
            break;
          }
          if (opts.signal?.aborted || aborted) {
            aborted = true;
            return;
          }
          const chunk = step.value;
          if (chunk.type === "text-delta") {
            out += chunk.text;
            emit({ type: "node.delta", nodeId, attempt, text: chunk.text });
          }
        }
        // Same contract as textGen/translate: an empty completion is not a
        // product, and the generic node is often the run's only one.
        if (!out.trim()) {
          states.set(nodeId, "failed");
          emit({ type: "node.failed", nodeId, attempt, error: `模型 ${gcfg.model} 返回了空内容（无正文可交付）`, errorCode: "PROVIDER_ERROR" });
          return;
        }
        // Observability parity: the text product must be inspectable in the
        // gallery like every other node kind's. setTextArtifact alone left the
        // generic node with a node.finished output but no artifact row (dogfood
        // tpl-custom-model run dd9641af: intake/craft/depot had artifacts, the
        // generic step between them had none) — same gap 8418d2e closed for gates.
        const artifact = setTextArtifact(artifacts, nodeId, out);
        emit({ type: "artifact.produced", nodeId, attempt, artifact });
        emit({ type: "node.finished", nodeId, attempt, output: out, usage });
        states.set(nodeId, "done");
        sendPackets(nodeId, out.slice(0, 120), "text");
      } catch (err) {
        console.warn(`[generic:text:${nodeId}] failed:`, (err as Error).message);
        // Honest failure, mirroring b6de7d9 for the dedicated media nodes: the
        // generic node is often the run's only product, so marking it done with
        // an empty output reported a successful run that produced nothing.
        // Templates that want a fallback should add an error edge.
        states.set(nodeId, "failed");
        emit({ type: "node.failed", nodeId, attempt, error: `通用节点文本生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
      }
      return;
    }

    if (modality === "image") {
      if (!worker.generateImage) {
        // Honest failure (same contract as the dedicated imageGen node): a
        // missing capability is not a successful no-op.
        states.set(nodeId, "failed");
        emit({ type: "node.failed", nodeId, attempt, error: "worker 无图片生成能力", errorCode: "VALIDATION" });
        return;
      }
      const imgCfg: ImageGenConfig = {
        model: gcfg.model,
        prompt: rawPrompt,
        size: gcfg.size,
        aspect: gcfg.aspect,
        n: gcfg.n ?? 1,
        baseUrl: gcfg.baseUrl,
        apiKey: gcfg.apiKey,
      };
      try {
        const results = await worker.generateImage({ node, config: imgCfg, input: prompt, signal: opts.signal });
        // Zero results is a failure, not an empty success (same as the dedicated
        // imageGen node): the provider does not serve this modality/model.
        if (results.length === 0) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `通用节点图片生成未返回任何结果（模型 ${imgCfg.model} 可能不支持该模态）`,
            errorCode: "UNSUPPORTED",
          });
          return;
        }
        let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { images: 0 } };
        const arts: Artifact[] = [];
        for (let idx = 0; idx < results.length; idx++) {
          const res = results[idx]!;
          const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "generic-img"}-${idx + 1}.png`);
          const a: Artifact = {
            id: `${nodeId}-gimg-${idx}`,
            kind: "image",
            uri,
            mimeType: res.mimeType,
            label: results.length > 1 ? `${node.name || "通用图片"} #${idx + 1}` : node.name || "通用图片",
          };
          arts.push(a);
          emit({ type: "artifact.produced", nodeId, artifact: a });
          usage = {
            tokensIn: usage.tokensIn + (res.usage.tokensIn ?? 0),
            tokensOut: usage.tokensOut + (res.usage.tokensOut ?? 0),
            costUsd: usage.costUsd + (res.usage.costUsd ?? 0),
            units: { ...usage.units, ...res.usage.units },
          };
        }
        artifacts.set(nodeId, arts);
        emit({ type: "node.finished", nodeId, attempt, output: "", usage });
        states.set(nodeId, "done");
        sendPackets(nodeId, `通用节点生成图片 ${results.length} 张`, "image");
      } catch (err) {
        console.warn(`[generic:image:${nodeId}] failed:`, (err as Error).message);
        states.set(nodeId, "failed");
        emit({ type: "node.failed", nodeId, attempt, error: `通用节点图片生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
      }
      return;
    }

    if (modality === "video") {
      if (!worker.generateVideo) {
        // Honest failure, mirroring b6de7d9 for the dedicated videoGen node.
        states.set(nodeId, "failed");
        emit({ type: "node.failed", nodeId, attempt, error: "worker 无视频生成能力", errorCode: "VALIDATION" });
        return;
      }
      const vidCfg: VideoGenConfig = {
        model: gcfg.model,
        prompt: rawPrompt,
        duration: gcfg.duration,
        aspect: gcfg.aspect,
        size: gcfg.size,
        n: gcfg.n ?? 1,
        baseUrl: gcfg.baseUrl,
        apiKey: gcfg.apiKey,
      };
      try {
        const results = await worker.generateVideo({ node, config: vidCfg, input: prompt, signal: opts.signal });
        // Zero results is a failure, not an empty success (see imageGen above).
        if (results.length === 0) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `通用节点视频生成未返回任何结果（模型 ${vidCfg.model} 可能不支持该模态）`,
            errorCode: "UNSUPPORTED",
          });
          return;
        }
        let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { videos: 0 } };
        const arts: Artifact[] = [];
        for (let idx = 0; idx < results.length; idx++) {
          const res = results[idx]!;
          const ext = res.mimeType.includes("mp4") ? "mp4" : res.mimeType.includes("webm") ? "webm" : "mov";
          const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "generic-video"}-${idx + 1}.${ext}`);
          const a: Artifact = {
            id: `${nodeId}-gvid-${idx}`,
            kind: "video",
            uri,
            mimeType: res.mimeType,
            label: results.length > 1 ? `${node.name || "通用视频"} #${idx + 1}` : node.name || "通用视频",
          };
          arts.push(a);
          emit({ type: "artifact.produced", nodeId, artifact: a });
          usage = {
            tokensIn: usage.tokensIn + (res.usage.tokensIn ?? 0),
            tokensOut: usage.tokensOut + (res.usage.tokensOut ?? 0),
            costUsd: usage.costUsd + (res.usage.costUsd ?? 0),
            units: { ...usage.units, ...res.usage.units },
          };
        }
        artifacts.set(nodeId, arts);
        emit({ type: "node.finished", nodeId, attempt, output: "", usage });
        states.set(nodeId, "done");
        sendPackets(nodeId, `通用节点生成视频 ${results.length} 段`, "video");
      } catch (err) {
        console.warn(`[generic:video:${nodeId}] failed:`, (err as Error).message);
        states.set(nodeId, "failed");
        emit({ type: "node.failed", nodeId, attempt, error: `通用节点视频生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
      }
      return;
    }

    if (modality === "audio") {
      if (!worker.generateAudio) {
        // Honest failure, mirroring b6de7d9 for the dedicated audioGen node.
        states.set(nodeId, "failed");
        emit({ type: "node.failed", nodeId, attempt, error: "worker 无音频生成能力", errorCode: "VALIDATION" });
        return;
      }
      const audCfg: AudioGenConfig = {
        model: gcfg.model,
        prompt: rawPrompt,
        voice: gcfg.voice,
        format: gcfg.format ?? "mp3",
        speed: gcfg.speed,
        n: gcfg.n ?? 1,
        baseUrl: gcfg.baseUrl,
        apiKey: gcfg.apiKey,
      };
      try {
        const results = await worker.generateAudio({ node, config: audCfg, input: prompt, signal: opts.signal });
        // Zero results is a failure, not an empty success (see imageGen above).
        if (results.length === 0) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `通用节点音频生成未返回任何结果（模型 ${audCfg.model} 可能不支持该模态）`,
            errorCode: "UNSUPPORTED",
          });
          return;
        }
        let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: {} };
        const arts: Artifact[] = [];
        for (let idx = 0; idx < results.length; idx++) {
          const res = results[idx]!;
          const ext = res.mimeType.includes("wav") ? "wav" : res.mimeType.includes("ogg") ? "ogg" : res.mimeType.includes("opus") ? "opus" : res.mimeType.includes("flac") ? "flac" : "mp3";
          const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "generic-audio"}-${idx + 1}.${ext}`);
          const a: Artifact = {
            id: `${nodeId}-gaud-${idx}`,
            kind: "audio",
            uri,
            mimeType: res.mimeType,
            label: results.length > 1 ? `${node.name || "通用音频"} #${idx + 1}` : node.name || "通用音频",
          };
          arts.push(a);
          emit({ type: "artifact.produced", nodeId, artifact: a });
          usage = {
            tokensIn: usage.tokensIn + (res.usage.tokensIn ?? 0),
            tokensOut: usage.tokensOut + (res.usage.tokensOut ?? 0),
            costUsd: usage.costUsd + (res.usage.costUsd ?? 0),
            units: { ...usage.units, ...res.usage.units },
          };
        }
        artifacts.set(nodeId, arts);
        emit({ type: "node.finished", nodeId, attempt, output: "", usage });
        states.set(nodeId, "done");
        sendPackets(nodeId, `通用节点生成音频 ${results.length} 段`, "audio");
      } catch (err) {
        console.warn(`[generic:audio:${nodeId}] failed:`, (err as Error).message);
        states.set(nodeId, "failed");
        emit({ type: "node.failed", nodeId, attempt, error: `通用节点音频生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
      }
      return;
    }

    // An unknown modality is a configuration error, not a no-op: reporting done
    // with an empty output would let a mistyped node pass as a successful run.
    console.warn(`[generic:${nodeId}] unknown modality "${modality}"`);
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `通用节点模态 "${modality}" 不受支持（应为 text / image / video / audio）`,
      errorCode: "VALIDATION",
    });
    return;
  }

      // agent
      const mounts = (node.textGen?.skills ?? []).map(toMount);
      const promptModules = collectPromptModules(mounts);
      // Prompts interpolate `${nodeId}` / `${item}` like every other template
      // string (loop bodies reference the loop item via ${item}; dogfood
      // tpl-research-loop sent the placeholder to the model verbatim).
      const promptTemplate = node.textGen?.prompt
        ? evaluateTemplate(node.textGen.prompt, interpCtx(nodeId))
        : "";
      const basePrompt = withLayoutDirectives(promptTemplate, node.textGen?.imageDirectives);
      let prompt = promptModules.length
        ? `${basePrompt}\n\n${promptModules.map((p) => `=== 已挂载模块提示 (prompt-module) ===\n${p}`).join("\n\n")}`
        : basePrompt;
      // Engine-level hard constraint: upstream source prohibited/brand terms are
      // always injected into the SYSTEM prompt here, regardless of what the user
      // wrote in the node prompt, so every pipeline (incl. user-customized ones)
      // is constrained at generation time. The gate remains the deterministic
      // backstop. Living in the system prompt also survives input truncation /
      // summarization, unlike appending to the user input body.
      const constraintBlocks: string[] = [];
      const prohibited = upstreamProhibitedTerms(graph, node.id);
      if (prohibited.length > 0) {
        constraintBlocks.push(
          `[硬性约束 — 禁用词] 生成的任何内容中都绝对不能出现以下词语/说法：${prohibited.join("、")}。` +
            `质检按“包含”匹配：任何包含这些字的短语同样被禁止（例如禁用“第一”时，“第一缕阳光”“第一杯咖啡”这类表达也不允许），必须换用不含这些字的说法。`,
        );
      }
      const brandTerms = upstreamBrandTerms(graph, node.id);
      if (brandTerms.length > 0) {
        constraintBlocks.push(`[品牌词] 建议在文案中自然融入以下品牌词，不必全部使用：${brandTerms.join("、")}`);
      }
      if (constraintBlocks.length > 0) {
        prompt = prompt ? `${prompt}\n\n${constraintBlocks.join("\n\n")}` : constraintBlocks.join("\n\n");
      }
      const config = {
        model: node.textGen?.model || fallbackModel,
        prompt,
        skills: node.textGen?.skills ?? [],
        temperature: node.textGen?.temperature ?? 0.7,
        timeoutMs: node.textGen?.timeoutMs ?? 120000,
        inputPolicy: node.textGen?.inputPolicy ?? { mode: "all" as const },
        retry: node.textGen?.retry ?? { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 },
      };
      emit({ type: "node.started", nodeId, attempt });

      let result: { output: string; usage: Usage } | null = null;
      let lastError: { message: string; code?: string } | null = null;
      const maxAttempts = 1 + config.retry.maxRetries;

      for (let tryIdx = 0; tryIdx < maxAttempts; tryIdx++) {
        if (opts.signal?.aborted || aborted) {
          aborted = true;
          return;
        }
        try {
          const agentInput = await inputFor(node);
          reworkNotes.delete(nodeId);
          // Variable tools ride along on every agent (safe, no approval needed).
          const tools = [...resolveTools(mounts), ...VARIABLE_TOOLS];
          const rawImageUris = imagesFor(nodeId);
          const referenceImages = opts.readArtifact
            ? await Promise.all(rawImageUris.map((u) => inlineImageUrl(u, opts.readArtifact!)))
            : rawImageUris;
          const content: ContentPart[] | undefined = referenceImages.length
            ? [{ type: "text", text: agentInput }, ...referenceImages.map((u): ContentPart => ({ type: "image", image: u }))]
            : undefined;
          const gen = worker.runTextGen({
            node,
            config,
            attempt,
            input: agentInput,
            images: referenceImages,
            content,
            tools,
            executeTool: async (name, args) => {
              if (name === "set_variable" || name === "get_variable") return handleVariableTool(name, args);
              guardToolCall(name, args, permCfg);
              if (isDangerousTool(name) && !approved.has(name)) {
                throw new HaltRequested(name, nodeId);
              }
              return executeBuiltinTool(name, args);
            },
            signal: opts.signal,
          });
          let output = "";
          let usage: Usage | null = null;
          while (true) {
            const step = await gen.next();
            if (step.done) {
              output = step.value.output;
              usage = step.value.usage;
              break;
            }
            if (opts.signal?.aborted || aborted) {
              aborted = true;
              return;
            }
            const chunk = step.value;
            if (chunk.type === "text-delta") {
              emit({ type: "node.delta", nodeId, attempt, text: chunk.text });
            } else if (chunk.type === "reasoning-delta") {
              emit({ type: "node.reasoning", nodeId, attempt, text: chunk.text });
            } else if (chunk.type === "tool-call") {
              emit({
                type: "tool.called",
                nodeId,
                attempt,
                callId: chunk.id,
                name: chunk.name,
                args: chunk.arguments,
              });
            } else if (chunk.type === "tool-result") {
              emit({
                type: "tool.result",
                nodeId,
                attempt,
                callId: chunk.id,
                name: chunk.name,
                result: chunk.result,
                error: chunk.error,
              });
            }
          }
          result = { output, usage: usage ?? zeroUsage() };
          break;
        } catch (err) {
          if (err instanceof HaltRequested) {
            // A dangerous tool was called without prior human approval: halt the
            // run and wait for a decision (4D.7). The node is intentionally left
            // incomplete so a resume re-runs it with the tool now approved.
            haltNodeId = err.nodeId;
            haltReason = `dangerous-tool:${err.toolName}`;
            status = "halted";
            aborted = true;
            void notifyHalt({ runId, graphId: graph.id, nodeId: err.nodeId, reason: haltReason });
            return;
          }
          const code = err instanceof ProviderError ? err.code : "UNKNOWN";
          lastError = { message: (err as Error).message, code };
          const canRetry = RETRYABLE.has(code) && tryIdx < maxAttempts - 1;
          if (!canRetry) break;
          await opts.sleep(
            Math.min(config.retry.maxDelayMs, config.retry.baseDelayMs * 2 ** tryIdx),
          );
        }
      }

      // E.3 output-contract: validate the agent's output against a mounted
      // output-contract skill, reworking (reusing the existing rework line) or
      // failing when the contract isn't satisfied.
      if (result) {
        const contract = getOutputContract(mounts);
        if (contract) {
          const contractErr = validateContract(result.output, contract);
          if (contractErr) {
            const loop = loopByGate.get(nodeId);
            const maxRework = loop?.maxAttempts ?? config.retry.maxRetries + 1;
            if (loop && attempt < maxRework) {
              reworkNotes.set(loop.entryId, `输出未满足契约：${contractErr}`);
              emit({
                type: "packet.sent",
                edgeId: loop.edge.id,
                from: nodeId,
                to: loop.entryId,
                summary: `输出未满足契约：${contractErr}`,
                artifactKind: "text",
              });
              for (const bodyId of loop.body) {
                states.set(bodyId, "pending");
                artifacts.set(bodyId, []);
              }
              return;
            }
            states.set(nodeId, "failed");
            emit({
              type: "node.failed",
              nodeId,
              attempt,
              error: `输出未满足契约：${contractErr}`,
              errorCode: "VALIDATION",
            });
            status = "failed";
            return;
          }
        }
      }

      if (!result) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: sanitizeError(lastError?.message ?? "agent failed with no output"),
          errorCode: (lastError?.code as
            | "TIMEOUT"
            | "RATE_LIMIT"
            | "PROVIDER_ERROR"
            | "SCRIPT_ERROR"
            | "AUTH"
            | "VALIDATION"
            | "UNKNOWN"
            | "UNSUPPORTED"
            | undefined) ?? "UNKNOWN",
        });
        status = "failed";
        return;
      }

      // An empty completion is not a product. Providers can answer 200 with no
      // text (openai-compatible falls back to `msg.content ?? ""`, e.g. a
      // tool-call-only turn or a filtered reply); recording that as done handed
      // downstream an empty string to interpolate and still reported the run as
      // done — same class as the media branches fixed in 2797011. Templates that
      // want to tolerate it can attach an error edge.
      if (!result.output.trim()) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `模型 ${config.model} 返回了空内容（无正文可交付）`,
          errorCode: "PROVIDER_ERROR",
        });
        status = "failed";
        return;
      }

      setTextArtifact(artifacts, nodeId, result.output);
      states.set(nodeId, "done");
      emit({ type: "node.finished", nodeId, attempt, output: result.output, usage: result.usage });
      const primaryKind = produceArtifacts(nodeId, result.output, attempt);

      // Cost accounting runs in a single synchronous block so concurrent
      // completions can't race the budget check.
      totalCostUsd += result.usage.costUsd;
      emit({ type: "power.metered", totalCostUsd, budgetUsd });

      const nodeSpent = (nodeCostUsd.get(nodeId) ?? 0) + result.usage.costUsd;
      nodeCostUsd.set(nodeId, nodeSpent);
      const nodeBudget = node.textGen?.budgetUsd;
      if (nodeBudget != null && nodeBudget > 0 && nodeSpent > nodeBudget) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `节点预算 $${nodeBudget.toFixed(4)} 已超出（已花 $${nodeSpent.toFixed(4)}）`,
          errorCode: "BUDGET",
        });
        status = "failed";
        return;
      }

      if (
        budgetUsd !== null &&
        budgetUsd > 0 &&
        !budgetWarned &&
        totalCostUsd >= budgetUsd * BUDGET_WARN
      ) {
        budgetWarned = true;
        emit({
          type: "power.warning",
          totalCostUsd,
          budgetUsd,
          threshold: BUDGET_WARN,
        });
      }

      if (budgetUsd !== null && totalCostUsd > budgetUsd) {
        emit({ type: "power.tripped", totalCostUsd, budgetUsd });
        status = "tripped";
        aborted = true;
        return;
      }

      // Monthly budget is advisory: warn at 80% and again at 100%, but don't
      // take the line down (a hard monthly trip would strand in-flight runs).
      if (monthlyBudgetUsd !== null && monthlyBudgetUsd > 0) {
        const monthlyTotal = monthSpentUsd + totalCostUsd;
        if (!monthlyWarned80 && monthlyTotal >= monthlyBudgetUsd * BUDGET_WARN) {
          monthlyWarned80 = true;
          emit({
            type: "power.warning",
            totalCostUsd: monthlyTotal,
            budgetUsd: monthlyBudgetUsd,
            threshold: BUDGET_WARN,
            scope: "monthly",
          });
        }
        if (!monthlyWarned100 && monthlyTotal >= monthlyBudgetUsd) {
          monthlyWarned100 = true;
          emit({
            type: "power.warning",
            totalCostUsd: monthlyTotal,
            budgetUsd: monthlyBudgetUsd,
            threshold: 1,
            scope: "monthly",
          });
        }
      }

      sendPackets(nodeId, result.output.slice(0, 120), primaryKind);
    } catch (err) {
      // 兜底安全网：任何节点分支的意外抛错都必须留下一条 node.failed。否则会走
      // 成 `void runNode()` 的 unhandled rejection —— 节点状态永久停在 "running"，
      // error 边的 catch 节点不会接手，run 照常收尾，外部只看得见"少了某个
      // node.finished"。2026-09-01 CI 上两条 code 节点回归用例的红就是这种形态。
      const message = sanitizeError(err instanceof Error ? err.message : String(err));
      console.warn(`[engine:${nodeId}] ${node.kind} 节点意外抛错:`, message);
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `节点执行异常: ${message}`,
        errorCode: "UNKNOWN",
      });
    } finally {
      running--;
      // 节点失败时立即把错误交给 error 边的下游 catch 节点，不等待全局静止
      // （否则 human 等人工审批挂起时 running 永不归零，兜底会被永久阻塞）。
      if (!aborted && states.get(nodeId) === "failed") {
        const errOut = outgoing(graph, nodeId, "error");
        if (errOut.length) {
          const cause = lastError.get(nodeId);
          if (cause && !artifacts.has(nodeId)) {
            artifacts.set(nodeId, [
              {
                id: `${nodeId}-error`,
                kind: "json",
                content: JSON.stringify(
                  { error: cause.error, errorCode: cause.errorCode ?? "UNKNOWN", nodeId },
                  null,
                  2,
                ),
                mimeType: "application/json",
              },
            ]);
          }
          for (const e of errOut) {
            if (packetEdges.has(e.id)) continue;
            packetEdges.add(e.id);
            emit({
              type: "packet.sent",
              edgeId: e.id,
              from: nodeId,
              to: e.to,
              summary: cause?.error ?? "upstream failed",
              artifactKind: "json",
            });
          }
        }
      }
      // Defer to a microtask so a synchronous node finishing mid-launch
      // doesn't close the run before the scheduler starts the next plant.
      if (!aborted) queueMicrotask(schedule);
      else if (running === 0) finish();
    }
  };

  const schedule = async () => {
    // Bounded concurrency: launch every ready plant up to the free slots.
    while (running < MAX_CONCURRENCY && !aborted) {
      const ready = graph.nodes.find(
        (n) => states.get(n.id) === "pending" && predecessorsReady(n.id),
      );
      if (!ready) break;
      states.set(ready.id, "running");
      running++;
      void runNode(ready.id);
    }

    if (running === 0) {
      // Hand off failures to catch nodes via error edges, then cascade-skip
      // flow downstream that has no catch. Done as a fixpoint once everything
      // else is terminal so parallel branches can't race the decision.
      if (status !== "halted" && status !== "cancelled") {
        let changed = true;
        while (changed) {
          changed = false;
          // 1. Failed nodes with error edges: write the cause as a json
          //    artifact and send an error packet so the catch node can run.
          for (const n of graph.nodes) {
            if (states.get(n.id) !== "failed") continue;
            const errOut = outgoing(graph, n.id, "error");
            if (!errOut.length) continue;
            const cause = lastError.get(n.id);
            if (cause && !artifacts.has(n.id)) {
              artifacts.set(n.id, [
                {
                  id: `${n.id}-error`,
                  kind: "json",
                  content: JSON.stringify({ error: cause.error, errorCode: cause.errorCode ?? "UNKNOWN", nodeId: n.id }, null, 2),
                  mimeType: "application/json",
                },
              ]);
            }
            for (const e of errOut) {
              if (packetEdges.has(e.id)) continue;
              packetEdges.add(e.id);
              emit({ type: "packet.sent", edgeId: e.id, from: n.id, to: e.to, summary: cause?.error ?? "upstream failed", artifactKind: "json" });
              changed = true;
            }
          }
          // 2. Cascade-skip flow downstream stranded behind a failed/skipped
          //    predecessor (and not rescued by a done merge point).
          for (const n of graph.nodes) {
            if (states.get(n.id) !== "pending") continue;
            const errIns = incoming(graph, n.id, "error");
            if (errIns.length > 0) {
              // A catch node is "dead" when every error predecessor is already
              // terminal and none of them failed — no error packet will ever
              // arrive, but it still holds a flow merge point hostage waiting
              // for it. Skip it so the happy path can continue.
              const allErrTerminal = errIns.every((e) => {
                const s = states.get(e.from);
                return s === "done" || s === "skipped" || s === "failed";
              });
              const anyFailed = errIns.some((e) => states.get(e.from) === "failed");
              if (allErrTerminal && !anyFailed) {
                states.set(n.id, "skipped");
                emit({ type: "node.skipped", nodeId: n.id, attempt: attempts.get(n.id) ?? 1, reason: "no error arrived" });
                changed = true;
              }
              continue;
            }
            const ins = incoming(graph, n.id, "flow");
            if (ins.length === 0) continue;
            const allTerminal = ins.every(
              (e) => {
                const s = states.get(e.from);
                return s === "done" || s === "failed" || s === "skipped";
              },
            );
            if (!allTerminal) continue;
            const hasDone = ins.some((e) => states.get(e.from) === "done");
            const hasBlocked = ins.some(
              (e) => states.get(e.from) === "failed" || states.get(e.from) === "skipped",
            );
            if (hasBlocked && !hasDone) {
              states.set(n.id, "skipped");
              emit({ type: "node.skipped", nodeId: n.id, attempt: attempts.get(n.id) ?? 1, reason: "upstream failed" });
              changed = true;
            }
          }
        }
      }
      // A catch node may have become ready via an error packet — restart
      // scheduling instead of finishing, so the catch branch can run.
      if (!aborted && graph.nodes.some((n) => states.get(n.id) === "pending" && predecessorsReady(n.id))) {
        queueMicrotask(schedule);
        return;
      }
      // Any pending node left is stranded behind a halted predecessor — or
      // the scheduler simply never picked it up. Either way the run did not
      // complete its graph, so claiming done would be a silent drop.
      const stranded = graph.nodes.some((n) => states.get(n.id) === "pending");
      if (stranded && status !== "halted" && status !== "cancelled") status = "failed";
      finish();
    }
  };

  // Resume: pre-approve the halted node so downstream can flow. A `human`
  // node resumes with a human.decision instead of a gate.verdict; a gate keeps
  // the existing verdict semantics.
  if (opts.approveGate) {
    const { nodeId, attempt } = opts.approveGate;
    const gate = nodeById(graph, nodeId);
    const isHuman = (opts.haltReason ?? "").startsWith("human:");
    const existing = artifacts.get(nodeId) ?? [];
    const output = existing.find((a) => a.kind === "text")?.content ?? "";
    setTextArtifact(artifacts, nodeId, output);
    states.set(nodeId, "done");
    attempts.set(nodeId, attempt);
    const decision = opts.editOutput && opts.editOutput[nodeId] != null ? "edited" : "approved";
    if (isHuman) {
      emit({ type: "human.decision", nodeId, attempt, decision });
      sendPackets(
        nodeId,
        decision === "edited" ? "Edited by human operator" : "Approved by human operator",
        "text",
      );
    } else {
      emit({
        type: "gate.verdict",
        nodeId,
        attempt,
        passed: true,
        reason: decision === "edited" ? "Edited by human operator" : "Approved by human operator",
        decision,
        by: "human",
      });
      sendPackets(nodeId, "Approved by human operator", "text");
    }
    void gate;
  }

  if (!opts.resuming) {
    emit({ type: "run.started", runId, graphId: graph.id, budgetUsd });
  }

  const onAbort = () => {
    if (finished || aborted) return;
    aborted = true;
    status = "cancelled";
    if (running === 0) finish();
  };
  opts.signal?.addEventListener("abort", onAbort);
  void schedule();

  return queue.stream();
}

function zeroUsage(): Usage {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
}

/** Best-effort filename from a URL path, e.g. https://x/y/report.pdf → report.pdf. */
function fileLabelFromUrl(url: URL): string {
  const base = url.pathname.split("/").filter(Boolean).pop();
  return base || "download";
}

/**
 * Yields the run's event stream. The engine holds no rendering concerns and no
 * persistence concerns — callers fan the stream out to SQLite and to SSE.
 */
export async function* execute(opts: ExecuteOptions): AsyncGenerator<RunEvent, void, void> {
  // Fail closed on a graph that cannot compile (e.g. an empty "blank" canvas):
  // the scheduler dereferences plan.loops/order/levels, so a null plan would
  // otherwise surface as an opaque TypeError instead of a clear error.
  if (!opts.plan) {
    throw new Error(
      "graph does not compile: the pipeline has no executable plan (missing intake or invalid edges)",
    );
  }
  const states = new Map<string, NodeState>();
  for (const n of opts.graph.nodes) states.set(n.id, "pending");

  const gen = await runScheduler({
    runId: opts.runId,
    graph: opts.graph,
    plan: opts.plan,
    worker: opts.worker,
    budgetUsd: opts.budgetUsd,
    monthlyBudgetUsd: opts.monthlyBudgetUsd ?? null,
    monthSpentUsd: opts.monthSpentUsd ?? 0,
    fallbackModel: opts.defaultModel ?? "agnes-2.0-flash",
    startSeq: 0,
    sourceInput: opts.input,
    connectorValues: opts.connectorValues,
    signal: opts.signal,
    now: opts.now ?? Date.now,
    sleep: opts.sleep ?? delay,
    storeBinary: opts.storeBinary ?? defaultStoreBinary,
    readArtifact: opts.readArtifact,
    publicUrl: opts.publicUrl,
    permissionConfig: opts.permissionConfig,
    loadSubgraph: opts.loadSubgraph,
    initialVariables: opts.initialVariables,
    bannedTerms: opts.bannedTerms,
    loadProducts: opts.loadProducts,
    init: {
      artifacts: new Map(),
      attempts: new Map(),
      nodeCostUsd: new Map(),
      totalCostUsd: 0,
      states,
      approvedTools: [],
      packetEdges: new Set(),
      variables: opts.initialVariables ?? new Map<string, unknown>(),
    },
  });
  yield* gen;
}

export interface ResumeState {
  artifacts: Map<string, Artifact[]>;
  attempts: Map<string, number>;
  /** Nodes the log records as skipped (branch tail not taken / cascade-skipped).
   *  Resume must re-seed them as skipped, not pending. */
  skipped: Set<string>;
  totalCostUsd: number;
  nodeCostUsd: Map<string, number>;
  haltedNodeId: string | null;
  haltedReason: string | null;
  lastSeq: number;
  approvedTools: string[];
}

/**
 * Reconstruct in-memory engine state from an existing event log. Used to resume
 * a halted run without replaying its old events (those stay in the DB).
 */
export function reconstructState(events: RunEvent[]): ResumeState {
  const artifacts = new Map<string, Artifact[]>();
  const attempts = new Map<string, number>();
  const skipped = new Set<string>();
  const nodeCostUsd = new Map<string, number>();
  const approvedTools: string[] = [];
  let totalCostUsd = 0;
  let haltedNodeId: string | null = null;
  let haltedReason: string | null = null;
  let lastSeq = -1;

  // Pass 1: which nodes produced a typed artifact event. node.finished may
  // arrive before artifact.produced (source nodes do), so the synthesis below
  // must not assume "no artifacts yet" means "never produced any".
  const producedBy = new Set<string>();
  for (const e of events) {
    if (e.type === "artifact.produced") producedBy.add(e.nodeId);
  }

  for (const e of events) {
    lastSeq = Math.max(lastSeq, e.seq);
    switch (e.type) {
      case "node.finished":
        // If no typed artifacts were produced for this node (old runs / text-only),
        // synthesize a text artifact from the output so downstream input assembly works.
        if (!producedBy.has(e.nodeId) && (!artifacts.has(e.nodeId) || artifacts.get(e.nodeId)!.length === 0)) {
          artifacts.set(e.nodeId, [{ id: `${e.nodeId}-text`, kind: "text", content: e.output }]);
        }
        totalCostUsd += e.usage.costUsd;
        nodeCostUsd.set(e.nodeId, (nodeCostUsd.get(e.nodeId) ?? 0) + e.usage.costUsd);
        break;
      case "artifact.produced": {
        const arr = artifacts.get(e.nodeId) ?? [];
        // The node.finished synthesis (below) can already hold a text artifact
        // with the same `${nodeId}-text` id for runs that predate text-note
        // events — skip the duplicate so downstream input assembly does not
        // repeat the same content twice.
        if (!arr.some((a) => a.id === e.artifact.id)) {
          arr.push(e.artifact);
          artifacts.set(e.nodeId, arr);
        }
        break;
      }
      case "node.started":
        // If this is a rework attempt (attempt > previously recorded), clear the
        // node's artifacts so the new run starts fresh — mirrors the engine's
        // artifacts.set(bodyId, []) during loop reset. Only clear if an entry
        // already exists; never create an empty one (resume uses .has() to tell
        // completed nodes from pending ones).
        const prevAttempt = attempts.get(e.nodeId) ?? 0;
        if (e.attempt > prevAttempt && artifacts.has(e.nodeId)) {
          artifacts.set(e.nodeId, []);
        }
        attempts.set(e.nodeId, e.attempt);
        break;
      case "gate.verdict":
        if (e.passed) attempts.set(e.nodeId, e.attempt);
        break;
      case "human.decision":
        attempts.set(e.nodeId, e.attempt);
        break;
      case "node.skipped":
        skipped.add(e.nodeId);
        break;
      case "gate.exhausted":
        if (e.policy === "halt") haltedNodeId = e.nodeId;
        break;
      case "run.finished":
        if (e.status === "halted") {
          haltedNodeId = e.haltedNodeId ?? haltedNodeId;
          haltedReason = e.reason ?? haltedReason;
        }
        break;
      case "tool.approved":
        if (!approvedTools.includes(e.tool)) approvedTools.push(e.tool);
        break;
    }
  }
  return { artifacts, attempts, skipped, totalCostUsd, nodeCostUsd, haltedNodeId, haltedReason, lastSeq, approvedTools };
}

export interface ResumeOptions {
  runId: string;
  graph: Graph;
  plan: Plan;
  worker: Worker;
  budgetUsd: number | null;
  monthlyBudgetUsd?: number | null;
  monthSpentUsd?: number;
  defaultModel?: string;
  pastEvents: RunEvent[];
  /**
   * Human decision on a halted run (4.7):
   * - `continue` / `approve`: treat the halted gate as passed and proceed.
   * - `edit`: like approve, but `editOutput` overrides the node's product first.
   * - `reject`: end the run as failed (the gate's decision is recorded as rejected).
   * - `scrap`: discard the run entirely (failed).
   * `continue` is retained as an alias of `approve` for backward compatibility.
   */
  action: "continue" | "approve" | "reject" | "edit" | "scrap";
  /**
   * Human-edited product text, keyed by node id (4.7). When set, the run resumes
   * with these strings as the node outputs instead of re-running the agent — the
   * operator fixes the copy directly rather than retrying the model.
   */
  editOutput?: Record<string, string>;
  /**
   * Tools approved for execution this run (4D.7 dangerous-action halt). When set,
   * the halted run is resumed with these tools pre-approved, so a node that halted
   * on a dangerous tool call re-runs and executes it instead of halting again.
   */
  approveTools?: string[];
  /**
   * When set, the node and every flow-descendant are reset to pending (their
   * prior artifacts/attempts/costs discarded) and re-executed. Used to retry a
   * failed node or to rework back to an upstream node.
   */
  resetFrom?: string;
  signal?: AbortSignal;
  /** Persists generated image bytes and returns a stable URI (e.g. /api/artifacts/:id). */
  storeBinary?: (data: Buffer, mimeType: string, label?: string) => string | Promise<string>;
  /** Resolves a /api/artifacts/<id> URI to a data URI for cloud models. */
  readArtifact?: (uri: string) => Promise<string | null>;
  /** Absolute origin prefixed to relative artifact URIs in agent prompts. */
  publicUrl?: string;
  /**
   * Graph variables for this run (cross-run persisted state). Passed by
   * reference and mutated in place; the caller persists them back after the
   * run finishes.
   */
  initialVariables?: Map<string, unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Tool-call permission governance. Defaults to the env-derived config. */
  permissionConfig?: PermissionConfig;
  /** Resolves a subprocess node's referenced graph (db lookup, injected by the HTTP layer). */
  loadSubgraph?: (graphId: string) => Graph | null;
  /** User's banned-word library (comma-joined), merged into compliance nodes. */
  bannedTerms?: string;
  /** Resolves a `product` connector against the user's product library (injected by the HTTP layer). */
  loadProducts?: (connector: ProductConnector) => Promise<ResolvedMaterial>;
}

/**
 * Resume a halted run. Yields ONLY the new events (seq continues from the past
 * log); the caller appends them to the same event store. For "continue", the
 * halted gate is treated as passing and flow proceeds downstream.
 */
export async function* resume(opts: ResumeOptions): AsyncGenerator<RunEvent, void, void> {
  // Same fail-closed guard as execute: a resumed run must have a valid plan,
  // otherwise the scheduler dereferences plan.loops/order/levels on null.
  if (!opts.plan) {
    throw new Error(
      "graph does not compile: the pipeline has no executable plan (missing intake or invalid edges)",
    );
  }
  const { runId, graph, plan, worker, budgetUsd, action } = opts;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? delay;
  const state = reconstructState(opts.pastEvents);

  if (opts.resetFrom) {
    // Collect the reset node and everything reachable downstream via flow edges.
    const reset = new Set<string>([opts.resetFrom]);
    const queue = [opts.resetFrom];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of outgoing(graph, id, "flow")) {
        if (!reset.has(e.to)) {
          reset.add(e.to);
          queue.push(e.to);
        }
      }
    }
    for (const id of reset) {
      state.artifacts.delete(id);
      state.attempts.delete(id);
      state.nodeCostUsd.delete(id);
      state.skipped.delete(id);
    }
  }

  // Seq of the next unused slot. Every event resume yields before handing off to
  // the scheduler consumes one, and the scheduler starts at whatever is left:
  // reusing state.lastSeq + 1 for both collides on the UNIQUE(run_id, seq)
  // constraint and kills the resume mid-stream.
  let nextSeq = state.lastSeq + 1;

  // 4.7 — a human node's pending review is its artifact: approving it passes
  // the reviewed text downstream (the approveGate pre-mark reads it back).
  // editOutput below then overrides it when the operator edited the text.
  const isHuman = (state.haltedReason ?? "").startsWith("human:");
  if (state.haltedNodeId && isHuman && (action === "approve" || action === "continue" || action === "edit")) {
    const review = [...opts.pastEvents]
      .reverse()
      .find((e) => e.type === "human.review" && e.nodeId === state.haltedNodeId);
    if (review && review.type === "human.review") {
      setTextArtifact(state.artifacts, state.haltedNodeId, review.content);
    }
  }

  // 4.7 — human-edited product text overrides the stored node outputs before
  // the run continues, so the operator can fix copy without re-running the model.
  if (opts.editOutput) {
    for (const [nodeId, text] of Object.entries(opts.editOutput)) {
      setTextArtifact(state.artifacts, nodeId, text);
    }
  }

  // 4.7 — reject: a rejected human node fails (error edges can catch it, else
  // the run fails); a rejected gate ends the run as failed directly.
  let rejectHuman: { nodeId: string; attempt: number } | undefined;
  if (action === "reject") {
    if (isHuman && state.haltedNodeId) {
      const attempt = state.attempts.get(state.haltedNodeId) ?? 1;
      rejectHuman = { nodeId: state.haltedNodeId, attempt };
      yield {
        type: "human.decision",
        nodeId: state.haltedNodeId,
        attempt,
        decision: "rejected",
        seq: nextSeq++,
        ts: now(),
      };
      // The scheduler pre-marks this node failed so error edges can catch it,
      // but a pre-mark writes no event: without this the node stays "running" in
      // the projection after the run ends and a later resume cannot see it failed.
      yield {
        type: "node.failed",
        nodeId: state.haltedNodeId,
        attempt,
        error: "Rejected by human operator",
        errorCode: "VALIDATION",
        seq: nextSeq++,
        ts: now(),
      };
    } else {
      if (state.haltedNodeId) {
        const attempt = state.attempts.get(state.haltedNodeId) ?? 1;
        yield {
          type: "gate.verdict",
          nodeId: state.haltedNodeId,
          attempt,
          passed: false,
          reason: "Rejected by human operator",
          decision: "rejected",
          by: "human",
          seq: nextSeq++,
          ts: now(),
        };
      }
      yield {
        type: "run.finished",
        runId,
        status: "failed",
        reason: "Rejected by human operator",
        haltedNodeId: state.haltedNodeId ?? undefined,
        seq: nextSeq++,
        ts: now(),
      };
      return;
    }
  }

  if (action === "scrap") {
    const ev: RunEvent = {
      type: "run.finished",
      runId,
      status: "failed",
      seq: nextSeq++,
      ts: now(),
    };
    yield ev;
    return;
  }

  // 4D.7 — dangerous-action approval: persist newly-approved tools as events
  // (replay-consistent) and resume with them pre-approved.
  const approveTools = opts.approveTools ?? [];
  const toEmit = approveTools.filter((t) => !state.approvedTools.includes(t));
  for (const t of toEmit) {
    yield { type: "tool.approved", tool: t, seq: nextSeq++, ts: now() };
  }
  const startSeq = nextSeq;

  // Seed the scheduler: every node that already produced an artifact is done;
  // a node the log records as skipped (branch tail not taken, or cascade-skipped
  // behind a failure) stays skipped — re-seeding it as pending strands every
  // downstream merge point, because predecessorsReady waits for a terminal
  // state that will never arrive (dogfood tpl-customer-service: human approve →
  // notify → depot never ran, yet the run reported done).
  // Everything else downstream of the halted gate is pending and will weld now.
  const states = new Map<string, NodeState>();
  for (const n of graph.nodes) {
    states.set(
      n.id,
      state.artifacts.has(n.id) ? "done" : state.skipped.has(n.id) ? "skipped" : "pending",
    );
  }

  const isToolHalt = (state.haltedReason ?? "").startsWith("dangerous-tool:");
  const gen = await runScheduler({
    runId,
    graph,
    plan,
    worker,
    budgetUsd,
    monthlyBudgetUsd: opts.monthlyBudgetUsd ?? null,
    monthSpentUsd: opts.monthSpentUsd ?? 0,
    fallbackModel: opts.defaultModel ?? "agnes-2.0-flash",
    startSeq,
    signal: opts.signal,
    now,
    sleep,
    storeBinary: opts.storeBinary ?? defaultStoreBinary,
    readArtifact: opts.readArtifact,
    publicUrl: opts.publicUrl,
    permissionConfig: opts.permissionConfig,
    editOutput: opts.editOutput,
    loadSubgraph: opts.loadSubgraph,
    initialVariables: opts.initialVariables,
    bannedTerms: opts.bannedTerms,
    loadProducts: opts.loadProducts,
    init: {
      artifacts: state.artifacts,
      attempts: state.attempts,
      nodeCostUsd: state.nodeCostUsd,
      totalCostUsd: state.totalCostUsd,
      states,
      approvedTools: state.approvedTools,
      packetEdges: new Set(
        opts.pastEvents
          .filter((e) => e.type === "packet.sent")
          .map((e) => (e as { edgeId: string }).edgeId),
      ),
      variables: opts.initialVariables ?? new Map<string, unknown>(),
    },
    resuming: true,
    approveTools: [...new Set([...state.approvedTools, ...approveTools])],
    haltReason: state.haltedReason ?? undefined,
    rejectHuman,
    approveGate: !isToolHalt && !rejectHuman && state.haltedNodeId
      ? {
          nodeId: state.haltedNodeId,
          attempt: state.attempts.get(state.haltedNodeId) ?? 1,
        }
      : undefined,
  });
  yield* gen;
}
