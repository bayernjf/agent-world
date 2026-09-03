import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

describe("performance metrics db (F6)", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-metrics-"));
    db = openDb(join(dir, "test.sqlite"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts and lists metric rows", () => {
    const m = db.insertMetric({
      id: "m1",
      userId: "u1",
      platform: "xiaohongshu",
      impressions: 1000,
      clicks: 50,
      conversions: 10,
      gmv: 500,
      adSpend: 100,
      recordedAt: 1700000000000,
    });
    expect(m.impressions).toBe(1000);
    expect(m.clicks).toBe(50);

    const rows = db.listMetrics("u1");
    expect(rows.length).toBe(1);
    expect(rows[0]!.gmv).toBe(500);
  });

  it("aggregates metrics by platform", () => {
    db.insertMetric({ id: "m1", userId: "u1", platform: "xiaohongshu", impressions: 100, clicks: 10, conversions: 1, gmv: 50, adSpend: 10, recordedAt: 1 });
    db.insertMetric({ id: "m2", userId: "u1", platform: "xiaohongshu", impressions: 200, clicks: 20, conversions: 2, gmv: 100, adSpend: 20, recordedAt: 2 });
    db.insertMetric({ id: "m3", userId: "u1", platform: "douyin", impressions: 300, clicks: 30, conversions: 3, gmv: 150, adSpend: 30, recordedAt: 3 });

    const agg = db.aggregatePerformance("u1", "platform");
    expect(agg.length).toBe(2);
    const xhs = agg.find((a) => a.group === "xiaohongshu");
    expect(xhs?.impressions).toBe(300);
    expect(xhs?.clicks).toBe(30);
    expect(xhs?.gmv).toBe(150);
  });

  it("scopes metrics by user", () => {
    db.insertMetric({ id: "m1", userId: "u1", impressions: 10, recordedAt: 1 });
    db.insertMetric({ id: "m2", userId: "u2", impressions: 20, recordedAt: 2 });
    expect(db.listMetrics("u1").length).toBe(1);
    expect(db.listMetrics("u2").length).toBe(1);
  });
});
