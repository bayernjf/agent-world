import { describe, it, expect } from "vitest";
import { anchorOf, pointsToPath, hitTestNode, edgeAnchors } from "./geometry";
import type { Point } from "./geometry";
import { PLANT_W, PLANT_H } from "../store/graph";
import type { Graph, GraphNode, GraphEdge } from "@agent-world/core";

const halfW = PLANT_W / 2;
const halfH = PLANT_H / 2;

function makeNode(id: string, x: number, y: number, kind = "textGen"): GraphNode {
  return { id, x, y, kind, name: id } as GraphNode;
}

function makeEdge(id: string, from: string, to: string, kind: GraphEdge["kind"] = "flow"): GraphEdge {
  return { id, from, to, kind } as GraphEdge;
}

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): Graph {
  return { nodes, edges } as Graph;
}

describe("anchorOf", () => {
  it("returns the right-face anchor for 'out' side", () => {
    const node = makeNode("a", 100, 200);
    const p = anchorOf(node, "out");
    expect(p).toEqual({ x: 100 + halfW, y: 200 });
  });

  it("returns the left-face anchor for 'in' side", () => {
    const node = makeNode("a", 100, 200);
    const p = anchorOf(node, "in");
    expect(p).toEqual({ x: 100 - halfW, y: 200 });
  });

  it("uses the node center y regardless of side", () => {
    const node = makeNode("a", 0, 500);
    expect(anchorOf(node, "out").y).toBe(500);
    expect(anchorOf(node, "in").y).toBe(500);
  });
});

describe("pointsToPath", () => {
  it("returns empty string for fewer than 2 points", () => {
    expect(pointsToPath([])).toBe("");
    expect(pointsToPath([{ x: 0, y: 0 }])).toBe("");
  });

  it("returns a simple M...L path for two points", () => {
    const d = pointsToPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(d).toBe("M 0 0 L 100 0");
  });

  it("dedupes consecutive identical points", () => {
    const d = pointsToPath([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(d).toBe("M 0 0 L 100 0");
  });

  it("adds quadratic curve (Q) at corners with default radius 10", () => {
    const d = pointsToPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
    // Corner at (100, 0): inset 10 from both sides, Q control point at (100, 0)
    expect(d).toContain("M 0 0");
    expect(d).toContain("L 90 0");
    expect(d).toContain("Q 100 0 100 10");
    expect(d).toContain("L 100 50");
  });

  it("respects a custom corner radius", () => {
    const d = pointsToPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      5,
    );
    expect(d).toContain("L 95 0");
    expect(d).toContain("Q 100 0 100 5");
  });

  it("clamps corner radius to half the segment length", () => {
    // Segments of length 10 — radius 100 should be clamped to 5
    const d = pointsToPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      100,
    );
    expect(d).toContain("L 5 0");
    expect(d).toContain("Q 10 0 10 5");
  });

  it("handles a 4-point orthogonal path with two corners", () => {
    const d = pointsToPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    expect(d).toContain("M 0 0");
    expect(d).toContain("Q 100 0 100 10");
    expect(d).toContain("Q 100 100 110 100");
    expect(d).toContain("L 200 100");
  });
});

describe("hitTestNode", () => {
  const graph = makeGraph(
    [
      makeNode("a", 0, 0),
      makeNode("b", 300, 0),
      makeNode("c", 0, 300),
    ],
    [],
  );

  it("returns the node when the point is inside its bounding box", () => {
    const result = hitTestNode(graph, { x: 0, y: 0 });
    expect(result?.id).toBe("a");
  });

  it("returns undefined when the point is outside all nodes", () => {
    const result = hitTestNode(graph, { x: 1000, y: 1000 });
    expect(result).toBeUndefined();
  });

  it("returns the topmost (last in array) node when overlapping", () => {
    const overlapping = makeGraph(
      [
        makeNode("bottom", 0, 0),
        makeNode("top", 0, 0),
      ],
      [],
    );
    const result = hitTestNode(overlapping, { x: 0, y: 0 });
    expect(result?.id).toBe("top");
  });

  it("matches at the exact boundary (halfW, halfH)", () => {
    const result = hitTestNode(graph, { x: halfW, y: halfH });
    expect(result?.id).toBe("a");
  });

  it("does not match just outside the boundary", () => {
    const result = hitTestNode(graph, { x: halfW + 1, y: 0 });
    expect(result).toBeUndefined();
  });
});

describe("edgeAnchors", () => {
  it("returns an empty map for a graph with no edges", () => {
    const graph = makeGraph([makeNode("a", 0, 0)], []);
    const result = edgeAnchors(graph);
    expect(result.size).toBe(0);
  });

  it("computes from/to anchors for a simple horizontal flow edge", () => {
    const graph = makeGraph(
      [makeNode("a", 0, 0), makeNode("b", 300, 0)],
      [makeEdge("e1", "a", "b", "flow")],
    );
    const result = edgeAnchors(graph);
    expect(result.size).toBe(1);
    const anchors = result.get("e1")!;
    // from: right face of node a
    expect(anchors.from.x).toBe(halfW);
    expect(anchors.from.y).toBe(0);
    // to: left face of node b
    expect(anchors.to.x).toBe(300 - halfW);
    expect(anchors.to.y).toBe(0);
  });

  it("uses top-center anchors for rework edges", () => {
    const graph = makeGraph(
      [makeNode("a", 0, 0), makeNode("b", 300, 0)],
      [makeEdge("e1", "a", "b", "rework")],
    );
    const result = edgeAnchors(graph);
    const anchors = result.get("e1")!;
    expect(anchors.from).toEqual({ x: 0, y: -halfH });
    expect(anchors.to).toEqual({ x: 300, y: -halfH });
  });

  it("uses vertical (bottom-to-top) anchors for same-column stacked nodes", () => {
    const graph = makeGraph(
      [makeNode("a", 100, 0), makeNode("b", 100, 300)],
      [makeEdge("e1", "a", "b", "flow")],
    );
    const result = edgeAnchors(graph);
    const anchors = result.get("e1")!;
    // from: bottom center of node a
    expect(anchors.from).toEqual({ x: 100, y: halfH });
    // to: top center of node b
    expect(anchors.to).toEqual({ x: 100, y: 300 - halfH });
  });

  it("distributes multiple outgoing edges across the node face (fan-out)", () => {
    const graph = makeGraph(
      [makeNode("a", 0, 0), makeNode("b", 300, -50), makeNode("c", 300, 50)],
      [makeEdge("e1", "a", "b", "flow"), makeEdge("e2", "a", "c", "flow")],
    );
    const result = edgeAnchors(graph);
    const a1 = result.get("e1")!;
    const a2 = result.get("e2")!;
    // Both exit from the right face of node a, but at different y positions
    expect(a1.from.x).toBe(halfW);
    expect(a2.from.x).toBe(halfW);
    expect(a1.from.y).not.toBe(a2.from.y);
  });

  it("skips edges whose from/to nodes are not in the graph", () => {
    const graph = makeGraph(
      [makeNode("a", 0, 0)],
      [makeEdge("e1", "a", "nonexistent", "flow")],
    );
    const result = edgeAnchors(graph);
    expect(result.size).toBe(0);
  });
});
