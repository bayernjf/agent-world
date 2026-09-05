import {
  FanoutConfig,
  incoming,
  nodeById,
  outgoing,
  type Artifact,
  type Graph,
  type GraphNode,
  type RunEvent,
  type SkillMount,
  type Usage,
} from "@agent-world/core";
import { getSkill } from "../skills/registry.js";
import type { ToolDefinition } from "../worker.js";

// Shared pure helpers extracted from engine.ts so node execution bodies in
// nodes/*.ts can reuse them without importing the engine (no cycle).

/** Flow-edge descendants of `id` (excludes `id`). */
export function descendants(graph: Graph, id: string): Set<string> {
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
export function ancestors(graph: Graph, id: string): Set<string> {
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
export interface VariantParam {
  id: string;
  prompt?: string;
  temperature?: number;
  model?: string;
}

/** Expand a fanout config into N per-lane parameter sets. */
export function buildVariantParams(cfg: FanoutConfig, fallbackModel: string): VariantParam[] {
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
export function applyVariantConfig(n: GraphNode, v: VariantParam): GraphNode {
  if (n.kind !== "textGen" || !n.textGen) return { ...n };
  const tg = { ...n.textGen };
  if (v.prompt != null) tg.prompt = v.prompt;
  if (v.temperature != null) tg.temperature = v.temperature;
  if (v.model != null) tg.model = v.model;
  return { ...n, textGen: tg };
}

/** Ids of the lane nodes strictly between a fanout and its select (exclusive). */
export function variantLaneIds(graph: Graph, fanoutId: string, selectId: string): string[] {
  const down = descendants(graph, fanoutId);
  const up = ancestors(graph, selectId);
  return [...down].filter((id) => id !== fanoutId && id !== selectId && up.has(id));
}

/** Clone the lane into a self-contained sub-graph (source → lane → sink). */
export function buildVariantGraph(
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
export function firstSelectDownstream(graph: Graph, fanoutId: string): string | null {
  const down = descendants(graph, fanoutId);
  for (const id of down) if (nodeById(graph, id)?.kind === "select") return id;
  return null;
}

/** The fanout node feeding a select's lanes (first one found upstream). */
export function firstFanoutUpstream(graph: Graph, selectId: string): string | null {
  const up = ancestors(graph, selectId);
  for (const id of up) if (nodeById(graph, id)?.kind === "fanout") return id;
  return null;
}

export const CONNECTOR_MAX_RETRIES = 2;
export const CONNECTOR_RETRY_DELAY_MS = 1000;

/**
 * Hard-truncate a body to `maxChars`, keeping the tail and a small head marker.
 * Used as the deterministic fallback when a `summary` policy has no summarizer
 * or the summarizer fails.
 */
export function truncateText(body: string, maxChars: number): string {
  const head = `...[前 ${body.length - maxChars} 字符已截断]...\n`;
  return head + body.slice(body.length - maxChars + head.length);
}

/**
 * Replace a node's artifacts with a single text artifact. Used when a node
 * finishes with a text output (agent/source/sink/gate).
 */
export function setTextArtifact(artifacts: Map<string, Artifact[]>, nodeId: string, text: string): Artifact {
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
 * Supplemental judging rule appended to every gate criterion. Locally stored
 * artifacts surface as …/api/artifacts/<id> URLs (often on a localhost origin),
 * and model judges otherwise reject them as "not a real upstream URL" — even
 * though they ARE the real upstream output. Enforced here at engine level so
 * no graph config can trip over it.
 */
export const ARTIFACT_URL_NOTE =
  "\n补充判定规则：凡 URL 路径中包含 /api/artifacts/ 的图片或媒体链接，都是本系统产物库中由上游节点真实产出的存储地址，属于有效的上游真实 URL；不得仅因其域名是本机或内网地址（如 localhost、127.0.0.1）而判定为无效、编造或不符合「真实 URL」要求。";

/**
 * Build the source brief: the raw material fed at run time plus the structured
 * product/brand/audience fields configured on the source node. This text flows
 * downstream as the first node's artifact, so every writer sees it.
 *
 * `fallbacks` (design-data-interpolation.md D4) only fills FACT fields
 * (productName/brand) and only when the user left them empty — non-empty user
 * input is treated as a deliberate override. Tone fields (audience/priceRange/
 * tone/prohibited/brandTerms/notes) never receive a fallback because data sources
 * have no semantic for them. Pure source nodes without a structured connector
 * pass `undefined` and keep byte-identical output to the pre-fallback era.
 */
export function buildSourceBrief(
  node: GraphNode,
  sourceInput: string | undefined,
  fallbacks?: Record<string, string>,
): string {
  const src = node.source;
  const factFallback = (key: "productName" | "brand"): string => {
    const user = src?.[key];
    if (typeof user === "string" && user.trim() !== "") return user;
    return fallbacks?.[key] ?? "";
  };
  const lines: string[] = [];
  const productName = factFallback("productName");
  if (productName) lines.push(`商品名称：${productName}`);
  const brand = factFallback("brand");
  if (brand) lines.push(`品牌/店铺：${brand}`);
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
export function upstreamProhibitedTerms(graph: Graph, nodeId: string): string[] {
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
export function upstreamBrandTerms(graph: Graph, nodeId: string): string[] {
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
export function detectProhibited(text: string, terms: string[]): string[] {
  if (terms.length === 0 || !text) return [];
  return terms.filter((t) => text.includes(t));
}

/** Short context snippets around each hit so rework feedback names the exact offending phrases. */
export function prohibitedSnippets(text: string, hits: string[], maxSnippets = 3): string[] {
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
export function buildImagePrompt(node: GraphNode, graph: Graph): string {
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

/**
 * Prefix every node-scoped event with a subprocess scope id
 * (`<subNode>#sub:`), so child-graph events can't collide with parent nodes.
 * Run-level events (run.started/run.finished) pass through untouched.
 */
export function prefixEvent(e: RunEvent, prefix: string): RunEvent {
  if (!("nodeId" in e) || e.nodeId === undefined) return e;
  return { ...e, nodeId: prefix + e.nodeId };
}

export function zeroUsage(): Usage {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
}

/** Best-effort filename from a URL path, e.g. https://x/y/report.pdf → report.pdf. */
export function fileLabelFromUrl(url: URL): string {
  const base = url.pathname.split("/").filter(Boolean).pop();
  return base || "download";
}

/** Provider error codes that may be retried. */
export const RETRYABLE: ReadonlySet<string> = new Set(["TIMEOUT", "RATE_LIMIT", "PROVIDER_ERROR"]);

/** Normalize a skill entry (id string or mount) into a full SkillMount. */
export function toMount(s: string | SkillMount): SkillMount {
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

/**
 * Built-in graph-variable tools (cross-run persisted state). They are appended
 * to every agent's tool list; the engine routes their execution to the run's
 * variables map (see `handleVariableTool`). Safe tools — no approval needed.
 */
export const VARIABLE_TOOLS: ToolDefinition[] = [
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

/** Budget warning threshold (fraction of the run budget). */
export const BUDGET_WARN = 0.8;
