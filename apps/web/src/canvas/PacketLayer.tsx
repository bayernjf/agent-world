import { useEffect, useRef, useState } from "react";
import { ARTIFACT_COLORS, type PacketRuntime } from "@agent-world/core";
import { VIEW_H, VIEW_W } from "./board";
import { pathRegistry } from "./pathRegistry";

/** Pixels per second a truck travels along a pipe. */
const SPEED = 340;

interface Props {
  packets: PacketRuntime[];
  /** Changes per dispatch. Packet seq numbers restart, so the seen-set must too. */
  runId: string | null;
  /** Where the letterboxed board sits inside the stage, and at what zoom. */
  fit: { scale: number; x: number; y: number };
  /** User-controlled pan/zoom applied on top of the letterbox fit. */
  viewport: { zoom: number; panX: number; panY: number };
  /** Ids of rework pipes, so backward freight can be painted with warning stripes. */
  reworkEdges: Set<string>;
  /** Freeze motion while the replay scrubber is being dragged. */
  frozen: boolean;
}

interface Truck {
  key: string;
  edgeId: string;
  rework: boolean;
  color: string;
  /** Timestamp the truck entered the pipe. */
  startedAt: number;
  length: number;
}

/**
 * Trucks live on a canvas overlay driven by a single rAF loop reading refs. Putting
 * them in React state would re-render the tree on every frame and stall once a run
 * has hundreds of packets in flight. The canvas fills the whole stage and applies
 * the same letterbox + pan/zoom transform as the SVG so freight stays on its pipes.
 */
export default function PacketLayer({ packets, runId, fit, viewport, reworkEdges, frozen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trucksRef = useRef<Truck[]>([]);
  const seenRef = useRef(new Set<string>());
  const runRef = useRef(runId);
  const frozenRef = useRef(frozen);
  const viewportRef = useRef(viewport);
  frozenRef.current = frozen;
  viewportRef.current = viewport;

  const [stage, setStage] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const measure = () => {
      const r = parent.getBoundingClientRect();
      setStage({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (runRef.current !== runId) {
      runRef.current = runId;
      seenRef.current = new Set();
      trucksRef.current = [];
    }

    const known = seenRef.current;
    for (const p of packets) {
      const key = `${p.edgeId}:${p.seq}`;
      if (known.has(key)) continue;
      known.add(key);
      const path = pathRegistry.get(p.edgeId);
      if (!path) continue;
      trucksRef.current.push({
        key,
        edgeId: p.edgeId,
        rework: reworkEdges.has(p.edgeId),
        color: p.artifactKind ? ARTIFACT_COLORS[p.artifactKind] : "#ffb020",
        startedAt: performance.now(),
        length: path.getTotalLength(),
      });
    }
  }, [packets, reworkEdges, runId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || stage.w === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = stage.w * dpr;
    canvas.height = stage.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = 0;
    const frame = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, stage.w, stage.h);

      const v = viewportRef.current;
      // Match the SVG: letterbox offset, then user pan/zoom.
      ctx.translate(fit.x, fit.y);
      ctx.scale(fit.scale, fit.scale);
      ctx.translate(v.panX, v.panY);
      ctx.scale(v.zoom, v.zoom);

      const alive: Truck[] = [];
      for (const truck of trucksRef.current) {
        const path = pathRegistry.get(truck.edgeId);
        if (!path) continue;

        const travelled = frozenRef.current
          ? truck.length
          : ((now - truck.startedAt) / 1000) * SPEED;
        if (travelled > truck.length) continue;
        alive.push(truck);

        const at = path.getPointAtLength(travelled);
        const ahead = path.getPointAtLength(Math.min(travelled + 8, truck.length));
        const angle = Math.atan2(ahead.y - at.y, ahead.x - at.x);

        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.rotate(angle);

        const body = truck.rework ? "#ff9d2e" : truck.color;
        ctx.shadowColor = body;
        ctx.shadowBlur = 14 / v.zoom;
        ctx.fillStyle = body;
        const w = 18 / v.zoom;
        const h = 10 / v.zoom;
        ctx.fillRect(-w / 2, -h / 2, w, h);

        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(6,9,11,0.85)";
        ctx.fillRect(-w / 2 + 3, -h / 2 + 2, 5 / v.zoom, 6 / v.zoom);
        if (truck.rework) {
          ctx.fillStyle = "rgba(6,9,11,0.6)";
          for (let i = -w / 2 + 5; i < w / 2; i += 4 / v.zoom) {
            ctx.fillRect(i, -h / 2, 2 / v.zoom, h);
          }
        }
        ctx.restore();
      }
      trucksRef.current = alive;

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [fit, stage]);

  return (
    <canvas
      ref={canvasRef}
      className="packet-layer"
      style={{ width: "100%", height: "100%", left: 0, top: 0 }}
      aria-hidden="true"
    />
  );
}
