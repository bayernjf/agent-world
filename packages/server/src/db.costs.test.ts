import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

describe("content costs db (F9)", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-costs-"));
    db = openDb(join(dir, "test.sqlite"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts a cost snapshot and computes roi = gmv / cost", () => {
    const c = db.insertContentCost({
      id: "c1",
      userId: "u1",
      platform: "xiaohongshu",
      costUsd: 0.5,
      gmv: 100,
      capturedAt: 1700000000000,
    });
    expect(c.costUsd).toBe(0.5);
    expect(c.gmv).toBe(100);
    expect(c.roi).toBe(200);

    const rows = db.listContentCosts("u1");
    expect(rows.length).toBe(1);
    expect(rows[0]!.roi).toBe(200);
  });

  it("aggregates costs by platform and recomputes roi", () => {
    db.insertContentCost({ id: "c1", userId: "u1", platform: "xiaohongshu", costUsd: 0.5, gmv: 100, capturedAt: 1 });
    db.insertContentCost({ id: "c2", userId: "u1", platform: "xiaohongshu", costUsd: 0.5, gmv: 50, capturedAt: 2 });
    db.insertContentCost({ id: "c3", userId: "u1", platform: "douyin", costUsd: 1.0, gmv: 300, capturedAt: 3 });

    const agg = db.aggregateContentCosts("u1", "platform");
    expect(agg.length).toBe(2);
    const xhs = agg.find((a) => a.group === "xiaohongshu");
    expect(xhs?.costUsd).toBe(1);
    expect(xhs?.gmv).toBe(150);
    expect(xhs?.roi).toBe(150);
  });

  it("scopes costs by user", () => {
    db.insertContentCost({ id: "c1", userId: "u1", costUsd: 1, capturedAt: 1 });
    db.insertContentCost({ id: "c2", userId: "u2", costUsd: 2, capturedAt: 2 });
    expect(db.listContentCosts("u1").length).toBe(1);
    expect(db.aggregateContentCosts("u2", "platform").length).toBe(1);
  });
});
