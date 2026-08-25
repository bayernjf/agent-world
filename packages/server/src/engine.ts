import {
  incoming,
  nodeById,
  outgoing,
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

export interface ExecuteOptions {
  runId: string;
  graph: Graph;
  plan: Plan;
  worker: Worker;
  /** Raw material fed to the source node. Falls back to a placeholder. */
  input?: string;
  /** Hard ceiling. Cost is metered after each call, so this trips late by one node. */
  budgetUsd: number | null;
  /** Fallback model for nodes that don't specify one. */
  defaultModel?: string;
  signal?: AbortSignal;
  /** Injected so runs are reproducible in tests. */
  now?: () => number;
  /** Injected so retry backoff is controllable in tests. */
  sleep?: (ms: number) => Promise<void>;
}

type Status = "done" | "failed" | "halted" | "tripped" | "cancelled";

const RETRYABLE: ReadonlySet<string> = new Set(["TIMEOUT", "RATE_LIMIT", "PROVIDER_ERROR"]);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Yields the run's event stream. The engine holds no rendering concerns and no
 * persistence concerns — callers fan the stream out to SQLite and to SSE.
 */
export async function* execute(opts: ExecuteOptions): AsyncGenerator<RunEvent, void, void> {
  const { runId, graph, plan, worker, budgetUsd } = opts;
  const fallbackModel = opts.defaultModel ?? "agnes-2.0-flash";
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? delay;

  let seq = 0;
  const emit = (e: DraftEvent): RunEvent => ({ ...e, seq: seq++, ts: now() });

  let totalCostUsd = 0;
  /** Latest artifact produced by each node, used to feed downstream inputs. */
  const artifacts = new Map<string, string>();
  const attempts = new Map<string, number>();
  /**
   * When a gate rejects and sends work back, the rejection reason is noted on
   * the rework entry node so it can see WHY it was sent back and actually
   * improve. Consumed (cleared) when that next runs.
   */
  const reworkNotes = new Map<string, string>();

  yield emit({ type: "run.started", runId, graphId: graph.id, budgetUsd });

  const inputFor = (node: GraphNode, includeNote = true): string => {
    const parts = incoming(graph, node.id, "flow")
      .map((e) => artifacts.get(e.from))
      .filter((v): v is string => typeof v === "string");
    const body = parts.join("\n\n");
    const note = includeNote ? reworkNotes.get(node.id) : undefined;
    if (!note) return body;
    return `${body}\n\n[质检站退回原因] ${note}`;
  };

  const loopByGate = new Map(plan.loops.map((l) => [l.gateId, l]));

  let cursor = 0;
  let status: Status = "done";

  outer: while (cursor < plan.order.length) {
    if (opts.signal?.aborted) {
      status = "cancelled";
      break;
    }

    const nodeId = plan.order[cursor]!;
    const node = nodeById(graph, nodeId);
    if (!node) {
      cursor++;
      continue;
    }

    const attempt = (attempts.get(nodeId) ?? 0) + 1;
    attempts.set(nodeId, attempt);

    // Intakes and depots do no work, but they still have to light up and hand
    // freight to the next plant — otherwise the first pipe never carries a truck.
    if (node.kind === "source" || node.kind === "sink") {
      const output = node.kind === "source"
        ? (opts.input?.trim() || `Task intake at ${node.name}`)
        : inputFor(node);
      artifacts.set(nodeId, output);
      yield emit({ type: "node.started", nodeId, attempt });
      yield emit({
        type: "node.finished",
        nodeId,
        attempt,
        output,
        usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
      });
      for (const e of outgoing(graph, nodeId, "flow")) {
        yield emit({
          type: "packet.sent",
          edgeId: e.id,
          from: nodeId,
          to: e.to,
          summary: output.slice(0, 120),
        });
      }
      cursor++;
      continue;
    }

    if (node.kind === "gate") {
      yield emit({ type: "node.started", nodeId, attempt });
      const output = inputFor(node);
      const verdict = await worker.judge({
        node,
        attempt,
        input: output,
        output,
        criterion: node.gate?.criterion ?? "",
        signal: opts.signal,
      });
      yield emit({
        type: "gate.verdict",
        nodeId,
        attempt,
        passed: verdict.passed,
        reason: verdict.reason,
      });

      if (verdict.passed) {
        artifacts.set(nodeId, output);
        for (const e of outgoing(graph, nodeId, "flow")) {
          yield emit({
            type: "packet.sent",
            edgeId: e.id,
            from: nodeId,
            to: e.to,
            summary: verdict.reason,
          });
        }
        cursor++;
        continue;
      }

      const loop = loopByGate.get(nodeId);
      if (!loop) {
        status = "failed";
        yield emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: verdict.reason,
          errorCode: "VALIDATION",
        });
        break;
      }

      if (attempt >= loop.maxAttempts) {
        const policy = node.gate?.onExhausted ?? "halt";
        yield emit({ type: "gate.exhausted", nodeId, attempts: attempt, policy });
        if (policy === "pass") {
          artifacts.set(nodeId, output);
          cursor++;
          continue;
        }
        status = policy === "halt" ? "halted" : "failed";
        break;
      }

      // Send it back down the rework line and re-run the loop body.
      // Note the rejection reason on the entry node so the reworked agent can
      // see what was wrong and improve, instead of producing the same output.
      reworkNotes.set(loop.entryId, verdict.reason);
      yield emit({
        type: "packet.sent",
        edgeId: loop.edge.id,
        from: nodeId,
        to: loop.entryId,
        summary: verdict.reason,
      });
      cursor = plan.order.indexOf(loop.entryId);
      continue;
    }

    // agent
    const config = {
      model: node.agent?.model || fallbackModel,
      prompt: node.agent?.prompt ?? "",
      skills: node.agent?.skills ?? [],
      temperature: node.agent?.temperature ?? 0.7,
      timeoutMs: node.agent?.timeoutMs ?? 120000,
      retry: node.agent?.retry ?? { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 },
    };
    yield emit({ type: "node.started", nodeId, attempt });

    // Run the agent with technical-failure retries. Retries do NOT increment
    // attempt — attempt is identity, retries are the same attempt surviving a
    // transient fault (timeout, rate limit, 5xx).
    let result: { output: string; usage: Usage } | null = null;
    let lastError: { message: string; code?: string } | null = null;
    const maxAttempts = 1 + config.retry.maxRetries;

    for (let tryIdx = 0; tryIdx < maxAttempts; tryIdx++) {
      if (opts.signal?.aborted) {
        status = "cancelled";
        break outer;
      }
      try {
        const agentInput = inputFor(node);
        reworkNotes.delete(nodeId);
        const gen = worker.runAgent({ node, config, attempt, input: agentInput, signal: opts.signal });
        let output = "";
        let usage: Usage | null = null;
        while (true) {
          const step = await gen.next();
          if (step.done) {
            output = step.value.output;
            usage = step.value.usage;
            break;
          }
          if (opts.signal?.aborted) {
            status = "cancelled";
            break outer;
          }
          const chunk = step.value;
          if (chunk.type === "text-delta") {
            yield emit({ type: "node.delta", nodeId, attempt, text: chunk.text });
          } else if (chunk.type === "reasoning-delta") {
            yield emit({ type: "node.reasoning", nodeId, attempt, text: chunk.text });
          }
          // tool-call / tool-result are reserved for Phase 2; ignore for now.
        }
        result = { output, usage: usage ?? { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
        break;
      } catch (err) {
        const code = err instanceof ProviderError ? err.code : "UNKNOWN";
        lastError = { message: (err as Error).message, code };
        const canRetry =
          RETRYABLE.has(code) &&
          tryIdx < maxAttempts - 1;
        if (!canRetry) break;
        const backoff = Math.min(
          config.retry.maxDelayMs,
          config.retry.baseDelayMs * 2 ** tryIdx,
        );
        await sleep(backoff);
      }
    }

      if (!result) {
        yield emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: sanitizeError(lastError?.message ?? "agent failed with no output"),
          errorCode: (lastError?.code as "TIMEOUT" | "RATE_LIMIT" | "PROVIDER_ERROR" | "AUTH" | "VALIDATION" | "UNKNOWN" | "UNSUPPORTED" | undefined) ?? "UNKNOWN",
        });
      status = "failed";
      break;
    }

    artifacts.set(nodeId, result.output);
    yield emit({
      type: "node.finished",
      nodeId,
      attempt,
      output: result.output,
      usage: result.usage,
    });

    totalCostUsd += result.usage.costUsd;
    yield emit({ type: "power.metered", totalCostUsd, budgetUsd });

    if (budgetUsd !== null && totalCostUsd > budgetUsd) {
      yield emit({ type: "power.tripped", totalCostUsd, budgetUsd });
      status = "tripped";
      break;
    }

    for (const e of outgoing(graph, nodeId, "flow")) {
      yield emit({
        type: "packet.sent",
        edgeId: e.id,
        from: nodeId,
        to: e.to,
        summary: result.output.slice(0, 120),
      });
    }

    cursor++;
  }

  yield emit({ type: "run.finished", runId, status });
}

