import {
  extractArtifacts,
  incoming,
  nodeById,
  outgoing,
  type Artifact,
  type DraftEvent,
  type Graph,
  type GraphNode,
  type Plan,
  type RunEvent,
  type Usage,
} from "@agent-world/core";
import type { Worker } from "./worker.js";
import { ProviderError } from "./providers/openai-compatible.js";
import { sanitizeError } from "./sanitize.js";
import { resolveTools, executeBuiltinTool } from "./skills/registry.js";

/**
 * Reference images originate at source nodes and flow downstream through
 * text-only agents. Returns a per-graph resolver that memoizes the set of
 * image URLs reachable from a node via flow edges (diamonds dedupe).
 */
function createImageResolver(graph: Graph): (nodeId: string) => string[] {
  const cache = new Map<string, string[]>();
  const resolve = (id: string): string[] => {
    const cached = cache.get(id);
    if (cached) return cached;
    const node = nodeById(graph, id);
    const own = node?.kind === "source" ? node.source?.images ?? [] : [];
    const upstream = incoming(graph, id, "flow").flatMap((e) => resolve(e.from));
    const merged = [...new Set([...own, ...upstream])];
    cache.set(id, merged);
    return merged;
  };
  return resolve;
}

export interface ExecuteOptions {
  runId: string;
  graph: Graph;
  plan: Plan;
  worker: Worker;
  /** Raw material fed to the source node. Falls back to a placeholder. */
  input?: string;
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
}

type Status = "done" | "failed" | "halted" | "tripped" | "cancelled";
type NodeState = "pending" | "running" | "done" | "failed";

const RETRYABLE: ReadonlySet<string> = new Set(["TIMEOUT", "RATE_LIMIT", "PROVIDER_ERROR"]);
/** Max plants welding at once. Keeps a burst of parallel branches from hammering the provider. */
const MAX_CONCURRENCY = 6;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Assemble upstream artifacts into a nodes input according to its input policy.
 * - all: concatenate every upstream output (default)
 * - last: only the most recent upstream output
 * - truncate: concatenate but cap at maxChars, keeping the tail
 */
