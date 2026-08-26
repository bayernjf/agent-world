import { compile, Graph, replay } from "@agent-world/core";
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

  it("emits a budget warning at 80% without tripping", async () => {
    // Single agent line whose only node costs a fixed 0.0008 per call.
    const g: Graph = {
      id: "warn",
      name: "warn",
      nodes: [
        { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
        { id: "a", kind: "agent", name: "A", x: 1, y: 0, agent: { model: "t", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 } },
        { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "in", to: "a", kind: "flow" },
        { id: "e2", from: "a", to: "out", kind: "flow" },
      ],
    };
    const { plan } = compile(g)!;
    const costWorker = {
      async *runAgent() {
        return { output: "ok", usage: { tokensIn: 100, tokensOut: 50, costUsd: 0.0008 } };
      },
      async judge() { return { passed: true, reason: "ok" }; },
    };
    const events = [];
    for await (const e of execute({ runId: "r", graph: g, plan, worker: costWorker as never, budgetUsd: 0.001, now: clock })) {
      events.push(e);
    }
    const state = replay(events);
    const warn = events.find((e) => e.type === "power.warning");
    expect(warn).toBeTruthy();
    expect((warn as any).threshold).toBe(0.8);
    expect(state.budgetWarned).toBe(true);
    expect(state.status).toBe("done");
    expect(events.some((e) => e.type === "power.tripped")).toBe(false);
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

  it("propagates source reference images to downstream agents", async () => {
    const graph = Graph.parse({
      id: "img",
      name: "img",
      nodes: [
        {
          id: "src",
          kind: "source",
          name: "SRC",
          x: 0,
          y: 0,
          source: { images: ["https://example.com/a.jpg", "https://example.com/b.jpg"] },
        },
        {
          id: "forge",
          kind: "agent",
          name: "FORGE",
          x: 1,
          y: 0,
          agent: { model: "test", prompt: "", skills: [] },
        },
        { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "forge", kind: "flow" },
        { id: "e2", from: "forge", to: "depot", kind: "flow" },
      ],
    });

    const seen: string[][] = [];
    const capturing = {
      ...fakeWorker({ chunkDelayMs: 0 }),
      async *runAgent(args: Parameters<ReturnType<typeof fakeWorker>["runAgent"]>[0]) {
        seen.push(args.images ?? []);
        return yield* fakeWorker({ chunkDelayMs: 0 }).runAgent(args);
      },
    };

    const { plan } = compile(graph);
    const events = [];
    for await (const e of execute({
      runId: "r",
      graph,
      plan: plan!,
      worker: capturing,
      now: clock,
    })) {
      events.push(e);
    }
    expect(replay(events).status).toBe("done");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toEqual([
      "https://example.com/a.jpg",
      "https://example.com/b.jpg",
    ]);
  });

  it("emits artifact.produced when agent output contains image URLs", async () => {
    const graph: Graph = {
      id: "art",
      name: "art",
      nodes: [
        { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
        { id: "a", kind: "agent", name: "A", x: 1, y: 0, agent: { model: "t", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 } },
        { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "in", to: "a", kind: "flow" },
        { id: "e2", from: "a", to: "out", kind: "flow" },
      ],
    };
    const { plan } = compile(graph)!;
    const imgWorker = {
      async *runAgent() {
        return {
          output: "Here is the result ![cover](https://example.com/cover.png)",
          usage: { tokensIn: 10, tokensOut: 20, costUsd: 0.001 },
        };
      },
      async judge() { return { passed: true, reason: "ok" }; },
    };
    const events = [];
    for await (const e of execute({
      runId: "r", graph, plan, worker: imgWorker as never, budgetUsd: null, now: clock,
    })) {
      events.push(e);
    }
    const produced = events.filter(
      (e) => e.type === "artifact.produced" && (e as any).nodeId === "a",
    );
    expect(produced).toHaveLength(1);
    expect((produced[0] as any).artifact.kind).toBe("image");
    expect((produced[0] as any).artifact.uri).toBe("https://example.com/cover.png");
    const pkt = events.find((e) => e.type === "packet.sent" && (e as any).from === "a");
    expect((pkt as any)?.artifactKind).toBe("image");
    const state = replay(events);
    expect(state.nodes.a!.artifacts).toHaveLength(1);
  });
});
