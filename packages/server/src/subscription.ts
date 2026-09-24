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

/** 图中内置视频模型节点 id（一个成功节点 = 一个视频段，用于视频配额计量）。
 *  BYOK 视频（用户自带 API key）不占用平台配额，故不计入。 */
export function videoNodeIds(graph: Graph, config: AppConfig): string[] {
  return graph.nodes
    .filter((n) => n.kind === "videoGen" && isBuiltinModel(n.videoGen?.model ?? "", config))
    .map((n) => n.id);
}

/** 当前计费周期起始（UTC 对齐到月初，ms epoch）。 */
export function currentPeriodStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** 订阅状态全集（design-monetization §4.1 subscriptions.status）。 */
export const SUBSCRIPTION_STATUSES = ["active", "trialing", "canceled", "past_due"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function isSubscriptionStatus(value: string | undefined): value is SubscriptionStatus {
  return value !== undefined && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

export interface SubscriptionLike {
  plan: string;
  status: string;
  /** 订阅周期结束（ms epoch）。判断「已取消但仍在已付费期内」要用它。 */
  currentPeriodEnd?: number;
}

/**
 * 订阅状态是否还支持「用平台内置模型」（design-monetization §6.4）。
 *
 * - `past_due`（Stripe invoice.payment_failed）→ 内置模型阻断，BYOK 保留。
 *   §6.4 写的「宽限期 3-7 天」在这里做不到：subscriptions 没有记录状态何时变更的
 *   列，`updated_at` 会被 checkout 镜像、setPlan 等无关写入顶掉，拿它当「欠费起始
 *   时间」会得到一个会说谎的窗口（已登记 deferred-items，等加列）。所以先按最保守
 *   的可实现口径：欠费即断，欠费清了（invoice.paid）自动恢复。
 * - `canceled` → 只在已付费周期走完后才断。Stripe 在「期末取消」时也会先把状态
 *   写成 canceled，此时访问权仍在有效期内，不该提前收走。
 * - 其它值（active / trialing / 未来新增的）→ 视为有访问权：未知状态不该误伤付费用户。
 */
export function builtinAccessIntact(sub: SubscriptionLike, now: number): boolean {
  if (sub.status === "past_due") return false;
  if (sub.status === "canceled") {
    return sub.currentPeriodEnd != null && now <= sub.currentPeriodEnd;
  }
  return true;
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
  /** 注入时钟，用于判断「已取消但仍在其已付费周期内」。 */
  now?: number;
}

/** 图中是否含内置视频模型节点（BYOK 视频不计入平台配额）。 */
function hasBuiltinVideo(graph: Graph, config: AppConfig): boolean {
  return graph.nodes.some(
    (n) => n.kind === "videoGen" && isBuiltinModel(n.videoGen?.model ?? "", config),
  );
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
    // 套餐对但钱没到位：内置模型这一维按免费层对待（BYOK 不受影响）。
    if (!builtinAccessIntact(opts.subscription!, opts.now ?? Date.now())) {
      throw new QuotaError(
        "SUBSCRIPTION_INACTIVE",
        opts.subscription!.status === "past_due"
          ? "订阅欠费中，内置模型已暂停。请更新付款方式，扣款成功后自动恢复；自带 API Key 的模型不受影响。"
          : "订阅已于本周期结束后取消，内置模型已暂停。请重新订阅，或改用自带 API Key 的模型。",
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

  // Video segments are metered only for built-in video models (BYOK video is user-paid).
  if (hasBuiltinVideo(graph, config) && quota.videoSegments >= 0 && usedVideo >= quota.videoSegments) {
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
