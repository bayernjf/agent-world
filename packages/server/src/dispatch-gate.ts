import type { Graph } from "@agent-world/core";
import type { Db } from "./db.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { DemoQuotaError, enforceDemoQuota } from "./demo.js";
import { enforceSubscription, QuotaError } from "./subscription.js";
import { currentUsage, getOrCreateSubscription } from "./subscriptionService.js";

/**
 * run 派发闸门的唯一入口。
 *
 * 为什么在这里而不是在路由里：`startRun()` 是所有派发的必经之路（手动 / 重跑 /
 * 批量 / cron·webhook·事件触发器 / AB / MCP）。闸门原先挂在 `POST /api/runs` 的
 * handler 里，其余四条路各自绕开——2026-09-25 逐调用点核实：5 个 startRun 调用
 * 点，1 个被拦。同址先例是 `run.ts` 的月度预算硬熔断，它的注释就写着「覆盖
 * manual / trigger / batch 全部入口（都经 startRun）」。
 */

export type EnforceMode = "off" | "observe" | "enforce";

/**
 * `MONETIZATION_ENFORCE` 的解析。
 *
 * 旧写法 `process.env.MONETIZATION_ENFORCE === "1"` 叠了三重坑：`true` / `"1 "` /
 * 拼错都静默等于「关」，而部署手册的紧急回滚又引用了一个根本不存在的变量名
 * （`ENABLE_SUBSCRIPTION_GATE`）——足以让人在事故里判断错当前状态。现在认
 * 1/true/yes，多一个 observe 档，其余非空值大声报出来再按关处理。
 */
export function readEnforceMode(raw: string | undefined = process.env.MONETIZATION_ENFORCE): EnforceMode {
  const value = (raw ?? "").trim();
  if (value === "") return "off";
  if (value === "1" || value === "true" || value === "yes") return "enforce";
  if (value === "observe" || value === "log") return "observe";
  log.warn("MONETIZATION_ENFORCE has an unrecognized value; treating the subscription gate as OFF", {
    value,
    accepted: "1|true|yes (enforce), observe|log (log only), empty/unset (off)",
  });
  return "off";
}

export interface GateContext {
  db: Db;
  graph: Graph;
  /** 图所有者。run 以 owner 身份执行，配额也按 owner 计（与 config/成本口径一致）。 */
  userId: string;
  /** 派发来源，写进日志供灰度观察：manual / rerun / batch / <triggerId> … */
  trigger: string;
  mode?: EnforceMode;
}

/**
 * demo 额度与订阅配额是两套东西，模式只管后者：demo 的限额**永远生效**——Hasee
 * 就是 ENFORCE=1 且 free tokens=0，若 demo 也听 mode，演示账号一步都跑不动
 * （design-demo-user 把这条列为「最容易踩的坑」）。
 *
 * `observe` 档照常评估并记 `would block`，但不抛，给新被盖住的那四条路一个灰度
 * 观察窗口（m2 手册第 6 步本就要求「先灰度观察计量是否准确」）。
 *
 * 抛 QuotaError / DemoQuotaError，由 `quotaResponseBody` 统一映射成 402。
 */
export async function dispatchGate(ctx: GateContext): Promise<void> {
  const { db, graph, userId, trigger } = ctx;
  const usage = await currentUsage(db, userId);
  const activeRuns = await db.activeRuns(userId);
  const config = await loadConfig(userId);

  const user = await db.findUserById(userId);
  if (user?.is_demo === 1) {
    enforceDemoQuota(graph, config, {
      usedTokens: usage.normalizedTokens,
      totalRuns: usage.runs,
      activeRuns,
      usedStorageBytes: usage.storageBytes,
    });
    return;
  }

  const mode = ctx.mode ?? readEnforceMode();
  if (mode === "off") return;
  try {
    enforceSubscription(graph, config, {
      // getOrCreate 而非 load：与其它 monetization 入口（席位闸、账单）同一套惰性
      // 落免费层的读法，也让配额判定永远有个真实行可读，而不是把「没有行」和
      // 「free 且 active」两种状态压成同一个 undefined。
      subscription: await getOrCreateSubscription(db, userId),
      usedTokens: usage.normalizedTokens,
      activeRuns,
      usedVideoSegments: usage.videoSegments,
      usedStorageBytes: usage.storageBytes,
    });
  } catch (err) {
    if (!(err instanceof QuotaError || err instanceof DemoQuotaError)) throw err;
    if (mode !== "observe") throw err;
    log.warn("subscription gate would block dispatch (observe mode)", {
      userId,
      graphId: graph.id,
      trigger,
      code: err.code,
      metric: err.metric ?? null,
      detail: err.detail ?? null,
      message: err.message,
    });
  }
}

/** 被拦派发回给客户端的 402 体。 */
export type QuotaResponseBody =
  | {
      error: "subscription";
      code: string;
      metric: string | null;
      detail: unknown;
      /** Internal anchor: the web app opens Settings → billing tab (no router). */
      upgradeUrl: "settings:billing";
      message: string;
    }
  | {
      error: "demo_quota";
      code: string;
      metric: string;
      detail: unknown;
      /** Internal anchor: the web app opens the claim dialog (keep work). */
      claimUrl: "/login?claim=1";
      message: string;
    };

/**
 * 每条走 HTTP 的派发路都回同一个形状——前端 `upgrade-gate.ts` 按 `error` 字段分流
 * （subscription → 升级引导，demo_quota → 转正引导），少一个字段就静默不弹。
 * 非配额错误返回 null，交回调用方继续抛。
 */
export function quotaResponseBody(err: unknown): QuotaResponseBody | null {
  if (err instanceof QuotaError) {
    return {
      error: "subscription",
      code: err.code,
      metric: err.metric ?? null,
      detail: err.detail ?? null,
      upgradeUrl: "settings:billing",
      message: err.message,
    };
  }
  if (err instanceof DemoQuotaError) {
    return {
      error: "demo_quota",
      code: err.code,
      metric: err.metric,
      detail: err.detail ?? null,
      claimUrl: "/login?claim=1",
      message: err.message,
    };
  }
  return null;
}
