import { describe, it, expect } from "vitest";
import { anchorOf, pointsToPath, hitTestNode, edgeAnchors, orthogonalRoute, orthoArrows, pipePath, pipeArrows, pipeArrow, pipeCrossings } from "./geometry";
import type { Point, Rect, Arrow, Crossing } from "./geometry";
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

describe("pipePath", () => {
  it("starts with M and the from point, ends at the to point", () => {
    const d = pipePath({ x: 0, y: 0 }, { x: 200, y: 100 }, "flow");
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith("L 200 100")).toBe(true);
  });

  it("returns a straight line for same-column vertical stacks", () => {
    const d = pipePath({ x: 100, y: 0 }, { x: 100, y: 200 }, "flow");
    expect(d).toBe("M 100 0 L 100 200");
  });

  it("returns a straight line for same-y horizontal edges", () => {
    const d = pipePath({ x: 0, y: 100 }, { x: 200, y: 100 }, "flow");
    expect(d).toBe("M 0 100 L 200 100");
  });

  it("returns an S-shaped curve with two quadratic corners for diagonal edges", () => {
    const d = pipePath({ x: 0, y: 0 }, { x: 200, y: 100 }, "flow");
    // Should have two Q (quadratic curve) commands
    expect(d.match(/Q/g)?.length).toBe(2);
    // Midpoint x should be 100
    expect(d).toContain("100");
  });

  it("curves downward when target is below source", () => {
    const d = pipePath({ x: 0, y: 0 }, { x: 200, y: 100 }, "flow");
    // First curve: Q mid sy mid sy+r (r=12, so y=12)
    expect(d).toContain("Q 100 0 100 12");
    // Second curve: Q mid ty mid+r ty (y=100-12=88)
    expect(d).toContain("Q 100 100 112 100");
  });

  it("curves upward when target is above source", () => {
    const d = pipePath({ x: 0, y: 100 }, { x: 200, y: 0 }, "flow");
    // First curve: Q mid sy mid sy-r (r=12, so y=88)
    expect(d).toContain("Q 100 100 100 88");
    // Second curve: Q mid ty mid+r ty (y=0+12=12)
    expect(d).toContain("Q 100 0 112 0");
  });

  it("returns an arched path for rework edges", () => {
    const d = pipePath({ x: 0, y: 100 }, { x: 200, y: 100 }, "rework");
    // Rework path goes up and over, should have two Q commands
    expect(d.match(/Q/g)?.length).toBe(2);
    // Should start at from and end at to
    expect(d.startsWith("M 0 100")).toBe(true);
    expect(d.endsWith("L 200 100")).toBe(true);
  });

  it("rework arch lifts above the nodes (lift = minY - halfH - 58)", () => {
    // from.y = to.y = 100, halfH = 46, lift = 100 - 46 - 58 = -4
    const d = pipePath({ x: 0, y: 100 }, { x: 200, y: 100 }, "rework");
    // First curve: Q from.x lift (from.x-16) lift
    expect(d).toContain("Q 0 -4 -16 -4");
    // Horizontal segment of the arch: L (to.x+16) lift
    expect(d).toContain("L 216 -4");
    // Second curve: Q to.x lift to.x (lift+14)
    expect(d).toContain("Q 200 -4 200 10");
  });

  it("handles error edges the same as flow edges", () => {
    const flowD = pipePath({ x: 0, y: 0 }, { x: 200, y: 100 }, "flow");
    const errorD = pipePath({ x: 0, y: 0 }, { x: 200, y: 100 }, "error");
    expect(errorD).toBe(flowD);
  });
});

