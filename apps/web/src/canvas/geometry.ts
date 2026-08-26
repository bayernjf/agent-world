import type { Graph, GraphEdge, GraphNode } from "@agent-world/core";
import { PLANT_H, PLANT_W } from "../store/graph";

export interface Point {
  x: number;
  y: number;
}

const halfW = PLANT_W / 2;
const halfH = PLANT_H / 2;
/** Vertical spacing between fan-out/fan-in pins on a node face. */
const PIN_GAP = 14;
/** Two plants count as "same column" when their centers are within this. */
const SAME_COLUMN_TOLERANCE = 4;

/**
 * Distribute the edges entering/leaving a node across its face so parallel
 * pipes don't all overlap at the same anchor. Rework edges always use the top
 * center pin (they arc over the line).
 */
export function edgeAnchors(graph: Graph): Map<string, { from: Point; to: Point }> {
  const out = new Map<string, number>(); // nodeId -> outgoing flow count
  const inn = new Map<string, number>();
  const outIdx = new Map<string, number>();
  const inIdx = new Map<string, number>();

  for (const e of graph.edges) {
    if (e.kind === "rework") continue;
    outIdx.set(e.id, out.get(e.from) ?? 0);
    inIdx.set(e.id, inn.get(e.to) ?? 0);
    out.set(e.from, (out.get(e.from) ?? 0) + 1);
    inn.set(e.to, (inn.get(e.to) ?? 0) + 1);
  }

  const pinY = (node: GraphNode, count: number, i: number) => {
    if (count <= 1) return node.y;
    const span = (count - 1) * PIN_GAP;
    const max = halfH - 10;
    const offset = Math.min(span, max * 2) / 2;
    return node.y - offset + i * PIN_GAP;
  };

  const map = new Map<string, { from: Point; to: Point }>();
  for (const e of graph.edges) {
    const from = graph.nodes.find((n) => n.id === e.from);
    const to = graph.nodes.find((n) => n.id === e.to);
    if (!from || !to) continue;
    if (e.kind === "rework") {
      map.set(e.id, {
        from: { x: from.x, y: from.y - halfH },
        to: { x: to.x, y: to.y - halfH },
      });
    } else if (
      Math.abs(from.x - to.x) < SAME_COLUMN_TOLERANCE &&
      to.y > from.y
    ) {
      // Vertical stack: draw straight down the center from bottom to top.
      map.set(e.id, {
        from: { x: from.x, y: from.y + halfH },
        to: { x: to.x, y: to.y - halfH },
      });
    } else {
      map.set(e.id, {
        from: { x: from.x + halfW, y: pinY(from, out.get(e.from) ?? 1, outIdx.get(e.id) ?? 0) },
        to: { x: to.x - halfW, y: pinY(to, inn.get(e.to) ?? 1, inIdx.get(e.id) ?? 0) },
      });
    }
  }
  return map;
}

/**
 * Forward pipes leave the right face and enter the left face as an orthogonal
 * dogleg between their (possibly distributed) anchor pins. Rework pipes leave
 * the top and arc back over the line, so a backward flow is visually unmistakable.
 */
export function pipePath(
  from: Point,
  to: Point,
  kind: GraphEdge["kind"],
): string {
  if (kind === "rework") {
    const lift = Math.min(from.y, to.y) - halfH - 58;
    return [
      `M ${from.x} ${from.y}`,
      `L ${from.x} ${lift + 14}`,
      `Q ${from.x} ${lift} ${from.x - 16} ${lift}`,
      `L ${to.x + 16} ${lift}`,
      `Q ${to.x} ${lift} ${to.x} ${lift + 14}`,
      `L ${to.x} ${to.y}`,
    ].join(" ");
  }

  const sx = from.x;
  const sy = from.y;
  const tx = to.x;
  const ty = to.y;
  const mid = sx + (tx - sx) / 2;

  // Vertical straight segment (same-column stack).
  if (Math.abs(sx - tx) < SAME_COLUMN_TOLERANCE) {
    return `M ${sx} ${sy} L ${tx} ${ty}`;
  }

  if (Math.abs(sy - ty) < 2) return `M ${sx} ${sy} L ${tx} ${ty}`;

  const r = 12;
  const dir = ty > sy ? 1 : -1;
  return [
    `M ${sx} ${sy}`,
    `L ${mid - r} ${sy}`,
    `Q ${mid} ${sy} ${mid} ${sy + r * dir}`,
    `L ${mid} ${ty - r * dir}`,
    `Q ${mid} ${ty} ${mid + r} ${ty}`,
    `L ${tx} ${ty}`,
  ].join(" ");
}

export function anchorOf(node: GraphNode, side: "in" | "out"): Point {
  return { x: node.x + (side === "out" ? halfW : -halfW), y: node.y };
}

