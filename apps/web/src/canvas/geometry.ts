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
 * Place a flow arrow near the end of a forward pipe: on the last horizontal
 * segment for doglegs, or pointing down the center for same-column stacks.
 * Rework pipes have no arrow (their arc already reads as a backward loop).
 */
export function pipeArrow(
  from: Point,
  to: Point,
  kind: GraphEdge["kind"],
): Arrow | null {
  if (kind === "rework") return null;
  // Same-column vertical pipe: arrow just above the target, pointing down.
  if (Math.abs(from.x - to.x) < SAME_COLUMN_TOLERANCE) {
    return { x: to.x, y: to.y - 14, dir: 1, angle: 90 };
  }
  const mid = from.x + (to.x - from.x) / 2;
  // Last horizontal segment runs from mid to to.x at y=to.y.
  const lastLen = to.x - mid;
  if (Math.abs(lastLen) < 1) return null;
  const dir = lastLen > 0 ? 1 : -1;
  const t = 0.5;
  return { x: mid + lastLen * t, y: to.y, dir, angle: 0 };
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

export function hitTestNode(graph: Graph, p: Point): GraphNode | undefined {
  return [...graph.nodes]
    .reverse()
    .find((n) => Math.abs(p.x - n.x) <= halfW && Math.abs(p.y - n.y) <= halfH);
}