describe("pipeArrows", () => {
  it("returns empty array for rework edges", () => {
    expect(pipeArrows({ x: 0, y: 0 }, { x: 200, y: 0 }, "rework")).toEqual([]);
  });

  it("returns a single centered arrow for short same-column vertical pipes", () => {
    // span = 50 < 3*20+12 = 72
    const arrows = pipeArrows({ x: 100, y: 0 }, { x: 100, y: 50 }, "flow");
    expect(arrows.length).toBe(1);
    expect(arrows[0]!.x).toBe(100);
    expect(arrows[0]!.y).toBe(25); // midpoint
    expect(arrows[0]!.angle).toBe(90); // downward
  });

  it("returns 3 arrows for long same-column vertical pipes", () => {
    // span = 200 >= 72
    const arrows = pipeArrows({ x: 100, y: 0 }, { x: 100, y: 200 }, "flow");
    expect(arrows.length).toBe(3);
    // First: inset 20 from start
    expect(arrows[0]!.y).toBe(20);
    // Middle: midpoint
    expect(arrows[1]!.y).toBe(100);
    // Last: inset 20 from end
    expect(arrows[2]!.y).toBe(180);
    // All vertical, downward
    arrows.forEach((a) => {
      expect(a.angle).toBe(90);
      expect(a.x).toBe(100);
    });
  });

  it("returns upward-pointing arrows for bottom-to-top vertical pipes", () => {
    const arrows = pipeArrows({ x: 100, y: 200 }, { x: 100, y: 0 }, "flow");
    expect(arrows.length).toBe(3);
    arrows.forEach((a) => expect(a.angle).toBe(-90));
  });

  it("returns a single centered arrow for short horizontal pipes", () => {
    // len = 50 < 72
    const arrows = pipeArrows({ x: 0, y: 100 }, { x: 50, y: 100 }, "flow");
    expect(arrows.length).toBe(1);
    expect(arrows[0]!.x).toBe(25); // midpoint
    expect(arrows[0]!.y).toBe(100);
    expect(arrows[0]!.dir).toBe(1);
    expect(arrows[0]!.angle).toBe(0);
  });

  it("returns 3 arrows for long horizontal pipes", () => {
    // len = 200 >= 72
    const arrows = pipeArrows({ x: 0, y: 100 }, { x: 200, y: 100 }, "flow");
    expect(arrows.length).toBe(3);
    expect(arrows[0]!.x).toBe(20); // inset from start
    expect(arrows[1]!.x).toBe(100); // midpoint
    expect(arrows[2]!.x).toBe(180); // inset from end
    arrows.forEach((a) => {
      expect(a.y).toBe(100);
      expect(a.dir).toBe(1);
      expect(a.angle).toBe(0);
    });
  });

  it("returns dir=-1 for right-to-left horizontal pipes", () => {
    const arrows = pipeArrows({ x: 200, y: 100 }, { x: 0, y: 100 }, "flow");
    expect(arrows.length).toBe(3);
    arrows.forEach((a) => expect(a.dir).toBe(-1));
  });

  it("returns arrows on all 3 segments for a dogleg pipe", () => {
    // from (0,0) to (200,100): mid=100
    // firstLen = 100 >= 28, vertical = 100 >= 72, lastLen = 100 >= 28
    const arrows = pipeArrows({ x: 0, y: 0 }, { x: 200, y: 100 }, "flow");
    expect(arrows.length).toBe(3);
    // First: horizontal on first segment
    expect(arrows[0]!.x).toBe(20);
    expect(arrows[0]!.y).toBe(0);
    expect(arrows[0]!.angle).toBe(0);
    // Middle: vertical on middle segment
    expect(arrows[1]!.x).toBe(100);
    expect(arrows[1]!.y).toBe(50);
    expect(arrows[1]!.angle).toBe(90);
    // Last: horizontal on last segment
    expect(arrows[2]!.x).toBe(180);
    expect(arrows[2]!.y).toBe(100);
    expect(arrows[2]!.angle).toBe(0);
  });

  it("skips the first arrow when the first horizontal segment is too short", () => {
    // from (0,0) to (30,100): mid=15, firstLen=15 < 28
    const arrows = pipeArrows({ x: 0, y: 0 }, { x: 30, y: 100 }, "flow");
    // Should have at most 2 arrows (middle + last), first skipped
    expect(arrows.length).toBeLessThanOrEqual(2);
    if (arrows.length >= 1) {
      // First arrow should not be at y=0 (first segment)
      expect(arrows[0]!.y).not.toBe(0);
    }
  });

  it("skips the middle arrow when the vertical segment is too short", () => {
    // from (0,0) to (200,50): vertical=50 < 72
    const arrows = pipeArrows({ x: 0, y: 0 }, { x: 200, y: 50 }, "flow");
    // Should have at most 2 arrows (first + last), middle skipped
    expect(arrows.length).toBeLessThanOrEqual(2);
    // No arrow should be at x=100 (middle vertical)
    arrows.forEach((a) => expect(a.x).not.toBe(100));
  });
});

