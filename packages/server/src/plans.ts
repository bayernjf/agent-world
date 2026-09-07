/**
 * Subscription plan quota definitions — single source of truth
 * (design-monetization §5.2).
 *
 * ⚠️ PLACEHOLDER: the prices and quotas below are the §4 defaults and are NOT
 * calibrated against real cost data yet. Fill them in after M1 cost backfill
 * (design-monetization §10.2). Everything here is runtime-editable, so the
 * test/pre-production environment can run with placeholder values freely.
 */

export type PlanId = "free" | "starter" | "pro" | "team";

export interface PlanQuota {
  /** 内置模型月 token 上限（折算 token，见 design-monetization §5.5） */
  tokens: number;
  concurrentRuns: number;
  storageBytes: number;
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

/** ⚙️ 占位月价（美元锚点，待成本校准） */
export const PLAN_PRICES: Record<PlanId, number> = {
  free: 0,
  starter: 19,
  pro: 49,
  team: 199,
};

export const DEFAULT_PLAN: PlanId = "free";

export function isPlanId(v: unknown): v is PlanId {
  return v === "free" || v === "starter" || v === "pro" || v === "team";
}
