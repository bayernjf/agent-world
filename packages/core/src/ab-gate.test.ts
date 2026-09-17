import { describe, expect, it } from "vitest";
import type { Graph, GraphEdge, GraphNode } from "./graph.js";
import type { RunEvent } from "./events.js";
import { buildTimeline } from "./trace.js";
import { findDownstreamGate, projectGateVerdict } from "./ab-gate.js";

function node(id: string, kind: GraphNode["kind"], extra: Partial<GraphNode> = {}): GraphNode {
  return { id, kind, name: id, x: 0, y: 0, ...extra } as GraphNode;
}
function edge(id: string, from: string, to: string, kind: GraphEdge["kind"] = "flow"): GraphEdge {
  return { id, from, to, kind };
}
function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): Graph {
  return { id: "g1", name: "g1", nodes, edges } as unknown as Graph;
}
function evt(partial: Partial<RunEvent> & { type: RunEvent["type"]; ts: number }): RunEvent {
  return partial as RunEvent;
}

describe("findDownstreamGate", () => {
  it("finds the gate directly downstream of the target", () => {
    const g = makeGraph(
      [node("src", "source"), node("t", "textGen"), node("q", "gate"), node("out", "sink")],
      [edge("e1", "src", "t"), edge("e2", "t", "q"), edge("e3", "q", "out")],
    );
    expect(findDownstreamGate(g, "t")).toEqual({ gateNodeId: "q", mutatesInBetween: false });
  });

  it("flags a content-mutating node between target and gate", () => {
    const g = makeGraph(
      [
        node("t", "textGen"),
        node("rewrite", "textGen"),
        node("q", "gate"),
      ],
      [edge("e1", "t", "rewrite"), edge("e2", "rewrite", "q")],
    );
    expect(findDownstreamGate(g, "t")?.mutatesInBetween).toBe(true);
  });

  it("treats translate as content-mutating but gate/control nodes as not", () => {
    const gTranslate = makeGraph(
      [node("t", "textGen"), node("tr", "translate"), node("q", "gate")],
      [edge("e1", "t", "tr"), edge("e2", "tr", "q")],
    );
    expect(findDownstreamGate(gTranslate, "t")?.mutatesInBetween).toBe(true);

    const gBranch = makeGraph(
      [node("t", "textGen"), node("b", "branch"), node("q", "gate")],
      [edge("e1", "t", "b"), edge("e2", "b", "q")],
    );
    expect(findDownstreamGate(gBranch, "t")?.mutatesInBetween).toBe(false);
  });

  it("returns null when no gate is downstream", () => {
    const g = makeGraph(
      [node("src", "source"), node("t", "textGen"), node("out", "sink")],
      [edge("e1", "src", "t"), edge("e2", "t", "out")],
    );
    expect(findDownstreamGate(g, "t")).toBeNull();
  });

  it("ignores rework back-edges and picks the nearest gate by BFS", () => {
    // q-near is one hop away; q-far is two hops. The rework edge q-near -> t
    // loops back and must not be followed forward.
    const g = makeGraph(
      [node("t", "textGen"), node("qnear", "gate"), node("x", "sink"), node("qfar", "gate")],
      [
        edge("e1", "t", "qnear"),
        edge("e2", "t", "x"),
        edge("e3", "x", "qfar"),
        edge("e4", "qnear", "t", "rework"),
      ],
    );
    expect(findDownstreamGate(g, "t")?.gateNodeId).toBe("qnear");
  });
});

describe("projectGateVerdict", () => {
  const graph = makeGraph(
    [
      node("t", "textGen"),
      node("q", "gate", { gate: { maxAttempts: 3, criterion: "", onExhausted: "halt", skills: [], minScore: 6 } as GraphNode["gate"] }),
    ],
    [edge("e1", "t", "q")],
  );

  it("returns null when there is no downstream gate", () => {
    const noGate = makeGraph([node("t", "textGen"), node("out", "sink")], [edge("e1", "t", "out")]);
    const tl = buildTimeline([]);
    expect(projectGateVerdict(noGate, tl, "t")).toBeNull();
  });

  it("projects the final verdict across rework attempts and the quality bar", () => {
    const events: RunEvent[] = [
      evt({ type: "gate.verdict", ts: 1000, nodeId: "q", attempt: 1, passed: false, reason: "too thin", score: 3 }),
      evt({ type: "gate.verdict", ts: 2000, nodeId: "q", attempt: 2, passed: true, reason: "good", score: 8 }),
    ];
    const p = projectGateVerdict(graph, buildTimeline(events), "t");
    expect(p).not.toBeNull();
    expect(p?.passed).toBe(true);
    expect(p?.score).toBe(8);
    expect(p?.reason).toBe("good");
    expect(p?.minScore).toBe(6);
    expect(p?.meetsBar).toBe(true);
    expect(p?.history.map((h) => h.attempt)).toEqual([1, 2]);
  });

  it("marks meetsBar false when the final score is below the bar", () => {
    const events: RunEvent[] = [
      evt({ type: "gate.verdict", ts: 1000, nodeId: "q", attempt: 1, passed: true, reason: "ok", score: 5 }),
    ];
    const p = projectGateVerdict(graph, buildTimeline(events), "t");
    expect(p?.score).toBe(5);
    expect(p?.meetsBar).toBe(false);
  });

  it("reports a verdict without a score, leaving meetsBar null", () => {
    const noBar = makeGraph(
      [node("t", "textGen"), node("q", "gate")],
      [edge("e1", "t", "q")],
    );
    const events: RunEvent[] = [
      evt({ type: "gate.verdict", ts: 1000, nodeId: "q", attempt: 1, passed: true, reason: "fine" }),
    ];
    const p = projectGateVerdict(noBar, buildTimeline(events), "t");
    expect(p?.passed).toBe(true);
    expect(p?.score).toBeNull();
    expect(p?.minScore).toBeNull();
    expect(p?.meetsBar).toBeNull();
  });

  it("returns a non-null projection with null verdict when the gate never ran", () => {
    const p = projectGateVerdict(graph, buildTimeline([]), "t");
    expect(p).not.toBeNull();
    expect(p?.gateNodeId).toBe("q");
    expect(p?.passed).toBeNull();
    expect(p?.score).toBeNull();
    expect(p?.reason).toBeNull();
    expect(p?.meetsBar).toBeNull();
    expect(p?.history).toEqual([]);
  });
});