function assembleInput(
  parts: string[],
  policy: { mode: "all" | "last" | "truncate"; maxChars?: number },
): string {
  if (parts.length === 0) return "";
  if (policy.mode === "last") return parts[parts.length - 1] ?? "";
  const body = parts.join("\n\n");
  if (policy.mode === "truncate" && policy.maxChars && body.length > policy.maxChars) {
    const head = `...[前 ${body.length - policy.maxChars} 字符已截断]...\n`;
    return head + body.slice(body.length - policy.maxChars + head.length);
  }
  return body;
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
  artifacts: Map<string, string>;
  attempts: Map<string, number>;
  nodeCostUsd: Map<string, number>;
  totalCostUsd: number;
  states: Map<string, NodeState>;
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
  signal?: AbortSignal;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  init: SchedulerInit;
  /** When resuming, the halted gate is pre-approved. */
  approveGate?: { nodeId: string; attempt: number };
  /** True when continuing an existing run (resume/retry): don't re-emit run.started. */
  resuming?: boolean;
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
  const monthlyBudgetUsd = opts.monthlyBudgetUsd ?? null;
  const monthSpentUsd = opts.monthSpentUsd ?? 0;
  const queue = new EventQueue();
  const imagesFor = createImageResolver(graph);

  let seq = opts.startSeq;
  const emit = (e: DraftEvent): RunEvent => {
    const ev = { ...e, seq: seq++, ts: opts.now() } as RunEvent;
    queue.push(ev);
    return ev;
  };

  const artifacts = opts.init.artifacts;
  const attempts = opts.init.attempts;
  const nodeCostUsd = opts.init.nodeCostUsd;
  const states = opts.init.states;
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

  let status: Status = "done";
  let running = 0;
  let aborted = false;
  let finished = false;

  const inputFor = (node: GraphNode, includeNote = true): string => {
    const parts = incoming(graph, node.id, "flow")
      .map((e) => artifacts.get(e.from))
      .filter((v): v is string => typeof v === "string");
    const policy = node.agent?.inputPolicy ?? { mode: "all" as const };
    const body = assembleInput(parts, policy);
    const note = includeNote ? reworkNotes.get(node.id) : undefined;
    if (!note) return body;
    return `${body}\n\n[质检站退回原因] ${note}`;
  };

  const predecessorsDone = (id: string) =>
    incoming(graph, id, "flow").every((e) => states.get(e.from) === "done");

  const finish = () => {
    if (finished) return;
    finished = true;
    if (status === "done" && [...states.values()].some((s) => s === "failed")) {
      status = "failed";
    }
    emit({ type: "run.finished", runId, status });
    queue.close();
  };

  const sendPackets = (nodeId: string, summary: string, artifactKind?: Artifact["kind"]) => {
    for (const e of outgoing(graph, nodeId, "flow")) {
      emit({ type: "packet.sent", edgeId: e.id, from: nodeId, to: e.to, summary, artifactKind });
    }
  };

  /** Produce typed artifacts from a node's output and emit events. Returns the primary kind. */
  const produceArtifacts = (nodeId: string, output: string, attempt?: number): Artifact["kind"] => {
    const extracted = extractArtifacts(output, nodeId);
    let primary: Artifact["kind"] = "text";
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
        const output =
          node.kind === "source"
            ? opts.sourceInput?.trim() || `Task intake at ${node.name}`
            : inputFor(node);
        artifacts.set(nodeId, output);
        states.set(nodeId, "done");
        emit({ type: "node.started", nodeId, attempt });
        emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
        let primaryKind: Artifact["kind"] | undefined;
        if (node.kind === "source" && node.source?.images.length) {
          for (const [i, url] of node.source.images.entries()) {
            const a: Artifact = { id: `${nodeId}-img${i}`, kind: "image", uri: url };
            emit({ type: "artifact.produced", nodeId, artifact: a });
          }
          primaryKind = "image";
        } else {
          primaryKind = produceArtifacts(nodeId, output, attempt);
        }
        sendPackets(nodeId, output.slice(0, 120), primaryKind);
        return;
      }

      if (node.kind === "gate") {
        emit({ type: "node.started", nodeId, attempt });
        const output = inputFor(node);
        const verdict = await worker.judge({
          node,
          attempt,
          input: output,
          output,
          criterion: node.gate?.criterion ?? "",
          signal: opts.signal,
        });
        emit({
          type: "gate.verdict",
          nodeId,
          attempt,
          passed: verdict.passed,
          reason: verdict.reason,
        });

        if (verdict.passed) {
          artifacts.set(nodeId, output);
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
            artifacts.set(nodeId, output);
            states.set(nodeId, "done");
            sendPackets(nodeId, verdict.reason, "text");
            return;
          }
          states.set(nodeId, "failed");
          status = policy === "halt" ? "halted" : "failed";
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
          artifacts.delete(bodyId);
        }
        return;
      }

      // agent
      const config = {
        model: node.agent?.model || fallbackModel,
        prompt: node.agent?.prompt ?? "",
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
          const agentInput = inputFor(node);
          reworkNotes.delete(nodeId);
          const mounts = (node.agent?.skills ?? []).map((s) =>
            typeof s === "string" ? { id: s, enabled: true } : s,
          );
          const tools = resolveTools(mounts);
          const gen = worker.runAgent({
            node,
            config,
            attempt,
            input: agentInput,
            images: imagesFor(nodeId),
            tools,
            executeTool: async (name, args) => executeBuiltinTool(name, args),
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
          const code = err instanceof ProviderError ? err.code : "UNKNOWN";
          lastError = { message: (err as Error).message, code };
          const canRetry = RETRYABLE.has(code) && tryIdx < maxAttempts - 1;
          if (!canRetry) break;
          await opts.sleep(
            Math.min(config.retry.maxDelayMs, config.retry.baseDelayMs * 2 ** tryIdx),
          );
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

      artifacts.set(nodeId, result.output);
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
        (n) => states.get(n.id) === "pending" && predecessorsDone(n.id),
      );
      if (!ready) break;
      states.set(ready.id, "running");
      running++;
      void runNode(ready.id);
    }

    if (running === 0) {
      // Any pending node left is stranded behind a failed/halted predecessor.
      const stranded = graph.nodes.some((n) => states.get(n.id) === "pending");
      if (stranded && status === "done") status = "failed";
      finish();
    }
  };

  // Resume: pre-approve the halted gate so downstream can flow.
  if (opts.approveGate) {
    const { nodeId, attempt } = opts.approveGate;
    const gate = nodeById(graph, nodeId);
    const output = artifacts.get(nodeId) ?? "";
    artifacts.set(nodeId, output);
    states.set(nodeId, "done");
    attempts.set(nodeId, attempt);
    emit({
      type: "gate.verdict",
      nodeId,
      attempt,
      passed: true,
      reason: "Approved by human operator",
    });
    sendPackets(nodeId, "Approved by human operator", "text");
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
    signal: opts.signal,
    now: opts.now ?? Date.now,
    sleep: opts.sleep ?? delay,
    init: {
      artifacts: new Map(),
      attempts: new Map(),
      nodeCostUsd: new Map(),
      totalCostUsd: 0,
      states,
    },
  });
  yield* gen;
}

