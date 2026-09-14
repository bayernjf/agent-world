/**
 * Subscription service — orchestration layer over the driver's subscription
 * / usage_ledger primitives (M2, design-monetization-m2-implementation §S2/S3).
 *
 * The driver only knows rows; this module owns the lifecycle rules:
 *  - existing users lazily land on the free tier (zero-breakage)
 *  - plan changes are instant (M2: no proration) and audited
 *  - usage is read for the current UTC calendar month
 *
 * All functions take `db` explicitly (dependency injection) so they are
 * trivially unit-testable with an in-memory driver.
 */
import type { Graph, PlanId } from "@agent-world/core";
import { DEFAULT_PLAN, PLANS, isPlanId, normalizeTokens } from "@agent-world/core";
import { audit } from "./audit.js";
import { currentPeriodStart, videoNodeIds } from "./subscription.js";
import type { Db } from "./db.js";
import type { AppConfig } from "./config.js";

export interface SubscriptionRecord {
  plan: string;
  status: string;
  provider: string | null;
  externalId: string | null;
  currentPeriodStart: number;
  currentPeriodEnd: number;
}

/** UTC end of the billing month (exclusive) — first ms of the next month. */
export function currentPeriodEnd(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * Load a user's subscription, lazily creating a free-tier record on first
 * access so pre-existing users keep working with no migration step.
 */
export async function getOrCreateSubscription(db: Db, userId: string): Promise<SubscriptionRecord> {
  const existing = await db.loadSubscription(userId);
  if (existing) return existing;
  return ensureFreeSubscription(db, userId);
}

/** The resolved plan id (falls back to free for malformed/legacy rows). */
export function planOf(sub: SubscriptionRecord | undefined): PlanId {
  return sub && isPlanId(sub.plan) ? sub.plan : DEFAULT_PLAN;
}

async function ensureFreeSubscription(db: Db, userId: string): Promise<SubscriptionRecord> {
  const now = Date.now();
  const periodStart = currentPeriodStart(now);
  const periodEnd = currentPeriodEnd(now);
  await db.saveSubscription(userId, DEFAULT_PLAN, "active", {
    provider: "manual",
    periodStart,
    periodEnd,
  });
  return {
    plan: DEFAULT_PLAN,
    status: "active",
    provider: "manual",
    externalId: null,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
  };
}

/**
 * Instantly change a user's plan (M2: manual owner action, no proration).
 * Writes a billing.plan_changed audit entry. Returns the new record.
 */
export async function setPlan(
  db: Db,
  targetUserId: string,
  plan: PlanId,
  actorId: string,
  ip?: string,
): Promise<SubscriptionRecord> {
  const before = await getOrCreateSubscription(db, targetUserId);
  const now = Date.now();
  await db.saveSubscription(targetUserId, plan, "active", {
    provider: before.provider ?? "manual",
    externalId: before.externalId ?? undefined,
    periodStart: before.currentPeriodStart,
    periodEnd: before.currentPeriodEnd,
  });
  audit(db, actorId, "billing.plan_changed", {
    objectType: "user",
    objectId: targetUserId,
    detail: { from: before.plan, to: plan },
    ip,
  });
  return { ...before, plan, status: "active" };
}

/**
 * Fold one finished run's metering into the usage ledger (online path, called
 * from the run.finished hook). Attribution uses the run's START time so a run
 * crossing a month boundary counts in the month it began. Idempotent only at
 * the run level via the caller (the finished hook fires once per run).
 */
export async function recordRunUsage(
  db: Db,
  userId: string,
  graph: Graph,
  runId: string,
  startedAt: number,
  config: AppConfig,
): Promise<{ normalizedTokens: number; videoSegments: number }> {
  const periodStart = currentPeriodStart(startedAt);
  const stats = await db.runStats(runId);
  const videoSegments = await db.countDoneNodes(runId, videoNodeIds(graph, config));
  await db.accumulateUsage(userId, periodStart, "tokens_in", stats.tokensIn);
  await db.accumulateUsage(userId, periodStart, "tokens_out", stats.tokensOut);
  await db.accumulateUsage(userId, periodStart, "runs", 1);
  if (videoSegments > 0) {
    await db.accumulateUsage(userId, periodStart, "video_segments", videoSegments);
  }
  return {
    normalizedTokens: normalizeTokens(stats.tokensIn, stats.tokensOut),
    videoSegments,
  };
}

export interface CurrentUsage {
  periodStart: number;
  periodEnd: number;
  tokensIn: number;
  tokensOut: number;
  /** Billable normalized tokens (in + 4×out). */
  normalizedTokens: number;
  runs: number;
  videoSegments: number;
  /** Live storage snapshot in bytes (not ledgered). */
  storageBytes: number;
}

/** Aggregate every usage dimension for the current billing period. */
export async function currentUsage(db: Db, userId: string, now = Date.now()): Promise<CurrentUsage> {
  const periodStart = currentPeriodStart(now);
  const [tokensIn, tokensOut, runs, videoSegments, storageBytes] = await Promise.all([
    db.usageFor(userId, "tokens_in", periodStart),
    db.usageFor(userId, "tokens_out", periodStart),
    db.usageFor(userId, "runs", periodStart),
    db.usageFor(userId, "video_segments", periodStart),
    db.sumArtifactBytes(userId),
  ]);
  return {
    periodStart,
    periodEnd: currentPeriodEnd(now),
    tokensIn,
    tokensOut,
    normalizedTokens: normalizeTokens(tokensIn, tokensOut),
    runs,
    videoSegments,
    storageBytes,
  };
}

/** Remaining quota view for a plan (negative fields mean over-quota). */
export function quotaRemaining(plan: PlanId, usage: CurrentUsage) {
  const q = PLANS[plan];
  return {
    tokens: q.tokens - usage.normalizedTokens,
    concurrentRuns: q.concurrentRuns, // checked live, not from usage
    storageBytes: q.storageBytes - usage.storageBytes,
    videoSegments: q.videoSegments - usage.videoSegments,
  };
}
