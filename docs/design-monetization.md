# 商业化详细实施方案（Monetization）

> 状态：**方案设计（价格已用 M1 真实数据校准；M2 订阅 gate S1-S8 已全部完成并测试通过，随 PR #277 合 dev（merge `124bdca`）部署 Hasee、owner 已升 pro、MONETIZATION_ENFORCE=1）**。设计决策基线见 [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) §八，历史讨论见 [product-vision-discussion.md](product-vision-discussion.md) §九。M2 落地级细化见 [design-monetization-m2-implementation.md](design-monetization-m2-implementation.md)。
> 本方案把「方向」落成可实施的规格：数据模型 / API / 挂点 / 分阶段路线。2026-09-14 已用 M1 回采 125 runs / $5.57 真实成本数据校准 §4 套餐价格与 §10.2 待定参数，校准依据见 §4.1。

---

## 1. 目标与原则

**目标**：把 agent-world 从「自用产品」变成「能收钱的 SaaS」，同时不破坏 BYOK 的低成本结构。

**设计原则**（继承自 PRODUCT_STRATEGY）：

1. **BYOK 为主**——模型/生图/生视频的 API 费是最大成本，必须转移给用户；平台只收「服务费」。
2. **内置模型订阅制、自定义模型 BYOK**——两层模型、两类计费（见 §4）。
3. **免费层成本≈0**——免费层只放行 BYOK，不放行内置模型（避免免费白嫖 LLM 成本）。
4. **budget 硬上限**——配额是硬约束，不是告警（把现有软预算升级为硬 quota）。
5. **先计量、再定价**——落地顺序必须先跑成本计量拿到真实数字，再定价格（见 §10 触发条件）。
6. **数据主权不设墙**——用户随时能导出自己的图/模板/数据，不因收费而锁定；这是 SaaS 信任底线，也呼应 PRD「不堵死开源/迁移」的护栏。
7. **open-core 边界**——开源（MIT）= 核心引擎 + 全节点 + BYOK + 自托管；商业 = 托管服务 + 内置模型代付 + 企业版 + 支持。任何「用户能自托管 + BYOK 复现」的能力**不设收费墙**，收费只加在「用户搞不定或不想搞」的环节（托管、代付、企业合规）。

---

## 2. 现状盘点（已有地基 vs 缺口）

### 2.1 已就绪（直接复用，不重建）

| 能力 | 位置 | 复用方式 |
|---|---|---|
| Provider 分层 | `ProviderConfig.source: "builtin" \| "custom"` | 订阅 gate 的判定依据：`source:"builtin"` 受订阅控制，`"custom"` 完全放行 |
| 成本计量 | `node_runs.tokens_in/out`、`cost_usd`、`content_costs`；`costs.ts` 聚合 | quota 用量的数据源 |
| 软预算 | `AppConfig.monthlyBudgetUsd`（warn at 80%/100%） | 升级为硬 quota 的入口 |
| 模型派发校验 | `validate-models.ts`（`isBuiltin` 判断） | 订阅 gate 的拦截点 |
| 账号/隔离 | users 表 + JWT + 全量 `user_id` 隔离 | 订阅归属、账单隔离 |
| RBAC | 全局 owner/admin/user + 资源级 owner/editor/viewer | 企业版席位、团队共享的权限底座 |
| 静态加密 + 密钥轮换 | `at-rest.ts` keyring + `enc:v2:` | 支付/订阅凭证落盘加密 |
| 审计日志 | `audit_log` + `audit()` | 账单/配额变更的审计埋点 |
| 公告 | `announcements` + target 定向 | 套餐变更、额度预警的触达通道 |

### 2.2 缺口（需要新增）

| 缺口 | 说明 |
|---|---|
| 订阅数据模型 | `subscriptions` / `usage_ledger` / 账单表，全部没有 |
| 硬配额执行 | 现有 budget 只 warn 不阻断，需加派发期硬拦截 |
| 订阅 gate | `source:"builtin"` 的模型访问控制，挂点已定、逻辑未写 |
| 支付接入 | 无支付网关、无发票、无账单页 |
| 企业版能力 | tenant_id 多租户、SSO/SAML、SIEM 审计导出、容器隔离 |
| 用量预警 UI | 无「本月已用 X / 限额 Y」的用户界面 |

---

## 3. 计费模型（三层）

> **商业化路线拍板（2026-09-07）**：**先 B（纯 BYOK）**——订阅主线卖「编排 + 存储 + 协作 + 专业模板」，平台零模型代付、零垫资。**内置模型（C）作为 SaaS 阶段的可选增强，不是前提**——触发条件：种子用户普遍反馈「卡在配 API key」。在此之前，内置模型订阅制不启动，`source:"builtin"` 的 agnes 维持 demo 定位。

```
平台收入 = 订阅费（覆盖平台服务 + 内置模型 quota）
         + 内置模型超额费用（quota 用尽后，可选按量加购）
         + 企业版定制（一次性 + 年费）
```

### 3.1 三层计费维度

| 层 | 谁付费 | 平台成本 | 计费方式 |
|---|---|---|---|
| **内置模型**（`source:"builtin"`） | 用户（经订阅） | 平台代付模型 API 费 | 订阅 quota（token 额度），超量按量加购 |
| **自定义模型 BYOK**（`source:"custom"`） | 用户直接付模型方 | ≈0（平台不出模型费） | 订阅费即「平台服务费」（编排/存储/队列） |
| **平台资源** | 用户（经订阅） | 服务器固定 + 边际 | 订阅内含并发/存储/视频额度，超量限流或加购 |

### 3.2 单位经济公式（定价依据）

```
订阅价 ≥ 平台边际成本 ÷ (1 − 目标毛利率)
```

