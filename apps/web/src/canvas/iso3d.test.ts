import { describe, expect, it } from "vitest";
import { boardToWorld, viewportCenterToWorld, worldToBoard, zoomToFrustum } from "./iso3d";
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
