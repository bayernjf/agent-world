/** Panel-collapse and inspector-width state of the app shell (audit P2
 * follow-up split out of App.tsx). The collapse toggles and the document-level
 * drag listeners for the inspector divider live here; the "no selected node"
 * flicker note below is preserved because the collapsed default is load-bearing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

const INSPECTOR_WIDTH_KEY = "inspector-width";
const INSPECTOR_WIDTH_DEFAULT = 420;

export interface PanelLayout {
  controlCollapsed: boolean;
  setControlCollapsed: Dispatch<SetStateAction<boolean>>;
  inspectorCollapsed: boolean;
  setInspectorCollapsed: Dispatch<SetStateAction<boolean>>;
  inspectorWidth: number;
  /** Start an inspector-divider drag; call on the divider's mouseDown. */
  onDragStart: (e: React.MouseEvent) => void;
  bothCollapsed: boolean;
  toggleBoth: () => void;
}

export function usePanelLayout(): PanelLayout {
  const [controlCollapsed, setControlCollapsed] = useState(false);
  // Collapsed by default, matching the "no selected node" state — starting
  // expanded would flash open on first paint before the selectedId effect
  // collapses it again (see App.tsx), causing an open-then-close flicker.
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const saved = localStorage.getItem(INSPECTOR_WIDTH_KEY);
    return saved ? Number(saved) : INSPECTOR_WIDTH_DEFAULT;
  });
  const dragging = useRef(false);
  const dragWidth = useRef(INSPECTOR_WIDTH_DEFAULT);
  // L20: hold the detach function for the active drag listeners so that an
  // unmount mid-drag (when mouseup never fires) does not leak them onto
  // document.
  const detachDrag = useRef<(() => void) | null>(null);
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      dragWidth.current = inspectorWidth;
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const w = Math.min(720, Math.max(280, window.innerWidth - ev.clientX));
        dragWidth.current = w;
        setInspectorWidth(w);
      };
      const detach = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        detachDrag.current = null;
      };
      const onUp = () => {
        dragging.current = false;
        detach();
        localStorage.setItem(INSPECTOR_WIDTH_KEY, String(dragWidth.current));
      };
      detachDrag.current?.();
      detachDrag.current = detach;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [inspectorWidth],
  );
  // Remove any lingering document listeners on unmount.
  useEffect(() => () => detachDrag.current?.(), []);

  const bothCollapsed = controlCollapsed && inspectorCollapsed;
  const toggleBoth = () => {
    const next = !bothCollapsed;
    setControlCollapsed(next);
    setInspectorCollapsed(next);
  };

  return {
    controlCollapsed,
    setControlCollapsed,
    inspectorCollapsed,
    setInspectorCollapsed,
    inspectorWidth,
    onDragStart,
    bothCollapsed,
    toggleBoth,
  };
}