- **平台边际成本** = 每用户边际（存储带宽 + 编排算力）+ 内置模型代付（token 成本 × 平均用量）+ 固定成本摊销（服务器 ÷ 用户数）
- **⚙️ 目标毛利率**：推荐 70%（SaaS 常见），待成本数据校准
- **关键教训**（PRODUCT_STRATEGY）：纯代付重度视频用户会亏——他 API 费 $50 只付你 $10。所以**视频生成类内置模型必须单独限次/按量加购**，绝不进无限 quota。

### 3.3 内置模型的供应链（「订阅内置模型」成立的前提）

「内置模型订阅制」的前提是平台有**可自采、可代付**的内置模型。**现状：内置 provider 仅 `agnes`（demo/fake，无音频模型），`DEFAULT_CONFIG` 无真实内置模型**——这是启动订阅收费前必须先解决的前提，否则「内置模型 quota」是空中楼阁。

- **待补（⚙️）**：确定内置模型清单（OpenAI / Claude / 豆包 等），以平台名义采购 API key；成本平台代付，计入 `usage_ledger`，由订阅 quota 覆盖。
- **根本原因**：这正是「免费层不能放行内置模型」的由来——放行等于平台免费白嫖自己的采购成本。
- **降级路径**：若不提供内置模型，订阅只靠「平台服务费」（编排/存储/队列），BYOK 用户仍可收费，「内置模型 quota」卖点消失但**可接受**（§4 免费层已把 BYOK 定为命脉）。

---

## 4. 套餐档位（✅ 已用 M1 回采真实数据校准，2026-09-14）

> 校准依据见 §4.1。价格基于 125 runs / 100 done / $5.57 总成本的真实回采数据，目标毛利率 70%。

| 档位 | 月价 | 目标用户 | 内置模型 quota | 并发 run | 存储 | 视频 | 自定义模型 BYOK |
|---|---|---|---|---|---|---|---|
| **Free 免费** | $0 | 试用/极轻度个人 | ❌ 不可用（试用 token 另计，见 §5.4） | 1 | 100MB | ❌ | ✅ 完全放行 |
| **Starter 入门** | $9 | 轻度个人（月 20-50 次文本产线） | 50 万 token/月 | 2 | 5GB | 2 段/月 | ✅ |
| **Pro 专业** | $29 | 重度/自由职业（月 100-200 次，含视频） | 200 万 token/月 | 5 | 50GB | 10 段/月 | ✅ |
| **Team 团队** | $149 | 小团队（5 席位，月 500+ 次） | 1000 万 token/月 + 5 席位 | 20 | 500GB | 50 段/月 | ✅ |

**超额加购价**（quota 用尽后按量加购）：
- 视频生成：$2/段（成本 $0.50，毛利率 75%）
- 图片生成：$0.20/张（成本 $0.04，毛利率 80%）
- token 超额：$0.50/100 万 token（成本约 $0.13/100 万，毛利率 74%）

**免费层设计（核心）**：
- BYOK **完全可用**——用户自己付模型费，平台成本≈0，免费层才能真正免费。
- 内置模型 **不可用**——否则免费白嫖 LLM 成本，违背「免费层成本≈0」。
- 免费层的平台边际成本（存储/带宽/编排）靠「转化」覆盖，接受少量亏损换取获客。

**超额处理**：quota 用尽后，内置模型调用被派发期阻断（`QUOTA_EXCEEDED`；`status` 判定生效后另有 `PAYMENT_REQUIRED`（欠费）与 `SUBSCRIPTION_ENDED`（到期取消）两个码，并发超额为 `CONCURRENCY_EXCEEDED`——四个是全集），引导加购或升级；BYOK 不受 quota 限制（模型费用户自付），但并发/存储仍受订阅档位约束。

---

## 4.1 价格校准依据（M1 回采真实数据，2026-09-14）

### 数据来源

- **回采环境**：Hasee staging（单机 Ubuntu，systemd + nginx，4 条 M1 产线 cron 自动运行）
- **时间范围**：2026-09-10 04:27 UTC ~ 2026-09-14 02:10 UTC（约 4 天）
- **样本量**：125 runs（done 100 / failed 21 / halted 1 / interrupted 3），总成本 $5.57
- **数据来源**：SQLite `runs` + `node_runs` 表直接查询，成本按 `node_runs.cost_usd` 聚合

### 真实用量分布（仅 done runs）

| 产线 | done 数 | 成本 P50 | 成本 P90 | token P50 | token P90 | 时长 P50 | 时长 P90 |
|---|---|---|---|---|---|---|---|
| ①写草稿·高频文本 | 72 | $0.00168 | $0.00221 | 4,587 | 6,200 | 3.8min | 8.1min |
| ②翻译流水线·带返工 | 8 | $0.00126 | $0.00296 | 3,287 | 8,553 | 4.2min | 21.7min |
| ③短视频广告工坊 | 10 | $0.54024 | $0.54037 | 1,043 | 1,264 | 2.8min | 8.0min |
| ④批量内容工坊 | 10 | $0.00148 | $0.00243 | 4,383 | 6,609 | 2.4min | 9.1min |

### 按模型成本拆分

| 模型 | 调用次数 | 总成本 | 单次成本 | 占比 |
|---|---|---|---|---|
| agnes-video-v2.0 | 10 | $5.00 | $0.500 | 89.7% |
| agnes-image-2.0-flash | 10 | $0.40 | $0.040 | 7.2% |
| agnes-2.0-flash（文本） | 253 | $0.17 | $0.00068 | 3.1% |

