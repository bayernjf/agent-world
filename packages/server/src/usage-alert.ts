/**
 * Usage alerts (M2 §S7): after a finished run, nudge paid users when their
 * built-in token usage crosses 80% / 100% of the monthly quota.
 *
 Design notes (code reality over the design doc's pseudocode):
 *  - Free users get no alert — they hit the 402 gate directly.
 *  - Only built-in tokens are alerted (dominant cost); video/storage are P2.
 *  - There is no generic per-user KV/flag store, so idempotency rides on the
 *    announcements table itself: each (user, billing-period, tier) maps to one
 *    deterministic announcement id. A repeat run finds the row and skips; a new
 *    UTC month changes periodStart, so alerts naturally re-arm.
 *  - Announcements are bilingual rows (the server has no i18next); the bell
 *    picks titleZh/bodyZh vs the En fields by UI language.
 */
import { PLANS, isPlanId, type PlanId } from "@agent-world/core";
import type { Db } from "./db.js";
import { log } from "./logger.js";
import { currentPeriodStart } from "./subscription.js";
import { currentUsage, getOrCreateSubscription, planOf } from "./subscriptionService.js";

export type AlertTier = "80" | "exhausted";

/**
 * Which alert (if any) a paid plan at `ratio` should fire. 100% wins over 80%;
 * below 80% returns null. Exported pure for unit tests.
 */
export function alertTier(plan: PlanId, ratio: number): AlertTier | null {
  if (plan === "free") return null;
  if (ratio >= 1) return "exhausted";
  if (ratio >= 0.8) return "80";
  return null;
}

/** Deterministic announcement id → one alert per user per period per tier. */
function alertId(userId: string, periodStart: number, tier: AlertTier): string {
  return `usage_alert:${userId}:${periodStart}:${tier}`;
}

function compact(n: number): string {
  return n.toLocaleString("en-US");
}

function bilingual(tier: AlertTier, ratio: number, used: number, limit: number) {
  const pct = Math.round(ratio * 100);
  if (tier === "exhausted") {
    return {
      titleZh: "内置模型 Token 已用尽",
      titleEn: "Built-in tokens exhausted",
      bodyZh: `本周期内置模型 Token 已用尽（已用 ${compact(used)}，额度 ${compact(limit)}）。升级套餐或等待下个计费周期重置后，可继续使用内置模型；也可在设置中改用自带模型（BYOK）。`,
      bodyEn: `This period's built-in tokens are exhausted (used ${compact(used)}, quota ${compact(limit)}). Upgrade, wait for the period to roll over, or switch to a custom model (BYOK) in settings.`,
      level: "warning",
    };
  }
  return {
    titleZh: "内置模型 Token 用量已达 80%",
    titleEn: "Built-in token usage at 80%",
    bodyZh: `本周期内置模型 Token 已使用约 ${pct}%，请注意用量，或升级更高套餐。`,
    bodyEn: `About ${pct}% of this period's built-in tokens are used. Keep an eye on usage or upgrade your plan.`,
    level: "info",
  };
}

/**
 * Inspect current usage and create the due threshold announcement, at most
 * once per tier per billing period. Never throws — called fire-and-forget from
 * the run.finished hook and must not change a run's terminal outcome.
 */
export async function checkUsageAlerts(db: Db, userId: string, now = Date.now()): Promise<void> {
  try {
    const sub = await getOrCreateSubscription(db, userId);
    const plan = planOf(sub);
    if (plan === "free") return;

    const usage = await currentUsage(db, userId, now);
    const limit = PLANS[plan].tokens;
    if (!isPlanId(plan) || limit <= 0) return;

    const ratio = usage.normalizedTokens / limit;
    const tier = alertTier(plan, ratio);
    if (!tier) return;

    const periodStart = currentPeriodStart(now);
    const id = alertId(userId, periodStart, tier);
    if (await db.getAnnouncement(id)) return; // already alerted this period+tier

    const text = bilingual(tier, ratio, usage.normalizedTokens, limit);
    await db.createAnnouncement({
      id,
      titleZh: text.titleZh,
      titleEn: text.titleEn,
      bodyZh: text.bodyZh,
      bodyEn: text.bodyEn,
      level: text.level,
      startsAt: now,
      endsAt: null,
      // Per-user targeting; resolved by announcementTargetsUser.
      target: `user:${userId}`,
    });
    log.info("usage alert created", { userId, plan, tier, ratio: Number(ratio.toFixed(3)) });
  } catch (err) {
    log.warn("usage alert check failed", { error: (err as Error)?.message ?? String(err) });
  }
}
