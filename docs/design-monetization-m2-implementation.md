# M2 订阅 gate 落地实施方案（design-monetization-m2-implementation）

> 定位：对 [design-monetization.md](design-monetization.md) §5「配额与订阅 gate」+ §9 P1 阶段的**落地级细化**，结合当前代码库（2026-09-14）实际状态，给出可执行的分步骤实施计划、文件清单、迁移方案、测试策略与回滚方案。
>
> 状态：**实施中（2026-09-14 启动）**。S1 无需新建迁移（表已存在于迁移 34）；S2 ✅ commit `1d7a3e4`（plans.ts 单一事实源 + subscriptionService）；S3 ✅ commit `8a8a32f`（用量计量 + 幂等回填 CLI）；S4 ✅ commit `7dece12`（gate 五维检查 + 结构化 402，25 测试全绿，=唯一 checkpoint）。S5-S8 待续（S4 后暂停等用户 review gate 设计）。M1 成本计量回采已完成（125 runs / $5.57 总成本），套餐价格已校准（Starter $9 / Pro $29 / Team $149，见 design-monetization.md §4.1）。
>
> 实施偏差记录（以代码现状为准，非方案预设）：① 无需新建 enforce-subscription.ts，enforceSubscription 已在 subscription.ts；② QuotaError 统一 code=QUOTA_EXCEEDED + 稳定 metric 字段（builtin_model/tokens/video/storage/concurrency），而非方案的独立 error code；③ 402 body 暂未加 upgradeUrl（S6 定路由后补）；④ gate feature flag `MONETIZATION_ENFORCE=1` 默认关闭；⑤ 视频检查对所有 plan 生效（free 配额=0 故免费层连 BYOK 视频也拦）。
>
> 约定：延续项目惯例——原子提交、英文 commit message、不加助手署名、不 push；typecheck 四包绿、全量测试通过；i18n + 设计 token；DB 迁移双写（sqlite base DDL + 迁移版本 + PG toPgDdl）。

## 一、当前代码库复用盘点（2026-09-14 复核）

| 已有能力 | 文件 | M2 复用方式 |
|---|---|---|
| 派发前模型校验 | `validate-models.ts`（validateModels 函数） | **直接复用挂点**：在 validateModels 之后、execute 之前插入 enforceSubscription，复用现有 ModelDiagnostic 错误通道 |
| 派发入口 | `index.ts`（POST /api/runs → validateModels → execute） | **扩展**：在 validateModels 调用后增加 enforceSubscription 调用 |
| 成本计量（node_runs.model / cost_usd / tokens） | `run.ts` / `engine.ts` / `sqlite-driver.ts`（迁移 36） | **直接复用**：用量计量从现有 node_runs/runs/artifacts 表聚合，无需新增计量埋点 |
| 成本报表 byModel 聚合 | `costs.ts` / `api.costs.ts` | **复用模式**：usage_ledger 的聚合查询参考 byModel 的实现方式 |
| 单价缺口审计 unpricedModels | `core` 包 / `config.ts` | **复用模式**：PLANS 配额定义放在 core 包，与 unpricedModels 同层 |
| RBAC 角色权限 | `rbac.ts` / `api.rbac.test.ts`（迁移 31） | **直接复用**：管理员改套餐 API 复用 owner/admin 权限校验 |
| 公告/通知系统 | `announcement.ts` / `AnnouncementBell.tsx` | **复用**：用量预警（80%/100%）通过公告系统触达 |
| 静态加密 at-rest | `at-rest.ts`（enc:v2:） | **复用**：支付凭据（P2 阶段）落盘走静态加密，M2 暂不涉及 |
| 审计日志 | `audit-log.ts`（迁移 33） | **复用**：套餐变更/额度调整记 audit_log（billing.* 动作词） |
| 数据库迁移机制 | `sqlite-driver.ts`（schema_migrations 表，当前版本 37）+ `pg-driver.ts` + `pg-sql.ts` | **直接复用**：M2 需要迁移 38（subscriptions）+ 39（usage_ledger），双写 sqlite + PG |
| 前端 MissingModelHint 模式 | `apps/web/src/components/MissingModelHint.tsx`（推测） | **复用模式**：免费层内置模型阻断的升级引导 UI 参考 MissingModelHint 的交互模式 |
| i18n 国际化 | `apps/web/src/i18n/`（7 命名空间） | **必须复用**：新增 billing 命名空间，所有 UI 文案走 t() |
| 设计 token 体系 | `apps/web/src/styles/tokens.css`（primitive/semantic/light 三层） | **必须复用**：升级引导卡片、用量进度条使用现有 token，不硬编码颜色 |

**结论**：M2 的核心新增量集中在：① 两张新表（subscriptions / usage_ledger）；② plans.ts 配额定义 + subscriptionService；③ enforceSubscription gate 逻辑；④ 3 个 API 端点；⑤ 前端升级引导 + 用量面板。**不是从零搭建计费系统，是在现有成本计量 + RBAC + 公告基础上加装订阅 gate。**

## 二、范围与边界

### 做（M2 / P1 范围）

