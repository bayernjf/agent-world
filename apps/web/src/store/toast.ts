import { create } from "zustand";

export interface ToastItem {
  id: number;
  message: string;
  undo?: () => void;
}

interface ToastState {
  toast: ToastItem | null;
  show: (message: string, undo?: () => void) => void;
  clear: () => void;
}

let counter = 0;

export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (message, undo) => set({ toast: { id: ++counter, message, undo } }),
  clear: () => set({ toast: null }),
}));