export interface Crossing {
  x: number;
  y: number;
  /** Vertical pipe that arcs over the horizontal one. */
  over: string;
  under: string;
}

export interface Arrow {
  x: number;
  y: number;
  /** 1 = points right, -1 = points left. */
  dir: 1 | -1;
  /** Rotation in degrees (0 = horizontal, 90 = pointing down). */
  angle: number;
}

/**
 * Place one arrow near each end of a forward pipe: one near the source
 * (flow leaves) and one near the target (flow arrives). For doglegs the arrows
 * sit on the first/last horizontal segments, inset from the node face so they
 * don't crowd it. Same-column stacks get arrows just below the source and just
 * above the target. Rework pipes have no arrow (their arc reads as a loop).
 */
const ARROW_INSET = 20;

export function pipeArrows(
  from: Point,
  to: Point,
  kind: GraphEdge["kind"],
): Arrow[] {
  if (kind === "rework") return [];
  const arrows: Arrow[] = [];

  // Same-column vertical pipe.
  if (Math.abs(from.x - to.x) < SAME_COLUMN_TOLERANCE) {
    const span = to.y - from.y;
    const down = span > 0;
    if (Math.abs(span) < 3 * ARROW_INSET + 12) {
      arrows.push({ x: to.x, y: (from.y + to.y) / 2, dir: 1, angle: down ? 90 : -90 });
    } else {
      arrows.push({ x: from.x, y: from.y + (down ? ARROW_INSET : -ARROW_INSET), dir: 1, angle: down ? 90 : -90 });
      arrows.push({ x: to.x, y: (from.y + to.y) / 2, dir: 1, angle: down ? 90 : -90 });
      arrows.push({ x: to.x, y: to.y - (down ? ARROW_INSET : -ARROW_INSET), dir: 1, angle: down ? 90 : -90 });
    }
    return arrows;
  }

  const sx = from.x;
  const sy = from.y;
  const tx = to.x;
  const ty = to.y;
  const mid = sx + (tx - sx) / 2;
  const dir = tx > sx ? 1 : -1;

  // Pure horizontal pipe.
  if (Math.abs(sy - ty) < 2) {
    const len = tx - sx;
    if (Math.abs(len) < 3 * ARROW_INSET + 12) {
      arrows.push({ x: sx + len / 2, y: sy, dir, angle: 0 });
    } else {
      arrows.push({ x: sx + dir * ARROW_INSET, y: sy, dir, angle: 0 });
      arrows.push({ x: sx + len / 2, y: sy, dir, angle: 0 });
      arrows.push({ x: tx - dir * ARROW_INSET, y: sy, dir, angle: 0 });
    }
    return arrows;
  }

  // Dogleg: arrows on the first/last horizontal segments, plus one on the
  // vertical middle segment pointing the way the flow turns.
  const firstLen = mid - sx;
  if (Math.abs(firstLen) >= ARROW_INSET + 8) {
    arrows.push({ x: sx + dir * ARROW_INSET, y: sy, dir, angle: 0 });
  }
  const verticalDown = ty > sy;
  if (Math.abs(ty - sy) >= 3 * ARROW_INSET + 12) {
    arrows.push({ x: mid, y: (sy + ty) / 2, dir: 1, angle: verticalDown ? 90 : -90 });
  }
  const lastLen = tx - mid;
  if (Math.abs(lastLen) >= ARROW_INSET + 8) {
    arrows.push({ x: tx - dir * ARROW_INSET, y: ty, dir, angle: 0 });
  }
  return arrows;
}

/** Backwards-compatible single arrow (the target-side one). */
export function pipeArrow(
  from: Point,
  to: Point,
  kind: GraphEdge["kind"],
): Arrow | null {
  return pipeArrows(from, to, kind).at(-1) ?? null;
}

interface Seg {
  id: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  mid: number;
}

/**
 * Find every point where a pipe's vertical segment crosses another pipe's
 * horizontal segment. The vertical pipe is drawn as the "over" pipe (gets a
 * bridge arc), giving the board an unambiguous circuit-diagram look without a
 * full orthogonal autorouter.
 */
