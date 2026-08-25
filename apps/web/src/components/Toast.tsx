import { useEffect } from "react";
import { useToast } from "../store/toast";

/**
 * Ephemeral toast for destructive actions. An "undo" action calls whatever
 * callback the producer supplied (the graph store's temporal undo). Auto-hides
 * after 4s. The app already wires ⌘/Ctrl-Z to graph undo globally, so the
 * button is the affordance; no extra key handler is needed here.
 */
export default function Toast() {
  const toast = useToast((s) => s.toast);
  const clear = useToast((s) => s.clear);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clear, 4000);
    return () => clearTimeout(t);
  }, [toast, clear]);

  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.undo && (
        <button className="link" onClick={() => { toast.undo?.(); clear(); }}>
          撤销 (⌘Z)
        </button>
      )}
    </div>
  );
}