**关键发现**：
1. **视频生成是绝对成本大头**（89.7%），文本模型极便宜（253 次调用仅 $0.17）
2. **纯文本产线成本极低**（$0.0015/run），视频产线成本是文本的 300+ 倍
3. **图片生成成本中等**（$0.04/张），是文本的 60 倍但仅为视频的 1/12
4. **并发峰值 15 runs/小时**（手动密集触发时），正常 cron 调度 3-6 runs/小时

### 定价计算方法

**单位经济公式**（继承自 §3.2）：
```
订阅价 ≥ 平台边际成本 ÷ (1 − 目标毛利率)
目标毛利率 = 70%（SaaS 行业常见）
```

**各档平台边际成本估算**：

| 档位 | 视频成本 | 图片成本 | 文本成本 | 存储/带宽 | 合计边际成本 | 最低订阅价 | 校准价 |
|---|---|---|---|---|---|---|---|
| Starter | $1.00 (2段) | $0.08 (2张) | $0.05 | $0.50 | $1.63 | $5.43 | **$9** |
| Pro | $5.00 (10段) | $0.80 (20张) | $0.20 | $2.00 | $8.00 | $26.67 | **$29** |
| Team | $25.00 (50段) | $4.00 (100张) | $1.00 | $10.00 | $40.00 | $133.33 | **$149** |

**超额加购价计算**：
- 视频：$0.50 ÷ (1-0.75) = $2.00/段（毛利率 75%）
- 图片：$0.04 ÷ (1-0.80) = $0.20/张（毛利率 80%）
- token：$0.13/100万 ÷ (1-0.74) ≈ $0.50/100万（毛利率 74%）

### 与原占位价的对比

| 档位 | 原占位价 | 校准价 | 变化 | 原因 |
|---|---|---|---|---|
| Starter | $19 | $9 | -53% | 文本成本极低，视频 quota 少（2段），边际成本仅 $1.63 |
| Pro | $49 | $29 | -41% | 10 段视频成本 $5，边际成本 $8，$29 已能覆盖 70% 毛利 |
| Team | $199 | $149 | -25% | 50 段视频成本 $25，边际成本 $40，$149 覆盖 73% 毛利 |

### 局限性与后续校准

1. **样本量偏小**（125 runs / 4 天），②翻译仅 8 个 done runs，P90 可能不稳定
2. **单一用户**（1 个 user_id），未覆盖多用户并发、团队协作场景
3. **非正式单价**（agnes 为占位单价，按 OpenAI 同级 list price 映射），正式计费前须换成 agnes 网关真实费率
4. **存储成本未含长期保留**（当前 57.5MB / 4 天，月增量约 400MB，年约 5GB）
5. **后续校准节点**：M2 订阅 gate 上线后，积累 1000+ runs / 多用户数据后做二次校准

---

## 5. 配额与订阅 gate（核心实现）

> **与「平台成本护栏」的区分（2026-09-07 评审）**：本节的订阅配额是**租户级**（防免费白嫖/超用额度）；另有一层独立的**平台成本护栏**（owner/平台级，防账单爆炸），见 [design-scaling.md §4.1](design-scaling.md)。自托管阶段两者合一（owner = 唯一用户），SaaS 阶段分离。

### 5.1 数据模型

> **计费维度：按 tenant（2026-09-07 决策）**。订阅/配额/账单归属租户而非用户——Team 套餐「5 席位」= 1 租户 + 5 成员共享一份 quota。自托管阶段「个人 = 单成员租户」，`tenant_id` 退化为用户自己的 id，个人订阅语义不变。详见 [design-multitenancy.md](design-multitenancy.md)。

```sql
-- 订阅（一个租户一条；自托管下「个人 = 单成员租户」，tenant_id 退化为用户自己的 id）
CREATE TABLE subscriptions (
  tenant_id            TEXT PRIMARY KEY,
  plan                 TEXT NOT NULL,          -- free | starter | pro | team
  status               TEXT NOT NULL,          -- active | trialing | canceled | past_due
  provider             TEXT,                   -- 支付网关：stripe | manual（手动开通）
  external_id          TEXT,                   -- 网关侧的 subscription id
  current_period_start INTEGER NOT NULL,       -- ms epoch
  current_period_end   INTEGER NOT NULL,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- 用量台账（每结算周期累计，写多读少；按租户计——Team 共享同一份 quota）
CREATE TABLE usage_ledger (
  tenant_id      TEXT NOT NULL,
  period_start   INTEGER NOT NULL,             -- 对账周期起始
  metric         TEXT NOT NULL,                -- tokens_in | tokens_out | runs | storage_bytes | video_seconds
  amount         REAL NOT NULL,                -- 累计值
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, period_start, metric)
);
```

### 5.2 配额定义（单一事实源）

```ts
// packages/server/src/plans.ts
interface PlanQuota {
  tokens: number;        // 内置模型月 token 上限（in+out 折算）
  concurrentRuns: number;
  storageBytes: number;
  videoSegments: number;
}
const PLANS: Record<PlanId, PlanQuota> = {
  free:    { tokens: 0, concurrentRuns: 1, storageBytes: 100 * MB, videoSegments: 0 },
  starter: { tokens: 500_000, concurrentRuns: 2, storageBytes: 5 * GB, videoSegments: 2 },
  pro:     { tokens: 2_000_000, concurrentRuns: 5, storageBytes: 50 * GB, videoSegments: 10 },
  team:    { tokens: 10_000_000, concurrentRuns: 20, storageBytes: 500 * GB, videoSegments: 50 },
};
```

### 5.3 订阅 gate 挂点（复用现有 `validate-models.ts`）

派发流程：`POST /api/runs` → `validateModels(graph, loadConfig(ownerId))` → `execute()`。

在 `validateModels` 之后、`execute` 之前插入 `enforceSubscription()`：