export interface ResumeState {
  artifacts: Map<string, string>;
  attempts: Map<string, number>;
  totalCostUsd: number;
  nodeCostUsd: Map<string, number>;
  haltedNodeId: string | null;
  lastSeq: number;
}

/**
 * Reconstruct in-memory engine state from an existing event log. Used to resume
 * a halted run without replaying its old events (those stay in the DB).
 */
export function reconstructState(events: RunEvent[]): ResumeState {
  const artifacts = new Map<string, string>();
  const attempts = new Map<string, number>();
  const nodeCostUsd = new Map<string, number>();
  let totalCostUsd = 0;
  let haltedNodeId: string | null = null;
  let lastSeq = -1;

  for (const e of events) {
    lastSeq = Math.max(lastSeq, e.seq);
    switch (e.type) {
      case "node.finished":
        artifacts.set(e.nodeId, e.output);
        totalCostUsd += e.usage.costUsd;
        nodeCostUsd.set(e.nodeId, (nodeCostUsd.get(e.nodeId) ?? 0) + e.usage.costUsd);
        break;
      case "node.started":
        attempts.set(e.nodeId, e.attempt);
        break;
      case "gate.verdict":
        if (e.passed) attempts.set(e.nodeId, e.attempt);
        break;
      case "gate.exhausted":
        if (e.policy === "halt") haltedNodeId = e.nodeId;
        break;
    }
  }
  return { artifacts, attempts, totalCostUsd, nodeCostUsd, haltedNodeId, lastSeq };
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
  action: "continue" | "scrap";
  /**
   * When set, the node and every flow-descendant are reset to pending (their
   * prior artifacts/attempts/costs discarded) and re-executed. Used to retry a
   * failed node or to rework back to an upstream node.
   */
  resetFrom?: string;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
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

  // Seed the scheduler: every node that already produced an artifact is done;
  // everything downstream of the halted gate is pending and will weld now.
  const states = new Map<string, NodeState>();
  for (const n of graph.nodes) {
    states.set(n.id, state.artifacts.has(n.id) ? "done" : "pending");
  }

  const gen = await runScheduler({
    runId,
    graph,
    plan,
    worker,
    budgetUsd,
    monthlyBudgetUsd: opts.monthlyBudgetUsd ?? null,
    monthSpentUsd: opts.monthSpentUsd ?? 0,
    fallbackModel: opts.defaultModel ?? "agnes-2.0-flash",
    startSeq: state.lastSeq + 1,
    signal: opts.signal,
    now,
    sleep,
    init: {
      artifacts: state.artifacts,
      attempts: state.attempts,
      nodeCostUsd: state.nodeCostUsd,
      totalCostUsd: state.totalCostUsd,
      states,
    },
    resuming: true,
    approveGate: state.haltedNodeId
      ? {
          nodeId: state.haltedNodeId,
          attempt: state.attempts.get(state.haltedNodeId) ?? 1,
        }
      : undefined,
  });
  yield* gen;
}
