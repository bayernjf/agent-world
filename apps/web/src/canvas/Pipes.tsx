import { useMemo, useState } from "react";
import type { Graph, RuntimeState } from "@agent-world/core";
import { PLANT_W, PLANT_H } from "../store/graph";
import {
  edgeAnchors,
  pipePath,
  orthogonalRoute,
  pointsToPath,
  orthoArrows,
  orthoCrossings,
  ROUTE_PAD,
  type Crossing,
  type Point,
  type Rect,
} from "./geometry";
import { registerPath } from "./pathRegistry";

interface Props {
  graph: Graph;
  runtime: RuntimeState;
  onRemove: (edgeId: string) => void;
  interactive: boolean;
  hoverable: boolean;
  selectedEdgeIds: string[];
  onHitPointerDown?: (edgeId: string, event: React.PointerEvent<SVGPathElement>) => void;
}

function flowEdgeIds(graph: Graph, edgeId: string): Set<string> {
  const edge = graph.edges.find((item) => item.id === edgeId);
  if (!edge) return new Set();

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const item of graph.edges) {
    outgoing.set(item.from, [...(outgoing.get(item.from) ?? []), item.to]);
    incoming.set(item.to, [...(incoming.get(item.to) ?? []), item.from]);
  }

  const walk = (start: string, adjacency: Map<string, string[]>) => {
    const visited = new Set<string>([start]);
    const stack = [start];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    return visited;
  };

  const active = new Set([...walk(edge.from, incoming), ...walk(edge.to, outgoing)]);
  return new Set(
    graph.edges
      .filter((item) => active.has(item.from) && active.has(item.to))
      .map((item) => item.id),
  );
}

const BRIDGE_R = 6;

export default function Pipes({
  graph,
  runtime,
  onRemove,
  interactive,
  hoverable,
  selectedEdgeIds,
  onHitPointerDown,
}: Props) {
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const anchors = useMemo(() => edgeAnchors(graph), [graph]);
  const obstacles = useMemo<Rect[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        x0: n.x - PLANT_W / 2 - ROUTE_PAD,
        y0: n.y - PLANT_H / 2 - ROUTE_PAD,
        x1: n.x + PLANT_W / 2 + ROUTE_PAD,
        y1: n.y + PLANT_H / 2 + ROUTE_PAD,
      })),
    [graph],
  );
  const routes = useMemo(() => {
    const map = new Map<string, Point[]>();
    for (const e of graph.edges) {
      if (e.kind === "rework") continue;
      const a = anchors.get(e.id);
      if (!a) continue;
      const obs = obstacles.filter((o) => o.id !== e.from && o.id !== e.to);
      map.set(e.id, orthogonalRoute(a.from, a.to, obs));
    }
    return map;
  }, [graph, anchors, obstacles]);
  const crossings = useMemo(
    () => orthoCrossings(graph, anchors, routes),
    [graph, anchors, routes],
  );
  const focusEdgeId = hoveredEdge ?? selectedEdgeIds[0] ?? null;
  const hotEdges = useMemo(
    () => (focusEdgeId ? flowEdgeIds(graph, focusEdgeId) : null),
    [graph, focusEdgeId],
  );

  const energised = (edgeId: string, fromId: string) => {
    if (runtime.status !== "running") return false;
    const upstream = runtime.nodes[fromId];
    return upstream?.status === "running" || upstream?.status === "done";
  };

  return (
    <g className="pipes">
      {graph.edges.map((edge) => {
        const anchor = anchors.get(edge.id);
        if (!anchor) return null;

        const rework = edge.kind === "rework";
        const route = rework ? null : routes.get(edge.id);
        const d = rework
          ? pipePath(anchor.from, anchor.to, edge.kind)
          : pointsToPath(route ?? [anchor.from, anchor.to]);
        if (!d) return null;

        const hot = hotEdges?.has(edge.id) ?? false;
        const dim = hotEdges !== null && !hot;
        const focus = edge.id === focusEdgeId;
        const live = energised(edge.id, edge.from);
        const arrows = rework ? [] : orthoArrows(route ?? [anchor.from, anchor.to], edge.kind);

        return (
          <g
            key={edge.id}
            className={`pipe ${rework ? "pipe--rework" : ""} ${hot ? "pipe--hot" : ""} ${focus ? "pipe--focus" : ""} ${dim ? "pipe--dim" : ""}`}
          >
            <path d={d} className="pipe__casing" />
            <path
              ref={(el) => registerPath(edge.id, el)}
              d={d}
              className={`pipe__core ${live ? "is-live" : ""}`}
            />
            {arrows.map((arrow, i) => (
              <g
                key={i}
                className={`pipe-arrow ${hot ? "pipe-arrow--hot" : ""} ${focus ? "pipe-arrow--focus" : ""} ${dim ? "pipe-arrow--dim" : ""}`}
                transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle}) scale(${arrow.dir} 1)`}
              >
                <path className="pipe-arrow__shape" d="M -5 -5 L 5 0 L -5 5 Z" />
              </g>
            ))}
            {(interactive || hoverable) && (
              <path
                d={d}
                className="pipe__hit"
                onPointerEnter={() => setHoveredEdge(edge.id)}
                onPointerLeave={() =>
                  setHoveredEdge((current) => (current === edge.id ? null : current))
                }
                onPointerDown={(event) => {
                  onHitPointerDown?.(edge.id, event);
                }}
                onClick={(e) => {
                  if (!interactive) return;
                  e.stopPropagation();
                  onRemove(edge.id);
                }}
              />
            )}
          </g>
        );
      })}

      {crossings.map((c: Crossing) => {
        const edge = graph.edges.find((e) => e.id === c.over);
        const hot = hotEdges?.has(c.over) ?? false;
        const focus = focusEdgeId === c.over;
        const dim = hotEdges !== null && !hot;
        const live = edge ? energised(edge.id, edge.from) : false;
        const mask = `M ${c.x - BRIDGE_R - 1} ${c.y} L ${c.x + BRIDGE_R + 1} ${c.y}`;
        const arc = `M ${c.x - BRIDGE_R} ${c.y} A ${BRIDGE_R} ${BRIDGE_R} 0 0 0 ${c.x + BRIDGE_R} ${c.y}`;
        return (
          <g
            key={`${c.over}-${c.under}-${c.x}-${c.y}`}
            className={`pipe-bridge ${hot ? "pipe-bridge--hot" : ""} ${focus ? "pipe-bridge--focus" : ""} ${dim ? "pipe-bridge--dim" : ""}`}
          >
            <path d={mask} className="pipe-bridge__mask" />
            <path d={arc} className="pipe-bridge__casing" />
            <path d={arc} className={`pipe-bridge__core ${live ? "is-live" : ""}`} />
          </g>
        );
      })}
    </g>
  );
}
