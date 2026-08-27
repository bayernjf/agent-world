import { useCallback, useEffect, useRef, useState } from "react";
import type { Graph, GraphNode } from "@agent-world/core";
import { useGraph } from "../store/graph";
import { useRun, useVisibleRuntime } from "../store/run";
import { MAX_ZOOM, MIN_ZOOM, useCanvas } from "../store/canvas";
import { useToast } from "../store/toast";
import { PLANT_H, PLANT_W, snap } from "../store/graph";
import { VIEW_H, VIEW_W } from "./board";
import PacketLayer from "./PacketLayer";
import Pipes from "./Pipes";
import Plants from "./Plants";

const flashDeleted = (message: string) =>
  useToast.getState().show(message, () => useGraph.getState().undo());

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
  const {
    graph,
    selectedId,
    selectedNodeIds,
    selectedEdgeIds,
    select,
    toggleNode,
    toggleEdge,
    selectNone,
    selectAllNodes,
    moveNode,
    moveNodes,
    addEdge,
    removeEdge,
    removeNode,
    deleteSelected,
    beginHistoryBatch,
    commitHistoryBatch,
    abortHistoryBatch,
  } = useGraph();
  const duplicateNode = useGraph((s) => s.duplicateNode);
  const runtime = useVisibleRuntime();
  const scrubbing = useRun((s) => s.scrubSeq !== null);
  const { viewport, setViewport, setFit: syncFit, setStageSize, fitToBounds } = useCanvas();
  const showToast = useToast((s) => s.show);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    id: string;
    dx: number;
    dy: number;
    moved: boolean;
    startX: number;
    startY: number;
    startGraph: Graph;
  } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const pipeDownRef = useRef<{ id: string; sx: number; sy: number } | null>(null);
  /** Marquee selection: drag on empty backdrop in select mode to box-select nodes. */
  const marqueeRef = useRef<{ startX: number; startY: number; curX: number; curY: number; active: boolean; shift: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
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

  // First-load auto-fit: when there is no persisted viewport (new user or
  // cleared storage), frame all nodes so the board is not blank. Runs once.
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (didInitialFit.current) return;
    if (graph.nodes.length === 0) return;
    const persisted = typeof localStorage !== "undefined"
      ? localStorage.getItem("agent-world-canvas-viewport")
      : null;
    if (persisted) return; // returning user keeps their saved viewport
    const xs = graph.nodes.map((n) => n.x);
    const ys = graph.nodes.map((n) => n.y);
    fitToBounds({
      minX: Math.min(...xs) - PLANT_W / 2 - 24,
      maxX: Math.max(...xs) + PLANT_W / 2 + 24,
      minY: Math.min(...ys) - PLANT_H / 2 - 24,
      maxY: Math.max(...ys) + PLANT_H / 2 + 24,
    });
    didInitialFit.current = true;
  }, [graph.nodes, fitToBounds]);

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
      if (mod && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        selectAllNodes();
        return;
      }
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
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeIds.length > 0 || selectedEdgeIds.length > 0) {
          e.preventDefault();
          const count = selectedNodeIds.length + selectedEdgeIds.length;
          deleteSelected();
          flashDeleted(`已删除 ${count} 个元素`);
          return;
        }
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
  }, [selectedEdgeId, removeEdge, selectedId, selectedNodeIds, selectedEdgeIds, removeNode, deleteSelected, selectAllNodes, duplicateNode, graph.nodes, fitToBounds, showToast]);

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

    // Selection logic:
    // - Shift+click: toggle this node in/out of the multi-selection
    // - Plain click on an already-selected node: keep selection (drag moves all)
    // - Plain click on an unselected node: single-select it
    if (e.shiftKey) {
      toggleNode(node.id, true);
    } else if (!selectedNodeIds.includes(node.id)) {
      select(node.id);
    }

    dragRef.current = {
      id: node.id,
      dx: cx - node.x,
      dy: cy - node.y,
      moved: false,
      startX: node.x,
      startY: node.y,
      startGraph: graph,
    };
    beginHistoryBatch();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // Marquee selection update
    const mq = marqueeRef.current;
    if (mq) {
      const p = toView(e.clientX, e.clientY);
      mq.curX = p.x;
      mq.curY = p.y;
      if (!mq.active && Math.hypot(p.x - mq.startX, p.y - mq.startY) >= CLICK_SLOP) {
        mq.active = true;
      }
      if (mq.active) {
        const x = Math.min(mq.startX, mq.curX);
        const y = Math.min(mq.startY, mq.curY);
        const w = Math.abs(mq.curX - mq.startX);
        const h = Math.abs(mq.curY - mq.startY);
        setMarquee({ x, y, w, h });
      }
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      const p = toView(e.clientX, e.clientY);
      const nx = (p.x - viewport.panX) / viewport.zoom - drag.dx;
      const ny = (p.y - viewport.panY) / viewport.zoom - drag.dy;
      const node = graph.nodes.find((n) => n.id === drag.id);
      if (!node) return;
      if (!drag.moved && Math.hypot(nx - node.x, ny - node.y) < CLICK_SLOP) return;
      const tx = snap(nx);
      const ty = snap(ny);
      if (node.x === tx && node.y === ty) return;
      drag.moved = true;
      // Multi-select drag: move all selected nodes by the same relative delta.
      if (selectedNodeIds.length > 1) {
        const dx = tx - drag.startX;
        const dy = ty - drag.startY;
        moveNodes(selectedNodeIds, dx, dy);
      } else {
        moveNode(drag.id, tx, ty);
      }
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
    const mq = marqueeRef.current;
    dragRef.current = null;
    panRef.current = null;
    pipeDownRef.current = null;
    marqueeRef.current = null;

    // Marquee selection complete
    if (mq) {
      setMarquee(null);
      if (mq.active) {
        const x1 = Math.min(mq.startX, mq.curX);
        const y1 = Math.min(mq.startY, mq.curY);
        const x2 = Math.max(mq.startX, mq.curX);
        const y2 = Math.max(mq.startY, mq.curY);
        const inside = graph.nodes.filter(
          (n) => n.x >= x1 && n.x <= x2 && n.y >= y1 && n.y <= y2,
        ).map((n) => n.id);
        if (mq.shift) {
          // Shift+marquee: toggle the boxed nodes in/out of current selection
          const current = new Set(selectedNodeIds);
          for (const id of inside) {
            if (current.has(id)) current.delete(id);
            else current.add(id);
          }
          const next = [...current];
          useGraph.setState({ selectedId: next[0] ?? null, selectedNodeIds: next, selectedEdgeIds: [] });
        } else if (inside.length > 0) {
          useGraph.setState({ selectedId: inside[0]!, selectedNodeIds: inside, selectedEdgeIds: [] });
        } else {
          selectNone();
        }
      } else {
        // A plain click on empty backdrop clears selection.
        selectNone();
        setConnectFrom(null);
      }
      return;
    }

    if (drag) {
      if (drag.moved) {
        commitHistoryBatch();
      } else {
        abortHistoryBatch();
        // Selection was already handled in onPlantPointerDown (select/toggleNode).
        setSelectedEdgeId(null);
      }
    }
    if (pd) {
      // Edge selection was handled in onPipePointerDown.
      // A drag on a pipe pans the canvas; a click just selects.
      if (pan?.moved) {
        // was a pan drag, selection already set on pointerdown
      }
    } else if (pan && !pan.moved) {
      // A plain click on empty backdrop clears selection / connection.
      selectNone();
      setConnectFrom(null);
    }
  };

  const onBackdropPointerDown = (e: React.PointerEvent) => {
    // Middle mouse or space always pans the canvas.
    if (e.button === 1 || spaceRef.current) {
      if (e.button === 1) e.preventDefault();
      beginPan(e.clientX, e.clientY);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    // In select mode, left-drag on empty backdrop starts a marquee selection.
    if (mode === "select") {
      const p = toView(e.clientX, e.clientY);
      marqueeRef.current = {
        startX: p.x,
        startY: p.y,
        curX: p.x,
        curY: p.y,
        active: false,
        shift: e.shiftKey,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    // Other modes: click clears selection.
    selectNone();
    setConnectFrom(null);
  };

  const onPipePointerDown = (edgeId: string, e: React.PointerEvent<SVGPathElement>) => {
    if (e.button === 1 || spaceRef.current || mode === "select") {
      if (e.button === 1) e.preventDefault();
      // Handle edge selection on pointerdown (same pattern as nodes).
      if (mode === "select" && !spaceRef.current && e.button === 0) {
        if (e.shiftKey) {
          toggleEdge(edgeId, true);
        } else {
          toggleEdge(edgeId, false);
        }
      }
      beginPan(e.clientX, e.clientY);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      pipeDownRef.current = { id: edgeId, sx: e.clientX, sy: e.clientY };
    } else {
      selectNone();
      setConnectFrom(null);
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
        onPointerCancel={onPointerUp}
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
              flashDeleted("管道已拆除");
            }}
            interactive={mode === "delete"}
            hoverable={mode === "select" || mode === "delete"}
            selectedEdgeIds={selectedEdgeIds}
            onHitPointerDown={onPipePointerDown}
          />
          <Plants
            graph={graph}
            runtime={runtime}
            selectedNodeIds={selectedNodeIds}
            connectFrom={connectFrom}
            onPointerDown={onPlantPointerDown}
          />
          {marquee && (
            <rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              className="marquee"
              fill="rgba(100, 180, 255, 0.12)"
              stroke="rgba(100, 180, 255, 0.8)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              pointerEvents="none"
            />
          )}
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
