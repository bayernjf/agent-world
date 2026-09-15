import { describe, expect, it } from "vitest";
import { formatHeat, formatCountdown, crossArchY, crossArchPoints } from "./CanvasPark";
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

  it("appends ROI only when both GMV and adSpend are positive", () => {
    expect(formatHeat(m({ gmv: 500, adSpend: 100 }))).toBe("$500 · ROI 5.0×");
    expect(formatHeat(m({ gmv: 2000, adSpend: 10 }))).toBe("$2.0k · ROI 200×");
    // zero ad spend → no ROI (never show ∞), GMV still renders
    expect(formatHeat(m({ gmv: 500, adSpend: 0 }))).toBe("$500");
    // CTR + GMV + ROI together, in fixed order
    expect(formatHeat(m({ impressions: 200, clicks: 10, gmv: 800, adSpend: 200 }))).toBe(
      "CTR 5.0% · $800 · ROI 4.0×",
    );
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

describe("crossArchY / crossArchPoints (C2 overhead pipe)", () => {
  it("sits at baseY at both ends and peaks by archH at the midpoint", () => {
    expect(crossArchY(0, 6, 230)).toBe(6);
    expect(crossArchY(1, 6, 230)).toBe(6);
    expect(crossArchY(0.5, 6, 230)).toBe(236);
    // parabola: t=0.25 → 0.75 of the arch
    expect(crossArchY(0.25, 6, 230)).toBeCloseTo(6 + 230 * 0.75, 6);
  });

  it("clamps out-of-range t to the endpoints", () => {
    expect(crossArchY(-1, 0, 100)).toBe(0);
    expect(crossArchY(2, 0, 100)).toBe(0);
  });

  it("samples segments+1 points interpolating x/z with an arched y", () => {
    const pts = crossArchPoints({ x: 0, z: 0 }, { x: 100, z: 200 }, 4, 6, 230);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual({ x: 0, y: 6, z: 0 });
    expect(pts[4]).toEqual({ x: 100, y: 6, z: 200 });
    // midpoint is the apex and sits on the straight xz line
    expect(pts[2]).toEqual({ x: 50, y: 236, z: 100 });
  });

  it("never produces fewer than two samples", () => {
    expect(crossArchPoints({ x: 0, z: 0 }, { x: 1, z: 1 }, 0, 0, 10)).toHaveLength(3);
  });
});
