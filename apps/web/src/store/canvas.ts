import { create } from "zustand";
import { VIEW_H, VIEW_W } from "../canvas/board";

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3;

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface CanvasState {
  viewport: Viewport;
  /** Letterboxed board placement inside the stage, measured by Canvas. */
  fit: { scale: number; x: number; y: number };
  /** Stage (the visible canvas area) size in CSS pixels. */
  stageSize: { width: number; height: number };
  setViewport: (v: Viewport) => void;
  setFit: (f: { scale: number; x: number; y: number }) => void;
  setStageSize: (s: { width: number; height: number }) => void;
  panBy: (dx: number, dy: number) => void;
  zoomTo: (factor: number) => void;
  /** Center the view on a board (user-space) coordinate. */
  centerOn: (x: number, y: number) => void;
  /** Zoom and pan so all given nodes fit the visible board. */
  fitToBounds: (b: Bounds) => void;
  reset: () => void;
}

/** Compute the viewport that frames a bounding box in the fixed 1440×640 board. */
function framing(b: Bounds): Viewport {
  const bw = Math.max(b.maxX - b.minX, 1);
  const bh = Math.max(b.maxY - b.minY, 1);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(VIEW_W / bw, VIEW_H / bh)));
  return {
    zoom,
    panX: (VIEW_W - bw * zoom) / 2 - b.minX * zoom,
    panY: (VIEW_H - bh * zoom) / 2 - b.minY * zoom,
  };
}

export const useCanvas = create<CanvasState>((set, get) => ({
  viewport: DEFAULT_VIEWPORT,
  fit: { scale: 1, x: 0, y: 0 },
  stageSize: { width: 0, height: 0 },
  setViewport: (v) => set({ viewport: v }),
  setFit: (f) => set({ fit: f }),
  setStageSize: (s) => set({ stageSize: s }),
  panBy: (dx, dy) =>
    set((s) => ({ viewport: { ...s.viewport, panX: s.viewport.panX + dx, panY: s.viewport.panY + dy } })),
  zoomTo: (factor) =>
    set((s) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s.viewport.zoom * factor));
      return { viewport: { ...s.viewport, zoom } };
    }),
  centerOn: (x, y) =>
    set((s) => ({
      viewport: {
        ...s.viewport,
        panX: s.stageSize.width / 2 - x * s.viewport.zoom,
        panY: s.stageSize.height / 2 - y * s.viewport.zoom,
      },
    })),
  fitToBounds: (b) => set({ viewport: framing(b) }),
  reset: () => set({ viewport: DEFAULT_VIEWPORT }),
}));
