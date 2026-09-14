import type { Graph, PlanId } from "@agent-world/core";
import type { AppConfig } from "./config.js";
import { providerForModel } from "./config.js";
import { PLANS, DEFAULT_PLAN, isPlanId } from "./plans.js";

/** Quota violation, surfaced at dispatch (before any request fires). */
export class QuotaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly metric?: QuotaMetric,
    public readonly detail?: { plan: PlanId; limit: number; used: number },
  ) {
    super(message);
    this.name = "QuotaError";
  }
}

/** 提取图中所有节点引用的模型名（去重）。 */
export function modelRefs(graph: Graph): string[] {
  const out = new Set<string>();
  for (const n of graph.nodes) {
    const cfg =
      n.kind === "textGen" ? n.textGen :
      n.kind === "imageGen" ? n.imageGen :
      n.kind === "videoGen" ? n.videoGen :
      n.kind === "audioGen" ? n.audioGen :
      n.kind === "generic" ? n.generic : null;
    const model = (cfg as { model?: string } | null)?.model?.trim();
    if (model) out.add(model);
  }
  return [...out];
}

/** 内置模型 = provider.source === "builtin"（agnes 等平台代付模型）。 */
export function isBuiltinModel(model: string, config: AppConfig): boolean {
  return providerForModel(config, model).provider.source === "builtin";
}

/** 图中所有 videoGen 节点 id（一个成功节点 = 一个视频段，用于视频配额计量）。 */
export function videoNodeIds(graph: Graph): string[] {
  return graph.nodes.filter((n) => n.kind === "videoGen").map((n) => n.id);
}

/** 当前计费周期起始（UTC 对齐到月初，ms epoch）。 */
export function currentPeriodStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export interface SubscriptionLike {
  plan: string;
  status: string;
}

export type QuotaMetric = "builtin_model" | "tokens" | "concurrency" | "video" | "storage";

export interface EnforceOptions {
  /** 订阅（缺省 = free 层） */
  subscription?: SubscriptionLike;
  /** 当前周期已用折算 token（normalizeTokens = in + 4×out，调用方折算好传入） */
  usedTokens: number;
  /** 当前活跃 run 数 */
  activeRuns: number;
  /** 当前周期已成功生成的视频段数（仅图含 videoGen 时检查） */
  usedVideoSegments?: number;
  /** 当前已占用存储字节（实时快照） */
  usedStorageBytes?: number;
}

function graphHasVideo(graph: Graph): boolean {
  return graph.nodes.some((n) => n.kind === "videoGen");
}

/**
 * 订阅 gate（design-monetization §5.3 / M2 §S4）。
 * - 免费层不可用内置模型（否则平台白嫖代付成本）；
 * - 付费层检查折算 token 余额、视频段数、存储与并发上限；
 * - BYOK（自定义模型）绕过内置模型/token 限制，但仍受视频、存储、并发约束。
 * 抛 QuotaError 表示阻断；返回 void 表示放行。纯函数，依赖经 opts 注入。
 * QuotaError 携带稳定 metric + {plan,limit,used}，前端据此本地化 402 引导。
 */
export function enforceSubscription(graph: Graph, config: AppConfig, opts: EnforceOptions): void {
  const planId = isPlanId(opts.subscription?.plan ?? "") ? (opts.subscription!.plan as PlanId) : DEFAULT_PLAN;
  const quota = PLANS[planId];
  const usedVideo = opts.usedVideoSegments ?? 0;
  const usedStorage = opts.usedStorageBytes ?? 0;

  const builtins = modelRefs(graph).filter((m) => isBuiltinModel(m, config));
  if (builtins.length > 0) {
    if (planId === "free") {
      throw new QuotaError(
        "QUOTA_EXCEEDED",
        "免费层不可用内置模型（如 agnes）。请升级套餐，或改用自带 API Key 的自定义模型。",
        "builtin_model",
        { plan: planId, limit: 0, used: 1 },
      );
    }
    if (opts.usedTokens >= quota.tokens) {
      throw new QuotaError(
        "QUOTA_EXCEEDED",
        `本月内置模型额度已用尽（${quota.tokens.toLocaleString()} 折算 token），请加购或升级。`,
        "tokens",
        { plan: planId, limit: quota.tokens, used: opts.usedTokens },
      );
    }
  }

  // Video segments are metered for every plan (free quota is 0 → upgrade required).
  if (graphHasVideo(graph) && quota.videoSegments >= 0 && usedVideo >= quota.videoSegments) {
    throw new QuotaError(
      "QUOTA_EXCEEDED",
      `本月视频生成额度已用尽（${quota.videoSegments} 段），请加购或升级套餐。`,
      "video",
      { plan: planId, limit: quota.videoSegments, used: usedVideo },
    );
  }

  if (usedStorage >= quota.storageBytes) {
    throw new QuotaError(
      "QUOTA_EXCEEDED",
      `存储空间已用尽（${formatBytes(quota.storageBytes)}），请清理产物或升级套餐。`,
      "storage",
      { plan: planId, limit: quota.storageBytes, used: usedStorage },
    );
  }

  if (opts.activeRuns >= quota.concurrentRuns) {
    throw new QuotaError(
      "CONCURRENCY_EXCEEDED",
      `并发上限 ${quota.concurrentRuns} 已满，请等待当前 run 完成后再试。`,
      "concurrency",
      { plan: planId, limit: quota.concurrentRuns, used: opts.activeRuns },
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(0)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
