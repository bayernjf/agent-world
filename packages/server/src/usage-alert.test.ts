import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLANS } from "@agent-world/core";
import { openDb } from "./db.js";
import { currentPeriodStart } from "./subscription.js";
import { alertTier, checkUsageAlerts } from "./usage-alert.js";

const PRO_LIMIT = PLANS.pro.tokens; // 2,000,000 normalized

describe("alertTier pure thresholds", () => {
  it("returns null below 80%, 80 at/above 80%, exhausted at/above 100%", () => {
    expect(alertTier("pro", 0.7)).toBeNull();
    expect(alertTier("pro", 0.8)).toBe("80");
    expect(alertTier("pro", 0.95)).toBe("80");
    expect(alertTier("pro", 1)).toBe("exhausted");
    expect(alertTier("pro", 1.3)).toBe("exhausted");
  });
  it("never alerts free users", () => {
    expect(alertTier("free", 0.9)).toBeNull();
    expect(alertTier("free", 2)).toBeNull();
  });
});

describe("checkUsageAlerts", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  let userId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "aw-usage-alert-"));
    db = openDb(join(dir, "s.sqlite"));
    userId = randomUUID();
    await db.createUser(userId, "paid@test.dev", "hash");
  });

  afterEach(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedPlan(plan: string, now: number) {
    const ps = currentPeriodStart(now);
    await db.saveSubscription(userId, plan, "active", { periodStart: ps, periodEnd: ps });
    return ps;
  }

  async function seedTokens(periodStart: number, normalized: number) {
    // normalized = in + 4*out; seed all as input tokens for simplicity.
    await db.accumulateUsage(userId, periodStart, "tokens_in", normalized);
  }

  async function alertCount() {
    const all = await db.listAnnouncements();
    return all.filter((a) => String(a.target) === `user:${userId}`);
  }

  it("does not alert at 70%", async () => {
    const now = Date.UTC(2026, 8, 15);
    const ps = await seedPlan("pro", now);
    await seedTokens(ps, PRO_LIMIT * 0.7);
    await checkUsageAlerts(db, userId, now);
    expect(await alertCount()).toHaveLength(0);
  });

  it("sends an info 80% alert at 85%", async () => {
    const now = Date.UTC(2026, 8, 15);
    const ps = await seedPlan("pro", now);
    await seedTokens(ps, PRO_LIMIT * 0.85);
    await checkUsageAlerts(db, userId, now);
    const alerts = await alertCount();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.level).toBe("info");
    expect(alerts[0]!.target).toBe(`user:${userId}`);
  });

  it("does not duplicate the same tier on a second run", async () => {
    const now = Date.UTC(2026, 8, 15);
    const ps = await seedPlan("pro", now);
    await seedTokens(ps, PRO_LIMIT * 0.85);
    await checkUsageAlerts(db, userId, now);
    await checkUsageAlerts(db, userId, now + 60_000);
    expect(await alertCount()).toHaveLength(1);
  });

  it("sends a warning exhausted alert at 100%", async () => {
    const now = Date.UTC(2026, 8, 15);
    const ps = await seedPlan("pro", now);
    await seedTokens(ps, PRO_LIMIT);
    await checkUsageAlerts(db, userId, now);
    const alerts = await alertCount();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.level).toBe("warning");
  });

  it("never alerts a free user even at/over quota", async () => {
    const now = Date.UTC(2026, 8, 15);
    const ps = await seedPlan("free", now);
    await seedTokens(ps, 1_000_000);
    await checkUsageAlerts(db, userId, now);
    expect(await alertCount()).toHaveLength(0);
  });

  it("re-arms the alert in a new billing month (period reset)", async () => {
    const sep = Date.UTC(2026, 8, 15);
    const psSep = await seedPlan("pro", sep);
    await seedTokens(psSep, PRO_LIMIT * 0.85);
    await checkUsageAlerts(db, userId, sep);
    expect(await alertCount()).toHaveLength(1);

    // October: a fresh period → different deterministic id → alert again.
    const oct = Date.UTC(2026, 9, 2);
    const psOct = currentPeriodStart(oct);
    await db.saveSubscription(userId, "pro", "active", { periodStart: psOct, periodEnd: psOct });
    await seedTokens(psOct, PRO_LIMIT * 0.9);
    await checkUsageAlerts(db, userId, oct);
    expect(await alertCount()).toHaveLength(2);
  });
});
