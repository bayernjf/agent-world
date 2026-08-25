import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphNode } from "@agent-world/core";
import { useGraph } from "../store/graph";
import { useRun, useVisibleRuntime } from "../store/run";
import { MAX_ZOOM, MIN_ZOOM, useCanvas } from "../store/canvas";
import { useToast } from "../store/toast";
import { PLANT_H, PLANT_W } from "../store/graph";
import { VIEW_H, VIEW_W } from "./board";
import PacketLayer from "./PacketLayer";
import Pipes from "./Pipes";
import Plants from "./Plants";

const undoGraph = () => useGraph.temporal.getState().undo();
const flashDeleted = (message: string) =>
  useToast.getState().show(message, undoGraph);

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
  const duplicateNode = useGraph((s) => s.duplicateNode);
  const runtime = useVisibleRuntime();
  const scrubbing = useRun((s) => s.scrubSeq !== null);
  const { viewport, setViewport, setFit: syncFit, setStageSize, reset, fitToBounds } = useCanvas();
  const showToast = useToast((s) => s.show);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const pipeDownRef = useRef<{ id: string; sx: number; sy: number } | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const copyRef = useRef<{ id: string; n: number } | null>(null);
  /** Spacebar held — forces canvas pan on drag (Figma-style) in any tool mode. */
  const spaceRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const reworkEdges = new Set(
    graph.edges.filter((e) => e.kind === "rework").map((e) => e.id),
  );

  const [fit, setFitState] = useState({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const r = svg.getBoundingClientRect();
      const f = fitOf(r);
      setFitState(f);
      syncFit(f);
      setStageSize({ width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [syncFit, setStageSize]);

  // Reset zoom/pan whenever a new run starts so the board isn't left zoomed in.
  const runIdRef = useRef(runtime.runId);
  useEffect(() => {
    if (runIdRef.current !== runtime.runId) {
      runIdRef.current = runtime.runId;
      reset();
    }
  }, [runtime.runId, reset]);

  const beginPan = (clientX: number, clientY: number) => {
    const p = toView(clientX, clientY);
    panRef.current = {
      startX: p.x,
      startY: p.y,
      originX: viewport.panX,
      originY: viewport.panY,
      moved: false,
    };
  };

  // Spacebar toggles pan mode; arrow keys nudge the canvas. Ignored while
  // typing in a field so text editing keeps working.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) {
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpaceHeld(true);
        }
        e.preventDefault();
        return;
      }
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "c" || e.key === "C") && selectedId) {
        e.preventDefault();
        copyRef.current = { id: selectedId, n: 0 };
        showToast("已复制厂房");
        return;
      }
      if (mod && (e.key === "v" || e.key === "V") && copyRef.current) {
        e.preventDefault();
        const { id, n } = copyRef.current;
        const offset = 30 + n * 10;
        const newId = duplicateNode(id, offset, offset);
        if (newId) {
          copyRef.current = { id, n: n + 1 };
          setSelectedEdgeId(null);
        }
        return;
      }
      if ((e.key === "f" || e.key === "F") && selectedId && !mod) {
        e.preventDefault();
        const node = graph.nodes.find((n) => n.id === selectedId);
        if (node) {
          fitToBounds({
            minX: node.x - PLANT_W / 2 - 40,
            maxX: node.x + PLANT_W / 2 + 40,
            minY: node.y - PLANT_H / 2 - 40,
            maxY: node.y + PLANT_H / 2 + 40,
          });
        }
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedEdgeId
      ) {
        e.preventDefault();
        removeEdge(selectedEdgeId);
        setSelectedEdgeId(null);
        flashDeleted("管道已拆除");
        return;
      }
      const step = e.shiftKey ? 120 : 40;
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = step;
      else if (e.key === "ArrowRight") dx = -step;
      else if (e.key === "ArrowUp") dy = step;
      else if (e.key === "ArrowDown") dy = -step;
      else return;
      e.preventDefault();
      useCanvas.setState((s) => ({
        viewport: { ...s.viewport, panX: s.viewport.panX + dx, panY: s.viewport.panY + dy },
      }));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [selectedEdgeId, removeEdge, selectedId, duplicateNode, graph.nodes, fitToBounds, showToast]);

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

    // Space-drag or middle mouse pans the canvas, even over a plant and
    // regardless of the active tool.
    if (spaceRef.current || e.button === 1) {
      e.preventDefault();
      beginPan(e.clientX, e.clientY);
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      return;
    }

    if (mode === "delete") {
      removeNode(node.id);
      flashDeleted("厂房已拆除");
      return;
    }

    if (mode === "connect" || mode === "rework") {
      if (!connectFrom) {
        setConnectFrom(node.id);
      } else {
        const res = addEdge(connectFrom, node.id, mode === "rework" ? "rework" : "flow");
        if (!res.ok && res.reason) showToast(res.reason);
        setConnectFrom(null);
      }
      return;
    }

    const p = toView(e.clientX, e.clientY);
    // Pointer position in content (graph) space, accounting for pan/zoom.
    const cx = (p.x - viewport.panX) / viewport.zoom;
    const cy = (p.y - viewport.panY) / viewport.zoom;
    dragRef.current = { id: node.id, dx: cx - node.x, dy: cy - node.y, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      const p = toView(e.clientX, e.clientY);
      const nx = (p.x - viewport.panX) / viewport.zoom - drag.dx;
      const ny = (p.y - viewport.panY) / viewport.zoom - drag.dy;
      const node = graph.nodes.find((n) => n.id === drag.id);
      if (!node) return;
      if (!drag.moved && Math.hypot(nx - node.x, ny - node.y) < CLICK_SLOP) return;
      drag.moved = true;
      moveNode(drag.id, Math.round(nx), Math.round(ny));
      return;
    }

    const pan = panRef.current;
    if (pan) {
      const p = toView(e.clientX, e.clientY);
      const dx = p.x - pan.startX;
      const dy = p.y - pan.startY;
      if (!pan.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      pan.moved = true;
      setViewport({ zoom: viewport.zoom, panX: pan.originX + dx, panY: pan.originY + dy });
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    const pan = panRef.current;
    const pd = pipeDownRef.current;
    dragRef.current = null;
    panRef.current = null;
    pipeDownRef.current = null;
    if (drag && !drag.moved) {
      select(drag.id);
      setSelectedEdgeId(null);
    }
    if (pd) {
      // A click (not a drag) on a pipe locks the flow highlight.
      if (!pan?.moved) {
        setSelectedEdgeId(pd.id);
        select(null);
        setConnectFrom(null);
      }
    } else if (pan && !pan.moved) {
      // A plain click on empty backdrop clears selection / connection.
      select(null);
      setConnectFrom(null);
      setSelectedEdgeId(null);
    }
  };

  const onBackdropPointerDown = (e: React.PointerEvent) => {
    // Middle mouse or space always pans; left click only pans in select mode.
    if (e.button === 1 || spaceRef.current || mode === "select") {
      if (e.button === 1) e.preventDefault();
      beginPan(e.clientX, e.clientY);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } else {
      select(null);
      setConnectFrom(null);
      setSelectedEdgeId(null);
    }
  };

  const onPipePointerDown = (edgeId: string, e: React.PointerEvent<SVGPathElement>) => {
    if (e.button === 1 || spaceRef.current || mode === "select") {
      if (e.button === 1) e.preventDefault();
      beginPan(e.clientX, e.clientY);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      pipeDownRef.current = { id: edgeId, sx: e.clientX, sy: e.clientY };
    } else {
      select(null);
      setConnectFrom(null);
      setSelectedEdgeId(null);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const p = toView(e.clientX, e.clientY);
    // Cursor position in content (user) space under current viewport.
    const cx = (p.x - viewport.panX) / viewport.zoom;
    const cy = (p.y - viewport.panY) / viewport.zoom;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor));
    setViewport({ zoom, panX: p.x - cx * zoom, panY: p.y - cy * zoom });
  };

  const transform = `translate(${viewport.panX} ${viewport.panY}) scale(${viewport.zoom})`;

  return (
    <div className="canvas">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className={`canvas__svg mode-${mode} ${spaceHeld ? "is-panning" : ""}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        <defs>
          <pattern id="grid" width={40} height={40} patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" className="grid__line" />
          </pattern>
        </defs>
        {/* Backdrop lives outside the zoom group so it always catches clicks and
            never scales. Panning is a select-mode drag on this surface. */}
        <rect
          width={VIEW_W}
          height={VIEW_H}
          fill="var(--steel-950)"
          className="canvas__backdrop"
          onPointerDown={onBackdropPointerDown}
        />

        <g className="canvas__viewport" transform={transform}>
          <rect
            x={-VIEW_W}
            y={-VIEW_H}
            width={VIEW_W * 3}
            height={VIEW_H * 3}
            fill="url(#grid)"
            className="canvas__pan-surface"
            onPointerDown={onBackdropPointerDown}
          />
          <Pipes
            graph={graph}
            runtime={runtime}
            onRemove={(id) => {
              removeEdge(id);
              setSelectedEdgeId((cur) => (cur === id ? null : cur));
              flashDeleted("管道已拆除");
            }}
            interactive={mode === "delete"}
            hoverable={mode === "select" || mode === "delete"}
            selectedEdgeId={selectedEdgeId}
            onHitPointerDown={onPipePointerDown}
          />
          <Plants
            graph={graph}
            runtime={runtime}
            selectedId={selectedId}
            connectFrom={connectFrom}
            onPointerDown={onPlantPointerDown}
          />
        </g>
      </svg>

      <PacketLayer
        packets={runtime.packets}
        runId={runtime.runId}
        fit={fit}
        viewport={viewport}
        reworkEdges={reworkEdges}
        frozen={scrubbing}
      />

      {graph.nodes.length === 0 && (
        <div className="canvas__empty">
          <p>画布是空的</p>
          <p className="muted">点右上角「+ 厂房」开始搭建你的产线</p>
        </div>
      )}
    </div>
  );
}
