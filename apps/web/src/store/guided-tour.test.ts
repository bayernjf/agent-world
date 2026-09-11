import { describe, it, expect, beforeEach } from "vitest";
import type { TourContext, TourDef } from "../tours/tour-types";
import {
  AUTO_COOLDOWN_MS,
  buildTourContext,
  canShowTour,
  getLastAutoAt,
  hasSeen,
  markSeen,
  migrateLegacySeen,
  pickAutoTour,
  seenKey,
  seenTourIds,
  setLastAutoAt,
  useGuidedTour,
} from "./guided-tour";

function makeTour(overrides: Partial<TourDef> = {}): TourDef {
  return {
    id: "fake",
    version: "1.0.0",
    titleKey: "tour:firstRun.title",
    priority: 5,
    autoStart: true,
    targeting: {},
    steps: [
      { target: null, placement: "center", titleKey: "tour:firstRun.steps.welcome.title", bodyKey: "tour:firstRun.steps.welcome.body" },
    ],
    ...overrides,
  };
}

function ctx(overrides: Partial<TourContext> = {}): TourContext {
  return {
    graphCount: 1,
    flags: new Set(),
    seenTours: new Set(),
    now: 1_000_000,
    lastAutoAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  useGuidedTour.setState({ activeTourId: null, index: 0, total: 0 });
});

describe("seen persistence", () => {
  it("builds a versioned seen key", () => {
    expect(seenKey("first-run", "1.0.0")).toBe("aw.tour.seen:first-run:1.0.0");
  });

  it("marks and reports seen per version", () => {
    expect(hasSeen("first-run", "1.0.0")).toBe(false);
    markSeen("first-run", "1.0.0");
    expect(hasSeen("first-run", "1.0.0")).toBe(true);
    // A newer version is not seen yet.
    expect(hasSeen("first-run", "2.0.0")).toBe(false);
  });

  it("lists seen tour ids regardless of version", () => {
    markSeen("first-run", "1.0.0");
    markSeen("v2-park", "3.1.0");
    expect(seenTourIds()).toEqual(new Set(["first-run", "v2-park"]));
  });

  it("migrates the legacy single-tour key then removes it", () => {
    localStorage.setItem("aw.tour.seen", "v1");
    migrateLegacySeen();
    expect(hasSeen("first-run", "1.0.0")).toBe(true);
    expect(localStorage.getItem("aw.tour.seen")).toBeNull();
  });

  it("records and reads the last auto-start time", () => {
    expect(getLastAutoAt()).toBeNull();
    setLastAutoAt(12345);
    expect(getLastAutoAt()).toBe(12345);
  });
});

describe("canShowTour", () => {
  it("allows an unseen tour that meets its targeting", () => {
    expect(canShowTour(makeTour({ targeting: { minGraphCount: 1 } }), ctx())).toBe(true);
  });

  it("blocks a seen tour", () => {
    markSeen("fake", "1.0.0");
    expect(canShowTour(makeTour(), ctx())).toBe(false);
  });

  it("blocks when graph count is below the minimum", () => {
    expect(
      canShowTour(makeTour({ targeting: { minGraphCount: 2 } }), ctx({ graphCount: 1 })),
    ).toBe(false);
  });

  it("requires every feature flag", () => {
    const tour = makeTour({ targeting: { featureFlags: ["park", "x"] } });
    expect(canShowTour(tour, ctx({ flags: new Set(["park"]) }))).toBe(false);
    expect(
      canShowTour(tour, ctx({ flags: new Set(["park", "x"]) })),
    ).toBe(true);
  });

  it("requires prerequisite seen tours", () => {
    const tour = makeTour({ targeting: { seenTours: ["first-run"] } });
    expect(canShowTour(tour, ctx())).toBe(false);
    expect(
      canShowTour(tour, ctx({ seenTours: new Set(["first-run"]) })),
    ).toBe(true);
  });

  it("evaluates hasRunHistory only when known", () => {
    const tour = makeTour({ targeting: { hasRunHistory: false } });
    expect(canShowTour(tour, ctx({ hasRunHistory: undefined }))).toBe(true);
    expect(canShowTour(tour, ctx({ hasRunHistory: true }))).toBe(false);
    expect(canShowTour(tour, ctx({ hasRunHistory: false }))).toBe(true);
  });

  it("runs a custom predicate", () => {
    const tour = makeTour({ targeting: { custom: (c) => c.graphCount > 3 } });
    expect(canShowTour(tour, ctx({ graphCount: 2 }))).toBe(false);
    expect(canShowTour(tour, ctx({ graphCount: 4 }))).toBe(true);
  });
});