> **实现更正（2026-09-25，commit `242b04f`）**：挂点已不在 `POST /api/runs` 的 handler 里，而是收进 `packages/server/src/dispatch-gate.ts`，由 `startRun()` 在**建 run 行之前**统一调用——这样重跑 / 批量 / 批量重试 / cron·webhook·事件触发器 / AB / fork 每一条派发路都盖得到（原挂点 5 个 `startRun` 调用点只拦 1 个，AB 与 fork 更是直连 `db.createRun`）。`resumeRun()`（审批后续跑一个已放行的 run）有意不拦。覆盖面表与 `observe` 灰度档见 [runbook 四之二](runbooks/deploy-ubuntu-server.md)。

```ts
function enforceSubscription(userId: string, graph: Graph): void {
  const plan = loadSubscription(userId) ?? { plan: "free" };
  const quota = PLANS[plan.plan];

  // 1. 内置模型访问控制：免费层不可用，付费层检查 token 余额
  const builtinModels = graph.nodes
    .flatMap((n) => modelRefs(n))            // 提取节点引用的模型
    .filter((m) => providerSource(m) === "builtin");
  if (builtinModels.length > 0) {
    if (plan.plan === "free") throw new QuotaError("QUOTA_EXCEEDED", "免费层不可用内置模型，请升级或改用自带 Key 的自定义模型");
    const used = usageFor(userId, "tokens_in") + usageFor(userId, "tokens_out");
    if (used >= quota.tokens) throw new QuotaError("QUOTA_EXCEEDED", "本月内置模型额度已用尽，请加购或升级");
  }

  // 2. 并发控制
  const running = activeRuns(userId).length;
  if (running >= quota.concurrentRuns) throw new QuotaError("CONCURRENCY_EXCEEDED", `并发上限 ${quota.concurrentRuns}`);
}
```

**关键决策**：
- gate 按**图所有者**（`ownerId`）身份执行，与现有「run 在 owner 上下文中运行」语义一致（RBAC 已实现）。
- 免费层只拦「内置模型」，不拦「自定义模型」——BYOK 是免费的命脉。
- 阻断在**派发期**（发任何请求前），复用现有 `VALIDATION` 错误通道，前端可显示升级引导。

### 5.4 免费层试用 token（可选，⚙️）

若担心免费层完全不能体验内置模型，给一次性 `trial_tokens`（如 10 万 token，注册即赠，用尽永久关闭）。挂在 `subscriptions` 或独立 `trials` 表。**默认建议先不做**，避免引入「试用 → 转化」漏斗复杂度，等有真实转化数据再说。

### 5.5 用量计量（复用现有成本电表）

- token：`node_runs.tokens_in/tokens_out` 求和（已有）
- run 次数：`runs` 表 count（已有）
- 存储：`artifacts` 表字节求和（`sizeBytes`，已有）
- 视频段：`node_runs` 里 videoGen 节点的成功次数（需按节点类型过滤，轻量查询）

计量是**事后累计**（不预扣），符合 PRD「成本事后计量」护栏。配额检查读 `usage_ledger` 的滚动周期累计。

**token 折算（⚙️）**：input/output token 权重不同（业界 output 通常比 input 贵 3-4 倍），配额建议按「折算 token」计：`折算 token = tokens_in + tokens_out × 4`（⚙️ 系数待成本校准）。图片按「张」、视频按「段」计，不进 token 折算（已在 §4 单独设 `videoSegments`）。

---

## 6. 账单与支付

### 6.1 数据模型

```sql
CREATE TABLE invoices (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end   INTEGER NOT NULL,
  amount_usd   REAL NOT NULL,
  status       TEXT NOT NULL,                 -- draft | open | paid | void
  created_at   INTEGER NOT NULL
);
```

### 6.2 支付接入（⚙️ 推荐 Stripe）

- **Stripe Billing**：订阅（subscription）+ 发票（invoice）托管，`subscriptions.external_id` 存 Stripe 侧 id。
- 回调：`POST /api/billing/webhook`（复用现有 webhook 防重放机制——`secretEqual` + timestamp 窗口，见 design-triggers）→ 更新 `subscriptions.status` + `plan`。
- **手动开通（MVP 先做）**：`POST /api/admin/users/:id/plan`（owner/admin 专属，复用 RBAC），用于早期人工收费、绕过支付网关。
- 支付凭据落盘走 `at-rest.ts` 静态加密（`enc:v2:`）。

### 6.3 用量预警（复用公告/通知）

- 阈值：quota 用至 80% / 100% 时触发。
- 触达：① 产品内 `AnnouncementBell`（复用现有公告）；② 可选 notify 邮件（`SMTP_*` env 已有，见 design-announcement / notify 节点）。
- 审计：额度变更/加购记 `audit_log`（`billing.*` 动作词）。

### 6.4 订阅生命周期（月付/年付、升降级、取消、欠费）

- **计费周期**：月付 + 年付（年付通常 8 折，⚙️）；`subscriptions.current_period_*` 记录周期边界。
- **升级**：即时生效，本周期按比例补差价（⚙️ 也可简化「下周期生效」）。
- **降级**：下周期生效（本周期已付额度保留），避免「月底降级蹭额度」。
- **取消**：到期停服，**数据保留 30 天**（宽限期），期内续费恢复；过期不删、可导出（见 §1 数据主权）。
- **欠费（past_due）**：支付失败 → 宽限期 3-7 天 → 停服（内置模型阻断，BYOK 保留只读）→ 数据保留 30 天。
  > **实现状态（2026-09-25，commit `bb50612`）**：**内置模型阻断 + BYOK 保留**已落地（`builtinAccessIntact()`），`canceled` 也按「到 `current_period_end` 才断」实现（Stripe 在期末取消时会先写 `canceled`，那时访问权还在已付费期内）。**「宽限期 3-7 天」没做**：`subscriptions` 没有记录状态何时变更的列，`updated_at` 会被 checkout 镜像 / `setPlan` 等无关写入顶掉，用它算宽限＝一个会说谎的窗口；需先加 `status_changed_at`（迁移），已登记 deferred-items。当前口径是「欠费即断、`invoice.paid` 一到自动恢复」，比设计的更严一点。

