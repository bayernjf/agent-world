import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import {
  getOrCreateSubscription,
  setPlan,
  planOf,
  currentPeriodEnd,
} from "./subscriptionService.js";

describe("subscriptionService", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-sub-"));
    db = openDb(join(dir, "test.sqlite"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lazily creates a free-tier subscription on first access", async () => {
    const sub = await getOrCreateSubscription(db, "u1");
    expect(sub.plan).toBe("free");
    expect(sub.status).toBe("active");
    // second access returns the same row, no duplicate
    const again = await getOrCreateSubscription(db, "u1");
    expect(again.plan).toBe("free");
    expect(again.currentPeriodStart).toBe(sub.currentPeriodStart);
  });

  it("upgrades a plan instantly and keeps the billing period", async () => {
    const initial = await getOrCreateSubscription(db, "u1");
    const upgraded = await setPlan(db, "u1", "pro", "owner-1");
    expect(upgraded.plan).toBe("pro");
    expect(upgraded.currentPeriodStart).toBe(initial.currentPeriodStart);
    const reloaded = await getOrCreateSubscription(db, "u1");
    expect(reloaded.plan).toBe("pro");
  });

  it("planOf falls back to free for missing/malformed records", () => {
    expect(planOf(undefined)).toBe("free");
    expect(planOf({ plan: "bogus", status: "active" } as never)).toBe("free");
    expect(planOf({ plan: "team", status: "active" } as never)).toBe("team");
  });

  it("currentPeriodEnd is the first ms of the next UTC month", () => {
    const end = currentPeriodEnd(new Date("2026-09-15T12:00:00Z").getTime());
    const d = new Date(end);
    expect(d.getUTCMonth()).toBe(9); // October (0-indexed)
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(0);
  });
});