describe("pickAutoTour", () => {
  it("picks the smallest-priority eligible tour", () => {
    const a = makeTour({ id: "a", priority: 5 });
    const b = makeTour({ id: "b", priority: 1 });
    const picked = pickAutoTour([a, b], ctx());
    expect(picked?.id).toBe("b");
  });

  it("ignores non-autoStart tours", () => {
    const picked = pickAutoTour([makeTour({ autoStart: false })], ctx());
    expect(picked).toBeNull();
  });

  it("suppresses auto-start within the 24h cooldown", () => {
    const now = 5_000_000;
    const recent = pickAutoTour(
      [makeTour()],
      ctx({ now, lastAutoAt: now - AUTO_COOLDOWN_MS + 1000 }),
    );
    expect(recent).toBeNull();
    const older = pickAutoTour(
      [makeTour()],
      ctx({ now, lastAutoAt: now - AUTO_COOLDOWN_MS - 1000 }),
    );
    expect(older?.id).toBe("fake");
  });
});

describe("buildTourContext", () => {
  it("assembles flags, seen tours and last-auto from storage", () => {
    markSeen("first-run", "1.0.0");
    setLastAutoAt(999);
    const c = buildTourContext(2, 1000, { hasRunHistory: true });
    expect(c.graphCount).toBe(2);
    expect(c.now).toBe(1000);
    expect(c.hasRunHistory).toBe(true);
    expect(c.seenTours.has("first-run")).toBe(true);
    expect(c.lastAutoAt).toBe(999);
  });
});

describe("guided-tour store", () => {
  it("no-ops when starting an unknown tour", () => {
    useGuidedTour.getState().start("nope");
    expect(useGuidedTour.getState().activeTourId).toBeNull();
  });

  it("starts the registered first-run tour at the given step", () => {
    useGuidedTour.getState().start("first-run");
    const s = useGuidedTour.getState();
    expect(s.activeTourId).toBe("first-run");
    expect(s.index).toBe(0);
    expect(s.total).toBe(8);
  });

  it("advances and clamps back", () => {
    useGuidedTour.getState().start("first-run");
    useGuidedTour.getState().next();
    expect(useGuidedTour.getState().index).toBe(1);
    useGuidedTour.getState().back();
    expect(useGuidedTour.getState().index).toBe(0);
    useGuidedTour.getState().back();
    expect(useGuidedTour.getState().index).toBe(0);
  });

  it("finishes (and marks seen) when next is pressed on the last step", () => {
    useGuidedTour.getState().start("first-run", 7);
    useGuidedTour.getState().next();
    expect(useGuidedTour.getState().activeTourId).toBeNull();
    expect(hasSeen("first-run", "1.0.0")).toBe(true);
  });

  it("skip marks the version seen and closes", () => {
    useGuidedTour.getState().start("first-run");
    useGuidedTour.getState().skip();
    expect(useGuidedTour.getState().activeTourId).toBeNull();
    expect(hasSeen("first-run", "1.0.0")).toBe(true);
  });

  it("goTo respects bounds", () => {
    useGuidedTour.getState().start("first-run");
    useGuidedTour.getState().goTo(3);
    expect(useGuidedTour.getState().index).toBe(3);
    useGuidedTour.getState().goTo(999);
    expect(useGuidedTour.getState().index).toBe(3);
    useGuidedTour.getState().goTo(-1);
    expect(useGuidedTour.getState().index).toBe(3);
  });
});
