import { useGraph } from "../store/graph";
import { MAX_ZOOM, MIN_ZOOM, useCanvas, type Bounds } from "../store/canvas";
import { PLANT_H, PLANT_W } from "../store/graph";
import { VIEW_H, VIEW_W } from "./board";

/** Minimap square size in stage pixels. */
const MAP = 168;
const PAD = 24;

const KIND_FILL: Record<string, string> = {
  source: "#16242b",
  agent: "#1c2730",
  gate: "#1d2b22",
  sink: "#16242b",
};

/**
 * Bird's-eye overview of the board. Plants are drawn at their stored
 * coordinates; the outlined rectangle is the current viewport. Clicking or
 * dragging centers the targeted board point in the viewport.
 */
export default function Minimap() {
  const { graph } = useGraph();
  const { viewport, fit, stageSize, setViewport, zoomTo, fitToBounds } = useCanvas();

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

  // Viewport in board user-space, accounting for letterbox fit + pan/zoom.
  const fitScale = fit.scale || 1;
  const vw = stageSize.width ? stageSize.width / fitScale / viewport.zoom : VIEW_W;
  const vh = stageSize.height ? stageSize.height / fitScale / viewport.zoom : VIEW_H;
  const vx = -viewport.panX / viewport.zoom;
  const vy = -viewport.panY / viewport.zoom;

  const centerOnClient = (clientX: number, clientY: number, rect: DOMRect) => {
    const mx = (clientX - rect.left) / scale + minX;
    const my = (clientY - rect.top) / scale + minY;
    // Pan is in SVG user units (the SVG maps stage px → user units via fitScale).
    const panX = stageSize.width / 2 / fitScale - mx * viewport.zoom;
    const panY = stageSize.height / 2 / fitScale - my * viewport.zoom;
    setViewport({ ...viewport, panX, panY });
  };

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

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    centerOnClient(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.buttons !== 1) return;
    centerOnClient(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  };

  return (
    <div className="minimap">
      <svg
        width={MAP}
        height={MAP}
        viewBox={`0 0 ${MAP} ${MAP}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
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
        {stageSize.width > 0 && (
          <rect
            x={tx(vx)}
            y={ty(vy)}
            width={vw * scale}
            height={vh * scale}
            className="minimap__view"
          />
        )}
      </svg>

      <div className="minimap__zoom minimap__zoom--left">
        <button className="chip" onClick={() => zoomTo(1.2)} title="放大" disabled={viewport.zoom >= MAX_ZOOM}>+</button>
        <span className="muted">{Math.round(viewport.zoom * 100)}%</span>
        <button className="chip" onClick={() => zoomTo(1 / 1.2)} title="缩小" disabled={viewport.zoom <= MIN_ZOOM}>−</button>
      </div>
      <div className="minimap__zoom minimap__zoom--right">
        <button className="chip" onClick={fitScreen} title="适应屏幕">适应</button>
      </div>
    </div>
  );
}