export interface ResumeState {
  artifacts: Map<string, string>;
  attempts: Map<string, number>;
  totalCostUsd: number;
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
  let totalCostUsd = 0;
  let haltedNodeId: string | null = null;
  let lastSeq = -1;

  for (const e of events) {
    lastSeq = Math.max(lastSeq, e.seq);
    switch (e.type) {
      case "node.finished":
        artifacts.set(e.nodeId, e.output);
        totalCostUsd += e.usage.costUsd;
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
      case "run.finished":
        if (e.status === "halted" && !haltedNodeId) {
          // fall back: find the last gate.exhausted
        }
        break;
    }
  }
  return { artifacts, attempts, totalCostUsd, haltedNodeId, lastSeq };
}

export interface ResumeOptions {
  runId: string;
  graph: Graph;
  plan: Plan;
  worker: Worker;
  budgetUsd: number | null;
  defaultModel?: string;
  pastEvents: RunEvent[];
  action: "continue" | "scrap";
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
  const fallbackModel = opts.defaultModel ?? "agnes-2.0-flash";
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? delay;
  const state = reconstructState(opts.pastEvents);

  let seq = state.lastSeq + 1;
  const emit = (e: DraftEvent): RunEvent => ({ ...e, seq: seq++, ts: now() });

  if (action === "scrap") {
    yield emit({ type: "run.finished", runId, status: "failed" });
    return;
  }