---

## 7. 企业版能力（阶段 5.1）

| 能力 | 设计 | 依赖 |
|---|---|---|
| 多租户 tenant_id | `users.tenant_id` + 全表行级隔离改造（现是 `user_id` 隔离，加租户维度） | 现有 RBAC + 用户隔离底座 |
| SSO/LDAP/SAML | 身份提供商适配层（SAML 走 `saml2-js`，OIDC 走 `openid-client`），登录入口分流 | 现有 JWT 会话 |
| SIEM 审计导出 | `audit_log` 增加导出（CSV/JSONL + syslog 转发），对接 hash chain（触发条件：SOC 2） | 现有 audit_log + design-audit-log P3 |
| 企业 Connector 套件 | MySQL/PG/MongoDB/飞书/钉钉/Jira/SharePoint driver 扩展 | 现有 `db-drivers.ts` + `connectors` 抽象 |
| 运行时容器隔离 | 多租户每次 run 放容器（gVisor/Firecracker/E2B），只读根 + 临时可写 + 网络白名单 | 现有 code-sandbox P2 后端 + deferred 容器后端 |
| 商业 SLA | 服务等级承诺 + 支持工单 | 运维体系 |

---

## 8. 启动前置：商业化验证路径

> 本节回答「要不要商业化、怎么验证」，先于 §9 的「怎么实现收费」。三个硬缺口是一条因果链——**部署 → 多用户 → 成本数据**——按顺序解决，且大部分在本地就能做。

### 8.1 三个硬缺口（一条因果链）

| 缺口 | 现状 | 为什么卡商业化 | 解决手段 |
|---|---|---|---|
| 部署形态 | 单机 `localhost`，无公网可达 | 收订阅费 = 要 SaaS 托管 | 云 VM / 容器托管（§8.2） |
| 多用户验证 | 唯一真实用户是 owner | 价值假设零验证 | 种子用户 + 内网穿透（§8.3） |
| 真实成本数据 | 没跑过规模化成本 | 定价全是拍脑袋 | 成本拆分报表 + 单位经济（§8.4） |

### 8.2 缺口一：部署形态（云 VM 选型）

**技术约束**：SSE 流式长连接 + sqlite 持久卷 → 不能用纯 serverless（Vercel/Functions 会掐长任务，见 `PRODUCT_STRATEGY §六`），必须是**常驻进程 + 持久磁盘**。

| 路径 | 选项 | 价格 | 适用 |
|---|---|---|---|
| 国内 | 腾讯云 Lighthouse | ~40-80 元/月（2C2G 起步） | 正式交付国内客户，Docker 一键，访问快 |
| 国内 | 阿里云轻量应用服务器 | 类似 | 同上 |
| 海外/免费 | Fly.io | 免费额度（3 个共享 VM） | 零成本验证，`fly deploy` 用现有 Dockerfile，支持持久卷 |
| 海外 | Render | $7/月起（免费 tier 休眠，不适合常驻） | 简单，但免费版对 SSE 长连接不友好 |

**推荐**：先 Fly.io（零成本验证）→ 正式交付国内客户转腾讯云 Lighthouse。前端静态资源独立托管（CF Pages / COS / OSS），别和 server 抢资源。现有 `Dockerfile` + `docker-compose.yml` 已就绪，`STORAGE_BACKEND=s3` 已支持。

### 8.3 缺口二：多用户验证（本地可先做，用内网穿透）

**关键：不必买 VM 就能验证「别人能不能用起来」**——用免费内网穿透把本地 `:8791` 暴露成公网 URL：

| 工具 | 费用 | 国内可用性 |
|---|---|---|
| cpolar | 免费额度（限速/限域名） | ✅ 稳定 |
| cloudflared tunnel | 免费 | ⚠️ 国内可能慢 |
| ngrok | 免费额度（限 1 会话） | ⚠️ 需账号，不稳 |

```bash
cloudflared tunnel --url http://localhost:8791
# 得到 https://xxx.trycloudflare.com 公网地址
```

**种子用户观察清单**（找 2 个专业服务方向潜在客户或同行，`product-industry-roi` 结论）：
- 能不能**自己**搭起来（不靠手把手）
- 哪个场景让他们「眼前一亮」
- 会不会主动问「怎么收费 / 能否长期用」← 付费意愿信号

**局限**：穿透只适合开发期验证，带宽/稳定性不适合正式交付；验证有戏再上 VM。

### 8.4 缺口三：真实成本数据（本地可先做，纯读不改行为）

成本电表数据已在本地 `agent-world.sqlite`（`cost_usd`/`tokens_in/out`/`content_costs`）。补「按用户×模型×月」拆分视图 + `CostBreakdown` 面板（`/api/costs` 已有 `groupBy`，扩展维度即可）。

**单位经济计算（账，不是代码）**：
```
平台月成本 = 云 VM 账单（固定，看账单）
           + S3 存储（artifacts.sizeBytes 求和，精确）
           + 出站带宽（云账单）
           + 内置模型代付（node_runs 按 model 聚合，精确）
每用户边际 = 平台月成本 ÷ 活跃用户数
```

### 8.5 本地开发分步路径（先不买 VM）

1. 成本拆分报表（半天，纯读不改行为）
2. `docker compose up --build` 本地跑通，验证 `CORS_ORIGINS`/`SECURE_COOKIES`/`DB_FILE` 在容器里正确
3. cloudflared/cpolar 穿透 + 找 2 个种子用户远程试用（验证多用户 + 付费意愿）