export function pipeCrossings(
  graph: Graph,
  anchors: Map<string, { from: Point; to: Point }>,
): Crossing[] {
  const segs: Seg[] = [];
  for (const e of graph.edges) {
    if (e.kind === "rework") continue;
    const a = anchors.get(e.id);
    if (!a) continue;
    const mid = a.from.x + (a.to.x - a.from.x) / 2;
    segs.push({ id: e.id, sx: a.from.x, sy: a.from.y, tx: a.to.x, ty: a.to.y, mid });
  }

  const out: Crossing[] = [];
  const cross = (v: Seg, h: Seg) => {
    const vY0 = Math.min(v.sy, v.ty);
    const vY1 = Math.max(v.sy, v.ty);
    const hit = (hy: number, hx1: number, hx2: number) => {
      const hX0 = Math.min(hx1, hx2);
      const hX1 = Math.max(hx1, hx2);
      if (v.mid > hX0 && v.mid < hX1 && hy > vY0 && hy < vY1) {
        out.push({ x: v.mid, y: hy, over: v.id, under: h.id });
      }
    };
    hit(h.sy, h.sx, h.mid);
    hit(h.ty, h.mid, h.tx);
  };

  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i];
      const b = segs[j];
      if (a && b) {
        cross(a, b);
        cross(b, a);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orthogonal autorouter (roadmap 3.8 / canvas wiring)
//
// Forward pipes are routed as Manhattan (axis-aligned) polylines that avoid
// other node boxes, replacing the simpler mid-dogleg. Rework pipes still render
// as arcs (pipePath with kind "rework") and crossings still get bridge arcs.
// ---------------------------------------------------------------------------

export interface Rect {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export const ROUTE_PAD = 10;

const ROUTE_OFF = 26;
const INTERSECT_PENALTY = 100000;

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

function segHitsRect(p1: Point, p2: Point, r: Rect): boolean {
  if (p1.x === p2.x && p1.y === p2.y) return false;
  const EPS = 0.5;
  if (p1.y === p2.y) {
    const y = p1.y;
    if (y <= r.y0 + EPS || y >= r.y1 - EPS) return false;
    const xa = Math.min(p1.x, p2.x);
    const xb = Math.max(p1.x, p2.x);
    return xa < r.x1 - EPS && xb > r.x0 + EPS;
  }
  const x = p1.x;
  if (x <= r.x0 + EPS || x >= r.x1 - EPS) return false;
  const ya = Math.min(p1.y, p2.y);
  const yb = Math.max(p1.y, p2.y);
  return ya < r.y1 - EPS && yb > r.y0 + EPS;
}

function routePenalty(pts: Point[], obstacles: Rect[]): number {
  let cost = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (a.x === b.x && a.y === b.y) continue;
    cost += Math.hypot(b.x - a.x, b.y - a.y);
    for (const o of obstacles) {
      if (segHitsRect(a, b, o)) cost += INTERSECT_PENALTY;
    }
  }
  return cost;
}

/**
 * Route a forward pipe from its source face to its target face as an orthogonal
 * polyline, preferring routes that don't pass through other node boxes. A small
 * set of candidate Manhattan routes (mid, near each endpoint, above/below all
 * obstacles, and a step-out detour) is scored by length with a heavy penalty for
 * any segment intersecting an obstacle; the cheapest wins.
 */
export function orthogonalRoute(
  from: Point,
  to: Point,
  obstacles: Rect[],
): Point[] {
  const levels = new Set<number>([
    from.y,
    to.y,
    (from.y + to.y) / 2,
    Math.min(from.y, to.y) - ROUTE_OFF,
    Math.max(from.y, to.y) + ROUTE_OFF,
  ]);
  if (obstacles.length) {
    levels.add(Math.min(...obstacles.map((o) => o.y0)) - ROUTE_OFF);
    levels.add(Math.max(...obstacles.map((o) => o.y1)) + ROUTE_OFF);
  }

  const candidates: Point[][] = [];
  for (const L of levels) {
    candidates.push([
      { x: from.x, y: from.y },
      { x: from.x, y: L },
      { x: to.x, y: L },
      { x: to.x, y: to.y },
    ]);
  }
  const detourL = Math.min(...levels);
  const detourH = Math.max(...levels);
  for (const L of [detourL, detourH]) {
    candidates.push([
      { x: from.x, y: from.y },
      { x: from.x + ROUTE_OFF, y: from.y },
      { x: from.x + ROUTE_OFF, y: L },
      { x: to.x - ROUTE_OFF, y: L },
      { x: to.x - ROUTE_OFF, y: to.y },
      { x: to.x, y: to.y },
    ]);
  }

  let best = candidates[0]!;
  let bestCost = routePenalty(best, obstacles);
  for (const c of candidates) {
    const cost = routePenalty(c, obstacles);
    const cheaper = cost < bestCost - 1e-6;
    const tieStraighter = Math.abs(cost - bestCost) <= 1e-6 && c.length < best.length;
    if (cheaper || tieStraighter) {
      best = c;
      bestCost = cost;
    }
  }
  return dedupe(best);
}

/** Build an SVG path from an orthogonal polyline, rounding corners for a clean
 * circuit-diagram look. */
export function pointsToPath(pts: Point[], r = 10): string {
  const clean = dedupe(pts);
  if (clean.length < 2) return "";
  let d = `M ${clean[0]!.x} ${clean[0]!.y}`;
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1]!;
    const cur = clean[i]!;
    if (i < clean.length - 1) {
      const next = clean[i + 1]!;
      const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
      const rr = Math.min(r, inLen / 2, outLen / 2);
      const ix = prev.x === cur.x ? 0 : cur.x - prev.x > 0 ? 1 : -1;
      const iy = prev.y === cur.y ? 0 : cur.y - prev.y > 0 ? 1 : -1;
      const ox = cur.x === next.x ? 0 : next.x - cur.x > 0 ? 1 : -1;
      const oy = cur.y === next.y ? 0 : next.y - cur.y > 0 ? 1 : -1;
      const p1x = cur.x - ix * rr;
      const p1y = cur.y - iy * rr;
      const p2x = cur.x + ox * rr;
      const p2y = cur.y + oy * rr;
      d += ` L ${p1x} ${p1y} Q ${cur.x} ${cur.y} ${p2x} ${p2y}`;
    } else {
      d += ` L ${cur.x} ${cur.y}`;
    }
  }
  return d;
}

