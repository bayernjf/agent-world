import {
  BranchConfig,
  CodeNodeConfig,
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
  type RunEvent,
  type SkillMount,
  type TableInput,
  type Usage,
} from "@agent-world/core";
import { spawn } from "node:child_process";
import { HaltRequested, type Worker } from "./worker.js";
import { ProviderError } from "./providers/openai-compatible.js";
import { sanitizeError } from "./sanitize.js";
import { getSkill, resolveTools, executeBuiltinTool } from "./skills/registry.js";
import { guardToolCall, isDangerousTool, loadPermissionConfig, type PermissionConfig } from "./permissions.js";
import { notifyFailed, notifyHalt } from "./notify.js";
import { resolveConnector } from "./connectors.js";
import { createSqliteDriver } from "./db-drivers.js";
import { dataUriToBuffer, parseDocument, extractPdfImages } from "./parse-file.js";
import { ocrImage } from "./ocr.js";
import { decodeImage, encodeJpeg, encodePng } from "./convert.js";
import { searchWeb, SearchAuthError } from "./search.js";
import { sendNotification, NotifyAuthError, NotifyProviderError } from "./notifier.js";
import { executeVcs, VcsAuthError, VcsProviderError } from "./vcs.js";
import { withRetry } from "./retry.js";
import { allowPrivateNetwork, hostIsInternal } from "./ssrf.js";

/**
 * Append free-text layout directives (manual image-position overrides) to an
 * agent's base prompt. Returns the prompt unchanged when no directives exist.
 */
