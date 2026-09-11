import { create } from "zustand";
import type { TourContext, TourDef } from "../tours/tour-types";
import { TOURS, getTour } from "../tours";

/**
 * Generic guided-tour store + pure scheduling/seen helpers.
 *
 * The store is tour-agnostic: it tracks whichever tour is active by id. Seen
 * state is versioned per tour in localStorage (`aw.tour.seen:{id}:{version}`),
 * see docs/design-guided-tour.md §7.2 / §12.5 / §12.6.
 */

const SEEN_PREFIX = "aw.tour.seen:";
const LEGACY_SEEN_KEY = "aw.tour.seen";
const LEGACY_SEEN_VALUE = "v1";
const LAST_AUTO_KEY = "aw.tour.lastAutoAt";
/** At most one auto-started tour per 24h (§12.6). */
export const AUTO_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Feature-flag accessor (web has no flag system yet; injectable, default empty)
// ---------------------------------------------------------------------------

let flagsProvider: () => ReadonlySet<string> = () => new Set();

/** Wire a real feature-flag source later without touching the tour engine. */
export function setFeatureFlagsProvider(fn: () => ReadonlySet<string>): void {
  flagsProvider = fn;
}

export function getFeatureFlags(): ReadonlySet<string> {
  try {
    return flagsProvider();
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Seen persistence (per tour id + version)
// ---------------------------------------------------------------------------

export function seenKey(tourId: string, version: string): string {
  return `${SEEN_PREFIX}${tourId}:${version}`;
}

export function hasSeen(tourId: string, version: string): boolean {
  try {
    return localStorage.getItem(seenKey(tourId, version)) != null;
  } catch {
    return false;
  }
}

export function markSeen(tourId: string, version: string): void {
  try {
    localStorage.setItem(seenKey(tourId, version), new Date().toISOString());
  } catch {
    /* private mode */
  }
}

/** Ids of tours seen in any version (for Targeting.seenTours). */
export function seenTourIds(): Set<string> {
  const ids = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SEEN_PREFIX)) {
        ids.add(k.slice(SEEN_PREFIX.length).split(":")[0]!);
      }
    }
  } catch {
    /* private mode */
  }
  return ids;
}

export function getLastAutoAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_AUTO_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function setLastAutoAt(now: number): void {
  try {
    localStorage.setItem(LAST_AUTO_KEY, String(now));
  } catch {
    /* private mode */
  }
}

/**
 * One-time migration from the original single-tour key (`aw.tour.seen=v1`) to
 * the versioned first-run key, then drop the legacy key (§12.5). Safe to call
 * repeatedly.
 */
export function migrateLegacySeen(): void {
  try {
    if (localStorage.getItem(LEGACY_SEEN_KEY) === LEGACY_SEEN_VALUE) {
      const firstRun = getTour("first-run");
      if (firstRun) markSeen(firstRun.id, firstRun.version);
      localStorage.removeItem(LEGACY_SEEN_KEY);
    }
  } catch {
    /* private mode */
  }
}

// ---------------------------------------------------------------------------
// Targeting + auto scheduling (pure, unit-tested)
// ---------------------------------------------------------------------------

/** Whether a tour is allowed to show for the given context (and isn't seen). */
export function canShowTour(tour: TourDef, ctx: TourContext): boolean {
  if (hasSeen(tour.id, tour.version)) return false;
  const t = tour.targeting;
  if (t.minGraphCount != null && ctx.graphCount < t.minGraphCount) return false;
  if (
    t.hasRunHistory != null &&
    ctx.hasRunHistory !== undefined &&
    ctx.hasRunHistory !== t.hasRunHistory
  ) {
    return false;
  }
  if (t.featureFlags && !t.featureFlags.every((f) => ctx.flags.has(f))) {
    return false;
  }
  if (t.seenTours && !t.seenTours.every((id) => ctx.seenTours.has(id))) {
    return false;
  }
  if (t.accountAgeDays) {
    const age = ctx.accountAgeDays;
    if (age === undefined) return false;
    if (t.accountAgeDays.min != null && age < t.accountAgeDays.min) return false;
    if (t.accountAgeDays.max != null && age > t.accountAgeDays.max) return false;
  }
  if (t.custom && !t.custom(ctx)) return false;
  return true;
}

/**
 * Pick at most one tour to auto-start: eligible autoStart tours, highest
 * priority (smallest number) wins; the global 24h cooldown suppresses all.
 */
export function pickAutoTour(tours: TourDef[], ctx: TourContext): TourDef | null {
  if (ctx.lastAutoAt != null && ctx.now - ctx.lastAutoAt < AUTO_COOLDOWN_MS) {
    return null;
  }
  const eligible = tours
    .filter((tour) => tour.autoStart && canShowTour(tour, ctx))
    .sort((a, b) => a.priority - b.priority);
  return eligible[0] ?? null;
}

/** Build a TourContext from readily-available app state. */
export function buildTourContext(
  graphCount: number,
  now: number = Date.now(),
  extras: Partial<Pick<TourContext, "hasRunHistory" | "accountAgeDays">> = {},
): TourContext {
  return {
    graphCount,
    flags: getFeatureFlags(),
    seenTours: seenTourIds(),
    now,
    lastAutoAt: getLastAutoAt(),
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// UI store
// ---------------------------------------------------------------------------

interface GuidedTourState {
  activeTourId: string | null;
  index: number;
  total: number;
  /** Begin a tour at an optional step; no-op if the id is unknown. */
  start: (tourId: string, at?: number) => void;
  next: () => void;
  back: () => void;
  goTo: (i: number) => void;
  /** Dismiss as skipped — still marks the version seen (§12.6 skip =放过). */
  skip: () => void;
  /** Complete normally and mark seen. */
  finish: () => void;
}

function clearActive(): Partial<GuidedTourState> {
  return { activeTourId: null, index: 0, total: 0 };
}

export const useGuidedTour = create<GuidedTourState>()((set, get) => ({
  activeTourId: null,
  index: 0,
  total: 0,

  start: (tourId, at = 0) => {
    const def = getTour(tourId);
    if (!def) return;
    set({ activeTourId: tourId, index: Math.max(0, at), total: def.steps.length });
  },

  next: () => {
    const { activeTourId, index, total } = get();
    if (!activeTourId) return;
    if (index + 1 >= total) {
      get().finish();
    } else {
      set({ index: index + 1 });
    }
  },

  back: () => {
    const { index } = get();
    if (index > 0) set({ index: index - 1 });
  },

  goTo: (i) => {
    const { total } = get();
    if (i >= 0 && i < total) set({ index: i });
  },

  skip: () => {
    const { activeTourId } = get();
    if (activeTourId) {
      const def = getTour(activeTourId);
      if (def) markSeen(def.id, def.version);
    }
    set(clearActive());
  },

  finish: () => {
    const { activeTourId } = get();
    if (activeTourId) {
      const def = getTour(activeTourId);
      if (def) markSeen(def.id, def.version);
    }
    set(clearActive());
  },
}));

/** All registered tours (re-exported for convenience by UI/menus). */
export { TOURS };
