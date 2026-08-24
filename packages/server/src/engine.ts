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

export interface ExecuteOptions {
  runId: string;
  graph: Graph;
  plan: Plan;
  worker: Worker;
  /** Hard ceiling. Cost is metered after each call, so this trips late by one node. */
  budgetUsd: number | null;
  signal?: AbortSignal;
  /** Injected so runs are reproducible in tests. */
  now?: () => number;
}

type Status = "done" | "failed" | "halted" | "tripped" | "cancelled";

/**
 * Yields the run's event stream. The engine holds no rendering concerns and no
 * persistence concerns — callers fan the stream out to SQLite and to SSE.
 */
export async function* execute(opts: ExecuteOptions): AsyncGenerator<RunEvent, void, void> {
  const { runId, graph, plan, worker, budgetUsd } = opts;
  const now = opts.now ?? Date.now;

  let seq = 0;
  const emit = (e: DraftEvent): RunEvent => ({ ...e, seq: seq++, ts: now() });

  let totalCostUsd = 0;
  /** Latest artifact produced by each node, used to feed downstream inputs. */
  const artifacts = new Map<string, string>();
  const attempts = new Map<string, number>();

  yield emit({ type: "run.started", runId, graphId: graph.id, budgetUsd });

  const inputFor = (node: GraphNode): string => {
    const parts = incoming(graph, node.id, "flow")
      .map((e) => artifacts.get(e.from))
      .filter((v): v is string => typeof v === "string");
    return parts.join("\n\n");
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
      const verdict = await worker.judge({ node, attempt, input: inputFor(node) });
      yield emit({
        type: "gate.verdict",
        nodeId,
        attempt,
        passed: verdict.passed,
        reason: verdict.reason,
      });

      if (verdict.passed) {
        artifacts.set(nodeId, inputFor(node));
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
        yield emit({ type: "node.failed", nodeId, attempt, error: verdict.reason });
        break;
      }

      if (attempt >= loop.maxAttempts) {
        const policy = node.gate?.onExhausted ?? "halt";
        yield emit({ type: "gate.exhausted", nodeId, attempts: attempt, policy });
        if (policy === "pass") {
          artifacts.set(nodeId, inputFor(node));
          cursor++;
          continue;
        }
        status = policy === "halt" ? "halted" : "failed";
        break;
      }

      // Send it back down the rework line and re-run the loop body.
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
    const config = node.agent ?? { model: "claude-sonnet-5", prompt: "", skills: [] };
    yield emit({ type: "node.started", nodeId, attempt });

    const gen = worker.runAgent({ node, config, attempt, input: inputFor(node) });
    let result: { output: string; usage: Usage };
    while (true) {
      const step = await gen.next();
      if (step.done) {
        result = step.value;
        break;
      }
      if (opts.signal?.aborted) {
        status = "cancelled";
        break outer;
      }
      yield emit({ type: "node.delta", nodeId, attempt, text: step.value });
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
