import { compile, replay, type Graph } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { SEED_GRAPH } from "./seed.js";
import { fakeWorker } from "./worker.js";

const worker = () => fakeWorker({ chunkDelayMs: 0 });
const clock = () => 0;

async function run(graph: Graph, budgetUsd: number | null = null, failFirstAttempts = 1) {
  const { plan } = compile(graph);
  if (!plan) throw new Error("graph did not compile");
  const events = [];
  for await (const e of execute({
    runId: "r",
    graph,
    plan,
    worker: fakeWorker({ chunkDelayMs: 0, failFirstAttempts }),
    budgetUsd,
    now: clock,
  })) {
    events.push(e);
  }
  return { events, state: replay(events) };
}

describe("execute", () => {
  it("runs every plant and hands freight along each pipe", async () => {
    const { state } = await run(SEED_GRAPH);

    expect(state.status).toBe("done");
    for (const node of SEED_GRAPH.nodes) {
      expect(state.nodes[node.id]?.status).toBe("done");
    }
    // Every flow pipe should have carried at least one truck, including the intake's.
    const carried = new Set(state.packets.map((p) => p.edgeId));
    for (const edge of SEED_GRAPH.edges.filter((e) => e.kind === "flow")) {
      expect(carried).toContain(edge.id);
    }
  });

  it("sends rejected work back down the rework line and re-runs the loop body", async () => {
    const { events, state } = await run(SEED_GRAPH);

    const verdicts = events.filter((e) => e.type === "gate.verdict");
    expect(verdicts.map((v) => v.passed)).toEqual([false, true]);

    const reworkEdge = SEED_GRAPH.edges.find((e) => e.kind === "rework")!;
    expect(state.packets.some((p) => p.edgeId === reworkEdge.id)).toBe(true);

    // Attempts are identity, not a counter: both forge outputs survive for diffing.
    const forge = state.nodes["forge"]!;
    expect(forge.attempt).toBe(2);
    expect(Object.keys(forge.outputs).sort()).toEqual(["1", "2"]);
    expect(forge.outputs[1]).not.toBe(forge.outputs[2]);
  });

  it("halts the line when the gate exhausts its attempts", async () => {
    const { events, state } = await run(SEED_GRAPH, null, 99);

    const exhausted = events.find((e) => e.type === "gate.exhausted");
    expect(exhausted?.policy).toBe("halt");
    expect(state.status).toBe("halted");
  });

  it("trips the breaker once metered cost passes the budget", async () => {
    const { events, state } = await run(SEED_GRAPH, 0.0001);

    expect(events.some((e) => e.type === "power.tripped")).toBe(true);
    expect(state.status).toBe("tripped");
    expect(state.totalCostUsd).toBeGreaterThan(0.0001);
  });

  it("stops at the next checkpoint when cancelled", async () => {
    const { plan } = compile(SEED_GRAPH);
    const ac = new AbortController();
    const events = [];
    for await (const e of execute({
      runId: "r",
      graph: SEED_GRAPH,
      plan: plan!,
      worker: worker(),
      budgetUsd: null,
      signal: ac.signal,
      now: clock,
    })) {
      events.push(e);
      if (e.type === "node.finished") ac.abort();
    }
    expect(replay(events).status).toBe("cancelled");
  });

  it("numbers events consecutively from zero so SSE resume is unambiguous", async () => {
    const { events } = await run(SEED_GRAPH);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  });
});