export function withLayoutDirectives(base: string, directives?: string): string {
  const d = directives?.trim();
  if (!d) return base;
  return `${base}\n\n排版附加要求（必须遵守）：\n${d}`;
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
}

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
function setTextArtifact(artifacts: Map<string, Artifact[]>, nodeId: string, text: string): void {
  const headingMatch = text.match(/^\s*#\s+(.+?)\s*$/m);
  const label = headingMatch ? headingMatch[1] : undefined;
  artifacts.set(nodeId, [
    {
      id: `${nodeId}-text`,
      kind: "text",
      content: text,
      mimeType: "text/markdown",
      ...(label ? { label } : {}),
    },
  ]);
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
  /** buildNodeContext with the loop item (if this node is inside a loop body). */
  const nodeCtx = (nodeId: string): Record<string, unknown> => {
    const item = loopItemByNode.get(nodeId);
    return buildNodeContext(nodeId, artifacts, graph, item !== undefined ? { item } : undefined);
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
    const policy = node.agent?.inputPolicy ?? { mode: "all" as const };
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
            model: node.agent?.model,
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
    for (const id of skipped) states.set(id, "skipped");
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    // A failed node is "handled" if it has an error edge to a catch node that
    // finished done — such failures don't sink the run (the catch produced a
    // fallback). Unhandled failures downgrade done → failed.
    if (status !== "halted" && status !== "cancelled" && status !== "tripped") {
      const isHandled = (id: string) =>
        outgoing(graph, id, "error").some((e) => states.get(e.to) === "done");
      const unhandled = [...states.entries()].some(([id, s]) => s === "failed" && !isHandled(id));
      status = unhandled ? "failed" : "done";
      if (status === "failed") {
        // Alert the operator: which nodes failed (unhandled by a catch) and how
        // many downstream nodes got skipped. Fire-and-forget, never blocks.
        void notifyFailed({
          runId,
          graphId: graph.id,
          failedNodes: [...states.entries()]
            .filter(([id, s]) => s === "failed" && !isHandled(id))
            .map(([id]) => {
              const le = lastError.get(id);
              return { nodeId: id, error: le?.error ?? "node failed", errorCode: le?.errorCode };
            }),
          skippedCount: [...states.values()].filter((s) => s === "skipped").length,
        });
      }
    }
    emit({
      type: "run.finished",
      runId,
      status,
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
        const conn = node.source?.connector;
        if (conn) {
          let ok = false;
          let lastErr: unknown;
          for (let i = 0; i <= CONNECTOR_MAX_RETRIES && !ok; i++) {
            try {
              const m = await resolveConnector(conn, opts.connectorValues);
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

        const ctx = nodeCtx(nodeId);
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
              const abort = new AbortController();
              const timer = setTimeout(() => abort.abort(), cfg.timeoutMs);
              try {
                const r = await fetch(targetUrl.toString(), {
                  method: cfg.method,
                  headers,
                  body: body && cfg.method !== "GET" ? body : undefined,
                  signal: abort.signal,
                });
                if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
                return r;
              } finally {
                clearTimeout(timer);
              }
            },
            cfg.retry,
            (err) => !(err instanceof Error && err.name === "AbortError"),
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
            errorCode: "PROVIDER_ERROR",
          });
          return;
        }

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
        const ctx = nodeCtx(nodeId);
        const inputJson = JSON.stringify({ inputs: ctx });
        const { stdout, stderr, killed, code } = await withRetry(
          async () => {
            const child = spawn(
              cfg.language === "python" ? "python3" : "node",
              cfg.language === "python" ? ["-c", cfg.code] : ["-e", cfg.code],
              { stdio: ["pipe", "pipe", "pipe"] },
            );
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
            errorCode: "PROVIDER_ERROR",
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
      }

      if (node.kind === "branch") {
        emit({ type: "node.started", nodeId, attempt });
        const cfg: BranchConfig = BranchConfig.parse(node.branch ?? {});
        const ctx = nodeCtx(nodeId);
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
          const roundValue = (id: string): unknown => {
            const arts = artifacts.get(id) ?? [];
            const json = arts.find((a) => a.kind === "json");
            if (json?.content) {
              try {
                return JSON.parse(json.content);
              } catch {
                return json.content;
              }
            }
            // Text artifacts may still hold JSON (e.g. a sink consuming a
            // JSON-producing body) — parse when possible so results stay
            // structured.
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
              results.push(roundValue(endNodes[0]!));
            } else {
              const round: Record<string, unknown> = {};
              for (const id of endNodes) round[id] = roundValue(id);
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

      if (node.kind === "parallel") {
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
          const fileArt = arts.find((a) => a.kind === "file" && a.uri);
          if (!fileArt) {
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
          const parsed = await parseDocument(dataUriToBuffer(resolved), fileArt.mimeType);
          const produced: Artifact[] = [
            { id: `${nodeId}-txt`, kind: "text", content: parsed.text, mimeType: "text/plain" },
          ];
          for (const [idx, img] of parsed.images.slice(0, cfg.maxImages).entries()) {
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
              label: `${fileArt.label ?? "文档"} 图片 ${idx + 1}`,
            });
          }
          artifacts.set(nodeId, produced);
          for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
          states.set(nodeId, "done");
          const imgCount = produced.length - 1;
          const summary = `解析完成：${parsed.text.length} 字符文本${imgCount ? `，提取 ${imgCount} 张图片` : ""}`;
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
            const gen = worker.runAgent({
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
              | "AUTH"
              | "VALIDATION"
              | "UNKNOWN"
              | "UNSUPPORTED"
              | undefined) ?? "UNKNOWN",
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
          const title = cfg.title?.trim() || node.name || cfg.action;
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
          setTextArtifact(artifacts, nodeId, output);
          states.set(nodeId, "done");
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
            setTextArtifact(artifacts, nodeId, output);
            states.set(nodeId, "done");
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
      console.warn(`[videoGen:${nodeId}] worker has no generateVideo, skipping`);
      states.set(nodeId, "done");
      emit({ type: "node.finished", nodeId, attempt, output: "", usage: zeroUsage() });
      sendPackets(nodeId, "跳过（worker 无视频能力）", "text");
      return;
    }
    const prompt = cfg.prompt?.trim() || (await inputFor(node));
    try {
      const results = await worker.generateVideo({ node, config: cfg, input: prompt, signal: opts.signal });
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
      states.set(nodeId, "done");
      emit({ type: "node.finished", nodeId, attempt, output: "", usage: zeroUsage() });
      sendPackets(nodeId, "视频生成失败（已跳过）", "text");
    }
    return;
  }

  // --- Audio generation node: TTS / music from text ---
  if (node.kind === "audioGen") {
    emit({ type: "node.started", nodeId, attempt });
    const cfg = node.audioGen ?? { model: "tts-1", format: "mp3", n: 1 };
    if (!worker.generateAudio) {
      console.warn(`[audioGen:${nodeId}] worker has no generateAudio, skipping`);
      states.set(nodeId, "done");
      emit({ type: "node.finished", nodeId, attempt, output: "", usage: zeroUsage() });
      sendPackets(nodeId, "跳过（worker 无音频能力）", "text");
      return;
    }
    const prompt = cfg.prompt?.trim() || (await inputFor(node));
    try {
      const results = await worker.generateAudio({ node, config: cfg, input: prompt, signal: opts.signal });
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
      states.set(nodeId, "done");
      emit({ type: "node.finished", nodeId, attempt, output: "", usage: zeroUsage() });
      sendPackets(nodeId, "音频生成失败（已跳过）", "text");
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
      let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { images: 0 } };
      const imageArts: Artifact[] = [];
      for (let idx = 0; idx < results.length; idx++) {
        const res = results[idx]!;
        const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "ai-image"}-${idx + 1}.png`);
        const a: Artifact = {
          id: `${nodeId}-img-${idx}`,
          kind: "image",
          uri,
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
      // 生图是增强项：无生图后端时优雅降级，整条线仍可继续运行。
      console.warn(`[imageGen:${nodeId}] generation skipped:`, (err as Error).message);
      states.set(nodeId, "done");
      emit({ type: "node.finished", nodeId, attempt, output: "", usage: zeroUsage() });
      sendPackets(nodeId, "生图失败（已降级跳过）", "text");
    }
    return;
  }

      // agent
      const mounts = (node.agent?.skills ?? []).map(toMount);
      const promptModules = collectPromptModules(mounts);
      const basePrompt = withLayoutDirectives(node.agent?.prompt ?? "", node.agent?.imageDirectives);
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
        model: node.agent?.model || fallbackModel,
        prompt,
        skills: node.agent?.skills ?? [],
        temperature: node.agent?.temperature ?? 0.7,
        timeoutMs: node.agent?.timeoutMs ?? 120000,
        inputPolicy: node.agent?.inputPolicy ?? { mode: "all" as const },
        retry: node.agent?.retry ?? { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 },
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
          const tools = resolveTools(mounts);
          const rawImageUris = imagesFor(nodeId);
          const referenceImages = opts.readArtifact
            ? await Promise.all(rawImageUris.map((u) => inlineImageUrl(u, opts.readArtifact!)))
            : rawImageUris;
          const content: ContentPart[] | undefined = referenceImages.length
            ? [{ type: "text", text: agentInput }, ...referenceImages.map((u): ContentPart => ({ type: "image", image: u }))]
            : undefined;
          const gen = worker.runAgent({
            node,
            config,
            attempt,
            input: agentInput,
            images: referenceImages,
            content,
            tools,
            executeTool: async (name, args) => {
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
            | "AUTH"
            | "VALIDATION"
            | "UNKNOWN"
            | "UNSUPPORTED"
            | undefined) ?? "UNKNOWN",
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
      const nodeBudget = node.agent?.budgetUsd;
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
    } finally {
      running--;
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
            if (errIns.length > 0) continue; // catch node — waits for its error pred, not skipped here
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
      // Any pending node left is stranded behind a halted predecessor.
      const stranded = graph.nodes.some((n) => states.get(n.id) === "pending");
      if (stranded && status === "done") status = "failed";
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
    init: {
      artifacts: new Map(),
      attempts: new Map(),
      nodeCostUsd: new Map(),
      totalCostUsd: 0,
      states,
      approvedTools: [],
      packetEdges: new Set(),
    },
  });
  yield* gen;
}

export interface ResumeState {
  artifacts: Map<string, Artifact[]>;
  attempts: Map<string, number>;
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
  const nodeCostUsd = new Map<string, number>();
  const approvedTools: string[] = [];
  let totalCostUsd = 0;
  let haltedNodeId: string | null = null;
  let haltedReason: string | null = null;
  let lastSeq = -1;

  for (const e of events) {
    lastSeq = Math.max(lastSeq, e.seq);
    switch (e.type) {
      case "node.finished":
        // If no typed artifacts were produced for this node (old runs / text-only),
        // synthesize a text artifact from the output so downstream input assembly works.
        if (!artifacts.has(e.nodeId) || artifacts.get(e.nodeId)!.length === 0) {
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
  return { artifacts, attempts, totalCostUsd, nodeCostUsd, haltedNodeId, haltedReason, lastSeq, approvedTools };
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
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Tool-call permission governance. Defaults to the env-derived config. */
  permissionConfig?: PermissionConfig;
}

/**
 * Resume a halted run. Yields ONLY the new events (seq continues from the past
 * log); the caller appends them to the same event store. For "continue", the
 * halted gate is treated as passing and flow proceeds downstream.
 */
export async function* resume(opts: ResumeOptions): AsyncGenerator<RunEvent, void, void> {
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
    }
  }

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
        seq: state.lastSeq + 1,
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
          seq: state.lastSeq + 1,
          ts: now(),
        };
      }
      yield {
        type: "run.finished",
        runId,
        status: "failed",
        reason: "Rejected by human operator",
        haltedNodeId: state.haltedNodeId ?? undefined,
        seq: state.lastSeq + 2,
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
      seq: state.lastSeq + 1,
      ts: now(),
    };
    yield ev;
    return;
  }

  // 4D.7 — dangerous-action approval: persist newly-approved tools as events
  // (replay-consistent) and resume with them pre-approved.
  const approveTools = opts.approveTools ?? [];
  let emitSeq = state.lastSeq;
  const toEmit = approveTools.filter((t) => !state.approvedTools.includes(t));
  for (const t of toEmit) {
    yield { type: "tool.approved", tool: t, seq: ++emitSeq, ts: now() };
  }
  const startSeq = emitSeq + 1;

  // Seed the scheduler: every node that already produced an artifact is done;
  // everything downstream of the halted gate is pending and will weld now.
  const states = new Map<string, NodeState>();
  for (const n of graph.nodes) {
    states.set(n.id, state.artifacts.has(n.id) ? "done" : "pending");
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