function segArrow(p1: Point, p2: Point, fromStart: boolean): Arrow | null {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const horizontal = dy === 0;
  const len = Math.hypot(dx, dy);
  if (len < ARROW_INSET * 2 + 4) return null;
  const dir = horizontal ? (dx > 0 ? 1 : -1) : 1;
  const angle = horizontal ? 0 : dy > 0 ? 90 : -90;
  const t = fromStart ? ARROW_INSET : len - ARROW_INSET;
  const x = p1.x + (dx / len) * t;
  const y = p1.y + (dy / len) * t;
  return { x, y, dir: horizontal ? dir : 1, angle };
}

/** Arrowheads on the source and target segments of an orthogonal route. */
export function orthoArrows(route: Point[], kind: GraphEdge["kind"]): Arrow[] {
  if (kind === "rework") return [];
  const clean = dedupe(route);
  if (clean.length < 2) return [];
  const arrows: Arrow[] = [];
  const a0 = segArrow(clean[0]!, clean[1]!, true);
  if (a0) arrows.push(a0);
  const aN = segArrow(clean[clean.length - 2]!, clean[clean.length - 1]!, false);
  if (aN) arrows.push(aN);
  return arrows;
}

interface OrthoSeg {
  id: string;
  vertical: boolean;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function toSegments(route: Point[], id: string): OrthoSeg[] {
  const segs: OrthoSeg[] = [];
  const clean = dedupe(route);
  for (let i = 0; i < clean.length - 1; i++) {
    const a = clean[i]!;
    const b = clean[i + 1]!;
    if (a.x === b.x && a.y === b.y) continue;
    segs.push({ id, vertical: a.x === b.x, ax: a.x, ay: a.y, bx: b.x, by: b.y });
  }
  return segs;
}

function crossOrtho(s1: OrthoSeg, s2: OrthoSeg): Point | null {
  if (s1.vertical === s2.vertical) return null;
  const v = s1.vertical ? s1 : s2;
  const h = s1.vertical ? s2 : s1;
  const vy0 = Math.min(v.ay, v.by);
  const vy1 = Math.max(v.ay, v.by);
  const hx0 = Math.min(h.ax, h.bx);
  const hx1 = Math.max(h.ax, h.bx);
  const hy = h.ay;
  if (v.ax > hx0 && v.ax < hx1 && hy > vy0 && hy < vy1) {
    return { x: v.ax, y: hy };
  }
  return null;
}

/** Where orthogonal pipes cross, draw a bridge arc (vertical pipe goes over). */
export function orthoCrossings(
  graph: Graph,
  _anchors: Map<string, { from: Point; to: Point }>,
  routes: Map<string, Point[]>,
): Crossing[] {
  const fwd = graph.edges.filter((e) => e.kind !== "rework" && routes.has(e.id));
  const out: Crossing[] = [];
  for (let i = 0; i < fwd.length; i++) {
    for (let j = i + 1; j < fwd.length; j++) {
      const ra = toSegments(routes.get(fwd[i]!.id)!, fwd[i]!.id);
      const rb = toSegments(routes.get(fwd[j]!.id)!, fwd[j]!.id);
      for (const sa of ra) {
        for (const sb of rb) {
          const p = crossOrtho(sa, sb);
          if (p) {
            out.push({
              x: p.x,
              y: p.y,
              over: sa.vertical ? sa.id : sb.id,
              under: sa.vertical ? sb.id : sa.id,
            });
          }
        }
      }
    }
  }
  return out;
}

export function hitTestNode(graph: Graph, p: Point): GraphNode | undefined {
  return [...graph.nodes]
    .reverse()
    .find((n) => Math.abs(p.x - n.x) <= halfW && Math.abs(p.y - n.y) <= halfH);
}
