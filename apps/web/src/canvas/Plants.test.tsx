import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Graph, GraphNode } from "@agent-world/core";
import { initialRuntime } from "@agent-world/core";
import { useGraph } from "../store/graph";
import Plants from "./Plants";

function makeNode(over: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "n1",
    kind: "source",
    name: "Start",
    x: 100,
    y: 100,
    ...over,
  } as GraphNode;
}

function makeGraph(nodes: GraphNode[]): Graph {
  return { id: "g1", name: "Test graph", nodes, edges: [] };
}

const runtime = initialRuntime;

interface RenderOptions {
  onActivate?: (node: GraphNode) => void;
  onToggleCollapse?: (fanoutId: string) => void;
  collapsedFans?: Record<string, boolean>;
}

function renderPlants(selectedNodeIds: string[] = [], opts: RenderOptions = {}) {
  const onActivate = opts.onActivate ?? vi.fn();
  const utils = render(
    <Plants
      graph={useGraph.getState().graph}
      runtime={runtime}
      selectedNodeIds={selectedNodeIds}
      connectFrom={null}
      onPointerDown={vi.fn()}
      onActivate={onActivate}
      onToggleCollapse={opts.onToggleCollapse}
      collapsedFans={opts.collapsedFans ?? {}}
    />,
  );
  return { ...utils, onActivate };
}

describe("Plants keyboard model", () => {
  beforeEach(() => {
    useGraph.getState().setGraph(makeGraph([makeNode()]));
  });
  afterEach(() => {
    cleanup();
  });

  it("renders each node as a focusable button with an accessible name", () => {
    const { container } = renderPlants();
    const plant = container.querySelector("g.plant") as SVGGElement;
    expect(plant).toBeTruthy();
    expect(plant.getAttribute("tabindex")).toBe("0");
    expect(plant.getAttribute("role")).toBe("button");
    expect(plant.getAttribute("aria-label")).toContain("Start");
    expect(plant.getAttribute("aria-pressed")).toBe("false");
  });

  it("reflects selection in aria-pressed", () => {
    const { container } = renderPlants(["n1"]);
    const plant = container.querySelector("g.plant") as SVGGElement;
    expect(plant.getAttribute("aria-pressed")).toBe("true");
  });

  it("activates the node on Enter like a pointer click", () => {
    const onActivate = vi.fn();
    const { container } = renderPlants([], { onActivate });
    const plant = container.querySelector("g.plant") as SVGGElement;
    fireEvent.keyDown(plant, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }));
  });

  it("activates the node on Space like a pointer click", () => {
    const onActivate = vi.fn();
    const { container } = renderPlants([], { onActivate });
    const plant = container.querySelector("g.plant") as SVGGElement;
    fireEvent.keyDown(plant, { key: " " });
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }));
  });

  it("moves the node right with ArrowRight", () => {
    const { container } = renderPlants();
    const plant = container.querySelector("g.plant") as SVGGElement;
    fireEvent.keyDown(plant, { key: "ArrowRight" });
    const moved = useGraph.getState().graph.nodes.find((n) => n.id === "n1")!;
    expect(moved.x).toBe(120);
    expect(moved.y).toBe(100);
  });

  it("moves the node up with ArrowUp", () => {
    const { container } = renderPlants();
    const plant = container.querySelector("g.plant") as SVGGElement;
    fireEvent.keyDown(plant, { key: "ArrowUp" });
    const moved = useGraph.getState().graph.nodes.find((n) => n.id === "n1")!;
    expect(moved.x).toBe(100);
    expect(moved.y).toBe(80);
  });

  it("uses a larger step when Shift is held", () => {
    const { container } = renderPlants();
    const plant = container.querySelector("g.plant") as SVGGElement;
    fireEvent.keyDown(plant, { key: "ArrowLeft", shiftKey: true });
    const moved = useGraph.getState().graph.nodes.find((n) => n.id === "n1")!;
    expect(moved.x).toBe(40);
  });
});

describe("fanout collapse chip", () => {
  beforeEach(() => {
    useGraph.getState().setGraph(makeGraph([makeNode({ id: "f1", kind: "fanout" })]));
  });
  afterEach(() => {
    cleanup();
  });

  it("renders as an independent focusable button with an aria-label", () => {
    const { container } = renderPlants([], { onToggleCollapse: vi.fn() });
    const chip = container.querySelector("g.plant__collapse-chip") as SVGGElement;
    expect(chip).toBeTruthy();
    expect(chip.getAttribute("role")).toBe("button");
    expect(chip.getAttribute("tabindex")).toBe("0");
    expect(chip.getAttribute("aria-label")).toBe("收起扇出泳道");
  });

  it("shows the expand label while collapsed", () => {
    const { container } = renderPlants([], {
      onToggleCollapse: vi.fn(),
      collapsedFans: { f1: true },
    });
    const chip = container.querySelector("g.plant__collapse-chip") as SVGGElement;
    expect(chip.getAttribute("aria-label")).toBe("展开扇出泳道");
  });

  it("toggles collapse on Enter and Space", () => {
    const onToggleCollapse = vi.fn();
    const { container } = renderPlants([], { onToggleCollapse });
    const chip = container.querySelector("g.plant__collapse-chip") as SVGGElement;
    fireEvent.keyDown(chip, { key: "Enter" });
    fireEvent.keyDown(chip, { key: " " });
    expect(onToggleCollapse).toHaveBeenCalledTimes(2);
    expect(onToggleCollapse).toHaveBeenCalledWith("f1");
  });

  it("does not activate the plant when the chip is keyed", () => {
    const onActivate = vi.fn();
    const { container } = renderPlants([], { onActivate, onToggleCollapse: vi.fn() });
    const chip = container.querySelector("g.plant__collapse-chip") as SVGGElement;
    fireEvent.keyDown(chip, { key: "Enter" });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("toggles collapse on click", () => {
    const onToggleCollapse = vi.fn();
    const { container } = renderPlants([], { onToggleCollapse });
    const chip = container.querySelector("g.plant__collapse-chip") as SVGGElement;
    fireEvent.click(chip);
    expect(onToggleCollapse).toHaveBeenCalledWith("f1");
  });
});
