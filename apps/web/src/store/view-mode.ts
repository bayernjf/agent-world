import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Which rendering view is active: the 2D editor or the 3D display view. */
export type ViewMode = "2d" | "3d";

interface ViewModeState {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggle: () => void;
}

export const useViewMode = create<ViewModeState>()(
  persist(
    (set) => ({
      viewMode: "2d",
      setViewMode: (mode) => set({ viewMode: mode }),
      toggle: () => set((s) => ({ viewMode: s.viewMode === "2d" ? "3d" : "2d" })),
    }),
    {
      name: "agent-world-view-mode",
      partialize: (state) => ({ viewMode: state.viewMode }),
    }
  )
);