- `subscriptions` / `usage_ledger` 两张表（迁移 38/39，sqlite + PG 双写）
- `plans.ts` 配额定义（PLANS 单一事实源，4 档 quota）
- `subscriptionService.ts`：loadSubscription / usageFor / recordUsage / setPlan
- 用量回填脚本：从现有 node_runs/runs/artifacts 聚合回填 usage_ledger（幂等）
- `enforceSubscription()` 挂入派发流程（validateModels 之后、execute 之前）
- 内置模型访问控制：免费层 QUOTA_EXCEEDED + 前端升级引导
- 硬配额四维检查：token / 并发 / 存储 / 视频段
- `POST /api/admin/users/:id/plan`（owner 手动开通/改套餐，MVP 绕过支付网关）
- `GET /api/subscription`（当前用户订阅 + 用量查询）
- 用量预警（80%/100%，通过公告系统触达）
- 前端：升级引导卡片（复用 MissingModelHint 模式）+ 用量面板（UsagePanel）
- 默认 plan = free（存量用户全落免费层，BYOK 不受影响、零破坏）

### 不做（留 P2 / P3 或以后）

- ❌ 支付网关接入（Stripe，P2）
- ❌ 账单页 + 月度发票 + 下载（P2）
- ❌ 团队席位管理（P2，复用 RBAC + Collaborators）
- ❌ 多租户 tenant_id 改造（P3，当前 tenant_id 退化为 user_id）
- ❌ SSO/SAML/OIDC（P3）
- ❌ SIEM 审计导出（P3）
- ❌ 运行时容器隔离（P3，依赖 deferred 容器后端）
- ❌ 免费层试用 token（design-monetization.md §5.4，默认建议先不做，避免转化漏斗复杂度）
- ❌ 年付/升降级按比例补差价（P2，M2 只做月付 + 手动改套餐即时生效）
- ❌ 超额加购（视频 $2/段、图片 $0.20/张，P2，M2 只做硬阻断不做按量加购）

## 三、分阶段实施步骤（S1-S8，原子提交）

> 每步独立可提交、可回滚。按依赖顺序执行，前一步是后一步的前置。

### S1 · 数据模型迁移（subscriptions + usage_ledger 表）✅ 已确认无需新建（表已存在于 base DDL + 迁移 34，最新迁移 37；PG 走 toPgDdl 自动派生）

**目标**：新增两张表，sqlite base DDL + 迁移 38/39 + PG toPgDdl 三写一致。

**文件清单**：
- `packages/server/src/sqlite-driver.ts`：base DDL 加两张表 + 迁移 38/39 函数
- `packages/server/src/pg-driver.ts`：PG 侧对应 DDL（如果 PG driver 有独立建表逻辑）
- `packages/server/src/pg-sql.ts`：toPgDdl 转换（如果需要）
- `packages/server/src/migrations.test.ts`：迁移测试（预迁移库 → 应用迁移 → 验证表结构）

**设计细节**：
```sql
-- subscriptions（一个用户一条；自托管阶段 tenant_id = user_id）
CREATE TABLE subscriptions (
  user_id            TEXT PRIMARY KEY,          -- 暂用 user_id，P3 多租户时改 tenant_id
  plan               TEXT NOT NULL,             -- free | starter | pro | team
  status             TEXT NOT NULL,             -- active | trialing | canceled | past_due
  provider           TEXT,                       -- manual（M2 只有手动开通）| stripe（P2）
  external_id        TEXT,                       -- 网关侧 subscription id（P2 用）
  current_period_start INTEGER NOT NULL,         -- ms epoch
  current_period_end   INTEGER NOT NULL,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- usage_ledger（每结算周期累计，写多读少）
CREATE TABLE usage_ledger (
  user_id      TEXT NOT NULL,                    -- 暂用 user_id
  period_start INTEGER NOT NULL,                 -- 对账周期起始（ms epoch，每月 1 号 00:00 UTC）
  metric       TEXT NOT NULL,                    -- tokens_in | tokens_out | runs | storage_bytes | video_segments
  amount       REAL NOT NULL,                    -- 累计值
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, period_start, metric)
);

-- 索引
CREATE INDEX idx_subscriptions_plan ON subscriptions(plan);
CREATE INDEX idx_usage_ledger_user_period ON usage_ledger(user_id, period_start);
```

**关键决策**：
- 暂用 `user_id` 而非 `tenant_id`——P3 多租户改造时再做列重命名 + 数据迁移，M2 阶段个人 = 单成员租户，语义一致
- `period_start` 用每月 1 号 00:00 UTC 的 ms epoch，自然月结算
- `storage_bytes` 是当前快照值（非累计），每次 recordUsage 时覆盖更新；其他 metric 是累加
- `video_segments` 按 videoGen 节点成功次数计（一段视频 = 一次成功的 videoGen 调用）

**测试**：
- 迁移测试：预迁移库（版本 37）→ 应用迁移 38/39 → 验证两张表存在 + 列正确 + 索引存在
- 重复应用迁移幂等（版本已到 39 时不重复执行）
- PG 侧 toPgDdl 输出与 sqlite 语义一致

**验收**：`pnpm typecheck` 四包绿；`pnpm test packages/server` 迁移测试全绿；Hasee 副本库升级演练（可选，M1 期不部署）。

---

### S2 · plans.ts 配额定义 + subscriptionService 基础 ✅ commit `1d7a3e4`

**目标**：PLANS 单一事实源 + subscriptionService 的 CRUD 基础方法。

