import { VIEW_H, VIEW_W } from "./board";
import type { Viewport } from "../store/canvas";

/** board center maps to the 3D world origin. */
const ORIGIN_X = VIEW_W / 2;
const ORIGIN_Z = VIEW_H / 2;

/** 2D board coordinate (x, y) → 3D world XZ plane (Y axis is height). */
export function boardToWorld(x: number, y: number): { x: number; z: number } {
  return { x: x - ORIGIN_X, z: y - ORIGIN_Z };
}

/** 3D world XZ → 2D board coordinate (inverse of boardToWorld). */
export function worldToBoard(x: number, z: number): { x: number; y: number } {
  return { x: x + ORIGIN_X, y: z + ORIGIN_Z };
}

/** 2D viewport center (board coords) → 3D world coords, for switch anchor alignment. */
export function viewportCenterToWorld(viewport: Viewport): { x: number; z: number } {
  const cx = (VIEW_W / 2 - viewport.panX) / viewport.zoom;
  const cy = (VIEW_H / 2 - viewport.panY) / viewport.zoom;
  return boardToWorld(cx, cy);
}

/** 2D zoom → 3D orthographic camera frustum, keeping the visible extent consistent. */
export function zoomToFrustum(zoom: number): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const halfW = VIEW_W / (2 * zoom);
  const halfH = VIEW_H / (2 * zoom);
  return { left: -halfW, right: halfW, top: halfH, bottom: -halfH };
}
