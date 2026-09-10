import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { WebGLRenderer } from "three";
import { useViewMode } from "../store/view-mode";
import { useGraph } from "../store/graph";

// Mock THREE.WebGLRenderer to avoid WebGL context creation in jsdom.
// Keep all other THREE exports (geometries, materials, math, etc.) real.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class MockWebGLRenderer {
    static instances: MockWebGLRenderer[] = [];
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    shadowMap: { enabled: boolean; type: number } = { enabled: false, type: 0 };
    domElement: HTMLCanvasElement = document.createElement("canvas");
    dispose = vi.fn();
    forceContextLoss = vi.fn();
    render = vi.fn();
    constructor() {
      MockWebGLRenderer.instances.push(this);
    }
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer as unknown as (typeof actual)["WebGLRenderer"],
  };
});

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => {
  class MockOrbitControls {
    target = { x: 0, y: 0, z: 0, set: vi.fn() };
    enableRotate = true;
    enablePan = true;
    enableZoom = true;
    mouseButtons: Record<string, number> = {};
    minPolarAngle = 0;
    maxPolarAngle = 0;
    enabled = true;
    update = vi.fn();
    dispose = vi.fn();
    rotateLeft = vi.fn();
    rotateUp = vi.fn();
    pan = vi.fn();
  }
  return { OrbitControls: MockOrbitControls as unknown as typeof import("three/examples/jsm/controls/OrbitControls.js").OrbitControls };
});

// Minimal graph fixture so Canvas3D has nodes/edges to build.
function setGraphWithOneNode() {
  useGraph.setState({
    graph: {
      id: "test-graph",
      name: "test",
      nodes: [
        { id: "n1", kind: "textGen" as const, x: 0, y: 0, label: "节点" },
      ],
      edges: [],
      createdAt: 0,
      updatedAt: 0,
    },
    selectedId: null,
    inspectorOpen: false,
  });
}

beforeEach(() => {
  // Clear instance bookkeeping between tests so counts stay deterministic.
  const mock = WebGLRenderer as unknown as { instances: unknown[] };
  mock.instances = [];
  useViewMode.setState({
    viewMode: "3d",
    camera3d: null,
    camera3dZoom: 1,
    camera3dTarget: null,
    camera3dZoomRequest: null,
    camera3dMoveRequest: null,
    camera3dResetRequest: false,
  });
  setGraphWithOneNode();
  // Suppress stray React act warnings from useEffects.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Canvas3D", () => {
  it("renders the 3D canvas container div", async () => {
    const { default: Canvas3D } = await import("./Canvas3D");
    const { container } = render(<Canvas3D />);
    const div = container.querySelector(".canvas3d");
    expect(div).toBeInTheDocument();
    cleanup();
  });

  it("cleans up without throwing when unmounted", async () => {
    const { default: Canvas3D } = await import("./Canvas3D");
    const { container, unmount } = render(<Canvas3D />);
    expect(container.querySelector(".canvas3d")).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });

  it("does not recreate the WebGL renderer when the graph changes (audit M30)", async () => {
    const { default: Canvas3D } = await import("./Canvas3D");
    const { unmount } = render(<Canvas3D />);
    const instances = (WebGLRenderer as unknown as { instances: { dispose: ReturnType<typeof vi.fn> }[] })
      .instances;
    expect(instances).toHaveLength(1);

    // Simulate an edit: add a second node. The graph-sync effect should rebuild
    // node/edge geometry only — the renderer instance must survive.
    useGraph.setState((s) => ({
      graph: {
        ...s.graph,
        nodes: [
          ...s.graph.nodes,
          { id: "n2", kind: "imageGen" as const, x: 200, y: 0, label: "节点2" },
        ],
      },
    }));

    expect(instances).toHaveLength(1);
    expect(instances[0]!.dispose).not.toHaveBeenCalled();

    unmount();
    expect(instances[0]!.dispose).toHaveBeenCalledTimes(1);
  });
});