**文件清单**：
- `packages/core/src/plans.ts`（新建）：PlanId 类型 + PlanQuota 接口 + PLANS 常量
- `packages/core/src/index.ts`：导出 plans
- `packages/server/src/subscriptionService.ts`（新建）：loadSubscription / usageFor / setPlan / ensureFreeSubscription
- `packages/server/src/db.ts`：如果 db 抽象层有接口定义，加 subscription 相关方法
- `packages/server/src/sqlite-driver.ts`：driver 层实现 getSubscription / upsertSubscription / getUsage / upsertUsage
- `packages/core/src/plans.test.ts`（新建）：PLANS 常量测试
- `packages/server/src/subscriptionService.test.ts`（新建）：service 层测试

**设计细节**：
```ts
// packages/core/src/plans.ts
export type PlanId = "free" | "starter" | "pro" | "team";

export interface PlanQuota {
  tokens: number;           // 内置模型月 token 上限（in + out × 4 折算）
  concurrentRuns: number;
  storageBytes: number;
  videoSegments: number;
}

export const PLANS: Record<PlanId, PlanQuota> = {
  free:    { tokens: 0,           concurrentRuns: 1,  storageBytes: 100 * 1024 * 1024,  videoSegments: 0  },
  starter: { tokens: 500_000,     concurrentRuns: 2,  storageBytes: 5 * 1024 * 1024 * 1024, videoSegments: 2  },
  pro:     { tokens: 2_000_000,   concurrentRuns: 5,  storageBytes: 50 * 1024 * 1024 * 1024, videoSegments: 10 },
  team:    { tokens: 10_000_000,  concurrentRuns: 20, storageBytes: 500 * 1024 * 1024 * 1024, videoSegments: 50 },
};

export const PLAN_LABELS: Record<PlanId, string> = {
  free: "免费版", starter: "入门版", pro: "专业版", team: "团队版",
};

// token 折算：output 比 input 贵 4 倍（业界常见 3-4 倍）
export function normalizeTokens(inTokens: number, outTokens: number): number {
  return inTokens + outTokens * 4;
}
```

```ts
// packages/server/src/subscriptionService.ts
export async function loadSubscription(userId: string): Promise<Subscription> {
  const sub = await driver.getSubscription(userId);
  if (sub) return sub;
  // 存量用户自动落免费层（零破坏）
  return ensureFreeSubscription(userId);
}

export async function ensureFreeSubscription(userId: string): Promise<Subscription> {
  const now = Date.now();
  const periodStart = startOfMonth(now);
  const periodEnd = endOfMonth(now);
  const sub: Subscription = {
    userId, plan: "free", status: "active", provider: "manual",
    currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
    createdAt: now, updatedAt: now,
  };
  await driver.upsertSubscription(sub);
  return sub;
}

export async function usageFor(userId: string, metric: UsageMetric): Promise<number> {
  const periodStart = startOfMonth(Date.now());
  const row = await driver.getUsage(userId, periodStart, metric);
  return row?.amount ?? 0;
}

export async function setPlan(userId: string, plan: PlanId, actorId: string): Promise<Subscription> {
  // 仅 owner/admin 可调用（API 层做 RBAC 校验）
  const existing = await loadSubscription(userId);
  const updated = { ...existing, plan, status: "active" as const, updatedAt: Date.now() };
  await driver.upsertSubscription(updated);
  await auditLog("billing.plan_changed", { userId, from: existing.plan, to: plan, actorId });
  return updated;
}
```

**关键决策**：
- PLANS 放在 `core` 包（与 unpricedModels 同层），前端也可引用做 UI 展示
- `ensureFreeSubscription` 懒创建——第一次查询时如果没有订阅记录，自动创建 free 订阅，存量用户零感知
- `setPlan` 即时生效（M2 简化，不做按比例补差价/下周期生效）
- token 折算用 `in + out × 4`（业界常见，M1 数据显示 output 通常比 input 略多但差距不大，4 倍是保守估计）

**测试**：
- PLANS 常量：4 档都有定义、quota 值合理（free tokens=0、videoSegments=0）
- normalizeTokens：in=100, out=50 → 300
- loadSubscription：新用户自动创建 free 订阅
- setPlan：free → pro，验证 plan 变更 + audit_log 记录
- usageFor：空用户返回 0

**验收**：typecheck 绿；plans + subscriptionService 测试全绿。

---

### S3 · 用量计量 + 回填脚本 ✅ commit `8a8a32f`

**目标**：从现有 node_runs/runs/artifacts 表聚合用量，写入 usage_ledger；提供 recordUsage 方法供 run 完成时调用。

**文件清单**：
- `packages/server/src/subscriptionService.ts`：扩展 recordUsage / computeAndRecordRunUsage / computeStorageUsage
- `packages/server/src/usage-backfill.ts`（新建）：一次性回填脚本（幂等，可重复执行）
- `packages/server/src/engine.ts`：run 完成事件中调用 computeAndRecordRunUsage（如果有 run.finished 事件钩子）
- `packages/server/src/subscriptionService.test.ts`：用量计量测试
- `packages/server/src/usage-backfill.test.ts`：回填脚本测试（构造测试数据 → 回填 → 验证 usage_ledger）

