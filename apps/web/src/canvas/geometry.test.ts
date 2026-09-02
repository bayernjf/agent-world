import { describe, it, expect } from "vitest";
import { anchorOf, pointsToPath, hitTestNode, edgeAnchors, orthogonalRoute, orthoArrows } from "./geometry";
import type { Point, Rect, Arrow } from "./geometry";
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

describe("orthogonalRoute", () => {
  function makeRect(id: string, x0: number, y0: number, x1: number, y1: number): Rect {
    return { id, x0, y0, x1, y1 };
  }

  it("returns a straight horizontal line when from and to share the same y", () => {
    const route = orthogonalRoute({ x: 0, y: 100 }, { x: 200, y: 100 }, []);
    expect(route).toEqual([
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ]);
  });

  it("returns a straight vertical line when from and to share the same x", () => {
    const route = orthogonalRoute({ x: 100, y: 0 }, { x: 100, y: 200 }, []);
    expect(route).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 200 },
    ]);
  });

  it("returns an L-shaped route for diagonal endpoints with no obstacles", () => {
    const route = orthogonalRoute({ x: 0, y: 0 }, { x: 200, y: 100 }, []);
    // Should be a 3-point L-shape: from -> (from.x, someY) -> to
    expect(route.length).toBe(3);
    expect(route[0]).toEqual({ x: 0, y: 0 });
    expect(route[2]).toEqual({ x: 200, y: 100 });
    // The middle point should share x with from and y with to (or vice versa)
    const mid = route[1]!;
    expect(mid.x === 0 || mid.x === 200).toBe(true);
    expect(mid.y === 0 || mid.y === 100).toBe(true);
  });

  it("starts at the from point and ends at the to point", () => {
    const from = { x: 50, y: 60 };
    const to = { x: 300, y: 200 };
    const route = orthogonalRoute(from, to, []);
    expect(route[0]).toEqual(from);
    expect(route[route.length - 1]).toEqual(to);
  });

  it("produces only orthogonal segments (each segment is horizontal or vertical)", () => {
    const route = orthogonalRoute({ x: 0, y: 0 }, { x: 200, y: 150 }, []);
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i]!;
      const b = route[i + 1]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it("routes around an obstacle blocking the direct path", () => {
    // Direct horizontal path at y=100 would pass through the obstacle.
    const obstacle = makeRect("obs", 80, 80, 120, 120);
    const route = orthogonalRoute({ x: 0, y: 100 }, { x: 200, y: 100 }, [obstacle]);
    // The route should not have a horizontal segment at y=100 crossing the obstacle.
    // It should detour above or below.
    let hitsObstacle = false;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i]!;
      const b = route[i + 1]!;
      if (a.y === b.y && a.y > 80 && a.y < 120) {
        const xa = Math.min(a.x, b.x);
        const xb = Math.max(a.x, b.x);
        if (xa < 120 && xb > 80) hitsObstacle = true;
      }
    }
    expect(hitsObstacle).toBe(false);
    expect(route[0]).toEqual({ x: 0, y: 100 });
    expect(route[route.length - 1]).toEqual({ x: 200, y: 100 });
  });

  it("prefers the shortest route when multiple obstacle-free routes exist", () => {
    // No obstacles — the L-shape should have total length = |dx| + |dy|
    const from = { x: 0, y: 0 };
    const to = { x: 200, y: 100 };
    const route = orthogonalRoute(from, to, []);
    let totalLen = 0;
    for (let i = 0; i < route.length - 1; i++) {
      totalLen += Math.hypot(route[i + 1]!.x - route[i]!.x, route[i + 1]!.y - route[i]!.y);
    }
    // Manhattan distance = 200 + 100 = 300
    expect(totalLen).toBe(300);
  });

  it("handles from and to being the same point", () => {
    const route = orthogonalRoute({ x: 100, y: 100 }, { x: 100, y: 100 }, []);
    expect(route.length).toBe(1);
    expect(route[0]).toEqual({ x: 100, y: 100 });
  });

  it("dedupes consecutive identical points in the output", () => {
    const route = orthogonalRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, []);
    for (let i = 0; i < route.length - 1; i++) {
      expect(route[i]).not.toEqual(route[i + 1]);
    }
  });

  it("routes around multiple obstacles", () => {
    const obstacles = [
      makeRect("obs1", 50, 50, 100, 100),
      makeRect("obs2", 150, 50, 200, 100),
    ];
    const route = orthogonalRoute({ x: 0, y: 75 }, { x: 250, y: 75 }, obstacles);
    expect(route[0]).toEqual({ x: 0, y: 75 });
    expect(route[route.length - 1]).toEqual({ x: 250, y: 75 });
    // All segments should be orthogonal
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i]!;
      const b = route[i + 1]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });
});

