import { describe, expect, it } from "vitest";
import { formatHeat, formatCountdown } from "./CanvasPark";
import type { ParkGraphMetrics } from "../lib/api";

const m = (o: Partial<ParkGraphMetrics>): ParkGraphMetrics => ({
  impressions: 0, clicks: 0, conversions: 0, gmv: 0, adSpend: 0, ...o,
});

describe("formatHeat (RTS C6)", () => {
  it("renders nothing without metrics or with all-zero data (honest empty state)", () => {
    expect(formatHeat(undefined)).toBeNull();
    expect(formatHeat(m({}))).toBeNull();
  });

  it("formats CTR from impressions/clicks", () => {
    expect(formatHeat(m({ impressions: 100, clicks: 10 }))).toBe("CTR 10%");
    expect(formatHeat(m({ impressions: 1000, clicks: 23 }))).toBe("CTR 2.3%");
    expect(formatHeat(m({ impressions: 100, clicks: 15 }))).toBe("CTR 15%");
  });

  it("formats GMV, compacting at/above 1000", () => {
    expect(formatHeat(m({ gmv: 800 }))).toBe("$800");
    expect(formatHeat(m({ gmv: 1500 }))).toBe("$1.5k");
  });

  it("joins CTR and GMV with a separator", () => {
    expect(formatHeat(m({ impressions: 200, clicks: 10, gmv: 2500 }))).toBe("CTR 5.0% · $2.5k");
  });

  it("treats adSpend-only as signal-less for the heat label", () => {
    expect(formatHeat(m({ adSpend: 5 }))).toBeNull();
  });
});

describe("formatCountdown (RTS C5)", () => {
  const MIN = 60000;
  it("formats sub-hour as minutes", () => {
    expect(formatCountdown(30 * MIN, 0)).toBe("30m");
  });
  it("formats under-24h as hours", () => {
    expect(formatCountdown(3 * 60 * MIN, 0)).toBe("3.0h");
    expect(formatCountdown(12 * 60 * MIN, 0)).toBe("12h");
  });
  it("returns null at/beyond 24h or in the past", () => {
    expect(formatCountdown(25 * 60 * MIN, 0)).toBeNull();
    expect(formatCountdown(-5 * MIN, 0)).toBeNull();
  });
});