**设计细节**：
```ts
// 一次 run 完成后，聚合该 run 的用量并写入 usage_ledger
export async function computeAndRecordRunUsage(runId: string, userId: string): Promise<void> {
  const nodeRuns = await driver.getNodeRunsByRun(runId);
  let tokensIn = 0, tokensOut = 0, videoSegments = 0;

  for (const nr of nodeRuns) {
    tokensIn += nr.tokens_in ?? 0;
    tokensOut += nr.tokens_out ?? 0;
    if (nr.node_type === "videoGen" && nr.status === "done") videoSegments += 1;
  }

  const periodStart = startOfMonth(Date.now());
  await driver.upsertUsage(userId, periodStart, "tokens_in", tokensIn);   // 累加
  await driver.upsertUsage(userId, periodStart, "tokens_out", tokensOut); // 累加
  await driver.upsertUsage(userId, periodStart, "video_segments", videoSegments); // 累加
  await driver.upsertUsage(userId, periodStart, "runs", 1); // 累加
}

// 存储用量是快照，每次查询时实时计算（不写 usage_ledger，避免频繁更新）
export async function computeStorageUsage(userId: string): Promise<number> {
  const total = await driver.sumArtifactSizes(userId);
  return total;
}

// 回填脚本：从历史数据聚合所有用户的用量
export async function backfillUsage(): Promise<{ users: number; runs: number }> {
  const users = await driver.listAllUserIds();
  let runCount = 0;
  for (const userId of users) {
    // 按月份分组聚合历史 run 的用量
    const monthlyUsage = await driver.aggregateHistoricalUsage(userId);
    for (const [periodStart, metrics] of Object.entries(monthlyUsage)) {
      for (const [metric, amount] of Object.entries(metrics)) {
        await driver.upsertUsage(userId, Number(periodStart), metric as UsageMetric, amount);
      }
    }
    runCount += monthlyUsage.runs;
  }
  return { users: users.length, runs: runCount };
}
```

**关键决策**：
- token/video/runs 用量在 run 完成时**累加写入** usage_ledger（写多读少，查询快）
- storage_bytes 是**快照值**，不写 usage_ledger，每次 enforceSubscription 时实时从 artifacts 表 SUM（存储查询轻量，且避免每次上传 artifact 都更新 ledger）
- 回填脚本**幂等**：upsertUsage 用 INSERT OR REPLACE，重复执行结果一致
- 回填按月份分组，period_start 取该月 1 号 00:00 UTC
- M2 阶段先跑回填脚本把历史数据灌进 usage_ledger，之后新 run 走实时 recordUsage

**测试**：
- computeAndRecordRunUsage：构造 1 个 run（3 个 node_runs，含 1 个 videoGen）→ 验证 usage_ledger 累加正确
- computeStorageUsage：构造 3 个 artifact（不同 size）→ 验证 SUM 正确
- backfillUsage：构造 2 个用户、跨 2 个月的 run → 验证回填后 usage_ledger 数据正确 + 幂等（跑两次结果一致）

**验收**：typecheck 绿；用量计量 + 回填测试全绿；Hasee 上手动跑一次回填脚本验证历史数据正确（可选）。

---

### S4 · enforceSubscription gate 挂入派发流程 ✅ commit `7dece12`（=唯一 checkpoint，暂停等用户 review）

**目标**：在派发流程中插入订阅配额检查，免费层拦内置模型、超额拦请求。

**文件清单**：
- `packages/server/src/enforce-subscription.ts`（新建）：enforceSubscription 函数 + QuotaError 类
- `packages/server/src/index.ts`：POST /api/runs 中，validateModels 之后调用 enforceSubscription
- `packages/server/src/enforce-subscription.test.ts`（新建）：gate 测试
- `packages/core/src/errors.ts`（如果有统一错误定义）：QuotaError 类型导出

**设计细节**：
```ts
// packages/server/src/enforce-subscription.ts
export class QuotaError extends Error {
  code: "QUOTA_EXCEEDED" | "CONCURRENCY_EXCEEDED" | "STORAGE_EXCEEDED" | "VIDEO_QUOTA_EXCEEDED";
  plan: PlanId;
  limit: number;
  used: number;
  constructor(code, message, plan, limit, used) { ... }
}

export async function enforceSubscription(userId: string, graph: Graph): Promise<void> {
  const sub = await loadSubscription(userId);
  const quota = PLANS[sub.plan];

  // 1. 提取图中引用的内置模型
  const builtinModelNodes = graph.nodes.filter(n => {
    const model = getModelForNode(n);
    return model && providerSource(model) === "builtin";
  });

  // 2. 免费层 + 内置模型 → 直接阻断
  if (builtinModelNodes.length > 0 && sub.plan === "free") {
    throw new QuotaError(
      "QUOTA_EXCEEDED",
      "免费版不可使用内置模型，请升级套餐或改用自带 API Key 的自定义模型",
      "free", 0, 0
    );
  }

  // 3. token 配额检查（仅当图中有内置模型节点时）
  if (builtinModelNodes.length > 0) {
    const tokensIn = await usageFor(userId, "tokens_in");
    const tokensOut = await usageFor(userId, "tokens_out");
    const used = normalizeTokens(tokensIn, tokensOut);
    if (used >= quota.tokens) {
      throw new QuotaError(
        "QUOTA_EXCEEDED",
        `本月内置模型额度已用尽（已用 ${formatTokens(used)} / 上限 ${formatTokens(quota.tokens)}），请加购或升级`,
        sub.plan, quota.tokens, used
      );
    }
  }

  // 4. 并发配额检查
  const running = await driver.countRunningRuns(userId);
  if (running >= quota.concurrentRuns) {
    throw new QuotaError(
      "CONCURRENCY_EXCEEDED",
      `并发运行上限 ${quota.concurrentRuns}，当前已有 ${running} 个运行中，请等待完成后再发起`,
      sub.plan, quota.concurrentRuns, running
    );
  }

  // 5. 视频配额检查（仅当图中有 videoGen 节点时）
  const videoNodes = graph.nodes.filter(n => n.kind === "videoGen");
  if (videoNodes.length > 0) {
    const usedVideos = await usageFor(userId, "video_segments");
    if (usedVideos >= quota.videoSegments) {
      throw new QuotaError(
        "VIDEO_QUOTA_EXCEEDED",
        `本月视频生成额度已用尽（已用 ${usedVideos} / 上限 ${quota.videoSegments} 段），请加购或升级`,
        sub.plan, quota.videoSegments, usedVideos
      );
    }
  }

  // 6. 存储配额检查（快照，实时计算）
  const storageUsed = await computeStorageUsage(userId);
  if (storageUsed >= quota.storageBytes) {
    throw new QuotaError(
      "STORAGE_EXCEEDED",
      `存储空间已用尽（已用 ${formatBytes(storageUsed)} / 上限 ${formatBytes(quota.storageBytes)}），请清理旧产物或升级`,
      sub.plan, quota.storageBytes, storageUsed
    );
  }
}
```

