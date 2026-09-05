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
import type { NodeRunContext, NodeHandler } from "./nodes/types.js";
import { textGenNode } from "./nodes/textgen.js";
import { httpNode } from "./nodes/http.js";
import { selectNode } from "./nodes/select.js";
import { fanoutNode } from "./nodes/fanout.js";
import { gateNode } from "./nodes/gate.js";
import { subprocessNode } from "./nodes/subprocess.js";
import { codeNode } from "./nodes/code.js";
import { loopNode } from "./nodes/loop.js";
import { sourceNode } from "./nodes/source.js";
import { genericNode } from "./nodes/generic.js";
import { imageGenNode } from "./nodes/imagegen.js";
import { audioGenNode } from "./nodes/audiogen.js";
import { videoGenNode } from "./nodes/videogen.js";
import { translateNode } from "./nodes/translate.js";
import { fileParseNode } from "./nodes/fileParse.js";
import { tableNode } from "./nodes/table.js";
import { searchNode } from "./nodes/search.js";
import { convertNode } from "./nodes/convert.js";
import { ocrNode } from "./nodes/ocr.js";
import { branchNode } from "./nodes/branch.js";
import { databaseNode } from "./nodes/database.js";
import { parallelNode } from "./nodes/parallel.js";
import { mapNode } from "./nodes/map.js";
import { complianceNode } from "./nodes/compliance.js";
import { humanNode } from "./nodes/human.js";
import { sinkNode } from "./nodes/sink.js";
import { publishNode } from "./nodes/publish.js";
import { runVcsNode } from "./nodes/vcs.js";
import { type Logger, log } from "./logger.js";
import {
  ARTIFACT_URL_NOTE,
  CONNECTOR_MAX_RETRIES,
  CONNECTOR_RETRY_DELAY_MS,
  ancestors,
  applyVariantConfig,
  buildImagePrompt,
  buildSourceBrief,
  buildVariantGraph,
  buildVariantParams,
  detectProhibited,
  descendants,
  fileLabelFromUrl,
  firstFanoutUpstream,
  firstSelectDownstream,
  BUDGET_WARN,
  collectPromptModules,
  getOutputContract,
  toMount,
  validateContract,
  VARIABLE_TOOLS,
  prefixEvent,
  RETRYABLE,
  prohibitedSnippets,
  setTextArtifact,
  truncateText,
  upstreamBrandTerms,
  upstreamProhibitedTerms,
  variantLaneIds,
  zeroUsage,
} from "./nodes/shared.js";

/**
 * Stage 2.2 node dispatch table: one handler per node kind, each living in
 * nodes/*.ts and receiving the explicit NodeRunContext built by runScheduler.
 * `notify` is deliberately absent — it runs inline in runNode (see the comment
 * there). Kinds missing from the table fall back to the agent/textGen handler,
 * mirroring the old if-chain fallthrough.
 */
const NODE_HANDLERS: Partial<Record<GraphNode["kind"], NodeHandler>> = {
  fanout: fanoutNode,
  select: selectNode,
  source: sourceNode,
  sink: sinkNode,
  http: httpNode,
  code: codeNode,
  branch: branchNode,
  map: mapNode,
  loop: loopNode,
  subprocess: subprocessNode,
  parallel: parallelNode,
  table: tableNode,
  database: databaseNode,
  fileParse: fileParseNode,
  translate: translateNode,
  ocr: ocrNode,
  convert: convertNode,
  search: searchNode,
  vcs: runVcsNode,
  human: humanNode,
  compliance: complianceNode,
  publish: publishNode,
  gate: gateNode,
  videoGen: videoGenNode,
  audioGen: audioGenNode,
  imageGen: imageGenNode,
  generic: genericNode,
  textGen: textGenNode,
};

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


/**
 * E.2 — collect prompt text from every mounted `prompt-module` skill, including
 * multi-level `equips` dependencies, de-duplicated by skill id (BFS, cycle-safe).
 * Returns the ordered module prompts to inject into the agent's system prompt.
 */
/** Normalize a skill entry (id string or mount) into a full SkillMount. */
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
  /**
   * The calling user's web search service (Settings → 搜索服务). Feeds every
   * search node as the default beneath node-level credentials: node apiKey/cx
   * → this → env vars. A configured provider here also replaces the node's
   * keyless duckduckgo default. Injected by the HTTP layer.
   */
  searchConfig?: { provider?: string; apiKey?: string; cx?: string };
  /** Resolves a `product` connector against the user's product library (injected by the HTTP layer). */
  loadProducts?: (connector: ProductConnector) => Promise<ResolvedMaterial>;
  /** Run-scoped structured logger, bound to runId/graphId by the caller. */
  log?: Logger;
}

export type Status = "done" | "failed" | "halted" | "tripped" | "cancelled";
/**
 * - skipped: a branch node did not route here; the node is never launched and
 *   its own un-routed subtree is skipped the same way.
 */
export type NodeState = "pending" | "running" | "done" | "failed" | "skipped";


/** Connector pull resilience: how many extra attempts and the gap between them. */
/** Max plants welding at once. Keeps a burst of parallel branches from hammering the provider. */
const MAX_CONCURRENCY = 6;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));



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

