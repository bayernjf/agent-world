import { create } from "zustand";

const KEY = "aw.tips";

function initial(): boolean {
  return localStorage.getItem(KEY) !== "off";
}

interface TipsState {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
}

export const useTips = create<TipsState>()((set) => ({
  enabled: initial(),
  toggle: () =>
    set((s) => {
      const next = !s.enabled;
      localStorage.setItem(KEY, next ? "on" : "off");
      return { enabled: next };
    }),
  setEnabled: (v) => {
    localStorage.setItem(KEY, v ? "on" : "off");
    set({ enabled: v });
  },
}));
