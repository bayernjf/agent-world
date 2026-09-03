import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGraph } from "../store/graph";
import { MAX_ZOOM, MIN_ZOOM, useCanvas, type Bounds } from "../store/canvas";
import { PLANT_H, PLANT_W } from "../store/graph";
import { VIEW_H, VIEW_W } from "./board";
import Tooltip from "../components/Tooltip";

/** Minimap square size in stage pixels. */
const MAP = 168;
const PAD = 24;

const KIND_FILL: Record<string, string> = {
  source: "#16242b",
  textGen: "#1c2730",
  gate: "#1d2b22",
  sink: "#16242b",
};

/** Are we grabbing the view rectangle (drag canvas) vs clicking empty space (jump)? */
interface ViewDrag {
  /** client coords at mousedown, to convert pointermove deltas. */
  startClientX: number;
  startClientY: number;
  /** viewport.panX / panY at mousedown (before any drag applied). */
  originPanX: number;
  originPanY: number;
}

/** Convert an SVG <rect> bounding rect + client coord to content (graph) coords. */
function clientToContent(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  scale: number,
  minX: number,
  minY: number,
) {
  return {
    x: (clientX - rect.left) / scale + minX,
    y: (clientY - rect.top) / scale + minY,
  };
}

/**
 * Bird's-eye overview of the board. Plants are drawn at their stored
 * coordinates; the outlined rectangle is the current viewport. Two gestures:
 *   - click anywhere outside the viewport rectangle → centers that point in the canvas
 *   - click-drag on the viewport rectangle → pans the canvas (move the viewport)
 */
