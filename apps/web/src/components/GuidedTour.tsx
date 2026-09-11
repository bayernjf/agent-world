import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGuidedTour } from "../store/guided-tour";
import { getTour } from "../tours";
import { useViewMode, type ViewMode } from "../store/view-mode";
import {
  findAnchor,
  holeRect,
  placeCard,
  runTourAction,
  type Rect,
} from "./guided-tour-engine";

const GAP = 12;
const HOLE_PAD = 6;
/** Wait at most ~500ms (30 frames) for a late anchor before falling back to centered. */
const MAX_ANCHOR_TRIES = 30;

interface Geom {
  top: number;
  left: number;
  hole: Rect | null;
}

/**
 * Generic guided-tour renderer. It renders whichever tour the store has active
 * (see docs/design-guided-tour.md §7 / §12): fixed scrim + spotlight hole + a
 * navigation card. Anchors missing (collapsed panel, no selection) degrade to a
 * centered card instead of blocking the flow.
 */
export default function GuidedTour() {
  const { t } = useTranslation();
  const activeTourId = useGuidedTour((s) => s.activeTourId);
  const index = useGuidedTour((s) => s.index);
  const next = useGuidedTour((s) => s.next);
  const back = useGuidedTour((s) => s.back);
  const skip = useGuidedTour((s) => s.skip);

  const viewMode = useViewMode((s) => s.viewMode);
  const setViewMode = useViewMode((s) => s.setViewMode);
  const prevViewRef = useRef<ViewMode | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<Geom>({ top: 0, left: 0, hole: null });

  const def = activeTourId ? getTour(activeTourId) : undefined;
  const step = def?.steps[index];
  const total = def?.steps.length ?? 0;
  const isLast = index === total - 1;
  const active = Boolean(def && step);

  // Force the stable 2D view while a tour runs; restore the prior view after.
  useEffect(() => {
    if (activeTourId) {
      if (prevViewRef.current === null) prevViewRef.current = viewMode;
      setViewMode("2d");
      // Clear any stray page scroll so fixed-layout anchors start on-screen.
      window.scrollTo(0, 0);
      runTourAction(def?.onStart);
    } else if (prevViewRef.current !== null) {
      setViewMode(prevViewRef.current);
      prevViewRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTourId]);

  // Compute card + spotlight geometry for the current step.
  useLayoutEffect(() => {
    if (!active || !step) return;
    let raf = 0;
    let tries = 0;
    let cancelled = false;

    runTourAction(step.before);

    const compute = () => {
      if (cancelled) return;
      const cardEl = cardRef.current;
      const card = {
        width: cardEl?.offsetWidth ?? 320,
        height: cardEl?.offsetHeight ?? 200,
      };
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const anchor = findAnchor(step.target);
      const rect = anchor?.getBoundingClientRect();
      const anchorReady =
        Boolean(anchor) && Boolean(rect) && (rect!.width > 0 || rect!.height > 0);
      // A stray page scroll (e.g. an oversized zoomed canvas) can push a
      // fixed-layout anchor out of the viewport; nudge it back before settling.
      const onScreen = rect
        ? rect.left >= 0 &&
          rect.right <= window.innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight
        : true;

      if (
        anchorReady &&
        !onScreen &&
        anchor &&
        tries < MAX_ANCHOR_TRIES
      ) {
        anchor.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        tries += 1;
        raf = requestAnimationFrame(compute);
        return;
      }

      if (!anchorReady && step.target && tries < MAX_ANCHOR_TRIES) {
        tries += 1;
        raf = requestAnimationFrame(compute);
        return;
      }

      if (anchorReady && rect && step.placement !== "center") {
        const target: Rect = {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
        const pos = placeCard(target, step.placement, card, viewport, GAP);
        if (!cancelled) setGeom({ top: pos.top, left: pos.left, hole: holeRect(target, HOLE_PAD) });
      } else {
        // Missing / zero-size anchor → centered card, no hole (never block).
        const pos = placeCard(null, "center", card, viewport, GAP);
        if (!cancelled) setGeom({ top: pos.top, left: pos.left, hole: null });
      }
    };

    compute();
    const reflow = () => {
      cancelAnimationFrame(raf);
      compute();
    };
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTourId, index]);

  // Move focus to the primary button when a step opens; simple Tab trap.
  useEffect(() => {
    if (!active) return;
    primaryRef.current?.focus();
  }, [active, index]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        skip();
        return;
      }
      if (e.key === "Tab" && overlayRef.current) {
        const focusables = overlayRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const activeEl = document.activeElement;
        if (e.shiftKey && activeEl === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [skip],
  );

  if (!active || !def || !step) return null;

  return (
    <div
      className="guided-tour"
      ref={overlayRef}
      onKeyDown={onKeyDown}
      aria-hidden={false}
    >
      {/* Centered steps use a full scrim; anchored steps dim via the hole shadow. */}
      {!geom.hole && <div className="guided-tour__scrim" />}
      {geom.hole && (
        <div
          className="guided-tour__hole"
          style={{
            top: geom.hole.top,
            left: geom.hole.left,
            width: geom.hole.width,
            height: geom.hole.height,
          }}
        />
      )}
      <div
        className="guided-tour__card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-title"
        aria-describedby="guided-tour-body"
        style={{ top: geom.top, left: geom.left }}
      >
        <div className="guided-tour__progress" aria-live="polite">
          {t("tour:nav.progress", { index: index + 1, total })}
        </div>
        <h2 id="guided-tour-title" className="guided-tour__title">
          {t(step.titleKey)}
        </h2>
        <p id="guided-tour-body" className="guided-tour__body">
          {t(step.bodyKey)}
        </p>
        <div className="guided-tour__actions">
          <button
            type="button"
            className="btn btn--ghost guided-tour__skip"
            onClick={skip}
          >
            {t("tour:nav.skip")}
          </button>
          <div className="guided-tour__nav">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={back}
              disabled={index === 0}
            >
              {t("tour:nav.back")}
            </button>
            <button
              ref={primaryRef}
              type="button"
              className="btn"
              onClick={next}
            >
              {isLast ? t("tour:nav.finish") : t("tour:nav.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