### 8.6 最小验证路径时间线

| 周 | 动作 | 产出 |
|---|---|---|
| 第 1 周 | 部署到云 VM（或先穿透）+ 开放注册 | 公网可用（缺口一 ✅） |
| 第 1-2 周 | 找 2 个种子用户 + 成本拆分报表 | 真实用户 + 用量（缺口二 ✅） |
| 第 2-4 周 | 跑起来算单位经济 | 真实成本（缺口三 ✅） |
| 第 4 周后 | 拿用户反馈 + 成本数据定套餐价 | 订阅定价有依据 |

### 8.7 订阅 + 定制的飞轮（不并行，是先后）

「订阅 + 定制二次开发」是正确飞轮，但顺序必须是**定制先行、订阅靠定制养**：

```
定制接单（产生现金流 + 逼出真实需求）
   ↓ 定制中暴露的通用能力沉淀为标准功能/模板
标准能力积累 → 订阅套餐有了真实卖点
   ↓ 定制客户转成订阅种子用户，用量喂出成本数据
订阅规模化
```

**三条守则**：① 只接「现有节点 + 少量模板」能交付的定制，拒绝需改引擎的一次性交付（防项目制泥潭）；② 定制必问「有没有通用价值」，有则沉淀进订阅；③ 订阅的定价前提（成本数据）靠定制客户的用量喂出来。

### 8.8 法律合规前置（国内 vs 国外）

> 这是比技术缺口更根本的硬门槛——不满足就收不了钱、开不了票、接不了支付。**顺序是「先手动收款验证，再办资质」**，别一上来全办。

**国内**（合规路径最清晰，但门槛最高）：

| 事项 | 必要性 | 做法 | 周期 |
|---|---|---|---|
| 营业执照 | 收费必办 | 个体户网上申请（比公司简单） | 几天 |
| 对公账户 | 接支付必办 | 有执照后开对公户 | 1 周 |
| ICP 备案 | 境内服务器必办 | 腾讯云/阿里云控制台提交 | 1-2 周 |
| 支付商户号 | 收费必办 | 微信支付/支付宝，需执照+对公 | 1-2 周 |
| 经营性许可证 | 灰色地带 | 早期了解风险、不做全合规；有稳定收入再评估 | — |
| 发票 | 客户可能要 | 税务登记后开票（小规模简易征收） | — |
| 三份协议 | 必办 | 隐私政策/用户协议/服务条款（数据合规有静态加密打底） | 几天 |

**国外**（大陆主体的核心障碍在「收款主体」）：

| 事项 | 做法 |
|---|---|
| 收款主体 | 大陆个人/公司**不能直接开 Stripe 收美元**；用 **Merchant of Record**（Paddle / Lemon Squeezy）代收代缴 VAT，或注册香港/新加坡主体 |
| 税务 VAT | MoR 兜底，你只拿分成（抽成 ~5%+），零税务合规负担 |
| 备案 | 境外服务器**免 ICP 备案**（代价是大陆访问慢） |

### 8.9 支付计费基建（国内 vs 国外）

| 阶段 | 国内 | 国外 |
|---|---|---|
| 验证期（MVP） | 手动收款（个人微信/支付宝转账）+ `POST /api/admin/users/:id/plan` 手动开通 | 同左，或 GitHub Sponsor |
| 正式收费 | 微信支付 + 支付宝商户号（§6 的 Stripe 换成国内网关） | Stripe（需海外主体）或 Paddle / Lemon Squeezy（MoR） |

### 8.10 定价依据（成本之外还差两块）

成本数据只是定价的一根柱子，还差：

1. **竞品调研**：n8n 免费 / Zapier $20-400/月 / AI 写作 $10-50/月（美元锚点）；国内 AI 工具普遍 ¥39-199/月（人民币锚点，用户更价格敏感）
2. **付费意愿信号**：种子用户会不会主动问「怎么收费」，比任何定价模型都准
3. **币种**：国内人民币（价格偏低），国外美元（对标国际 SaaS，方案 §4 的 $19/$49/$199 正是美元锚点）
4. **差异化定位**：相比 n8n/Zapier（通用自动化、非 AI 原生）与 Coze/Dify（AI 应用、非多节点流水线），agent-world 的差异化是「**AI 原生 + 可视化多节点流水线 + 事件流可回放 + 专业服务垂直模板**」；定价锚点取「通用自动化」与「AI 工具」之间。

### 8.11 客户获取（第一个客户从哪来）

| 渠道 | 国内 | 国外 |
|---|---|---|
| 最快 | 熟人/朋友圈（直接问「有没有合同审查/报销对账的重复劳动」） | Product Hunt 发布 |
| 精准 | 法律/财务社群发案例（9 个专业服务模板是现成弹药） | X/Twitter 发案例、Hacker News |
| 长期 | 知乎/小红书写「AI 做合同审查」教程 | SEO、开源社区 |
| 必做 | 售前材料：5 分钟演示 + 真实案例（已有 run 取证）+ 报价单 | 同左 |

**营销落地页**：商业化需要独立的官网/落地页（产品本身不是营销页）——定价页 + 案例 + Demo + 文档。早期可用 README + 一个静态页起步，不必追求完整官网。

### 8.12 国内 vs 国外双轨路线

**主线国内、副线国外，两条不冲突**，且正好对应「订阅 + 定制」两条腿：