export default function Minimap() {
  const { t } = useTranslation();
  const { graph } = useGraph();
  const { viewport, setViewport, zoomTo, fitToBounds } = useCanvas();
  const dragRef = useRef<ViewDrag | null>(null);
  const [dragging, setDragging] = useState(false);

  const xs = graph.nodes.map((n) => n.x);
  const ys = graph.nodes.map((n) => n.y);
  const minX = xs.length ? Math.min(...xs) - PLANT_W / 2 - PAD : 0;
  const maxX = xs.length ? Math.max(...xs) + PLANT_W / 2 + PAD : VIEW_W;
  const minY = ys.length ? Math.min(...ys) - PLANT_H / 2 - PAD : 0;
  const maxY = ys.length ? Math.max(...ys) + PLANT_H / 2 + PAD : VIEW_H;
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const scale = Math.min(MAP / bw, MAP / bh);
  const offX = (MAP - bw * scale) / 2;
  const offY = (MAP - bh * scale) / 2;
  const tx = (x: number) => offX + (x - minX) * scale;
  const ty = (y: number) => offY + (y - minY) * scale;

  // Viewport in board user-space (content coords). The SVG board uses a
  // fixed viewBox of VIEW_W × VIEW_H; letterbox fit only controls where
  // that board sits inside the stage but never changes the viewBox itself.
  // So the visible rectangle in content space is simply the inverted pan/zoom:
  //   rect = (viewBox - pan) / zoom
  const vw = VIEW_W / viewport.zoom;
  const vh = VIEW_H / viewport.zoom;
  const vx = -viewport.panX / viewport.zoom;
  const vy = -viewport.panY / viewport.zoom;

  // Pan delta to content-space delta: dpix (SVG user) = dcontent * zoom.
  // Minimap content delta minimap-pixels / scale → graph units → * zoom → pan delta.
  const contentDeltaFromMinimapDelta = (
    dMinimapX: number,
    dMinimapY: number,
  ) => ({
    dx: -(dMinimapX / scale) * viewport.zoom,
    dy: -(dMinimapY / scale) * viewport.zoom,
  });

  const centerOnContent = useCallback(
    (mx: number, my: number) => {
      setViewport({
        ...viewport,
        panX: VIEW_W / 2 - mx * viewport.zoom,
        panY: VIEW_H / 2 - my * viewport.zoom,
      });
    },
    [viewport, setViewport],
  );

  const fitScreen = () => {
    if (graph.nodes.length === 0) return;
    const xs = graph.nodes.map((n) => n.x);
    const ys = graph.nodes.map((n) => n.y);
    const b: Bounds = {
      minX: Math.min(...xs) - PLANT_W / 2 - PAD,
      maxX: Math.max(...xs) + PLANT_W / 2 + PAD,
      minY: Math.min(...ys) - PLANT_H / 2 - PAD,
      maxY: Math.max(...ys) + PLANT_H / 2 + PAD,
    };
    fitToBounds(b);
  };

  // Global pointer listeners for "drag viewport" mode.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      // Minimap pixel delta → canvas pan delta (negated: viewport right = canvas content shift left).
      const { dx: panDX, dy: panDY } = contentDeltaFromMinimapDelta(dx, dy);
      setViewport({
        ...viewport,
        panX: d.originPanX + panDX,
        panY: d.originPanY + panDY,
      });
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, viewport, setViewport, scale]);

  const onViewPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    e.stopPropagation(); // don't bubble to svg's "jump to" handler
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      originPanX: viewport.panX,
      originPanY: viewport.panY,
    };
    setDragging(true);
  };

  const onBackgroundPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y } = clientToContent(
      e.clientX,
      e.clientY,
      rect,
      scale,
      minX,
      minY,
    );
    centerOnContent(x, y);
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    // (cx, cy): content-space point currently under the minimap cursor.
    // Keep this point pinned under the cursor before/after zoom — same
    // "anchor point" semantics as Canvas.onWheel.
    const { x: cx, y: cy } = clientToContent(
      e.clientX,
      e.clientY,
      rect,
      scale,
      minX,
      minY,
    );
    const factor = Math.exp(-e.deltaY * 0.0015);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor));
    // Current anchor position in the viewBox coordinate space.
    const anchorX = viewport.panX + cx * viewport.zoom;
    const anchorY = viewport.panY + cy * viewport.zoom;
    // Recompute pan so the anchor stays in the same viewBox spot.
    setViewport({
      ...viewport,
      zoom,
      panX: anchorX - cx * zoom,
      panY: anchorY - cy * zoom,
    });
  };

  return (
    <div className="minimap">
      <svg
        width={MAP}
        height={MAP}
        viewBox={`0 0 ${MAP} ${MAP}`}
        onPointerDown={onBackgroundPointerDown}
        onWheel={onWheel}
        style={{ cursor: dragging ? "grabbing" : "pointer" }}
      >
        <rect className="minimap__bg" width={MAP} height={MAP} />
        {graph.edges.map((edge) => {
          const a = graph.nodes.find((n) => n.id === edge.from);
          const b = graph.nodes.find((n) => n.id === edge.to);
          if (!a || !b) return null;
          return (
            <line
              key={edge.id}
              x1={tx(a.x)}
              y1={ty(a.y)}
              x2={tx(b.x)}
              y2={ty(b.y)}
              className={`minimap__edge minimap__edge--${edge.kind}`}
            />
          );
        })}
        {graph.nodes.map((n) => (
          <rect
            key={n.id}
            x={tx(n.x) - (PLANT_W * scale) / 2}
            y={ty(n.y) - (PLANT_H * scale) / 2}
            width={PLANT_W * scale}
            height={PLANT_H * scale}
            rx={2}
            className="minimap__plant"
            style={{ fill: KIND_FILL[n.kind] }}
          />
        ))}
        <rect
          x={tx(vx)}
          y={ty(vy)}
          width={vw * scale}
          height={vh * scale}
          className="minimap__view"
          onPointerDown={onViewPointerDown}
          style={{ cursor: "grab" }}
        />
      </svg>

      <div className="minimap__zoom minimap__zoom--left">
        <Tooltip content={t("canvas:zoomIn")}>
          <button
            className="chip"
            onClick={() => zoomTo(1.2)}
            disabled={viewport.zoom >= MAX_ZOOM}
          >
            +
          </button>
        </Tooltip>
        <span className="muted">{Math.round(viewport.zoom * 100)}%</span>
        <Tooltip content={t("canvas:zoomOut")}>
          <button
            className="chip"
            onClick={() => zoomTo(1 / 1.2)}
            disabled={viewport.zoom <= MIN_ZOOM}
          >
            −
          </button>
        </Tooltip>
      </div>
      <div className="minimap__zoom minimap__zoom--right">
        <Tooltip content={t("canvas:fitView")}>
          <button className="chip" onClick={fitScreen}>
            {t("canvas:fit")}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
