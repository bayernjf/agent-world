/**
 * Subscription plans — single source of truth for plan quotas and prices
 * (design-monetization §4/§5, M2 implementation).
 *
 * Quotas and prices here are calibrated against the M1 cost-backfill data
 * (125 runs / $5.57, 2026-09-08 → 2026-09-13; see design-monetization.md §4.1).
 * Both server (gate, API) and web (billing page, usage panel) import from here
 * so the numbers never drift apart.
 */

export type PlanId = "free" | "starter" | "pro" | "team";

export const PLAN_IDS: PlanId[] = ["free", "starter", "pro", "team"];

export const DEFAULT_PLAN: PlanId = "free";

export interface PlanQuota {
  /** Monthly built-in-model token ceiling (normalized tokens, see normalizeTokens). */
  tokens: number;
  /** Maximum simultaneously running pipelines. */
  concurrentRuns: number;
  /** Artifact storage ceiling in bytes (snapshot value). */
  storageBytes: number;
  /** Monthly generated video-segment ceiling (one successful videoGen = one segment). */
  videoSegments: number;
}

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

export const PLANS: Record<PlanId, PlanQuota> = {
  free: { tokens: 0, concurrentRuns: 1, storageBytes: 100 * MB, videoSegments: 0 },
  starter: { tokens: 500_000, concurrentRuns: 2, storageBytes: 5 * GB, videoSegments: 2 },
  pro: { tokens: 2_000_000, concurrentRuns: 5, storageBytes: 50 * GB, videoSegments: 10 },
  team: { tokens: 10_000_000, concurrentRuns: 20, storageBytes: 500 * GB, videoSegments: 50 },
};

/** Monthly subscription price in USD (M1-calibrated, design-monetization §4.1). */
export const PLAN_PRICES: Record<PlanId, number> = {
  free: 0,
  starter: 9,
  pro: 29,
  team: 149,
};

export function isPlanId(v: unknown): v is PlanId {
  return v === "free" || v === "starter" || v === "pro" || v === "team";
}

/**
 * Normalize raw token usage into a single billable figure. Output tokens are
 * weighted 4× input (industry-common 3–4× ratio; output is the cost driver in
 * the M1 data). design-monetization §5.5.
 */
export function normalizeTokens(inputTokens: number, outputTokens: number): number {
  return Math.max(0, inputTokens) + Math.max(0, outputTokens) * 4;
}

/** Usage metrics accumulated in usage_ledger (storage_bytes is a live snapshot, not ledgered). */
export type UsageMetric =
  | "tokens_in"
  | "tokens_out"
  | "runs"
  | "video_segments";
