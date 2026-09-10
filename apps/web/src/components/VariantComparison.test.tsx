import { render, screen } from "@testing-library/react";
import type { Graph, RuntimeState } from "@agent-world/core";
import VariantComparison from "./VariantComparison";

function variantArtifact(lanes: unknown[]) {
  return {
    id: "fo-variants",
    kind: "json" as const,
    content: JSON.stringify({ variants: lanes }),
  };
}

function graphWithFanoutSelect(): Graph {
  return {
    nodes: [
      { id: "fo", kind: "fanout" },
      { id: "sel", kind: "select" },
    ],
    edges: [{ id: "e1", from: "fo", to: "sel", kind: "flow" }],
  } as unknown as Graph;
}

function runtimeWith(partial: Record<string, unknown>): RuntimeState {
  // nodes is always present on a real RuntimeState; useMemo reads it before
  // the early `if (!group) return null`, so default it to an empty record.
  return { nodes: {}, ...partial } as unknown as RuntimeState;
}

const LANES = [
  { variant: "v1", output: "方案一内容", ok: true },
  { variant: "v2", output: "方案二内容", ok: true },
];

describe("VariantComparison", () => {
  it("renders nothing when there is no variant group", () => {
    const { container } = render(
      <VariantComparison graph={graphWithFanoutSelect()} runtime={runtimeWith({ variants: {} })} nodeId="fo" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the group has no lanes and no ranking", () => {
    const runtime = runtimeWith({
      variants: { fo: { nodeId: "fo", kind: "fanout", variantIds: [] } },
      nodes: { fo: { artifacts: [] } },
    });
    const { container } = render(
      <VariantComparison graph={graphWithFanoutSelect()} runtime={runtime} nodeId="fo" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders fanout lanes from the variant artifact", () => {
    const runtime = runtimeWith({
      variants: { fo: { nodeId: "fo", kind: "fanout", variantIds: ["v1", "v2"] } },
      nodes: { fo: { artifacts: [variantArtifact(LANES)] } },
    });
    render(<VariantComparison graph={graphWithFanoutSelect()} runtime={runtime} nodeId="fo" />);
    expect(screen.getByText("变体泳道")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("方案一内容")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.queryByText("已选中")).not.toBeInTheDocument();
  });

  it("walks upstream to the fanout and shows the select title", () => {
    const runtime = runtimeWith({
      variants: { sel: { nodeId: "sel", kind: "select", ranking: [], chosen: [], failed: [] } },
      nodes: { fo: { artifacts: [variantArtifact(LANES)] } },
    });
    render(<VariantComparison graph={graphWithFanoutSelect()} runtime={runtime} nodeId="sel" />);
    expect(screen.getByText("变体对比")).toBeInTheDocument();
    expect(screen.getByText("方案二内容")).toBeInTheDocument();
  });

  it("marks the chosen lane and shows score + reason", () => {
    const runtime = runtimeWith({
      variants: {
        sel: {
          nodeId: "sel",
          kind: "select",
          ranking: [{ variant: "v2", score: 8.5, reason: "结构更完整" }],
          chosen: ["v2"],
          failed: [],
        },
      },
      nodes: { fo: { artifacts: [variantArtifact(LANES)] } },
    });
    render(<VariantComparison graph={graphWithFanoutSelect()} runtime={runtime} nodeId="sel" />);
    expect(screen.getByText("已选中")).toBeInTheDocument();
    expect(screen.getByText("8.5")).toBeInTheDocument();
    expect(screen.getByText("结构更完整")).toBeInTheDocument();
    expect(document.querySelector(".variant-card.is-chosen")).not.toBeNull();
  });

  it("renders a failed lane with its custom error and the failed summary", () => {
    const runtime = runtimeWith({
      variants: {
        sel: {
          nodeId: "sel",
          kind: "select",
          ranking: [],
          chosen: [],
          failed: ["v1"],
        },
      },
      nodes: {
        fo: {
          artifacts: [
            variantArtifact([
              { variant: "v1", output: "", ok: false, error: "429 rate limit" },
              { variant: "v2", output: "ok", ok: true },
            ]),
          ],
        },
      },
    });
    render(<VariantComparison graph={graphWithFanoutSelect()} runtime={runtime} nodeId="sel" />);
    expect(screen.getByText("429 rate limit")).toBeInTheDocument();
    expect(screen.getByText(/失败泳道 1 条：v1/)).toBeInTheDocument();
    expect(document.querySelector(".variant-card.is-failed")).not.toBeNull();
  });

  it("falls back to the generic lane-failed text when no error is given", () => {
    const runtime = runtimeWith({
      variants: {
        sel: { nodeId: "sel", kind: "select", ranking: [], chosen: [], failed: ["v1"] },
      },
      nodes: {
        fo: {
          artifacts: [variantArtifact([{ variant: "v1", output: "", ok: false }])],
        },
      },
    });
    render(<VariantComparison graph={graphWithFanoutSelect()} runtime={runtime} nodeId="sel" />);
    expect(screen.getByText("该泳道失败")).toBeInTheDocument();
  });

  it("falls back to ranking when the fanout has no lane artifact", () => {
    const runtime = runtimeWith({
      variants: {
        sel: {
          nodeId: "sel",
          kind: "select",
          ranking: [{ variant: "r1", score: 6, reason: "" }],
          chosen: [],
          failed: [],
        },
      },
      nodes: { fo: { artifacts: [] } },
    });
    render(<VariantComparison graph={graphWithFanoutSelect()} runtime={runtime} nodeId="sel" />);
    expect(screen.getByText("r1")).toBeInTheDocument();
    expect(screen.getByText("6.0")).toBeInTheDocument();
  });

  it("assigns good/warn/bad score classes by threshold", () => {
    const runtime = runtimeWith({
      variants: {
        sel: {
          nodeId: "sel",
          kind: "select",
          ranking: [
            { variant: "g", score: 8.5, reason: "" },
            { variant: "w", score: 5, reason: "" },
            { variant: "b", score: 2, reason: "" },
          ],
          chosen: [],
          failed: [],
        },
      },
      nodes: { fo: { artifacts: [] } },
    });
    render(<VariantComparison graph={graphWithFanoutSelect()} runtime={runtime} nodeId="sel" />);
    expect(document.querySelector(".variant-card__score.is-good")?.textContent).toBe("8.5");
    expect(document.querySelector(".variant-card__score.is-warn")?.textContent).toBe("5.0");
    expect(document.querySelector(".variant-card__score.is-bad")?.textContent).toBe("2.0");
  });

  it("returns nothing when the variant artifact JSON is corrupt", () => {
    const runtime = runtimeWith({
      variants: { fo: { nodeId: "fo", kind: "fanout", variantIds: ["v1"] } },
      nodes: { fo: { artifacts: [{ id: "fo-variants", kind: "json", content: "{not json" }] } },
    });
    const { container } = render(
      <VariantComparison graph={graphWithFanoutSelect()} runtime={runtime} nodeId="fo" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
