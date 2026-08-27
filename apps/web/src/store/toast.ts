import { create } from "zustand";

export interface ToastAction {
  /** Button label, e.g. "撤销" or "复制". */
  label: string;
  /** Click handler; the toast is cleared after it runs. */
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  message: string;
  /**
   * When set, the toast auto-dismisses after this many ms. Errors get a
   * longer default than undo toasts because the user often needs to read
   * the message and copy it before it disappears.
   */
  ttlMs?: number;
  /** Optional actions rendered on the right of the toast. */
  actions?: ToastAction[];
}

interface ToastState {
  toast: ToastItem | null;
  show: (message: string, opts?: { ttlMs?: number; actions?: ToastAction[] }) => void;
  clear: () => void;
}

let counter = 0;

export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (message, opts) =>
    set({ toast: { id: ++counter, message, ttlMs: opts?.ttlMs, actions: opts?.actions } }),
  clear: () => set({ toast: null }),
}));

/** Clipboard helper. Falls back to the legacy execCommand path when the
 *  modern Clipboard API is blocked (e.g. inside the in-app browser). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