**挂入点**（index.ts）：
```ts
// POST /api/runs
const diagnostics = validateModels(graph, config);
if (diagnostics.some(d => d.severity === "error")) {
  return res.status(400).json({ errors: diagnostics });
}
// ↓ 新增：订阅配额检查
try {
  await enforceSubscription(userId, graph);
} catch (err) {
  if (err instanceof QuotaError) {
    return res.status(402).json({
      error: err.code,
      message: err.message,
      plan: err.plan,
      limit: err.limit,
      used: err.used,
      upgradeUrl: "/settings/billing", // 前端升级页路由
    });
  }
  throw err;
}
// ↑ 新增结束
const run = await execute(graph, userId, ...);
```

**关键决策**：
- gate 在**派发期**（发任何 API 请求前）阻断，复用现有 400/402 错误通道
- HTTP 状态码用 **402 Payment Required**（语义最准确），前端可据此显示升级引导
- 免费层只拦「内置模型」，不拦「自定义模型」——BYOK 是免费的命脉
- token 检查仅当图中有内置模型节点时才做（纯 BYOK 产线不查 token）
- 并发检查对所有产线生效（包括 BYOK）——并发是平台资源，不是模型资源
- 存储检查对所有产线生效
- 视频检查仅当图中有 videoGen 节点时才做
- **不预扣 token**——派发时只检查余额，run 完成后才 recordUsage 累加（符合 PRD「成本事后计量」护栏）。存在「周期末瞬间超量」的边界，可接受（下周期结清）

**测试**：
- 免费层 + 内置模型节点 → 抛 QUOTA_EXCEEDED
- 免费层 + 纯 BYOK 节点 → 不抛错（通过）
- pro 层 + token 已用尽 → 抛 QUOTA_EXCEEDED
- pro 层 + token 未用尽 → 通过
- 并发超限 → 抛 CONCURRENCY_EXCEEDED
- 视频配额用尽 + 图中有 videoGen → 抛 VIDEO_QUOTA_EXCEEDED
- 存储超限 → 抛 STORAGE_EXCEEDED
- 边界：token 刚好用到 quota-1 → 通过；用到 quota → 阻断
- index.ts 集成测试：POST /api/runs 触发 QuotaError → 返回 402 + 正确 body

**验收**：typecheck 绿；enforce-subscription 测试全绿；index.ts 集成测试通过；本地手动验证（免费用户跑内置模型产线 → 402 + 升级引导；跑 BYOK 产线 → 正常）。

---

### S5 · API 端点（订阅查询 + 管理员改套餐 + 用量查询）

**目标**：3 个 REST API 端点，供前端查询订阅状态、用量、管理员改套餐。

**文件清单**：
- `packages/server/src/api.subscription.ts`（新建）：3 个端点的路由处理
- `packages/server/src/index.ts`：注册路由
- `packages/server/src/api.subscription.test.ts`（新建）：API 测试
- `apps/web/src/api/subscription.ts`（新建）：前端 API client

**API 设计**：

```
GET /api/subscription
→ 200 { plan, status, currentPeriodStart, currentPeriodEnd, usage: { tokensIn, tokensOut, tokensNormalized, tokensLimit, runs, videoSegments, videoLimit, storageBytes, storageLimit, concurrentRuns, concurrentLimit } }
→ 401 未登录

POST /api/admin/users/:userId/plan
Body: { plan: "starter" | "pro" | "team" | "free" }
→ 200 { plan, status, updatedAt }
→ 401 未登录
→ 403 非 owner/admin
→ 400 无效 plan

GET /api/admin/subscriptions?plan=pro&limit=50&offset=0
→ 200 { subscriptions: [{ userId, plan, status, createdAt, updatedAt }], total }
→ 401/403（仅 owner/admin）
```

**关键决策**：
- `GET /api/subscription` 返回**当前登录用户**的订阅 + 用量汇总（前端用量面板一次请求拿全）
- `POST /api/admin/users/:userId/plan` 是 M2 的**唯一改套餐入口**（手动开通，绕过支付网关），P2 接 Stripe 后再加 webhook 入口
- 管理员改套餐走 RBAC 校验（复用现有 rbac.ts 的 owner/admin 权限）
- 改套餐即时生效 + 写 audit_log（billing.plan_changed）
- `GET /api/admin/subscriptions` 是管理后台的用户列表（可选，M2 可以先不做，等管理后台 UI 时再加）

