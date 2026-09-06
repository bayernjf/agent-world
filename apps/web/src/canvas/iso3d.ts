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

/**
 * A polyline on the XZ ground plane with precomputed cumulative segment lengths,
 * so a truck can be placed at any travelled distance with a single lookup.
 */
export interface XZPolyline {
  points: { x: number; z: number }[];
  /** cum[i] = distance from the first point to points[i] along the line. */
  cum: number[];
  total: number;
}

/** Build the cumulative-length table for an XZ polyline. */
export function xzPolyline(points: { x: number; z: number }[]): XZPolyline {
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return { points, cum, total: cum[cum.length - 1] ?? 0 };
}

/**
 * Position (and heading) at `dist` along an XZ polyline. Distance is clamped to
 * [0, total]; the heading is the segment's angle around Y (0 = +X, grows toward +Z).
 */
export function xzPolylinePointAt(
  line: XZPolyline,
  dist: number,
): { x: number; z: number; angle: number } {
  if (line.points.length < 2) {
    const p = line.points[0] ?? { x: 0, z: 0 };
    return { x: p.x, z: p.z, angle: 0 };
  }
  const d = Math.max(0, Math.min(dist, line.total));
  let i = 0;
  while (i < line.cum.length - 2 && line.cum[i + 1]! < d) i++;
  const a = line.points[i]!;
  const b = line.points[i + 1]!;
  const segLen = line.cum[i + 1]! - line.cum[i]!;
  const t = segLen > 0 ? (d - line.cum[i]!) / segLen : 0;
  const x = a.x + (b.x - a.x) * t;
  const z = a.z + (b.z - a.z) * t;
  const angle = Math.atan2(b.z - a.z, b.x - a.x);
  return { x, z, angle };
}