```
主线（国内，尽快验证收钱）：
  手动收款 + 内网穿透 + 2 个国内种子用户（专业服务/电商）
  → 验证有戏 → 个体户 + 微信支付宝 + 腾讯云部署

副线（国外，低成本并行做品牌）：
  开源（MIT 已就绪）+ 英文 i18n 已有 + Fly.io 部署 + Product Hunt
  → Paddle/Lemon Squeezy 做 MoR，绕开大陆主体收款障碍
  → 不急，先做开源品牌，国内主线跑通再投入
```

**关键判断**：① 国内是「能尽快收到第一笔钱」的路——专业服务场景现成、合规路径清晰（手动收款起步）；② 国外是「长期品牌 + 全球市场」——但大陆主体收美元有硬障碍（MoR 才能绕开）、竞争激烈；③ 开源（国外）+ 定制（国内）正好是「订阅 + 定制」的一体两面。

---

### 8.13 落地里程碑（粗粒度，把「部署 → 收费」串起来）

> §9 的 P0-P3 是「实现」粒度，下面补一层「落地」粒度——尤其补上 P0 之前缺的「运行环境从哪来」。M0 是当前在做的一步。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M0 本地运行环境** | 把 agent-world 部署成可 7×24 跑真实产线的**单机服务**（Ubuntu 纯 Server / Node 24 / systemd / nginx 同源 / bwrap 沙箱），作为 P0 成本计量回采的运行床 | ✅ 完成（阶段 0-7 + CI/CD 全部通过，见 [deploy-ubuntu-execution-log.md](runbooks/deploy-ubuntu-execution-log.md)） |
| **M1 成本计量回采** | 用 M0 环境跑 2-4 周真实产线，攒真实成本数据（§8.4 单位经济） | ✅ 完成（125 runs / $5.57，价格已校准，见 §4.1） |
| **M2 订阅 gate 落地** | P1 的 `enforceSubscription` + 套餐 + 硬配额（§5） | ✅ 已部署 Hasee（S1-S8 随 PR #277 合 dev merge `124bdca`；owner 已升 pro、MONETIZATION_ENFORCE=1，部署手册见 m2-implementation §S8） |
| **M3 收款与上线** | P2 账单/支付 + 域名/TLS（§6，先手动收款再接网关） | ⬜ |

> M0 的部署形态：§8.2 原推荐「先云 VM（Fly.io 零成本）」，现按实际资源调整为「先本地 Linux 笔记本单机」——数据 rsync 可迁、P2 真收款前再上云/隧道，与 §8.3「本地可先做」一致，不推翻原推荐。

---

## 9. 分阶段实施路线

### P0 —— 计量回采 + 数据模型（无用户可见变化）
- [x] 落 `subscriptions` / `usage_ledger` 表（迁移 34 已含；`invoices` 归 P2 收款阶段）
- [x] `plans.ts` 配额定义（core 单一事实源）+ `loadSubscription`/`usageFor` 读接口
- [x] 用量回采脚本：从现有 `node_runs`/`runs`/`artifacts` 回填 `usage_ledger`（幂等 CLI，`usage-backfill.ts`）
- [x] 成本报表增强：`/api/costs` 增加按用户/模型/月的真实成本拆分（为定价提供数据）——2026-09-08 落地 `node_runs.model`（迁移 36）+ `byModel` 聚合 + 前端「按模型分摊电费」表 + CSV `model` 段；迁移前的行归入 `(未记录模型)` 桶，保证与总额对账
- [x] 单价缺口审计：`unpricedModels()`（core）判定「完全没配单价 / 只配了一部分」，server 启动 warn + `/api/costs.unpricedModels`，前端成本报表顶部警告条。**这是 M1 的开跑前置**——缺单价的模型 `cost_usd` 当场按 0 落库，事后无法补算，回采数据会系统性偏低
- [x] 在用模型单价配全 + 端到端实测（2026-09-08，Hasee/staging 浏览器直连核对）：7 个在用模型（agnes 6 个内置 + ceshi 1 个）价格卡全部落地，`unpricedModels` 缺口清零。**关键修复**：内置 `agnes` tier 原本没有价格卡，而 `loadConfig` 每次读取都用内置默认整体覆盖 builtin provider，导致 UI 里填的单价保存后被抹掉——价格改写入源码 `AGNES_PROVIDER`（`packages/server/src/config.ts`，随产品发布）才持久化；`ceshi` 为 custom provider，经设置 UI 直接持久化。当前为**非正式占位单价**（按 OpenAI 同级 list price 映射：flash 文本 ≈ gpt-4o-mini / gpt-4.1-mini、图片 ≈ gpt-image-1、视频 ≈ Sora 量级），**正式计费前须换成 agnes 网关真实费率**。实测：投料派发后运行「全部出厂」（seq 23/23），电费读数 **$0.00051**、token **830 入 / 643 出**，与 `computeCost` 手算（830×$0.15/1M + 643×$0.6/1M ≈ $0.00051）一致，成本报表不再报「未配单价」。
- **验收**：能按用户看到「本月真实成本 = 平台代付模型费 + 存储 + 编排」，是 §10 定价的数据前提。

### P1 —— 订阅 gate + 免费层（核心收费逻辑）✅ 已部署 Hasee（M2 S1-S8，PR #277）
- [x] `enforceSubscription()` 挂入派发流程（§5.3，五维检查，gate 由 `MONETIZATION_ENFORCE=1` 开启、默认关）
  > **实现更正（2026-09-25，commit `242b04f`）**：这一项当初写作时「挂入派发流程」只挂了 `POST /api/runs` 一条路，5 个 `startRun` 调用点里 1 个生效（AB / fork 直连 `db.createRun`，连这个数都不算），prod 虽从 09-14/15 就开着 `=1`，计量却一直系统性偏低——而留开它的文档理由正是「先灰度观察计量是否准确」。现已收进 `startRun()` 之前的 `dispatch-gate.ts`，全部派发口生效，并新增 `observe` 档做「评估+记日志、不拦」。仍**有意不拦** `resumeRun()`（续跑不该在人工审批后被配额掐死）。覆盖面表与灰度步骤见 runbook 四之二。