describe("orthoArrows", () => {
  it("returns empty array for rework edges", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(orthoArrows(route, "rework")).toEqual([]);
  });

  it("returns empty array for fewer than 2 points", () => {
    expect(orthoArrows([], "flow")).toEqual([]);
    expect(orthoArrows([{ x: 0, y: 0 }], "flow")).toEqual([]);
  });

  it("dedupes consecutive identical points before computing arrows", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const arrows = orthoArrows(route, "flow");
    expect(arrows.length).toBe(2);
  });

  it("places arrows on a left-to-right horizontal segment with dir=1, angle=0", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    const arrows = orthoArrows(route, "flow");
    expect(arrows.length).toBe(2);
    // Source arrow: inset 20 from start
    expect(arrows[0]!.x).toBe(20);
    expect(arrows[0]!.y).toBe(0);
    expect(arrows[0]!.dir).toBe(1);
    expect(arrows[0]!.angle).toBe(0);
    // Target arrow: inset 20 from end
    expect(arrows[1]!.x).toBe(180);
    expect(arrows[1]!.y).toBe(0);
    expect(arrows[1]!.dir).toBe(1);
    expect(arrows[1]!.angle).toBe(0);
  });

  it("places arrows on a right-to-left horizontal segment with dir=-1", () => {
    const route = [
      { x: 200, y: 0 },
      { x: 0, y: 0 },
    ];
    const arrows = orthoArrows(route, "flow");
    expect(arrows.length).toBe(2);
    expect(arrows[0]!.dir).toBe(-1);
    expect(arrows[0]!.x).toBe(180);
    expect(arrows[1]!.dir).toBe(-1);
    expect(arrows[1]!.x).toBe(20);
  });

  it("places arrows on a top-to-bottom vertical segment with angle=90", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 200 },
    ];
    const arrows = orthoArrows(route, "flow");
    expect(arrows.length).toBe(2);
    expect(arrows[0]!.angle).toBe(90);
    expect(arrows[0]!.y).toBe(20);
    expect(arrows[1]!.angle).toBe(90);
    expect(arrows[1]!.y).toBe(180);
  });

  it("places arrows on a bottom-to-top vertical segment with angle=-90", () => {
    const route = [
      { x: 0, y: 200 },
      { x: 0, y: 0 },
    ];
    const arrows = orthoArrows(route, "flow");
    expect(arrows.length).toBe(2);
    expect(arrows[0]!.angle).toBe(-90);
    expect(arrows[0]!.y).toBe(180);
    expect(arrows[1]!.angle).toBe(-90);
    expect(arrows[1]!.y).toBe(20);
  });

  it("returns no arrows for a segment shorter than the inset threshold", () => {
    // Length 40 < ARROW_INSET * 2 + 4 = 44
    const route = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ];
    const arrows = orthoArrows(route, "flow");
    expect(arrows.length).toBe(0);
  });

  it("returns arrows for a segment just above the threshold", () => {
    // Length 50 > 44
    const route = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ];
    const arrows = orthoArrows(route, "flow");
    expect(arrows.length).toBe(2);
  });

  it("uses the first and last segments of a multi-segment route", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ];
    const arrows = orthoArrows(route, "flow");
    expect(arrows.length).toBe(2);
    // First arrow on the first (horizontal) segment
    expect(arrows[0]!.x).toBe(20);
    expect(arrows[0]!.y).toBe(0);
    // Last arrow on the last (horizontal) segment
    expect(arrows[1]!.x).toBe(180);
    expect(arrows[1]!.y).toBe(100);
  });
});
