import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGraph } from "../store/graph";
import { MAX_ZOOM, MIN_ZOOM, useCanvas, type Bounds } from "../store/canvas";
import { PLANT_H, PLANT_W } from "../store/graph";
import { VIEW_H, VIEW_W } from "./board";
import { useViewMode } from "../store/view-mode";
import { boardToWorld, worldToBoard } from "./iso3d";
import Tooltip from "../components/Tooltip";

/** Minimap square size in stage pixels. Matches the zoom control row width (189 + 8 padding + 2 border = 199). */
const MAP = 189;
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
  const viewMode = useViewMode((s) => s.viewMode);
  const camera3dZoom = useViewMode((s) => s.camera3dZoom);
  const camera3dTarget = useViewMode((s) => s.camera3dTarget);
  const requestCamera3dMove = useViewMode((s) => s.requestCamera3dMove);
  const requestCamera3dZoom = useViewMode((s) => s.requestCamera3dZoom);
  const requestCamera3dReset = useViewMode((s) => s.requestCamera3dReset);
  const is3d = viewMode === "3d";
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
  // In 3D the view rect scales with the 3D camera zoom (camera.zoom), stacked
  // on the 2D viewport zoom, just like zooming in 2D.
  const effZoom = is3d ? viewport.zoom * camera3dZoom : viewport.zoom;

  // Viewport in board user-space (content coords). The SVG board uses a
  // fixed viewBox of VIEW_W × VIEW_H; letterbox fit only controls where
  // that board sits inside the stage but never changes the viewBox itself.
  // So the visible rectangle in content space is simply the inverted pan/zoom:
  //   rect = (viewBox - pan) / zoom
  const vw = VIEW_W / effZoom;
  const vh = VIEW_H / effZoom;
  const vx = -viewport.panX / viewport.zoom;
  const vy = -viewport.panY / viewport.zoom;
  // Keep the view rect's true aspect (VIEW_W:VIEW_H = 2.25:1) instead of
  // clamping its size to MAP: clamping made the wider axis stick to the minimap
  // edge with zero pan range, so it could only be dragged vertically. Let it
  // overflow the square minimap and clamp only its leading edge.
  const viewW = vw * scale;
  const viewH = vh * scale;
  // Clamp the view rect's CENTER (not its leading edge) into the minimap. This
  // lets the rect overflow the square minimap symmetrically and stay in sync when
  // panning in any direction — clamping the leading edge to [0, MAP-size] froze
  // the wider axis whenever the viewport was as wide as the whole graph (viewW
  // === MAP after a fit), which read as "can't drag left/right".
  const clampViewCenter = (center: number, size: number) =>
    Math.max(0, Math.min(center, MAP)) - size / 2;
  // Viewport center in content coords: the 3D camera target, or the 2D viewport
  // center (top-left + half extent).
  const viewCenter = is3d && camera3dTarget
    ? worldToBoard(camera3dTarget.x, camera3dTarget.z)
    : { x: vx + vw / 2, y: vy + vh / 2 };

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
    if (is3d) {
      requestCamera3dReset();
      return;
    }
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
      if (is3d) {
        // Dragging the minimap rect pans the 3D view the same way left-dragging
        // the canvas does (OrbitControls PAN): the scene follows the cursor, so
        // the camera target moves opposite the pointer delta.
        requestCamera3dMove(d.originPanX - dx / scale, d.originPanY - dy / scale);
      } else {
        // Minimap pixel delta → canvas pan delta (negated: viewport right = canvas content shift left).
        const { dx: panDX, dy: panDY } = contentDeltaFromMinimapDelta(dx, dy);
        setViewport({
          ...viewport,
          panX: d.originPanX + panDX,
          panY: d.originPanY + panDY,
        });
      }
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
  }, [dragging, viewport, setViewport, scale, is3d, requestCamera3dMove]);

  const onViewPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    e.stopPropagation(); // don't bubble to svg's "jump to" handler
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      // In 3D the drag origin is the camera target; in 2D it's the viewport pan.
      originPanX: is3d && camera3dTarget ? camera3dTarget.x : viewport.panX,
      originPanY: is3d && camera3dTarget ? camera3dTarget.z : viewport.panY,
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
    if (is3d) {
      const w = boardToWorld(x, y);
      requestCamera3dMove(w.x, w.z);
    } else {
      centerOnContent(x, y);
    }
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
    <>
      <div className="minimap">
        <svg
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
          x={clampViewCenter(tx(viewCenter.x), viewW)}
          y={clampViewCenter(ty(viewCenter.y), viewH)}
          width={viewW}
          height={viewH}
          className="minimap__view"
          onPointerDown={onViewPointerDown}
          style={{ cursor: "grab" }}
        />
      </svg>
      </div>

      <div className="minimap__zoom">
        <Tooltip content={t("canvas:zoomOut")}>
          <button
            className="chip minimap__zoom-step"
            onClick={() =>
              is3d
                ? requestCamera3dZoom(Math.max(MIN_ZOOM, camera3dZoom / 1.2))
                : zoomTo(1 / 1.2)
            }
            disabled={is3d ? camera3dZoom <= MIN_ZOOM : viewport.zoom <= MIN_ZOOM}
          >
            −
          </button>
        </Tooltip>
        <input
          className="minimap__slider"
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={is3d ? camera3dZoom : viewport.zoom}
          onChange={(e) =>
            is3d
              ? requestCamera3dZoom(Number(e.target.value))
              : setViewport({ ...viewport, zoom: Number(e.target.value) })
          }
          aria-label={t("canvas:zoom")}
        />
        <Tooltip content={t("canvas:zoomIn")}>
          <button
            className="chip minimap__zoom-step"
            onClick={() =>
              is3d
                ? requestCamera3dZoom(Math.min(MAX_ZOOM, camera3dZoom * 1.2))
                : zoomTo(1.2)
            }
            disabled={is3d ? camera3dZoom >= MAX_ZOOM : viewport.zoom >= MAX_ZOOM}
          >
            +
          </button>
        </Tooltip>
        <span className="muted">{Math.round((is3d ? camera3dZoom : viewport.zoom) * 100)}%</span>
        <span className="minimap__zoom-sep" aria-hidden="true" />
        <Tooltip content={t("canvas:fitView")}>
          <button className="chip" onClick={fitScreen}>
            {t("canvas:fit")}
          </button>
        </Tooltip>
      </div>
    </>
  );
}
