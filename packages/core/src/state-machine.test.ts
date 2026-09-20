import { describe, expect, it } from "vitest";
import { deriveStateMachine } from "./state-machine.js";
import type { Graph, GraphEdge, GraphNode, NodeKind } from "./graph.js";

const node = (id: string, kind: NodeKind, extra: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind, name: id.toUpperCase(), x: 0, y: 0, ...extra }) as GraphNode;

const edge = (id: string, from: string, to: string): GraphEdge =>
  ({ id, from, to, kind: "flow" }) as GraphEdge;

/** intake → decide branches to ship / refund / hold, driven by var.orderState. */
function orderGraph(): Graph {
  return {
    id: "g",
    name: "orders",
    variables: { orderState: "pending" },
    nodes: [
      node("intake", "source"),
      node("decide", "branch", {
        branch: {
          rules: [
            { id: "paid", when: "${var.orderState} == 'paid'", target: "ship" },
            { id: "cancel", when: "'cancelled' === ${var.orderState}", target: "refund" },
          ],
          defaultTarget: "hold",
        },
      }),
      node("ship", "sink"),
      node("refund", "sink"),
      node("hold", "sink"),
    ],
    edges: [
      edge("e1", "intake", "decide"),
      edge("e2", "decide", "ship"),
      edge("e3", "decide", "refund"),
      edge("e4", "decide", "hold"),
    ],
  } as unknown as Graph;
}

describe("deriveStateMachine", () => {
  it("extracts equality transitions and the declared initial state", () => {
    const views = deriveStateMachine(orderGraph());
    expect(views).toHaveLength(1);
    const v = views[0]!;
    expect(v.variable).toBe("orderState");
    expect(v.hasDeclaration).toBe(true);
    expect(v.initial).toBe("pending");
    expect(v.values).toEqual(["paid", "cancelled"]);
    expect(v.transitions).toHaveLength(2);
    expect(v.transitions[0]).toMatchObject({
      value: "paid",
      ruleId: "paid",
      targetNodeId: "ship",
      targetName: "SHIP",
      branchNodeId: "decide",
    });
    // reverse literal form ('cancelled' === ${var...}) is captured too
    expect(v.transitions[1]).toMatchObject({ value: "cancelled", targetNodeId: "refund" });
  });

  it("parses number and boolean state values and de-duplicates", () => {
    const g = orderGraph();
    const decide = g.nodes[1] as GraphNode & {
      branch: { rules: { id: string; when: string; target: string }[] };
    };
    decide.branch.rules = [
      { id: "s3", when: "${var.stage} === 3", target: "ship" },
      { id: "s3again", when: "${var.stage} == 3", target: "ship" },
      { id: "done", when: "${var.done} == true", target: "hold" },
    ];
    const views = deriveStateMachine(g);
    const stage = views.find((x) => x.variable === "stage")!;
    expect(stage.values).toEqual([3]);
    expect(stage.transitions).toHaveLength(2);
    const done = views.find((x) => x.variable === "done")!;
    expect(done.values).toEqual([true]);
  });

  it("ignores inequality and ordering comparisons", () => {
    const g = orderGraph();
    const decide = g.nodes[1] as GraphNode & {
      branch: { rules: { when: string }[] };
    };
    decide.branch.rules = [
      { id: "neq", when: "${var.orderState} != 'paid'", target: "hold" },
      { id: "gt", when: "${var.count} > 3", target: "ship" },
    ];
    expect(deriveStateMachine(g)).toEqual([]);
  });

  it("reports an undeclared state variable", () => {
    const g = orderGraph();
    delete g.variables;
    const v = deriveStateMachine(g)[0]!;
    expect(v.hasDeclaration).toBe(false);
    expect(v.initial).toBeUndefined();
  });

  it("returns nothing for graphs without state-driven branches", () => {
    const g = orderGraph();
    const decide = g.nodes[1] as GraphNode & { branch: { rules: { when: string }[] } };
    decide.branch.rules = [{ id: "plain", when: "${intake.ok} == true", target: "ship" }];
    expect(deriveStateMachine(g)).toEqual([]);
  });
});
