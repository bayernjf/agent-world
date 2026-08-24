import { useEffect, useRef } from "react";
import type { PacketRuntime } from "@agent-world/core";
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
  /** Ids of rework pipes, so backward freight can be painted with warning stripes. */
  reworkEdges: Set<string>;
  /** Freeze motion while the replay scrubber is being dragged. */
  frozen: boolean;
}

interface Truck {
  key: string;
  edgeId: string;
  rework: boolean;
  /** Timestamp the truck entered the pipe. */
  startedAt: number;
  length: number;
}

/**
 * Trucks live on a canvas overlay driven by a single rAF loop reading refs. Putting
 * them in React state would re-render the tree on every frame and stall once a run
 * has hundreds of packets in flight.
 */
export default function PacketLayer({ packets, runId, fit, reworkEdges, frozen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trucksRef = useRef<Truck[]>([]);
  const seenRef = useRef(new Set<string>());
  const runRef = useRef(runId);
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

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
        startedAt: performance.now(),
        length: path.getTotalLength(),
      });
    }
  }, [packets, reworkEdges, runId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = VIEW_W * fit.scale;
    const h = VIEW_H * fit.scale;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr * fit.scale, dpr * fit.scale);

    let raf = 0;
    const frame = (now: number) => {
      ctx.clearRect(0, 0, VIEW_W, VIEW_H);

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

        const body = truck.rework ? "#ff9d2e" : "#ffb020";
        ctx.shadowColor = body;
        ctx.shadowBlur = 14;
        ctx.fillStyle = body;
        ctx.fillRect(-9, -5, 18, 10);

        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(6,9,11,0.85)";
        ctx.fillRect(-6, -3, 5, 6);
        if (truck.rework) {
          ctx.fillStyle = "rgba(6,9,11,0.6)";
          for (let i = -4; i < 8; i += 4) ctx.fillRect(i, -5, 2, 10);
        }
        ctx.restore();
      }
      trucksRef.current = alive;

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [fit]);

  return (
    <canvas
      ref={canvasRef}
      className="packet-layer"
      style={{
        width: VIEW_W * fit.scale,
        height: VIEW_H * fit.scale,
        left: fit.x,
        top: fit.y,
      }}
      aria-hidden="true"
    />
  );
}
