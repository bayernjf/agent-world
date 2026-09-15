/**
 * Demo (try-before-signup) accounts — design-demo-user.md.
 *
 * A demo account is a real `users` row flagged is_demo=1; it is NOT a plan and
 * never enters PLANS / Stripe. Its limits live here so the pricing table stays
 * untouched. Two distinct gates:
 *
 *  - DemoQuotaError / enforceDemoQuota: usage ceilings at run dispatch (tokens,
 *    total runs, concurrency, storage, media). Shaped exactly like QuotaError so
 *    the run route and the web client can treat both as a 402, while the DEMO_*
 *    code makes the UI nudge "sign up to keep your work" instead of "upgrade".
 *  - DemoForbiddenError / assertNotDemo: hard capability blacklist (change
 *    password, publish/webhook egress, remote MCP, custom connectors, admin,
 *    billing). The route maps this to 403 DEMO_LOCKED.
 */
import type { Graph } from "@agent-world/core";
import type { AppConfig } from "./config.js";
import { isBuiltinModel, modelRefs } from "./subscription.js";

const MB = 1024 * 1024;

/** Demo experience ceilings (defaults; overridable via DEMO_QUOTA_* env at boot). */
export interface DemoQuota {
  /** Total normalized tokens for the whole demo lifetime (not per month). */
  tokens: number;
  /** Hard cap on the number of runs over the whole demo lifetime. */
  maxRunsTotal: number;
  /** Simultaneously running pipelines. */
  concurrentRuns: number;
  /** Artifact storage ceiling in bytes (live snapshot). */
  storageBytes: number;
  /** Built-in media segments — 0 means video/audio generation is blocked. */
  videoSegments: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const DEMO_QUOTA: DemoQuota = {
  tokens: envNumber("DEMO_QUOTA_TOKENS", 30_000),
  maxRunsTotal: envNumber("DEMO_QUOTA_MAX_RUNS", 15),
  concurrentRuns: 1,
  storageBytes: envNumber("DEMO_QUOTA_STORAGE_MB", 20) * MB,
  videoSegments: 0,
};

/** Demo account lifetime. The row is cascade-deleted by prune-demo-users after it. */
export const DEMO_TTL_MS = envNumber("DEMO_TTL_HOURS", 24) * 60 * 60 * 1000;

export type DemoQuotaCode =
  | "DEMO_QUOTA_TOKENS"
  | "DEMO_QUOTA_RUNS"
  | "DEMO_QUOTA_CONCURRENCY"
  | "DEMO_QUOTA_STORAGE"
  | "DEMO_QUOTA_MEDIA";

/** Same shape as subscription.QuotaError, but the code/plan mark it as a demo. */
export class DemoQuotaError extends Error {
  constructor(
    public readonly code: DemoQuotaCode,
    message: string,
    public readonly metric: string,
    public readonly detail: { plan: "demo"; limit: number; used: number },
  ) {
    super(message);
    this.name = "DemoQuotaError";
  }
}

export interface DemoEnforceOptions {
  /** Normalized tokens already consumed across the whole demo lifetime. */
  usedTokens: number;
  /** Runs already started across the whole demo lifetime. */
  totalRuns: number;
  /** Currently active runs. */
  activeRuns: number;
  /** Occupied artifact storage in bytes (live snapshot). */
  usedStorageBytes?: number;
}

/** True when the graph contains a built-in (platform-paid) videoGen/audioGen node. */
export function hasBuiltinMedia(graph: Graph, config: AppConfig): boolean {
  return graph.nodes.some((n) => {
    if (n.kind !== "videoGen" && n.kind !== "audioGen") return false;
    const model =
      n.kind === "videoGen" ? n.videoGen?.model : n.audioGen?.model;
    return !!model && isBuiltinModel(model, config);
  });
}

/**
 * Demo dispatch gate (mirrors enforceSubscription but for a demo lifetime).
 * Unlike the free plan (tokens=0, which blocks even text under
 * MONETIZATION_ENFORCE=1), a demo gets a small token pool so text pipelines run;
 * media is always blocked. Throws DemoQuotaError to block, returns to allow.
 */
export function enforceDemoQuota(graph: Graph, config: AppConfig, opts: DemoEnforceOptions): void {
  const usedStorage = opts.usedStorageBytes ?? 0;

  // Platform-paid media is never available in a demo (videoSegments = 0).
  if (DEMO_QUOTA.videoSegments <= 0 && hasBuiltinMedia(graph, config)) {
    throw new DemoQuotaError(
      "DEMO_QUOTA_MEDIA",
      "演示账号不支持视频/音频生成，注册转正后即可使用。",
      "media",
      { plan: "demo", limit: 0, used: 1 },
    );
  }

  // Text/builtin-model token pool (this is what lets a demo actually run text
  // while the free plan would be blocked).
  const builtins = modelRefs(graph).filter((m) => isBuiltinModel(m, config));
  if (builtins.length > 0 && opts.usedTokens >= DEMO_QUOTA.tokens) {
    throw new DemoQuotaError(
      "DEMO_QUOTA_TOKENS",
      `演示额度已用尽（${DEMO_QUOTA.tokens.toLocaleString()} 折算 token），注册转正后保留全部工作并获得正式额度。`,
      "tokens",
      { plan: "demo", limit: DEMO_QUOTA.tokens, used: opts.usedTokens },
    );
  }

  if (opts.totalRuns >= DEMO_QUOTA.maxRunsTotal) {
    throw new DemoQuotaError(
      "DEMO_QUOTA_RUNS",
      `演示最多运行 ${DEMO_QUOTA.maxRunsTotal} 次，注册转正后不限演示次数并保留已有产线。`,
      "runs",
      { plan: "demo", limit: DEMO_QUOTA.maxRunsTotal, used: opts.totalRuns },
    );
  }

  if (usedStorage >= DEMO_QUOTA.storageBytes) {
    throw new DemoQuotaError(
      "DEMO_QUOTA_STORAGE",
      "演示存储空间已用尽，注册转正后获得更大空间。",
      "storage",
      { plan: "demo", limit: DEMO_QUOTA.storageBytes, used: usedStorage },
    );
  }

  if (opts.activeRuns >= DEMO_QUOTA.concurrentRuns) {
    throw new DemoQuotaError(
      "DEMO_QUOTA_CONCURRENCY",
      "演示账号同时只能运行一条产线，请等当前运行结束。",
      "concurrency",
      { plan: "demo", limit: DEMO_QUOTA.concurrentRuns, used: opts.activeRuns },
    );
  }
}

/** A capability that is permanently locked for demo accounts. */
export type DemoFeature =
  | "password"
  | "publish"
  | "webhook"
  | "remote_mcp"
  | "custom_connector"
  | "admin"
  | "billing"
  | "team";

/** 403 at the route: demo accounts may not touch this feature. */
export class DemoForbiddenError extends Error {
  constructor(
    public readonly feature: DemoFeature,
    message?: string,
  ) {
    super(message ?? `feature "${feature}" is locked for demo accounts`);
    this.name = "DemoForbiddenError";
  }
}

/**
 * Throw DemoForbiddenError when the actor is a demo. Pass the resolved is_demo
 * flag (UserRow.is_demo === 1) so this stays free of DB shape assumptions.
 */
export function assertNotDemo(isDemo: boolean, feature: DemoFeature): void {
  if (isDemo) throw new DemoForbiddenError(feature);
}
