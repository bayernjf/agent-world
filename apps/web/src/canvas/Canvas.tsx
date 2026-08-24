import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphNode } from "@agent-world/core";
import { useGraph } from "../store/graph";
import { useRun, useVisibleRuntime } from "../store/run";
import { VIEW_H, VIEW_W } from "./board";
import PacketLayer from "./PacketLayer";
import Pipes from "./Pipes";
import Plants from "./Plants";

export type Mode = "select" | "connect" | "rework" | "delete";

/** Below the drag threshold a pointer gesture counts as a click, not a move. */
const CLICK_SLOP = 5;

/**
 * The board keeps a fixed aspect ratio, so the rendered SVG is letterboxed inside the
 * stage. The truck canvas draws in the same user units and has to be placed on the
 * exact same box, otherwise freight drifts off its pipes.
 */
function fitOf(r: { width: number; height: number }) {
  const scale = Math.min(r.width / VIEW_W, r.height / VIEW_H);
  return {
    scale,
    x: (r.width - VIEW_W * scale) / 2,
    y: (r.height - VIEW_H * scale) / 2,
  };
}

interface Props {
  mode: Mode;
}

export default function Canvas({ mode }: Props) {
  const { graph, selectedId, select, moveNode, addEdge, removeEdge, removeNode } = useGraph();
  const runtime = useVisibleRuntime();
  const scrubbing = useRun((s) => s.scrubSeq !== null);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);

  const reworkEdges = new Set(
    graph.edges.filter((e) => e.kind === "rework").map((e) => e.id),
  );

  const [fit, setFit] = useState({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => setFit(fitOf(svg.getBoundingClientRect()));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  const toView = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    const f = fitOf(r);
    return {
      x: (clientX - r.left - f.x) / f.scale,
      y: (clientY - r.top - f.y) / f.scale,
    };
  }, []);

  const onPlantPointerDown = (node: GraphNode, e: React.PointerEvent) => {
    e.stopPropagation();

    if (mode === "delete") {
      removeNode(node.id);
      return;
    }

    if (mode === "connect" || mode === "rework") {
      if (!connectFrom) {
        setConnectFrom(node.id);
      } else {
        addEdge(connectFrom, node.id, mode === "rework" ? "rework" : "flow");
        setConnectFrom(null);
      }
      return;
    }

    const p = toView(e.clientX, e.clientY);
    dragRef.current = { id: node.id, dx: p.x - node.x, dy: p.y - node.y, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toView(e.clientX, e.clientY);
    const nx = p.x - drag.dx;
    const ny = p.y - drag.dy;
    const node = graph.nodes.find((n) => n.id === drag.id);
    if (!node) return;
    if (!drag.moved && Math.hypot(nx - node.x, ny - node.y) < CLICK_SLOP) return;
    drag.moved = true;
    moveNode(drag.id, Math.round(nx), Math.round(ny));
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved) select(drag.id);
  };

  return (
    <div className="canvas">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className={`canvas__svg mode-${mode}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <defs>
          <pattern id="grid" width={40} height={40} patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" className="grid__line" />
          </pattern>
        </defs>
        {/* Clearing lives on the backdrop, not the svg: an svg-level handler would
            also catch the click that just picked a plant and cancel the connection. */}
        <rect
          width={VIEW_W}
          height={VIEW_H}
          fill="url(#grid)"
          onClick={() => {
            select(null);
            setConnectFrom(null);
          }}
        />

        <Pipes
          graph={graph}
          runtime={runtime}
          onRemove={removeEdge}
          interactive={mode === "delete"}
        />
        <Plants
          graph={graph}
          runtime={runtime}
          selectedId={selectedId}
          connectFrom={connectFrom}
          onPointerDown={onPlantPointerDown}
        />
      </svg>

      <PacketLayer
        packets={runtime.packets}
        runId={runtime.runId}
        fit={fit}
        reworkEdges={reworkEdges}
        frozen={scrubbing}
      />
    </div>
  );
}
