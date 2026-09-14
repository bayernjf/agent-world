import { describe, expect, it } from "vitest";
import {
  PLANS,
  PLAN_PRICES,
  PLAN_IDS,
  DEFAULT_PLAN,
  isPlanId,
  normalizeTokens,
} from "./plans.js";

describe("PLANS", () => {
  it("defines all four tiers", () => {
    expect(PLAN_IDS).toEqual(["free", "starter", "pro", "team"]);
    for (const id of PLAN_IDS) {
      expect(PLANS[id]).toBeTruthy();
      expect(PLANS[id].concurrentRuns).toBeGreaterThanOrEqual(1);
      expect(PLANS[id].storageBytes).toBeGreaterThan(0);
    }
  });

  it("locks the free tier out of built-in models and video", () => {
    expect(PLANS.free.tokens).toBe(0);
    expect(PLANS.free.videoSegments).toBe(0);
  });

  it("quotas grow monotonically across paid tiers", () => {
    const order: Array<keyof typeof PLANS> = ["free", "starter", "pro", "team"];
    for (let i = 1; i < order.length; i++) {
      const prev = PLANS[order[i - 1]!];
      const cur = PLANS[order[i]!];
      expect(cur.tokens).toBeGreaterThan(prev.tokens);
      expect(cur.concurrentRuns).toBeGreaterThan(prev.concurrentRuns);
      expect(cur.storageBytes).toBeGreaterThan(prev.storageBytes);
      expect(cur.videoSegments).toBeGreaterThan(prev.videoSegments);
    }
  });

  it("carries M1-calibrated monthly prices", () => {
    expect(PLAN_PRICES.free).toBe(0);
    expect(PLAN_PRICES.starter).toBe(9);
    expect(PLAN_PRICES.pro).toBe(29);
    expect(PLAN_PRICES.team).toBe(149);
  });

  it("defaults to free", () => {
    expect(DEFAULT_PLAN).toBe("free");
  });
});

describe("isPlanId", () => {
  it("accepts the four tiers", () => {
    expect(isPlanId("free")).toBe(true);
    expect(isPlanId("pro")).toBe(true);
    expect(isPlanId("enterprise")).toBe(false);
    expect(isPlanId(undefined)).toBe(false);
    expect(isPlanId(null)).toBe(false);
  });
});

describe("normalizeTokens", () => {
  it("weights output tokens 4x", () => {
    expect(normalizeTokens(100, 50)).toBe(300);
  });
  it("treats input-only usage at face value", () => {
    expect(normalizeTokens(200, 0)).toBe(200);
  });
  it("clamps negative values", () => {
    expect(normalizeTokens(-5, 10)).toBe(40);
  });
});
