import { create } from "zustand";

/** Quota dimensions the gate can block on (mirrors server enforceSubscription). */
export type QuotaMetric = "builtin_model" | "tokens" | "video" | "storage" | "concurrency";

export interface QuotaBlock {
  code: string;
  metric: QuotaMetric | null;
  plan: string;
  limit: number;
  used: number;
}

interface UpgradeGateState {
  block: QuotaBlock | null;
  /** Open the gate from a structured 402 payload. */
  open: (block: QuotaBlock) => void;
  close: () => void;
}

export const useUpgradeGate = create<UpgradeGateState>((set) => ({
  block: null,
  open: (block) => set({ block }),
  close: () => set({ block: null }),
}));

/**
 * The web api client throws `Error("<status> <body-text>")` on non-2xx (see
 * lib/api.ts `json`). Pull a structured subscription 402 back out of that
 * string so the run flow can surface the UpgradeGate instead of a raw toast.
 * Returns null for every other error.
 */
export function parseQuotaError(err: unknown): QuotaBlock | null {
  if (!(err instanceof Error)) return null;
  const match = /^402\s+([\s\S]+)$/.exec(err.message);
  if (!match) return null;
  try {
    const body = JSON.parse(match[1]!) as {
      error?: string;
      code?: string;
      metric?: QuotaMetric | null;
      detail?: { plan?: string; limit?: number; used?: number } | null;
    };
    if (body.error !== "subscription") return null;
    return {
      code: body.code ?? "QUOTA_EXCEEDED",
      metric: body.metric ?? null,
      plan: body.detail?.plan ?? "free",
      limit: body.detail?.limit ?? 0,
      used: body.detail?.used ?? 0,
    };
  } catch {
    return null;
  }
}