describe("pipeArrow", () => {
  it("returns the last arrow from pipeArrows", () => {
    const arrows = pipeArrows({ x: 0, y: 0 }, { x: 200, y: 100 }, "flow");
    const single = pipeArrow({ x: 0, y: 0 }, { x: 200, y: 100 }, "flow");
    expect(single).toEqual(arrows[arrows.length - 1]);
  });

  it("returns null for rework edges (no arrows)", () => {
    expect(pipeArrow({ x: 0, y: 0 }, { x: 200, y: 0 }, "rework")).toBeNull();
  });
});

describe("pipeCrossings", () => {
  function makeGraph(edges: { id: string; kind?: GraphEdge["kind"] }[]): Graph {
    return {
      id: "test",
      name: "test",
      nodes: [],
      edges: edges.map((e) => ({
        id: e.id,
        from: "n1",
        to: "n2",
        kind: e.kind ?? "flow",
      })) as GraphEdge[],
      runs: [],
    } as Graph;
  }

  it("returns empty array for parallel horizontal pipes (no crossing)", () => {
    const graph = makeGraph([{ id: "a" }, { id: "b" }]);
    const anchors = new Map([
      ["a", { from: { x: 0, y: 0 }, to: { x: 200, y: 0 } }],
      ["b", { from: { x: 0, y: 50 }, to: { x: 200, y: 50 } }],
    ]);
    expect(pipeCrossings(graph, anchors)).toEqual([]);
  });

  it("detects a crossing between a vertical and a horizontal pipe", () => {
    const graph = makeGraph([{ id: "h" }, { id: "v" }]);
    const anchors = new Map([
      ["h", { from: { x: 0, y: 0 }, to: { x: 200, y: 0 } }],
      // v.mid=50 is inside h's first horizontal segment [0, 100]
      ["v", { from: { x: 50, y: -100 }, to: { x: 50, y: 100 } }],
    ]);
    const crossings = pipeCrossings(graph, anchors);
    expect(crossings.length).toBe(1);
    expect(crossings[0]!.x).toBe(50);
    expect(crossings[0]!.y).toBe(0);
    // Vertical pipe is "over", horizontal is "under"
    expect(crossings[0]!.over).toBe("v");
    expect(crossings[0]!.under).toBe("h");
  });

  it("skips rework edges", () => {
    const graph = makeGraph([{ id: "h" }, { id: "r", kind: "rework" }]);
    const anchors = new Map([
      ["h", { from: { x: 0, y: 0 }, to: { x: 200, y: 0 } }],
      ["r", { from: { x: 100, y: -100 }, to: { x: 100, y: 100 } }],
    ]);
    // Rework edge is skipped, so no crossing detected
    expect(pipeCrossings(graph, anchors)).toEqual([]);
  });

  it("skips edges without anchors", () => {
    const graph = makeGraph([{ id: "h" }, { id: "v" }]);
    const anchors = new Map([
      ["h", { from: { x: 0, y: 0 }, to: { x: 200, y: 0 } }],
      // "v" has no anchor
    ]);
    expect(pipeCrossings(graph, anchors)).toEqual([]);
  });

  it("detects multiple crossings", () => {
    const graph = makeGraph([{ id: "h1" }, { id: "h2" }, { id: "v" }]);
    const anchors = new Map([
      ["h1", { from: { x: 0, y: 0 }, to: { x: 200, y: 0 } }],
      ["h2", { from: { x: 0, y: 50 }, to: { x: 200, y: 50 } }],
      ["v", { from: { x: 50, y: -100 }, to: { x: 50, y: 100 } }],
    ]);
    const crossings = pipeCrossings(graph, anchors);
    expect(crossings.length).toBe(2);
    // Both crossings should be at x=50, vertical pipe over
    crossings.forEach((c) => {
      expect(c.x).toBe(50);
      expect(c.over).toBe("v");
    });
  });

  it("returns Crossing objects with x, y, over, under fields", () => {
    const graph = makeGraph([{ id: "h" }, { id: "v" }]);
    const anchors = new Map([
      ["h", { from: { x: 0, y: 0 }, to: { x: 200, y: 0 } }],
      ["v", { from: { x: 50, y: -100 }, to: { x: 50, y: 100 } }],
    ]);
    const crossings = pipeCrossings(graph, anchors);
    expect(crossings.length).toBe(1);
    const c = crossings[0]!;
    expect(typeof c.x).toBe("number");
    expect(typeof c.y).toBe("number");
    expect(typeof c.over).toBe("string");
    expect(typeof c.under).toBe("string");
  });
});
