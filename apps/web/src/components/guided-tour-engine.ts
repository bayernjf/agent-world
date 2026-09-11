import type { Placement } from "../tours/tour-types";

/**
 * Pure placement/spotlight helpers for the guided-tour engine, split out so the
 * geometry is unit-testable under jsdom (where getBoundingClientRect is all 0).
 * See docs/design-guided-tour.md §7.3.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Viewport {
  width: number;
  height: number;
}
export interface CardPlacement {
  top: number;
  left: number;
  /** The placement actually used after edge-flipping. */
  placement: Placement;
}

const VIEWPORT_EDGE = 12;

function clamp(v: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(v, min), max);
}

const OPPOSITE: Record<Exclude<Placement, "center">, Exclude<Placement, "center">> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/**
 * Position a card of `card` size relative to `target` rect within `viewport`.
 * Flips to the opposite side when the preferred side overflows, then clamps
 * the card fully inside the viewport. A null target / "center" centers it.
 */
export function placeCard(
  target: Rect | null,
  placement: Placement,
  card: Size,
  viewport: Viewport,
  gap = 12,
): CardPlacement {
  if (!target || placement === "center") {
    return {
      top: (viewport.height - card.height) / 2,
      left: (viewport.width - card.width) / 2,
      placement: "center",
    };
  }

  type Side = Exclude<Placement, "center">;
  const anchorRect: Rect = target;

  const tCx = anchorRect.left + anchorRect.width / 2;
  const tCy = anchorRect.top + anchorRect.height / 2;

  function candidate(p: Side): { top: number; left: number } {
    switch (p) {
      case "right":
        return { top: tCy - card.height / 2, left: anchorRect.left + anchorRect.width + gap };
      case "left":
        return { top: tCy - card.height / 2, left: anchorRect.left - gap - card.width };
      case "bottom":
        return { top: anchorRect.top + anchorRect.height + gap, left: tCx - card.width / 2 };
      case "top":
        return { top: anchorRect.top - gap - card.height, left: tCx - card.width / 2 };
    }
  }

  function overflows(top: number, left: number): boolean {
    return (
      left < VIEWPORT_EDGE ||
      top < VIEWPORT_EDGE ||
      left + card.width > viewport.width - VIEWPORT_EDGE ||
      top + card.height > viewport.height - VIEWPORT_EDGE
    );
  }

  let chosen: Side = placement;
  let pos = candidate(chosen);
  if (overflows(pos.top, pos.left)) {
    const flipped = OPPOSITE[chosen];
    const alt = candidate(flipped);
    if (!overflows(alt.top, alt.left)) {
      chosen = flipped;
      pos = alt;
    }
  }

  return {
    top: clamp(pos.top, VIEWPORT_EDGE, viewport.height - card.height - VIEWPORT_EDGE),
    left: clamp(pos.left, VIEWPORT_EDGE, viewport.width - card.width - VIEWPORT_EDGE),
    placement: chosen,
  };
}

/** Grow a target rect by `pad` to form the spotlight hole. */
export function holeRect(target: Rect, pad = 6): Rect {
  return {
    top: target.top - pad,
    left: target.left - pad,
    width: target.width + pad * 2,
    height: target.height + pad * 2,
  };
}

/** Resolve a data-tour anchor element (null for centered steps / missing anchors). */
export function findAnchor(target?: string | null): HTMLElement | null {
  if (!target) return null;
  try {
    return document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle / before-step action registry. Feature code (App) registers side
// effects such as "expand a collapsed panel" / "select the first node", keyed
// by the strings referenced from tour definitions — keeping tour data React-free.
// ---------------------------------------------------------------------------

const actions = new Map<string, () => void>();

export function registerTourAction(key: string, fn: () => void): void {
  actions.set(key, fn);
}

export function runTourAction(key?: string): void {
  if (!key) return;
  const fn = actions.get(key);
  if (fn) {
    try {
      fn();
    } catch {
      /* a failing side-effect must never break the tour */
    }
  }
}
