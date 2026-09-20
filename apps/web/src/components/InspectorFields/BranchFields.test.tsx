import { render, screen, within } from "@testing-library/react";
import type { TFunction } from "i18next";
import type { Graph, GraphNode } from "@agent-world/core";
import BranchFields from "./BranchFields";
import type { FieldsProps } from "./types";

// t mock: echo the key, interpolating {{value}} so initial-state text is assertable.
const t = ((k: string, opts?: Record<string, unknown>) =>
  opts && "value" in opts ? `${k}⟦${String(opts.value)}⟧` : k) as unknown as TFunction;

const branchNode = (rules: { id: string; when: string; target: string }[], defaultTarget?: string): GraphNode =>
  ({
    id: "decide",
    kind: "branch",
    name: "Decide",
    x: 0,
    y: 0,
    branch: { rules, defaultTarget },
  }) as GraphNode;

const graphWith = (node: GraphNode, variables?: Record<string, unknown>): Graph =>
  ({
    id: "g",
    name: "orders",
    variables,
    nodes: [
      node,
      { id: "ship", kind: "sink", name: "Ship", x: 0, y: 0 },
      { id: "refund", kind: "sink", name: "Refund", x: 0, y: 0 },
      { id: "hold", kind: "sink", name: "Hold", x: 0, y: 0 },
    ],
    edges: [],
  }) as unknown as Graph;

const renderFields = (node: GraphNode, graph: Graph) =>
  render(<BranchFields {...({ node, graph, updateNode: vi.fn(), t } as unknown as FieldsProps)} />);

describe("BranchFields state-flow preview", () => {
  it("renders derived state values, targets and the declared initial state", () => {
    const node = branchNode(
      [
        { id: "paid", when: "${var.orderState} == 'paid'", target: "ship" },
        { id: "cancel", when: "'cancelled' === ${var.orderState}", target: "refund" },
      ],
      "hold",
    );
    renderFields(node, graphWith(node, { orderState: "pending" }));

    const panel = screen.getByTestId("state-flow-orderState");
    expect(within(panel).getByText("var.orderState")).toBeTruthy();
    expect(within(panel).getByText("paid")).toBeTruthy();
    expect(within(panel).getByText("cancelled")).toBeTruthy();
    expect(within(panel).getByText("Ship")).toBeTruthy();
    expect(within(panel).getByText("Refund")).toBeTruthy();
    expect(within(panel).getByText("Hold")).toBeTruthy();
    // declared initial value is surfaced via the stateInitial interpolation
    expect(within(panel).getByText(/pending/)).toBeTruthy();
    // default branch is labelled, not a state value
    expect(within(panel).getByText("nodes:inspector.branch.stateDefault")).toBeTruthy();
  });

  it("flags a state variable with no declared initial value", () => {
    const node = branchNode([{ id: "paid", when: "${var.stage} === 3", target: "ship" }]);
    renderFields(node, graphWith(node));
    const panel = screen.getByTestId("state-flow-stage");
    expect(within(panel).getByText("nodes:inspector.branch.stateUndeclared")).toBeTruthy();
    expect(within(panel).getByText("3")).toBeTruthy();
  });

  it("shows no state-flow preview for plain node-reference conditions", () => {
    const node = branchNode([{ id: "ok", when: "${intake.ok} == true", target: "ship" }], "hold");
    const { container } = renderFields(node, graphWith(node, {}));
    expect(container.querySelector("[data-testid^='state-flow-']")).toBeNull();
  });
});