- [x] 默认 plan = `free`（存量用户懒创建落免费层，BYOK 不受影响、零破坏）
- [x] 内置模型访问控制：免费层 402 `QUOTA_EXCEEDED` + 前端升级引导模态（UpgradeGate，不丢画布状态）
- [x] 硬配额：token / 并发 / 存储 / 视频四维检查（视频只拦内置模型，免费层 BYOK 视频放行）
- [x] `POST /api/admin/users/:id/plan`（owner 手动开通/改套餐，写 `billing.plan_changed` 审计）
- [x] 用量预警（80% info / 100% warning，确定性公告 ID 每用户每月每档一次）
- **验收**：免费层能跑 BYOK 产线、内置模型被诚实阻断且报错可行动；付费层能跑内置模型且超额被拦。（代码 + 单测已达成；端到端验收随 Hasee 部署进行，见 m2-implementation §S8）

### P2 —— 账单 + 支付（真正收钱）
- [~] 账单页 + 用量面板（`UsagePanel`：本月 token/视频/存储/并发进度条 + 四档套餐对比表，已在 M2 S6 落地于 Settings billing tab；真正的账单流水/发票待支付阶段）
- [ ] 支付网关接入（Stripe，`/api/billing/*` + webhook）
- [ ] 月度发票 + 下载
- [ ] 团队席位管理（复用 RBAC + Collaborators）
- **验收**：完整「订阅 → 计量 → 账单 → 收款 → 发票」闭环，可对真实用户收费。

### P3 —— 企业版 + 托管（规模化）
- [ ] 多租户 tenant_id 改造
- [ ] SSO/SAML/OIDC
- [ ] SIEM 审计导出
- [ ] 企业 Connector 套件
- [ ] 运行时容器隔离（依赖 deferred 容器后端触发）
- **验收**：一个企业客户能在隔离环境里跑产线、走 SSO 登录、导出 SIEM 审计。

---

## 10. 触发条件与风险

### 10.1 启动门槛（不满足别动手）

**必须先完成 P0 的「成本计量回采」，拿到 2-4 周真实成本数据**（按用户/模型/月拆分），否则 §4 的所有价格都是拍脑袋。这是 PRODUCT_STRATEGY 明确的「当务之急」。

### 10.2 待定参数清单（✅ 已用 M1 回采数据校准，2026-09-14）

| 参数 | 校准值 | 校准依据 | 状态 |
|---|---|---|---|
| 目标毛利率 | 70% | SaaS 行业常见 + M1 数据验证（各档毛利 70-75%） | ✅ 已校准 |
| 套餐价格 | $9/$29/$149 | 单位经济公式 + M1 真实边际成本（见 §4.1） | ✅ 已校准 |
| 各档 token quota | 50万/200万/1000万 | 真实用量 P90 = 6,200-8,553 token/run × 月 run 数 | ✅ 已校准 |
| 各档存储 quota | 5GB/50GB/500GB | 当前 4 天 57.5MB，月增量约 400MB，留 10x 余量 | ✅ 已校准 |
| 各档视频 quota | 2/10/50 段/月 | 视频成本 $0.50/段，占总成本 89.7%，必须单独限次 | ✅ 已校准 |
| 视频超额加购价 | $2/段 | 成本 $0.50 ÷ (1-75%) = $2.00 | ✅ 已校准 |
| 图片超额加购价 | $0.20/张 | 成本 $0.04 ÷ (1-80%) = $0.20 | ✅ 已校准 |
| token 超额加购价 | $0.50/100万 | 成本约 $0.13/100万 ÷ (1-74%) ≈ $0.50 | ✅ 已校准 |
| 免费层试用 token | 无（建议不做） | 免费层只放行 BYOK，避免白嫖内置模型成本 | ✅ 已确认 |

**后续二次校准节点**：M2 订阅 gate 上线后，积累 1000+ runs / 多用户数据后做二次校准（见 §4.1 局限性）。

### 10.3 风险与边界

1. **纯代付重度视频用户会亏**（PRODUCT_STRATEGY）——视频必须单独限次/按量加购，绝不进无限 quota（已在 §4 落地为 `videoSegments`）。
2. **BYOK 是命脉**——任何改动都不能破坏 BYOK 路径，否则「免费层成本≈0」的前提崩塌。
3. **配额是硬约束**——把现有软预算（只 warn）升级为硬拦截，语义从「提醒」变「阻断」，需独立回归用例。
4. **不预扣、事后计量**——配额检查读累计值，存在「周期末瞬间超量」的边界，可接受（下周期结清）。
5. **自由文本密钥**——支付凭据必须走专用字段 + 静态加密，不落 prompt/变量（继承审计 L3 边界）。
6. **商业化与「不堵死开源」**——本方案不做任何「只服务商业化」的硬编码，worker 可替换、事件流带版本这些开源护栏不动。

---

## 11. 相关文档

- [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) §八 — 定价策略基线
- [product-vision-discussion.md](product-vision-discussion.md) §九 — 三条商业化路径 + 模型分层
- [roadmap-tasks.md](roadmap-tasks.md) 阶段 5 — 商业化待办清单（本方案的源头）
- [design-rbac.md](design-rbac.md) — 席位/团队权限底座
- [design-at-rest-encryption.md](design-at-rest-encryption.md) — 支付凭据加密
- [design-audit-log.md](design-audit-log.md) — 账单/配额审计
- [design-code-sandbox.md](design-code-sandbox.md) §11 — 容器后端（企业版运行时隔离依赖）