**测试**：
- GET /api/subscription：登录用户 → 返回 plan=free + 用量全 0
- POST /api/admin/users/:id/plan：owner 改 free→pro → 200 + plan=pro + audit_log
- POST /api/admin/users/:id/plan：普通用户 → 403
- POST /api/admin/users/:id/plan：无效 plan → 400
- 改套餐后 GET /api/subscription → 返回新 plan

**验收**：typecheck 绿；API 测试全绿；本地 curl 验证 3 个端点。

---

### S6 · 前端升级引导 + 用量面板

**目标**：免费层用户遇到 402 时显示升级引导卡片；设置页增加用量面板展示当前配额使用情况。

**文件清单**：
- `apps/web/src/components/UpgradeGate.tsx`（新建）：402 错误时的升级引导卡片（复用 MissingModelHint 模式）
- `apps/web/src/components/UsagePanel.tsx`（新建）：用量面板（token/视频/存储/并发 4 个进度条）
- `apps/web/src/pages/SettingsBilling.tsx`（新建）：设置 → 账单/订阅页（嵌入 UsagePanel + 套餐介绍）
- `apps/web/src/api/subscription.ts`：前端 API client（S5 已建）
- `apps/web/src/i18n/locales/zh/billing.json`（新建）：billing 命名空间中文
- `apps/web/src/i18n/locales/en/billing.json`（新建）：billing 命名空间英文
- `apps/web/src/App.tsx` 或路由配置：加 /settings/billing 路由
- `apps/web/src/components/UpgradeGate.test.tsx`（新建）：升级引导测试
- `apps/web/src/components/UsagePanel.test.tsx`（新建）：用量面板测试

**设计细节**：

**UpgradeGate（402 拦截 → 升级引导）**：
- 在 API client 的 response interceptor 中捕获 402 错误
- 402 时显示模态卡片：当前套餐 + 缺少的配额 + 「升级套餐」按钮（跳 /settings/billing）+ 「改用自定义模型」按钮（跳设置页模型配置）
- 卡片设计：参考 MissingModelHint 的视觉风格，使用设计 token（--color-primary / --color-surface / --radius-md）
- 文案走 i18n（billing.quotaExceeded / billing.upgrade / billing.useCustomModel）

**UsagePanel（用量面板）**：
- 4 个进度条：内置模型 token（已用/上限）、视频生成（已用段/上限）、存储（已用/上限）、并发（当前/上限）
- token 进度条颜色：<80% 绿色（--color-ok）、80-100% 黄色（--color-warning）、=100% 红色（--color-error）
- 每个进度条下方显示「已用 X / 上限 Y」+ 百分比
- 顶部显示当前套餐名称 + 「升级」按钮
- 数据来源：GET /api/subscription（一次请求拿全）

**SettingsBilling（设置 → 账单页）**：
- 顶部：当前套餐卡片（plan name + 价格 + 到期日 + 「升级」/「联系销售」按钮）
- 中部：UsagePanel（用量面板）
- 底部：四档套餐对比表（Free/Starter/Pro/Team 的 quota 对比 + 价格），当前套餐高亮
- M2 阶段「升级」按钮跳转到**联系 owner 手动开通**的提示（因为没有支付网关），P2 接 Stripe 后改成跳转支付

**关键决策**：
- 升级引导用**模态卡片**而非整页跳转——用户在运行产线时遇到 402，模态卡片不丢失当前画布状态
- 用量面板放在**设置页**，不在主界面常驻——避免信息过载，需要时才看
- 4 档套餐对比表的数据来自 core 包的 PLANS 常量（单一事实源，不硬编码）
- 所有文案走 i18n billing 命名空间
- 所有颜色/间距/圆角走设计 token，不硬编码

**测试**：
- UpgradeGate：模拟 402 响应 → 验证模态卡片显示 + 按钮跳转正确
- UsagePanel：mock API 返回各档用量 → 验证进度条宽度 + 颜色 + 文案正确
- UsagePanel：token 用量 70% → 绿色；90% → 黄色；100% → 红色
- SettingsBilling：渲染 → 验证当前套餐高亮 + 四档对比表数据正确
- i18n：zh/en 两套文案都有定义、无缺失 key

**验收**：typecheck 绿；前端测试全绿；本地手动走查（免费用户点运行 → 402 → 升级引导卡片 → 跳设置页 → 用量面板显示全 0 → 四档套餐对比表）。

---

### S7 · 用量预警（80% / 100%）

**目标**：用量达到 80% 时发预警公告，达到 100% 时发用尽公告。

**文件清单**：
- `packages/server/src/usage-alert.ts`（新建）：checkUsageAlerts 函数
- `packages/server/src/engine.ts` 或 run 完成钩子：run 完成后调用 checkUsageAlerts
- `packages/server/src/usage-alert.test.ts`（新建）：预警测试
- `apps/web/src/i18n/locales/zh/billing.json`：预警文案
- `apps/web/src/i18n/locales/en/billing.json`：预警文案

