import { compile, replay, type Graph, type ParallelConfig } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function graph(parallel: ParallelConfig): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      {
        id: "a",
        kind: "code",
        name: "A",
        x: 1,
        y: 0,
        code: { language: "javascript", code: "console.log(JSON.stringify({ x: 1 }))", timeoutMs: 5000 },
      },
      {
        id: "b",
        kind: "code",
        name: "B",
        x: 1,
        y: 1,
        code: { language: "javascript", code: "console.log(JSON.stringify({ x: 2 }))", timeoutMs: 5000 },
      },
      { id: "par", kind: "parallel", name: "PAR", x: 2, y: 0, parallel },
      { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "a", kind: "flow" },
      { id: "e2", from: "src", to: "b", kind: "flow" },
      { id: "e3", from: "a", to: "par", kind: "flow" },
      { id: "e4", from: "b", to: "par", kind: "flow" },
      { id: "e5", from: "par", to: "sink", kind: "flow" },
    ],
  };
}

async function collect(g: Graph, input?: string) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    now: () => 0,
    input,
  })) {
    events.push(e);
  }
  return events;
}

function jsonOf(events: any[], nodeId: string): string | undefined {
  return events.find(
    (e) => e.type === "artifact.produced" && e.nodeId === nodeId && e.artifact.kind === "json",
  )?.artifact.content;
}

describe("parallel (join) node", () => {
  it("waits for all branches and aggregates their outputs into an array", async () => {
    const events = await collect(graph({}));
    expect(replay(events).status).toBe("done");
    expect(JSON.parse(jsonOf(events, "par")!)).toEqual([{ x: 1 }, { x: 2 }]);
  });

  it("outputs an object keyed by upstream node id when asObject is set", async () => {
    const events = await collect(graph({ asObject: true }));
    expect(replay(events).status).toBe("done");
    expect(JSON.parse(jsonOf(events, "par")!)).toEqual({ a: { x: 1 }, b: { x: 2 } });
  });

  it("extracts a field from each branch value with pick", async () => {
    const events = await collect(graph({ pick: "x" }));
    expect(replay(events).status).toBe("done");
    expect(JSON.parse(jsonOf(events, "par")!)).toEqual([1, 2]);
  });
});
