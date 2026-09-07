import type { Graph } from "@agent-world/core";
import type { AppConfig } from "./config.js";
import { providerForModel } from "./config.js";
import { PLANS, DEFAULT_PLAN, isPlanId } from "./plans.js";

/** Quota violation, surfaced at dispatch (before any request fires). */
export class QuotaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
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

/** 当前计费周期起始（UTC 对齐到月初，ms epoch）。 */
export function currentPeriodStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export interface SubscriptionLike {
  plan: string;
  status: string;
}

export interface EnforceOptions {
  /** 订阅（缺省 = free 层） */
  subscription?: SubscriptionLike;
  /** 当前周期已用 token（折算 token，design-monetization §5.5） */
  usedTokens: number;
  /** 当前活跃 run 数 */
  activeRuns: number;
}

/**
 * 订阅 gate（design-monetization §5.3）。
 * - 免费层不可用内置模型（否则平台白嫖代付成本）；
 * - 付费层检查 token 余额（内置模型）与并发上限；
 * - BYOK（自定义模型）完全放行，仅受并发约束。
 * 抛 QuotaError 表示阻断；返回 void 表示放行。纯函数，依赖经 opts 注入。
 */
export function enforceSubscription(graph: Graph, config: AppConfig, opts: EnforceOptions): void {
  const plan = opts.subscription?.plan ?? DEFAULT_PLAN;
  const quota = PLANS[isPlanId(plan) ? plan : DEFAULT_PLAN];

  const builtins = modelRefs(graph).filter((m) => isBuiltinModel(m, config));
  if (builtins.length > 0) {
    if (plan === "free") {
      throw new QuotaError(
        "QUOTA_EXCEEDED",
        "免费层不可用内置模型（如 agnes）。请升级套餐，或改用自带 API Key 的自定义模型。",
      );
    }
    if (opts.usedTokens >= quota.tokens) {
      throw new QuotaError(
        "QUOTA_EXCEEDED",
        `本月内置模型额度已用尽（${quota.tokens.toLocaleString()} token），请加购或升级。`,
      );
    }
  }

  if (opts.activeRuns >= quota.concurrentRuns) {
    throw new QuotaError(
      "CONCURRENCY_EXCEEDED",
      `并发上限 ${quota.concurrentRuns} 已满，请等待当前 run 完成后再试。`,
    );
  }
}
