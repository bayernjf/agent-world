import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type Placement = "top" | "bottom";

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

interface Props {
  open: boolean;
  /** Anchor rectangle in viewport (CSS) pixels, e.g. from getBoundingClientRect. */
  anchor: Rect | null;
  placement?: Placement;
  /** Gap between anchor and popover. */
  gap?: number;
  /** Minimum distance kept from the viewport edge. */
  margin?: number;
  className?: string;
  children: ReactNode;
}

interface Pos {
  top: number;
  left: number;
  placement: Placement;
}

/**
 * Single source of truth for every custom tooltip/popover. It renders through
 * a portal to document.body with position: fixed and a high z-index, so it can
 * never be clipped by an overflow:hidden ancestor or covered by side panels.
 * Placement auto-flips (top <-> bottom) when there isn't room, and the result
 * is always clamped inside the viewport.
 */
export default function Popover({
  open,
  anchor,
  placement = "top",
  gap = 8,
  margin = 12,
  className = "",
  children,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const compute = useCallback(() => {
    const el = elRef.current;
    if (!el || !anchor) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let place: Placement = placement;
    const spaceAbove = anchor.top;
    const spaceBelow = vh - anchor.bottom;
    if (placement === "top" && r.height + gap > spaceAbove && spaceBelow > spaceAbove) {
      place = "bottom";
    } else if (
      placement === "bottom" &&
      r.height + gap > spaceBelow &&
      spaceAbove > spaceBelow
    ) {
      place = "top";
    }

    const top =
      place === "top"
        ? anchor.top - r.height - gap
        : anchor.bottom + gap;

    // Centre on the anchor, then clamp inside the viewport.
    let left = anchor.left + anchor.width / 2 - r.width / 2;
    left = Math.max(margin, Math.min(left, vw - r.width - margin));
    const clampedTop = Math.max(margin, Math.min(top, vh - r.height - margin));

    setPos({ top: clampedTop, left, placement: place });
  }, [anchor, placement, gap, margin]);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPos(null);
      return;
    }
    // Reposition after layout settles. Keep the previous position for one frame
    // rather than flashing hidden while the anchor moves.
    const raf = requestAnimationFrame(compute);
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open, anchor, compute]);

  if (!open || !anchor) return null;

  return createPortal(
    <div
      ref={elRef}
      className={`popover ${pos ? "is-ready" : ""} ${className}`}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        zIndex: "var(--z-popover, 1000)",
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