export interface SchedulerInit {
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

export interface SchedulerOptions {
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
  /** User's web search service (Settings), default beneath node-level search credentials. */
  searchConfig?: { provider?: string; apiKey?: string; cx?: string };
  /** Resolves a `product` connector against the user's product library (injected by the HTTP layer). */
  loadProducts?: (connector: ProductConnector) => Promise<ResolvedMaterial>;
  /** Run-scoped structured logger, bound to runId/graphId by the caller. */
  log?: Logger;
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
  const runLog = (opts.log ?? log).child({ runId });
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

  // --- Explicit execution context for node handlers in nodes/*.ts (stage 2.2).
  // Makes the scheduler's shared state explicit: handlers receive this object
  // instead of closing over runScheduler's locals. Mutable scalars are wired
  // through getters/setters so scheduler core (bare identifiers) and handlers
  // (ctx.xxx) read/write the same state. runNode is assigned after its const
  // declaration below — handlers only ever run after that point.
  const ctx: NodeRunContext = {
    opts,
    runId,
    log: runLog,
    graph,
    plan,
    worker,
    budgetUsd,
    fallbackModel,
    monthlyBudgetUsd,
    monthSpentUsd,
    approved,
    artifacts,
    attempts,
    nodeCostUsd,
    states,
    lastError,
    reworkNotes,
    loopByGate,
    loopItemByNode,
    variables,
    httpMeta,
    packetEdges,
    get status() {
      return status;
    },
    set status(v: Status) {
      status = v;
    },
    get running() {
      return running;
    },
    set running(v: number) {
      running = v;
    },
    get aborted() {
      return aborted;
    },
    set aborted(v: boolean) {
      aborted = v;
    },
    get finished() {
      return finished;
    },
    set finished(v: boolean) {
      finished = v;
    },
    get haltNodeId() {
      return haltNodeId;
    },
    set haltNodeId(v: string | undefined) {
      haltNodeId = v;
    },
    get haltReason() {
      return haltReason;
    },
    set haltReason(v: string | undefined) {
      haltReason = v;
    },
    get totalCostUsd() {
      return totalCostUsd;
    },
    set totalCostUsd(v: number) {
      totalCostUsd = v;
    },
    get budgetWarned() {
      return budgetWarned;
    },
    set budgetWarned(v: boolean) {
      budgetWarned = v;
    },
    get monthlyWarned80() {
      return monthlyWarned80;
    },
    set monthlyWarned80(v: boolean) {
      monthlyWarned80 = v;
    },
    get monthlyWarned100() {
      return monthlyWarned100;
    },
    set monthlyWarned100(v: boolean) {
      monthlyWarned100 = v;
    },
    emit,
    inputFor,
    nodeCtx,
    interpCtx,
    sendPackets,
    artifactValue,
    produceArtifacts,
    markBranchSkipped,
    extractSubInit,
    mergeSubInit,
    finish,
    permCfg,
    imagesFor,
    handleVariableTool,
    scheduler: runScheduler,
    runNode: undefined as unknown as NodeRunContext["runNode"],
  };

  // --- Per-node-kind execution bodies, extracted from runNode's if-chain (2.1).
  // They close over the scheduler's shared state and are invoked from runNode's
  // dispatch switch. `node`/`nodeId`/`attempt` are runNode-local, so passed in.





























  // --- Agent / textGen node: conversational generation with tools (the
  // default branch — every unhandled kind runs here).

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
      // Stage 2.2: every migrated kind dispatches through the module-level
      // NODE_HANDLERS registry. `notify` stays inline below — extracting it
      // once introduced an await boundary that deferred error-edge dispatch by
      // a microtask and broke the "notify failure → catch node" contract
      // (regression/core-path.test.ts).
      if (node.kind !== "notify") {
        const handler = NODE_HANDLERS[node.kind] ?? textGenNode;
        await handler(ctx, node, nodeId, attempt);
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
    } catch (err) {
      // 兜底安全网：任何节点分支的意外抛错都必须留下一条 node.failed。否则会走
      // 成 `void runNode()` 的 unhandled rejection —— 节点状态永久停在 "running"，
      // error 边的 catch 节点不会接手，run 照常收尾，外部只看得见"少了某个
      // node.finished"。2026-09-01 CI 上两条 code 节点回归用例的红就是这种形态。
      const message = sanitizeError(err instanceof Error ? err.message : String(err));
      runLog.warn("node threw unexpectedly", { nodeId, kind: node.kind, error: message });
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
  // Wired here (after runNode's declaration) for node handlers in nodes/*.ts;
  // see the ctx construction above.
  ctx.runNode = runNode;

  const schedule = async () => {
    // Bounded concurrency: launch every ready plant up to the free slots.
    while (running < MAX_CONCURRENCY && !aborted) {
      const ready = graph.nodes.find(
        (n) => states.get(n.id) === "pending" && predecessorsReady(n.id),
      );
      if (!ready) break;
      if (ready.kind === "code" || ready.kind === "notify" || ready.kind === "human") {
        runLog.debug("schedule launch", { nodeId: ready.id, kind: ready.kind, running });
      }
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
    log: opts.log,
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
    searchConfig: opts.searchConfig,
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
  /** User's web search service (Settings), default beneath node-level search credentials. */
  searchConfig?: { provider?: string; apiKey?: string; cx?: string };
  /** Resolves a `product` connector against the user's product library (injected by the HTTP layer). */
  loadProducts?: (connector: ProductConnector) => Promise<ResolvedMaterial>;
  /** Run-scoped structured logger, bound to runId/graphId by the caller. */
  log?: Logger;
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
    log: opts.log,
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
    searchConfig: opts.searchConfig,
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
