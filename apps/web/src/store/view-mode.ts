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
}

export const useViewMode = create<ViewModeState>()(
  persist(
    (set) => ({
      viewMode: "2d",
      setViewMode: (mode) => set({ viewMode: mode }),
      toggle: () => set((s) => ({ viewMode: s.viewMode === "2d" ? "3d" : "2d" })),
      camera3d: null,
      setCamera3d: (c) => set({ camera3d: c }),
    }),
    {
      name: "agent-world-view-mode",
      partialize: (state) => ({ viewMode: state.viewMode, camera3d: state.camera3d }),
    }
  )
);
