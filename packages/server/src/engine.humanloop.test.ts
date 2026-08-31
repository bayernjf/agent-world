import { compile, type Graph, type RunEvent } from "@agent-world/core";
import { describe, expect, it, vi } from "vitest";
import { execute, resume } from "./engine.js";
import { type Worker } from "./worker.js";

const TEXTGEN = {
  model: "agnes-2.0-flash",
  prompt: "",
  skills: [],
  temperature: 0,
  timeoutMs: 60000,
  inputPolicy: { mode: "all" as const },
  retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
};

/** Worker that records each agent's input and always fails the gate. */
function humanLoopWorker(): { worker: Worker; calls: Array<{ id: string; input: string }> } {
  const calls: Array<{ id: string; input: string }> = [];
  const worker: Worker = {
    async *runTextGen(args) {
      calls.push({ id: (args.node as { id: string }).id, input: args.input });
      yield { type: "text-delta", text: "x" };
      return { output: `OUT-${(args.node as { id: string }).id}`, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: false, reason: "judge says no" };
    },
    async generateImage() {
      return [];
    },
  };
  return { worker, calls };
}

function loopGraph(): Graph {
  return {
    nodes: [
      { id: "s1", kind: "source", name: "Src", x: 0, y: 0, source: {} },
      { id: "w1", kind: "textGen", name: "Writer", x: 1, y: 0, textGen: TEXTGEN },
      { id: "g1", kind: "gate", name: "Critic", x: 2, y: 0, gate: { maxAttempts: 1, onExhausted: "halt" } },
      { id: "a1", kind: "textGen", name: "Downstream", x: 3, y: 0, textGen: TEXTGEN },
    ],
    edges: [
      { id: "e1", kind: "flow", from: "s1", to: "w1" },
      { id: "e2", kind: "flow", from: "w1", to: "g1" },
      { id: "e3", kind: "rework", from: "g1", to: "w1" },
      { id: "e4", kind: "flow", from: "g1", to: "a1" },
    ],
  };
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const finished = (events: RunEvent[]) => events.find((e) => e.type === "run.finished") as Extract<RunEvent, { type: "run.finished" }>;

describe("4.7 human-in-the-loop", () => {
  it("halts at a gate and records halted context for notification", async () => {
    const { worker } = humanLoopWorker();
    const graph = loopGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(execute({ runId: "r", graph, plan, worker, now: () => 0 }));
    const fin = finished(events);
    expect(fin.status).toBe("halted");
    expect(fin.haltedNodeId).toBe("g1");
    expect(fin.reason).toBe("judge says no");
  });

  it("approve (continue) lets the run finish with a decision event", async () => {
    const { worker } = humanLoopWorker();
    const graph = loopGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const halted = await collect(execute({ runId: "r", graph, plan, worker, now: () => 0 }));

    const events = await collect(
      resume({ runId: "r", graph, plan, worker, budgetUsd: null, pastEvents: halted, action: "approve", now: () => 0 }),
    );
    const decision = events.find((e) => e.type === "gate.verdict") as Extract<RunEvent, { type: "gate.verdict" }>;
    expect(decision.decision).toBe("approved");
    expect(decision.by).toBe("human");
    expect(finished(events).status).toBe("done");
  });

  it("edit applies the human-edited product to the downstream node", async () => {
    const { worker, calls } = humanLoopWorker();
    const graph = loopGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const halted = await collect(execute({ runId: "r", graph, plan, worker, now: () => 0 }));

    const events = await collect(
      resume({
        runId: "r",
        graph,
        plan,
        worker,
        budgetUsd: null,
        pastEvents: halted,
        action: "edit",
        editOutput: { g1: "HUMAN-FIXED" },
        now: () => 0,
      }),
    );
    const decision = events.find((e) => e.type === "gate.verdict") as Extract<RunEvent, { type: "gate.verdict" }>;
    expect(decision.decision).toBe("edited");
    expect(finished(events).status).toBe("done");
    // The downstream agent must have received the human-edited text.
    const a1 = calls.find((c) => c.id === "a1");
    expect(a1?.input).toContain("HUMAN-FIXED");
  });

  it("reject ends the run as failed with a rejected decision", async () => {
    const { worker } = humanLoopWorker();
    const graph = loopGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const halted = await collect(execute({ runId: "r", graph, plan, worker, now: () => 0 }));

    const events = await collect(
      resume({ runId: "r", graph, plan, worker, budgetUsd: null, pastEvents: halted, action: "reject", now: () => 0 }),
    );
    const decision = events.find((e) => e.type === "gate.verdict") as Extract<RunEvent, { type: "gate.verdict" }>;
    expect(decision.decision).toBe("rejected");
    expect(finished(events).status).toBe("failed");
  });
});

// Keep vi import used (restoreAllMocks hygiene across suites).
void vi;
