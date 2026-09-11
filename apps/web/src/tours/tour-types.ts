/**
 * Guided Tour — type definitions for the extensible multi-tour registry.
 *
 * A tour is *data*, not code: the engine (`components/GuidedTour.tsx`) renders
 * any {@link TourDef}. Adding a new-version / new-feature tour means adding a
 * `*.tour.ts` file and registering one line in `tours/index.ts` — the engine,
 * store, spotlight and a11y code never change. See docs/design-guided-tour.md §12.
 */

/** Where the step card sits relative to its spotlighted anchor. */
export type Placement = "top" | "bottom" | "left" | "right" | "center";

/**
 * A single step. `target` matches a `data-tour="<target>"` element rendered by
 * the feature's own code (§12.7 anchor contract). A null/undefined target (or
 * placement "center") renders a centered card with no spotlight hole.
 */
export interface StepDef {
  /** Anchor id referenced by `data-tour`. Null = centered card. */
  target?: string | null;
  placement: Placement;
  /** Full i18n key literal, e.g. "tour:firstRun.steps.raw.title". */
  titleKey: string;
  /** Full i18n key literal for the 1-2 sentence explanation. */
  bodyKey: string;
  /**
   * Optional side-effect run before the anchor is measured (e.g. expand a
   * collapsed panel / select the first node). Keys are resolved by the engine
   * through a before-action map so this data file stays React/store-free.
   */
  before?: string;
}

/** Snapshot the targeting predicates evaluate against. */
export interface TourContext {
  /** Current number of production lines (graphs). */
  graphCount: number;
  /** Whether the account has any run history; undefined = unknown / unconstrained. */
  hasRunHistory?: boolean;
  /** Currently enabled feature flags (empty when no flag system is wired). */
  flags: ReadonlySet<string>;
  /** Tour ids already seen (any version). */
  seenTours: ReadonlySet<string>;
  /** Account age in days when known. */
  accountAgeDays?: number;
  /** Epoch ms of evaluation (injectable for tests). */
  now: number;
  /** Epoch ms of the last auto-started tour, for the 24h cooldown. */
  lastAutoAt?: number | null;
}

/** Decides who is eligible to see a tour. Every field is optional (AND-combined). */
export interface Targeting {
  /** Require at least N graphs. */
  minGraphCount?: number;
  /** Require (true) or forbid (false) prior run history. */
  hasRunHistory?: boolean;
  /** Every listed feature flag must be enabled. */
  featureFlags?: string[];
  /** Every listed tour id must already have been seen. */
  seenTours?: string[];
  accountAgeDays?: { min?: number; max?: number };
  /** Escape hatch for arbitrary predicates. */
  custom?: (ctx: TourContext) => boolean;
}

/** A registered guided tour. */
export interface TourDef {
  /** Stable id, e.g. "first-run" / "v2-park". */
  id: string;
  /** Semantic version; bumping it re-shows the tour (seen key is versioned). */
  version: string;
  /** Full i18n key for the display name (⌘K / What's-new menu). */
  titleKey: string;
  /** Lower priority auto-starts first when several tours are eligible. */
  priority: number;
  /** Whether the scheduler may auto-start it; false = manual replay only. */
  autoStart: boolean;
  targeting: Targeting;
  steps: StepDef[];
  /** Optional lifecycle hook key, resolved by the engine (e.g. force 2D view). */
  onStart?: string;
  onFinish?: string;
}
