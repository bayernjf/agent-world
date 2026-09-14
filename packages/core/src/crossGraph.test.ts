import { describe, expect, it } from "vitest";
import { Graph } from "./graph.js";
import {
  buildCrossGraphEdges,
  downstreamGraphIds,
  externalGraphRefs,
  upstreamGraphIds,
} from "./crossGraph.js";

/** Minimal valid single-factory graph; override fields per case. */
function graph(over: Partial<{ id: string; nodes: unknown[]; triggers: unknown[] }> = {}) {
  return Graph.parse({
    id: over.id ?? "g1",
    name: "line",
    nodes: over.nodes ?? [
      { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0 },
      { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
    ],
    edges: [],
    triggers: over.triggers,
  });
}

function subNode(id: string, targetGraphId: string) {
  return {
    id,
    kind: "subprocess",
    name: id.toUpperCase(),
    x: 0,
    y: 0,
    subprocess: { graphId: targetGraphId },
  };
}

describe("externalGraphRefs", () => {
  it("1. legacy single-factory graph yields no external refs (byte-compatible)", () => {
    expect(externalGraphRefs(graph())).toEqual([]);
  });

  it("2. subprocess node references the sub-flow graph", () => {
    const g = graph({ id: "parent", nodes: [subNode("sub1", "child")] });
    expect(externalGraphRefs(g)).toEqual([
      { targetGraphId: "child", via: "subprocess", refId: "sub1" },
    ]);
  });

  it("3. graph-event trigger references the upstream graph", () => {
    const g = graph({
      id: "down",
      triggers: [{ id: "tr1", type: "event", eventSource: { kind: "graph", id: "up" } }],
    });
    expect(externalGraphRefs(g)).toEqual([
      { targetGraphId: "up", via: "event", refId: "tr1" },
    ]);
  });

  it("4. artifact-event source is not a factory edge", () => {
    const g = graph({
      triggers: [
        { id: "tr1", type: "event", eventSource: { kind: "artifact", id: "art-9" } },
      ],
    });
    expect(externalGraphRefs(g)).toEqual([]);
  });

  it("5. self references (own graphId) are excluded", () => {
    const g = graph({
      id: "self",
      nodes: [subNode("sub1", "self")],
      triggers: [{ id: "tr1", type: "event", eventSource: { kind: "graph", id: "self" } }],
    });
    expect(externalGraphRefs(g)).toEqual([]);
  });

  it("6. cron/webhook triggers and non-subprocess nodes are ignored", () => {
    const g = graph({
      id: "g",
      nodes: [{ id: "n1", kind: "textGen", name: "N1", x: 0, y: 0 }],
      triggers: [
        { id: "c1", type: "cron", cron: "0 9 * * *" },
        { id: "w1", type: "webhook", webhookSecret: "s" },
      ],
    });
    expect(externalGraphRefs(g)).toEqual([]);
  });
});

describe("buildCrossGraphEdges", () => {
  it("7. empty and single-factory input produce no edges", () => {
    expect(buildCrossGraphEdges([])).toEqual([]);
    expect(buildCrossGraphEdges([graph()])).toEqual([]);
  });

  it("8. edge direction is upstream(sub-flow) -> downstream(caller)", () => {
    const parent = graph({ id: "parent", nodes: [subNode("sub1", "child")] });
    const child = graph({ id: "child" });
    const edges = buildCrossGraphEdges([parent, child]);
    expect(edges).toEqual([
      { fromGraphId: "child", toGraphId: "parent", via: "subprocess", refId: "sub1" },
    ]);
  });

  it("9. mutual recursion between two factories yields two directed edges", () => {
    const a = graph({ id: "a", nodes: [subNode("sa", "b")] });
    const b = graph({
      id: "b",
      triggers: [{ id: "tb", type: "event", eventSource: { kind: "graph", id: "a" } }],
    });
    const edges = buildCrossGraphEdges([a, b]).sort((x, y) => x.toGraphId.localeCompare(y.toGraphId));
    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual({ fromGraphId: "b", toGraphId: "a", via: "subprocess", refId: "sa" });
    expect(edges).toContainEqual({ fromGraphId: "a", toGraphId: "b", via: "event", refId: "tb" });
  });

  it("10. two refs to the same factory stay distinct (different refId)", () => {
    const a = graph({
      id: "a",
      nodes: [subNode("s1", "b"), subNode("s2", "b")],
    });
    const b = graph({ id: "b" });
    expect(buildCrossGraphEdges([a, b])).toHaveLength(2);
  });

  it("11. dangling reference kept by default, dropped with internalOnly", () => {
    const a = graph({ id: "a", nodes: [subNode("s1", "deleted-graph")] });
    expect(buildCrossGraphEdges([a])).toHaveLength(1);
    expect(buildCrossGraphEdges([a], { internalOnly: true })).toHaveLength(0);
  });
});

describe("upstream/downstream helpers", () => {
  const edges = buildCrossGraphEdges([
    graph({ id: "a", nodes: [subNode("s1", "b"), subNode("s2", "c")] }),
    graph({ id: "b" }),
    graph({ id: "c" }),
    graph({
      id: "d",
      triggers: [{ id: "t1", type: "event", eventSource: { kind: "graph", id: "a" } }],
    }),
  ]);

  it("12. upstreamGraphIds lists distinct consumed factories", () => {
    // a consumes b and c (two subprocess refs); de-duped by factory id.
    expect(upstreamGraphIds("a", edges).sort()).toEqual(["b", "c"]);
  });

  it("13. downstreamGraphIds lists consumers", () => {
    expect(downstreamGraphIds("a", edges)).toEqual(["d"]);
    expect(downstreamGraphIds("b", edges)).toEqual(["a"]);
    expect(downstreamGraphIds("d", edges)).toEqual([]);
  });
});
