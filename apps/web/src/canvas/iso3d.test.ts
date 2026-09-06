import { describe, expect, it } from "vitest";
import {
  boardToWorld,
  viewportCenterToWorld,
  worldToBoard,
  xzPolyline,
  xzPolylinePointAt,
  zoomToFrustum,
} from "./iso3d";
import { VIEW_H, VIEW_W } from "./board";

describe("iso3d coordinate mapping", () => {
  it("maps board center to world origin", () => {
    expect(boardToWorld(VIEW_W / 2, VIEW_H / 2)).toEqual({ x: 0, z: 0 });
  });

  it("maps board top-left to negative world", () => {
    expect(boardToWorld(0, 0)).toEqual({ x: -VIEW_W / 2, z: -VIEW_H / 2 });
  });

  it("worldToBoard is the inverse of boardToWorld", () => {
    const p = { x: 123, y: 456 };
    const w = boardToWorld(p.x, p.y);
    expect(worldToBoard(w.x, w.z)).toEqual(p);
  });

  it("computes viewport center in world coords", () => {
    expect(viewportCenterToWorld({ zoom: 1, panX: 0, panY: 0 })).toEqual({ x: 0, z: 0 });
    const c = viewportCenterToWorld({ zoom: 2, panX: 100, panY: 50 });
    // board center: ((720-100)/2, (320-50)/2) = (310, 135)
    expect(c).toEqual({ x: 310 - VIEW_W / 2, z: 135 - VIEW_H / 2 });
  });

  it("maps zoom to frustum half-extents", () => {
    expect(zoomToFrustum(1)).toEqual({
      left: -VIEW_W / 2,
      right: VIEW_W / 2,
      top: VIEW_H / 2,
      bottom: -VIEW_H / 2,
    });
    expect(zoomToFrustum(2).right).toBe(VIEW_W / 4);
    expect(zoomToFrustum(2).top).toBe(VIEW_H / 4);
  });
});

describe("iso3d polyline", () => {
  it("accumulates segment lengths", () => {
    // 3-4-5 triangle in the XZ plane.
    const line = xzPolyline([
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 4 },
    ]);
    expect(line.cum).toEqual([0, 3, 7]);
    expect(line.total).toBe(7);
  });

  it("places a point mid-segment with the correct heading", () => {
    const line = xzPolyline([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
    ]);
    // 5 units in: still on the first (horizontal) segment, heading +X.
    expect(xzPolylinePointAt(line, 5)).toEqual({ x: 5, z: 0, angle: 0 });
    // 15 units in: 5 units along the vertical segment, heading +Z.
    const at = xzPolylinePointAt(line, 15);
    expect(at.x).toBe(10);
    expect(at.z).toBeCloseTo(5);
    expect(at.angle).toBeCloseTo(Math.PI / 2);
  });

  it("clamps distance to the polyline bounds", () => {
    const line = xzPolyline([
      { x: 0, z: 0 },
      { x: 0, z: 4 },
    ]);
    expect(xzPolylinePointAt(line, -5)).toEqual({ x: 0, z: 0, angle: Math.PI / 2 });
    expect(xzPolylinePointAt(line, 99)).toEqual({ x: 0, z: 4, angle: Math.PI / 2 });
  });

  it("handles a degenerate single-point polyline", () => {
    const line = xzPolyline([{ x: 2, z: 3 }]);
    expect(line.total).toBe(0);
    expect(xzPolylinePointAt(line, 1)).toEqual({ x: 2, z: 3, angle: 0 });
  });
});
