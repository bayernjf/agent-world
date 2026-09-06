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
  /** Live 3D camera target (XZ), synced each frame by Canvas3D and read by the minimap. */
  camera3dLive: { targetX: number; targetZ: number } | null;
  setCamera3dLive: (c: { targetX: number; targetZ: number }) => void;
  /** One-shot "move the 3D camera here" request from the minimap, consumed by Canvas3D. */
  camera3dRequest: { targetX: number; targetZ: number } | null;
  requestCamera3dMove: (targetX: number, targetZ: number) => void;
  consumeCamera3dRequest: () => { targetX: number; targetZ: number } | null;
}

export const useViewMode = create<ViewModeState>()(
  persist(
    (set, get) => ({
      viewMode: "2d",
      setViewMode: (mode) => set({ viewMode: mode }),
      toggle: () => set((s) => ({ viewMode: s.viewMode === "2d" ? "3d" : "2d" })),
      camera3d: null,
      setCamera3d: (c) => set({ camera3d: c }),
      camera3dLive: null,
      setCamera3dLive: (c) => {
        const cur = get().camera3dLive;
        // Only update when the target actually moved, so the minimap isn't
        // re-rendered every frame while the camera sits still.
        if (cur && cur.targetX === c.targetX && cur.targetZ === c.targetZ) return;
        set({ camera3dLive: c });
      },
      camera3dRequest: null,
      requestCamera3dMove: (targetX, targetZ) => set({ camera3dRequest: { targetX, targetZ } }),
      consumeCamera3dRequest: () => {
        const r = get().camera3dRequest;
        if (r) set({ camera3dRequest: null });
        return r;
      },
    }),
    {
      name: "agent-world-view-mode",
      partialize: (state) => ({ viewMode: state.viewMode, camera3d: state.camera3d }),
    }
  )
);
