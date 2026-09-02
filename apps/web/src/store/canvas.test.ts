import { describe, it, expect, beforeEach } from "vitest";
import { useCanvas, MIN_ZOOM, MAX_ZOOM, DEFAULT_VIEWPORT } from "./canvas";
import type { Viewport, Bounds } from "./canvas";

describe("canvas store", () => {
  beforeEach(() => {
    useCanvas.setState({
      viewport: { ...DEFAULT_VIEWPORT },
      stageSize: { width: 1440, height: 640 },
    });
  });

  it("has the expected default viewport", () => {
    expect(DEFAULT_VIEWPORT).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(MIN_ZOOM).toBe(0.3);
    expect(MAX_ZOOM).toBe(3);
  });

  it("panBy shifts the viewport by the given delta", () => {
    useCanvas.getState().panBy(100, -50);
    const vp = useCanvas.getState().viewport;
    expect(vp.panX).toBe(100);
    expect(vp.panY).toBe(-50);
    expect(vp.zoom).toBe(1);
  });

  it("panBy accumulates across multiple calls", () => {
    useCanvas.getState().panBy(10, 20);
    useCanvas.getState().panBy(30, -10);
    const vp = useCanvas.getState().viewport;
    expect(vp.panX).toBe(40);
    expect(vp.panY).toBe(10);
  });

  it("zoomTo multiplies the current zoom level", () => {
    useCanvas.getState().zoomTo(2);
    expect(useCanvas.getState().viewport.zoom).toBe(2);
  });

  it("zoomTo clamps to MAX_ZOOM", () => {
    useCanvas.getState().zoomTo(10);
    expect(useCanvas.getState().viewport.zoom).toBe(MAX_ZOOM);
  });

  it("zoomTo clamps to MIN_ZOOM", () => {
    useCanvas.getState().zoomTo(0.01);
    expect(useCanvas.getState().viewport.zoom).toBe(MIN_ZOOM);
  });

  it("zoomTo preserves pan coordinates", () => {
    useCanvas.setState({ viewport: { zoom: 1, panX: 50, panY: 75 } });
    useCanvas.getState().zoomTo(2);
    const vp = useCanvas.getState().viewport;
    expect(vp.zoom).toBe(2);
    expect(vp.panX).toBe(50);
    expect(vp.panY).toBe(75);
  });

  it("centerOn places the given board coordinate at the stage center", () => {
    useCanvas.setState({
      viewport: { zoom: 2, panX: 0, panY: 0 },
      stageSize: { width: 1000, height: 800 },
    });
    useCanvas.getState().centerOn(100, 200);
    const vp = useCanvas.getState().viewport;
    // stage center (500, 400) minus board coord * zoom (200, 400)
    expect(vp.panX).toBe(300);
    expect(vp.panY).toBe(0);
    expect(vp.zoom).toBe(2);
  });

  it("fitToBounds frames a small bounding box at zoom 1 (clamped by MAX_ZOOM)", () => {
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    useCanvas.getState().fitToBounds(bounds);
    const vp = useCanvas.getState().viewport;
    // 1440/100 = 14.4, 640/100 = 6.4 -> min = 6.4 -> clamped to MAX_ZOOM 3
    expect(vp.zoom).toBe(MAX_ZOOM);
    // centered: (1440 - 100*3)/2 - 0*3 = 570
    expect(vp.panX).toBe(570);
    // (640 - 100*3)/2 - 0*3 = 170
    expect(vp.panY).toBe(170);
  });

  it("fitToBounds frames a large bounding box with reduced zoom", () => {
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 1000 };
    useCanvas.getState().fitToBounds(bounds);
    const vp = useCanvas.getState().viewport;
    // 1440/2000 = 0.72, 640/1000 = 0.64 -> min = 0.64 (above MIN_ZOOM 0.3)
    expect(vp.zoom).toBeCloseTo(0.64, 5);
    // centered horizontally: (1440 - 2000*0.64)/2 = 80
    expect(vp.panX).toBeCloseTo(80, 5);
    // centered vertically: (640 - 1000*0.64)/2 = 0
    expect(vp.panY).toBeCloseTo(0, 5);
  });

  it("fitToBounds handles non-zero min coordinates", () => {
    const bounds: Bounds = { minX: 500, minY: 300, maxX: 700, maxY: 500 };
    useCanvas.getState().fitToBounds(bounds);
    const vp = useCanvas.getState().viewport;
    // bw=200, bh=200 -> zoom = min(7.2, 3.2) = 3.2 (above MAX_ZOOM 3)
    expect(vp.zoom).toBe(MAX_ZOOM);
    // (1440 - 200*3)/2 - 500*3 = 420 - 1500 = -1080
    expect(vp.panX).toBe(-1080);
    // (640 - 200*3)/2 - 300*3 = 20 - 900 = -880
    expect(vp.panY).toBe(-880);
  });

  it("setViewport replaces the entire viewport", () => {
    const newVp: Viewport = { zoom: 1.5, panX: -100, panY: 200 };
    useCanvas.getState().setViewport(newVp);
    expect(useCanvas.getState().viewport).toEqual(newVp);
  });
});
