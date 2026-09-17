import { compile, replay, type Graph } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute, fork } from "./engine.js";
import { fakeWorker } from "./worker.js";

/**
 * G1.2 — forking a completed run at a node reuses that node and every upstream
 * step (synthesized as zero-cost `reused` events, never re-executed, never
 * billed) and re-runs only the fork point's flow descendants. The parent run's
 * event log is the seed; the fork is a brand-new run with its own seq-0 stream.
 */

function linearGraph(): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "a", kind: "textGen", name: "A", x: 1, y: 0, textGen: { prompt: "step a" } },
      { id: "b", kind: "textGen", name: "B", x: 2, y: 0, textGen: { prompt: "step b" } },
      { id: "depot", kind: "sink", name: "DEPOT", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "a", kind: "flow" },
      { id: "e2", from: "a", to: "b", kind: "flow" },
      { id: "e3", from: "b", to: "depot", kind: "flow" },
    ],
  };
}

async function runParent(g: Graph) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  for await (const e of execute({
    runId: "parent",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    now: () => 0,
    input: "parent intake",
  })) {
    events.push(e);
  }
  expect(replay(events).status).toBe("done");
  return events;
}

async function collectFork(g: Graph, parentEvents: any[], fromNodeId: string) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  for await (const e of fork({
    runId: "forked",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    now: () => 0,
    pastEvents: parentEvents,
    fromNodeId,
    sourceInput: "parent intake",
  })) {
    events.push(e);
  }
  return events;
}

describe("G1.2 engine fork", () => {
  it("reuses the fork point and upstream as zero-cost reused steps and reruns only descendants", async () => {
    const g = linearGraph();
    const parent = await runParent(g);
    const forked = await collectFork(g, parent, "a");

    // A fresh run stream.
    expect(forked[0]!.type).toBe("run.started");
    expect(replay(forked).status).toBe("done");

    const finished = (id: string) => forked.filter((e) => e.type === "node.finished" && e.nodeId === id);
    // src and a are reused: exactly one synthesized finished each, flagged, zero cost.
    for (const id of ["src", "a"]) {
      const fs = finished(id);
      expect(fs).toHaveLength(1);
      expect(fs[0]!.reused).toBe(true);
      expect(fs[0]!.usage.costUsd).toBe(0);
    }
    // b and depot actually ran again (not marked reused). b is a model node → cost.
    const bFin = finished("b");
    expect(bFin).toHaveLength(1);
    expect(bFin[0]!.reused).toBeUndefined();
    expect(bFin[0]!.usage.costUsd).toBeGreaterThan(0);
    expect(finished("depot")[0]!.reused).toBeUndefined();

    // Reused nodes are never re-executed: only one node.started each, and the
    // single start is the synthesized one (no real attempt followed).
    for (const id of ["src", "a"]) {
      const starts = forked.filter((e) => e.type === "node.started" && e.nodeId === id);
      expect(starts).toHaveLength(1);
    }
    // The rerun descendant b did start for real.
    expect(forked.some((e) => e.type === "node.started" && e.nodeId === "b")).toBe(true);
  });

  it("bills nothing for reused upstream on the forked run", async () => {
    const g = linearGraph();
    const parent = await runParent(g);
    const forked = await collectFork(g, parent, "b"); // reuse src, a, b; rerun depot only

    const reusedCost = forked
      .filter((e) => e.type === "node.finished" && e.reused)
      .reduce((sum, e) => sum + e.usage.costUsd, 0);
    expect(reusedCost).toBe(0);

    // src, a, b all reused; depot (sink, no model) reruns at zero cost too.
    for (const id of ["src", "a", "b"]) {
      const f = forked.find((e) => e.type === "node.finished" && e.nodeId === id);
      expect(f?.reused).toBe(true);
    }
    // Total billed across the whole forked run is 0 here (only a sink reran).
    const total = forked
      .filter((e) => e.type === "node.finished")
      .reduce((sum, e) => sum + e.usage.costUsd, 0);
    expect(total).toBe(0);
  });

  it("throws when the fork point has no completed output in the parent run", async () => {
    const g = linearGraph();
    const parent = await runParent(g);
    await expect(collectFork(g, parent, "ghost-node")).rejects.toThrow(/cannot fork from node/);
  });
});