**设计细节**：
```ts
export async function checkUsageAlerts(userId: string): Promise<void> {
  const sub = await loadSubscription(userId);
  const quota = PLANS[sub.plan];
  if (sub.plan === "free") return; // 免费层不预警（直接 402 阻断）

  const tokensIn = await usageFor(userId, "tokens_in");
  const tokensOut = await usageFor(userId, "tokens_out");
  const used = normalizeTokens(tokensIn, tokensOut);
  const ratio = used / quota.tokens;

  const alertKey = `usage_alert:${userId}:${startOfMonth(Date.now())}`;

  if (ratio >= 1.0 && !(await getFlag(alertKey + ":exhausted"))) {
    await createAnnouncement({
      userId, type: "warning", dismissible: true,
      title: t("billing.alertTokenExhaustedTitle"),
      body: t("billing.alertTokenExhaustedBody", { used: formatTokens(used), limit: formatTokens(quota.tokens) }),
      actionUrl: "/settings/billing",
      actionLabel: t("billing.upgrade"),
    });
    await setFlag(alertKey + ":exhausted", true);
  } else if (ratio >= 0.8 && !(await getFlag(alertKey + ":80"))) {
    await createAnnouncement({
      userId, type: "info", dismissible: true,
      title: t("billing.alertToken80Title"),
      body: t("billing.alertToken80Body", { percent: Math.round(ratio * 100) }),
      actionUrl: "/settings/billing",
      actionLabel: t("billing.viewUsage"),
    });
    await setFlag(alertKey + ":80", true);
  }
}
```

**关键决策**：
- 仅对**付费用户**（starter/pro/team）发预警，免费层不发（直接 402 阻断更直接）
- 预警通过**现有公告系统**（AnnouncementBell）触达，不新建通知渠道
- 每个用户每月每档阈值**只发一次**（用 flag 去重），避免每次 run 完成都弹公告
- 只做 token 预警（成本大头），视频/存储预警 P2 再加（M2 阶段视频配额小、存储增长慢，优先级低）
- 预警在 run 完成后异步触发（不阻塞 run 完成响应）

**测试**：
- token 用量 70% → 不发公告
- token 用量 85% → 发 80% 预警公告 + flag 标记
- token 用量 85% 再跑一次 → 不重复发（flag 去重）
- token 用量 100% → 发用尽公告
- 免费用户 → 不发预警
- 跨月 → flag 重置（新月份重新预警）

**验收**：typecheck 绿；预警测试全绿；本地手动验证（pro 用户把 token 用到 80% → 公告铃铛出现预警）。

---

### S8 · 全量测试 + 文档更新 + Hasee 部署验证

**目标**：全量回归测试通过、文档更新、Hasee 部署验证、M2 正式闭环。

**文件清单**：
- `docs/design-monetization.md`：更新 P1 状态为已实施
- `handoff.md`：更新待办状态，记录 M2 完成
- `README.md`：如果有功能列表，加订阅/计费相关说明
- `docs/README.md`：文档索引加 M2 实施方案链接

**验证清单**：
1. `pnpm -r typecheck` 四包全绿
2. `pnpm -r test` 全量测试通过（core + server + web + mcp-server）
3. 本地 dev 手动走查：
   - 免费用户：BYOK 产线正常运行 / 内置模型产线 → 402 + 升级引导
   - pro 用户（手动改套餐）：内置模型产线正常运行 / 用量面板显示正确 / token 到 80% 出预警
   - 管理员：POST /api/admin/users/:id/plan 改套餐成功 + audit_log 记录
4. Hasee 部署：
   - 迁移 38/39 应用成功（subscriptions / usage_ledger 表存在）
   - 回填脚本跑一次（历史数据灌入 usage_ledger）
   - 存量用户自动落免费层（loadSubscription 不报错）
   - M1 回采产线继续正常运行（免费层 + 内置模型？需要确认——M1 回采产线用的是内置 agnes 模型，如果 owner 是免费层会被 402 阻断！需要把 owner 手动改成 pro 或 team）

**⚠️ 重要：M1 回采产线的兼容性**
- M1 回采产线（4 条）用的是**内置 agnes 模型**
- M2 上线后，如果 owner 是免费层，这些产线会被 402 阻断
- **解决方案**：M2 部署到 Hasee 后，立即把 owner 用户手动改成 `pro` 或 `team` 套餐（POST /api/admin/users/:id/plan），保证 M1 回采不中断
- 这是 M2 部署的**必要前置操作**，写进部署手册

**验收**：全量测试通过 + 本地走查通过 + Hasee 部署验证通过 + M1 回采不中断 + 文档更新完成。

## 四、测试策略

| 层级 | 测试内容 | 工具 | 覆盖目标 |
|---|---|---|---|
| 单元测试 | PLANS 常量、normalizeTokens、subscriptionService 方法 | vitest | 100% 覆盖新增函数 |
| 单元测试 | enforceSubscription 各分支（free/pro/并发/视频/存储） | vitest | 每个 QuotaError 分支至少 1 例 + 边界值 |
| 单元测试 | 用量计量（computeAndRecordRunUsage / backfillUsage） | vitest | 累加正确 + 幂等 + 跨月分组 |
| 集成测试 | API 端点（GET /api/subscription / POST /api/admin/...） | vitest + supertest | 200/401/403/400 各状态码 |
| 集成测试 | index.ts 派发流程（validateModels → enforceSubscription → execute） | vitest | 402 拦截 + 正常通过 |
| 迁移测试 | 预迁移库（v37）→ 应用 v38/v39 → 验证表结构 | vitest | 表/列/索引正确 + 幂等 |
| 前端测试 | UpgradeGate 模态卡片、UsagePanel 进度条、SettingsBilling 页面 | @testing-library/react | 渲染正确 + 交互正确 + i18n |
| 前端测试 | API client 402 拦截 | vitest + msw | 402 → 升级引导触发 |
| E2E（可选） | 免费用户跑内置模型 → 402 → 升级 → pro 用户跑成功 | Playwright（如果有） | 端到端流程 |

