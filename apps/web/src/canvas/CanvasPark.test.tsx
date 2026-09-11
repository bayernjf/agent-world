import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { WebGLRenderer } from "three";
import { useViewMode } from "../store/view-mode";
import type { ParkFactory } from "./CanvasPark";

// Mock THREE.WebGLRenderer to avoid a WebGL context in jsdom; keep the rest of
// three (geometries, InstancedMesh, math) real, mirroring Canvas3D.test.tsx.
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
    zoom = 1;
    position = { x: 0, y: 0, z: 0, set: vi.fn() };
    update = vi.fn();
    dispose = vi.fn();
  }
  return {
    OrbitControls: MockOrbitControls as unknown as typeof import("three/examples/jsm/controls/OrbitControls.js").OrbitControls,
  };
});

function factory(over: Partial<ParkFactory> = {}): ParkFactory {
  return {
    id: "g1",
    name: "产线一",
    category: "营销内容",
    status: "idle",
    pendingReview: 0,
    ...over,
  };
}

beforeEach(() => {
  const mock = WebGLRenderer as unknown as { instances: unknown[] };
  mock.instances = [];
  useViewMode.setState({ parkCamera: null, drilledFromPark: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("CanvasPark", () => {
  it("renders the park container and an empty hint with no factories", async () => {
    const { default: CanvasPark } = await import("./CanvasPark");
    const { container, getByText } = render(<CanvasPark factories={[]} />);
    expect(container.querySelector(".canvas-park")).toBeInTheDocument();
    // Empty hint comes from the zh park namespace (i18n forced to zh in setup).
    expect(getByText("暂无产线，先从模板创建一条产线吧")).toBeInTheDocument();
    cleanup();
  });

  it("mounts and unmounts without throwing", async () => {
    const { default: CanvasPark } = await import("./CanvasPark");
    const { unmount } = render(<CanvasPark factories={[factory()]} />);
    expect(() => unmount()).not.toThrow();
  });

  it("does not recreate the renderer when the factories prop changes (mount-once)", async () => {
    const { default: CanvasPark } = await import("./CanvasPark");
    const instances = (WebGLRenderer as unknown as { instances: { dispose: ReturnType<typeof vi.fn> }[] })
      .instances;
    const utils = render(<CanvasPark factories={[factory()]} />);
    expect(instances).toHaveLength(1);

    // A live poll swaps in a new factories array (status change). Only matrices /
    // billboards rebuild — the WebGL renderer instance must survive.
    utils.rerender(<CanvasPark factories={[factory({ id: "g1", status: "running" }), factory({ id: "g2", name: "产线二" })]} />);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.dispose).not.toHaveBeenCalled();

    utils.unmount();
    expect(instances[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it("builds without crashing when a factory has pending reviews", async () => {
    const { default: CanvasPark } = await import("./CanvasPark");
    const { unmount } = render(
      <CanvasPark factories={[factory({ status: "halted", pendingReview: 3 })]} />,
    );
    expect(() => unmount()).not.toThrow();
  });
});
