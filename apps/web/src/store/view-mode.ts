import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Which rendering view is active: the 2D editor or the 3D display view. */
export type ViewMode = "2d" | "3d";

/** Persisted 3D camera pose, restored when switching back to 3D. */
export interface Camera3D {
  posX: number;
  posY: number;
  posZ: number;
  targetX: number;
  targetZ: number;
}

interface ViewModeState {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggle: () => void;
  camera3d: Camera3D | null;
  setCamera3d: (c: Camera3D) => void;
  /** Live 3D camera zoom (orthographic camera.zoom), synced by Canvas3D for the minimap. */
  camera3dZoom: number;
  setCamera3dZoom: (zoom: number) => void;
  /** Live 3D camera target (XZ), synced each frame by Canvas3D for the minimap. */
  camera3dTarget: { x: number; z: number } | null;
  setCamera3dTarget: (c: { x: number; z: number }) => void;
  /** One-shot "set the 3D zoom" request from the minimap controls, consumed by Canvas3D. */
  camera3dZoomRequest: number | null;
  requestCamera3dZoom: (zoom: number) => void;
  consumeCamera3dZoomRequest: () => number | null;
  /** One-shot "move the 3D camera here" request from the minimap, consumed by Canvas3D. */
  camera3dMoveRequest: { x: number; z: number } | null;
  requestCamera3dMove: (x: number, z: number) => void;
  consumeCamera3dMoveRequest: () => { x: number; z: number } | null;
  /** One-shot "reset the 3D camera" request from the minimap fit button. */
  camera3dResetRequest: boolean;
  requestCamera3dReset: () => void;
  consumeCamera3dResetRequest: () => boolean;
}

export const useViewMode = create<ViewModeState>()(
  persist(
    (set, get) => ({
      viewMode: "2d",
      setViewMode: (mode) => set({ viewMode: mode }),
      toggle: () => set((s) => ({ viewMode: s.viewMode === "2d" ? "3d" : "2d" })),
      camera3d: null,
      setCamera3d: (c) => set({ camera3d: c }),
      camera3dZoom: 1,
      setCamera3dZoom: (zoom) => {
        if (get().camera3dZoom === zoom) return;
        set({ camera3dZoom: zoom });
      },
      camera3dTarget: null,
      setCamera3dTarget: (c) => {
        const cur = get().camera3dTarget;
        if (cur && cur.x === c.x && cur.z === c.z) return;
        set({ camera3dTarget: c });
      },
      camera3dZoomRequest: null,
      requestCamera3dZoom: (zoom) => set({ camera3dZoomRequest: zoom }),
      consumeCamera3dZoomRequest: () => {
        const z = get().camera3dZoomRequest;
        if (z != null) set({ camera3dZoomRequest: null });
        return z;
      },
      camera3dMoveRequest: null,
      requestCamera3dMove: (x, z) => set({ camera3dMoveRequest: { x, z } }),
      consumeCamera3dMoveRequest: () => {
        const m = get().camera3dMoveRequest;
        if (m) set({ camera3dMoveRequest: null });
        return m;
      },
      camera3dResetRequest: false,
      requestCamera3dReset: () => set({ camera3dResetRequest: true }),
      consumeCamera3dResetRequest: () => {
        const r = get().camera3dResetRequest;
        if (r) set({ camera3dResetRequest: false });
        return r;
      },
    }),
    {
      name: "agent-world-view-mode",
      partialize: (state) => ({ viewMode: state.viewMode, camera3d: state.camera3d }),
    }
  )
);