  const artifacts = state.artifacts;
  const attempts = state.attempts;
  let totalCostUsd = state.totalCostUsd;
  let status: Status = "done";

  // Find the cursor position: just after the halted gate in the plan order.
  const startIdx = state.haltedNodeId
    ? plan.order.indexOf(state.haltedNodeId)
    : plan.order.length;
  if (startIdx < 0) {
    yield emit({ type: "run.finished", runId, status: "failed" });
    return;
  }

  // The halted gate is approved by the human; mark it as passing and emit the
  // downstream packets it would have sent.
  if (state.haltedNodeId) {
    const gate = nodeById(graph, state.haltedNodeId);
    const attempt = attempts.get(state.haltedNodeId) ?? 1;
    const output = artifacts.get(state.haltedNodeId) ?? "";
    artifacts.set(state.haltedNodeId, output);
    yield emit({
      type: "gate.verdict",
      nodeId: state.haltedNodeId,
      attempt,
      passed: true,
      reason: "Approved by human operator",
    });
    for (const e of outgoing(graph, state.haltedNodeId, "flow")) {
      yield emit({
        type: "packet.sent",
        edgeId: e.id,
        from: state.haltedNodeId,
        to: e.to,
        summary: "Approved by human operator",
      });
    }
    void gate;
  }

  const inputFor = (node: GraphNode): string => {
    const parts = incoming(graph, node.id, "flow")
      .map((e) => artifacts.get(e.from))
      .filter((v): v is string => typeof v === "string");
    return parts.join("\n\n");
  };

  let cursor = startIdx + 1;