**回归保障**：
- 现有 1800+ web 测试 + 1000+ server 测试必须全绿
- M2 改动不触碰现有 run 执行逻辑（只在派发前加 gate），回归风险低
- 重点回归：POST /api/runs 正常流程（BYOK 产线不受影响）、成本报表（byModel 不受影响）、M1 回采产线（owner 改 pro 后正常）

## 五、回滚方案

| 场景 | 回滚操作 | 风险 |
|---|---|---|
| S1 迁移出问题 | 迁移是增量加表，不修改现有表结构，回滚只需 DROP TABLE subscriptions / usage_ledger | 低（新表，不影响现有数据） |
| S2-S3 service 出问题 | git revert 对应 commit，service 层不影响现有功能（新增代码，不改现有逻辑） | 低 |
| S4 gate 误阻断正常产线 | git revert S4 commit，移除 enforceSubscription 调用，派发流程恢复原样 | 中（如果 gate 有 bug 会阻断所有 run，需快速回滚） |
| S5 API 出问题 | git revert S5 commit，移除路由注册 | 低 |
| S6 前端出问题 | git revert S6 commit，前端恢复原样 | 低 |
| S7 预警骚扰 | git revert S7 commit 或在代码里加 feature flag 关闭预警 | 低 |
| 整体回滚 | `git revert` S1-S8 的所有 commit（按倒序），DB 里 DROP 两张新表 | 中（需要按序回滚，DB 迁移不可逆但可 DROP） |

**回滚保障**：
- 每步原子提交，可单独回滚
- gate 逻辑有 feature flag（`ENABLE_SUBSCRIPTION_GATE` 环境变量），紧急时可关闭 gate 而不回滚代码
- M2 部署到 Hasee 前先在本地 dev 充分验证
- M2 部署后先观察 24 小时（M1 回采产线正常 + 无异常 402）再确认稳定

## 六、验收标准（M2 完成定义）

1. ✅ `subscriptions` / `usage_ledger` 两张表已创建（迁移 38/39），sqlite + PG 双写一致
2. ✅ PLANS 四档配额定义在 core 包，前端后端共用
3. ✅ 存量用户自动落免费层，BYOK 产线零影响
4. ✅ 免费层 + 内置模型 → 402 + 升级引导卡片（模态、不丢画布状态）
5. ✅ 付费层 token/并发/视频/存储四维配额检查正确
6. ✅ 用量计量准确（run 完成后累加 + 历史回填幂等）
7. ✅ 管理员可手动改套餐（POST /api/admin/users/:id/plan）+ audit_log 记录
8. ✅ 设置页用量面板显示 4 项配额使用情况 + 四档套餐对比表
9. ✅ token 用量 80%/100% 预警公告（每用户每月每档只发一次）
10. ✅ 全量测试通过（typecheck 四包绿 + 1800+ web + 1000+ server 测试全绿）
11. ✅ Hasee 部署成功 + M1 回采产线不中断（owner 改 pro）
12. ✅ 文档更新（design-monetization.md P1 状态 + handoff.md + README）

**M2 完成后，P2（账单 + 支付网关）可以启动。**

## 七、工作量估算

| 步骤 | 内容 | 预估工作量 | 依赖 |
|---|---|---|---|
| S1 | 数据模型迁移 | 小（0.5 天） | 无 |
| S2 | plans.ts + subscriptionService | 小（0.5 天） | S1 |
| S3 | 用量计量 + 回填 | 中（1 天） | S2 |
| S4 | enforceSubscription gate | 中（1 天） | S2, S3 |
| S5 | API 端点 | 小（0.5 天） | S2 |
| S6 | 前端升级引导 + 用量面板 | 中（1.5 天） | S5 |
| S7 | 用量预警 | 小（0.5 天） | S3 |
| S8 | 全量测试 + 文档 + 部署 | 中（1 天） | S1-S7 |
| **合计** | | **约 6.5 天** | |

**可并行**：S5（API）与 S3（用量计量）可并行；S7（预警）与 S6（前端）可并行。实际可能 4-5 天完成。

## 八、相关文档

- [design-monetization.md](design-monetization.md) — 商业化详细实施方案（顶层设计，§5 配额与订阅 gate / §9 P1 阶段）
- [design-monetization-m2-implementation.md](design-monetization-m2-implementation.md) — 本文档（M2 落地实施方案）
- [design-rbac.md](design-rbac.md) — 角色权限（管理员改套餐的权限底座）
- [design-audit-log.md](design-audit-log.md) — 审计日志（套餐变更记录）
- [design-at-rest-encryption.md](design-at-rest-encryption.md) — 静态加密（P2 支付凭据用）
- [design-multitenancy.md](design-multitenancy.md) — 多租户（P3 tenant_id 改造）
- [design-scaling.md](design-scaling.md) — 规模化与平台成本护栏（与订阅配额的区分）
- [handoff.md](../handoff.md) — 项目当前状态与待办
