import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Graph, GraphNode } from "@agent-world/core";
import { useGraph } from "../store/graph";
import Canvas from "./Canvas";
import type { Mode } from "./Canvas";

// PacketLayer drives a 2d canvas + SVG path metrics that jsdom lacks; the
// keyboard behavior under test lives in Canvas/Plants, not in packets.
vi.mock("./PacketLayer", () => ({ default: () => null }));

function makeNode(over: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "n1",
    kind: "textGen",
    name: "N1",
    x: 100,
    y: 100,
    ...over,
  } as GraphNode;
}

function makeGraph(nodes: GraphNode[]): Graph {
  return { id: "g1", name: "Test graph", nodes, edges: [] };
}

function renderCanvas(mode: Mode) {
  return render(<Canvas mode={mode} diagnostics={[]} />);
}

describe("Canvas node activation via keyboard", () => {
  beforeEach(() => {
    useGraph.getState().setGraph(
      makeGraph([makeNode(), makeNode({ id: "n2", name: "N2", x: 300 })]),
    );
    useGraph.setState({
      selectedId: null,
      selectedNodeIds: [],
      selectedEdgeIds: [],
      inspectorOpen: false,
    });
  });
  afterEach(() => {
    cleanup();
  });

  it("Enter selects the node and opens the inspector in select mode", () => {
    const { container } = renderCanvas("select");
    const plant = container.querySelector("g.plant") as SVGGElement;
    fireEvent.keyDown(plant, { key: "Enter" });
    expect(useGraph.getState().selectedNodeIds).toEqual(["n1"]);
    expect(useGraph.getState().inspectorOpen).toBe(true);
  });

  it("Space activates the node like a click in select mode", () => {
    const { container } = renderCanvas("select");
    const plants = container.querySelectorAll("g.plant");
    fireEvent.keyDown(plants[1], { key: " " });
    expect(useGraph.getState().selectedNodeIds).toEqual(["n2"]);
    expect(useGraph.getState().inspectorOpen).toBe(true);
  });

  it("Enter removes the node in delete mode", () => {
    const { container } = renderCanvas("delete");
    const plant = container.querySelector("g.plant") as SVGGElement;
    fireEvent.keyDown(plant, { key: "Enter" });
    const ids = useGraph.getState().graph.nodes.map((n) => n.id);
    expect(ids).toEqual(["n2"]);
  });

  it("Enter connects two nodes in connect mode", () => {
    const { container } = renderCanvas("connect");
    const plants = container.querySelectorAll("g.plant");
    fireEvent.keyDown(plants[0], { key: "Enter" });
    // First Enter marks the source node; the visual connect badge shows it.
    expect(plants[0].classList.contains("is-connect-src")).toBe(true);
    fireEvent.keyDown(plants[1], { key: "Enter" });
    const edges = useGraph.getState().graph.edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: "n1", to: "n2", kind: "flow" });
    expect(useGraph.getState().inspectorOpen).toBe(false);
  });

  it("Enter creates a rework edge in rework mode", () => {
    const { container } = renderCanvas("rework");
    const plants = container.querySelectorAll("g.plant");
    fireEvent.keyDown(plants[0], { key: "Enter" });
    fireEvent.keyDown(plants[1], { key: "Enter" });
    const edges = useGraph.getState().graph.edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: "n1", to: "n2", kind: "rework" });
  });
});