  outer: while (cursor < plan.order.length) {
    if (opts.signal?.aborted) {
      status = "cancelled";
      break;
    }

    const nodeId = plan.order[cursor]!;
    const node = nodeById(graph, nodeId);
    if (!node) {
      cursor++;
      continue;
    }

    const attempt = (attempts.get(nodeId) ?? 0) + 1;
    attempts.set(nodeId, attempt);

    if (node.kind === "source" || node.kind === "sink") {
      const output = node.kind === "source" ? `Task intake at ${node.name}` : inputFor(node);
      artifacts.set(nodeId, output);
      yield emit({ type: "node.started", nodeId, attempt });
      yield emit({
        type: "node.finished",
        nodeId,
        attempt,
        output,
        usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
      });
      for (const e of outgoing(graph, nodeId, "flow")) {
        yield emit({
          type: "packet.sent",
          edgeId: e.id,
          from: nodeId,
          to: e.to,
          summary: output.slice(0, 120),
        });
      }
      cursor++;
      continue;
    }

    if (node.kind === "gate") {
      yield emit({ type: "node.started", nodeId, attempt });
      const output = inputFor(node);
      const verdict = await worker.judge({
        node,
        attempt,
        input: output,
        output,
        criterion: node.gate?.criterion ?? "",
        signal: opts.signal,
      });
      yield emit({
        type: "gate.verdict",
        nodeId,
        attempt,
        passed: verdict.passed,
        reason: verdict.reason,
      });
      if (verdict.passed) {
        artifacts.set(nodeId, output);
        for (const e of outgoing(graph, nodeId, "flow")) {
          yield emit({
            type: "packet.sent",
            edgeId: e.id,
            from: nodeId,
            to: e.to,
            summary: verdict.reason,
          });
        }
        cursor++;
      } else {
        // On resume we don't re-enter rework loops (the original halt was about
        // a different gate); fail fast to avoid surprises.
        yield emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: verdict.reason,
          errorCode: "VALIDATION",
        });
        status = "failed";
        break;
      }
      continue;
    }

    const config = {
      model: node.agent?.model || fallbackModel,
      prompt: node.agent?.prompt ?? "",
      skills: node.agent?.skills ?? [],
      temperature: node.agent?.temperature ?? 0.7,
      timeoutMs: node.agent?.timeoutMs ?? 120000,
      retry: node.agent?.retry ?? { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 },
    };
    yield emit({ type: "node.started", nodeId, attempt });

    let result: { output: string; usage: Usage } | null = null;
    let lastError: { message: string; code?: string } | null = null;
    const maxTries = 1 + config.retry.maxRetries;

    for (let tryIdx = 0; tryIdx < maxTries; tryIdx++) {
      if (opts.signal?.aborted) {
        status = "cancelled";
        break outer;
      }
      try {

        const gen = worker.runAgent({ node, config, attempt, input: inputFor(node), signal: opts.signal });
        let output = "";
        let usage: Usage | null = null;
        while (true) {
          const step = await gen.next();
          if (step.done) {
            output = step.value.output;
            usage = step.value.usage;
            break;
          }
          if (opts.signal?.aborted) {
            status = "cancelled";
            break outer;
          }
          const chunk = step.value;
          if (chunk.type === "text-delta") {
            yield emit({ type: "node.delta", nodeId, attempt, text: chunk.text });
          } else if (chunk.type === "reasoning-delta") {
            yield emit({ type: "node.reasoning", nodeId, attempt, text: chunk.text });
          }
        }
        result = { output, usage: usage ?? { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
        break;
      } catch (err) {
        const code = err instanceof ProviderError ? err.code : "UNKNOWN";
        lastError = { message: (err as Error).message, code };
        if (!RETRYABLE.has(code) || tryIdx >= maxTries - 1) break;
        await sleep(Math.min(config.retry.maxDelayMs, config.retry.baseDelayMs * 2 ** tryIdx));
      }
    }

    if (!result) {
      yield emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: sanitizeError(lastError?.message ?? "agent failed with no output"),
        errorCode: (lastError?.code as "TIMEOUT" | "RATE_LIMIT" | "PROVIDER_ERROR" | "AUTH" | "VALIDATION" | "UNKNOWN" | "UNSUPPORTED" | undefined) ?? "UNKNOWN",
      });
      status = "failed";
      break;
    }

    artifacts.set(nodeId, result.output);
    yield emit({
      type: "node.finished",
      nodeId,
      attempt,
      output: result.output,
      usage: result.usage,
    });
    totalCostUsd += result.usage.costUsd;
    yield emit({ type: "power.metered", totalCostUsd, budgetUsd });
    if (budgetUsd !== null && totalCostUsd > budgetUsd) {
      yield emit({ type: "power.tripped", totalCostUsd, budgetUsd });
      status = "tripped";
      break;
    }
    for (const e of outgoing(graph, nodeId, "flow")) {
      yield emit({
        type: "packet.sent",
        edgeId: e.id,
        from: nodeId,
        to: e.to,
        summary: result.output.slice(0, 120),
      });
    }
    cursor++;
  }

  yield emit({ type: "run.finished", runId, status });
}
