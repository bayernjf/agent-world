import { describe, expect, it } from "vitest";
import { Graph, type Graph as GraphType } from "@agent-world/core";
import { loadCrossGraphEdges } from "./crossGraphService.js";

function makeGraph(id: string, extra: Record<string, unknown> = {}): GraphType {
  return Graph.parse({
    id,
    name: id,
    nodes: [
      { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0 },
      { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
    ],
    edges: [],
    ...extra,
  });
}

describe("loadCrossGraphEdges", () => {
  it("1. no visible graphs yields no edges", async () => {
    const edges = await loadCrossGraphEdges([], async () => null);
    expect(edges).toEqual([]);
  });

  it("2. derives a subprocess edge between two visible factories", async () => {
    const parent = makeGraph("parent", {
      nodes: [
        {
          id: "sub1",
          kind: "subprocess",
          name: "SUB1",
          x: 0,
          y: 0,
          subprocess: { graphId: "child" },
        },
      ],
    });
    const child = makeGraph("child");
    const docs: Record<string, GraphType> = { parent, child };
    const edges = await loadCrossGraphEdges(["parent", "child"], async (id) => docs[id] ?? null);
    expect(edges).toEqual([
      { fromGraphId: "child", toGraphId: "parent", via: "subprocess", refId: "sub1" },
    ]);
  });

  it("3. drops an edge whose upstream factory is not visible (internalOnly)", async () => {
    const parent = makeGraph("parent", {
      nodes: [
        {
          id: "sub1",
          kind: "subprocess",
          name: "SUB1",
          x: 0,
          y: 0,
          subprocess: { graphId: "someone-else" },
        },
      ],
    });
    const edges = await loadCrossGraphEdges(["parent"], async (id) =>
      id === "parent" ? parent : null,
    );
    expect(edges).toEqual([]);
  });

  it("4. a loader that throws for one graph does not break the rest", async () => {
    const a = makeGraph("a", {
      nodes: [
        {
          id: "s1",
          kind: "subprocess",
          name: "S1",
          x: 0,
          y: 0,
          subprocess: { graphId: "b" },
        },
      ],
    });
    const b = makeGraph("b");
    const edges = await loadCrossGraphEdges(["broken", "a", "b"], async (id) => {
      if (id === "broken") throw new Error("corrupt doc");
      return id === "a" ? a : b;
    });
    expect(edges).toEqual([
      { fromGraphId: "b", toGraphId: "a", via: "subprocess", refId: "s1" },
    ]);
  });

  it("5. derives an event-trigger edge", async () => {
    const down = makeGraph("down", {
      triggers: [{ id: "t1", type: "event", eventSource: { kind: "graph", id: "up" } }],
    });
    const up = makeGraph("up");
    const docs: Record<string, GraphType> = { down, up };
    const edges = await loadCrossGraphEdges(["down", "up"], async (id) => docs[id] ?? null);
    expect(edges).toEqual([
      { fromGraphId: "up", toGraphId: "down", via: "event", refId: "t1" },
    ]);
  });
});
