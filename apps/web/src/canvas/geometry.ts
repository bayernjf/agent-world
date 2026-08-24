import type { Graph, GraphEdge, GraphNode } from "@agent-world/core";
import { PLANT_H, PLANT_W } from "../store/graph";

export interface Point {
  x: number;
  y: number;
}

const halfW = PLANT_W / 2;
const halfH = PLANT_H / 2;

/**
 * Forward pipes leave the right face and enter the left face as an orthogonal
 * dogleg. Rework pipes leave the top and arc back over the line, so a backward
 * flow is visually unmistakable rather than a tangled forward pipe.
 */
export function pipePath(graph: Graph, edge: GraphEdge): string | null {
  const from = graph.nodes.find((n) => n.id === edge.from);
  const to = graph.nodes.find((n) => n.id === edge.to);
  if (!from || !to) return null;

  if (edge.kind === "rework") {
    const lift = Math.min(from.y, to.y) - halfH - 58;
    return [
      `M ${from.x} ${from.y - halfH}`,
      `L ${from.x} ${lift + 14}`,
      `Q ${from.x} ${lift} ${from.x - 16} ${lift}`,
      `L ${to.x + 16} ${lift}`,
      `Q ${to.x} ${lift} ${to.x} ${lift + 14}`,
      `L ${to.x} ${to.y - halfH}`,
    ].join(" ");
  }

  const sx = from.x + halfW;
  const tx = to.x - halfW;
  const mid = sx + (tx - sx) / 2;

  if (Math.abs(from.y - to.y) < 2) return `M ${sx} ${from.y} L ${tx} ${to.y}`;

  const r = 12;
  const dir = to.y > from.y ? 1 : -1;
  return [
    `M ${sx} ${from.y}`,
    `L ${mid - r} ${from.y}`,
    `Q ${mid} ${from.y} ${mid} ${from.y + r * dir}`,
    `L ${mid} ${to.y - r * dir}`,
    `Q ${mid} ${to.y} ${mid + r} ${to.y}`,
    `L ${tx} ${to.y}`,
  ].join(" ");
}

export function anchorOf(node: GraphNode, side: "in" | "out"): Point {
  return { x: node.x + (side === "out" ? halfW : -halfW), y: node.y };
}

export function hitTestNode(graph: Graph, p: Point): GraphNode | undefined {
  return [...graph.nodes]
    .reverse()
    .find((n) => Math.abs(p.x - n.x) <= halfW && Math.abs(p.y - n.y) <= halfH);
}
