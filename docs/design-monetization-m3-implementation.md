# M3 收款与账单落地实施方案（design-monetization-m3-implementation）

> 定位：对 [design-monetization.md](design-monetization.md) §6「账单与支付」+ §9 P2 阶段的**落地级细化**，结合当前代码库（2026-09-14）实际状态，给出可执行的分步骤实施计划、文件清单、迁移方案、测试策略与回滚方案。
>
> 状态：**设计阶段（2026-09-14 启动）**。M2 订阅 gate 已部署 Hasee（PR #277，commit `124bdca`），owner 已升 pro，`MONETIZATION_ENFORCE=1` 已开。M3 在 M2 基础上加装「账单流水 + 发票 + 手动收款闭环 + 团队席位」，MVP 阶段先做手动收款，支付网关（Stripe）待有收款主体后再接。
>
> 实施偏差记录（以代码现状为准，非方案预设）：待实施过程中补充。
>
> 约定：延续项目惯例——原子提交、英文 commit message、不加助手署名、不 push；typecheck 四包绿、全量测试通过；i18n + 设计 token；DB 迁移双写（sqlite base DDL + 迁移版本 + PG toPgDdl）。

## 一、当前代码库复用盘点（2026-09-14 复核）

| 已有能力 | 文件 | M3 复用方式 |
|---|---|---|
| subscriptions 表 | `sqlite-driver.ts`（迁移 34） | **直接复用**：账单关联订阅，账单周期与 `current_period_start/end` 对齐 |
| usage_ledger 表 | `sqlite-driver.ts`（迁移 34） | **直接复用**：账单金额从 usage_ledger 聚合（超额用量 + 套餐基础费） |
| subscriptionService.ts | `packages/server/src/subscriptionService.ts` | **扩展**：增加 `listInvoices` / `getInvoice` / `markInvoicePaid` / `generateInvoice` 方法 |
| plans.ts（PLANS 配额 + 价格） | `packages/core/src/plans.ts` | **直接复用**：账单基础费从 `PLAN_PRICES` 取，Team 套餐 seats 字段在此扩展 |
| RBAC 角色权限 | `rbac.ts`（owner/admin/user） | **直接复用**：admin 标记账单 paid、管理团队席位复用 owner/admin 校验 |
| Collaborators 资源级共享 | `resource_access` 表（迁移 32）+ `api.rbac.ts` | **扩展**：团队席位管理在 Collaborators 面板基础上加 seats 计数和超限拦截 |
| 审计日志 | `audit-log.ts`（`billing.plan_changed` 已有） | **扩展**：新增 `billing.invoice_created` / `billing.invoice_paid` / `billing.invoice_voided` / `billing.seat_added` / `billing.seat_removed` |
| 公告系统 | `announcement.ts` + `user:<id>` 定向分支（M2 S7 已加） | **复用**：账单生成/支付成功/欠费预警通过公告触达 |
| 静态加密 at-rest | `at-rest.ts`（enc:v2:） | **复用**：支付凭据（S6 Stripe API key）落盘走静态加密，S1-S5 暂不涉及 |
| Settings billing tab | `apps/web/src/components/Settings.tsx`（M2 S6 已加） | **扩展**：在 billing tab 内增加账单流水列表、账单详情、下载发票入口、团队席位管理 |
| UsagePanel 用量面板 | `apps/web/src/components/UsagePanel.tsx`（M2 S6） | **直接复用**：账单详情里嵌入用量明细 |
| PlanComparison 套餐对比 | `apps/web/src/components/PlanComparison.tsx`（M2 S6） | **扩展**：Team 套餐增加 seats 展示 |
| i18n billing 命名空间 | `apps/web/src/i18n/locales/{zh,en}/billing.json`（M2 S6） | **扩展**：新增账单/发票/席位相关 key |
| 数据库迁移机制 | `sqlite-driver.ts`（schema_migrations，当前版本 37）+ `pg-sql.ts` | **直接复用**：M3 需要迁移 38（invoices 表），双写 sqlite + PG |
| 成本计量 byModel 聚合 | `costs.ts` / `node_runs` 表 | **复用**：账单超额用量从 node_runs + usage_ledger 聚合 |

**结论**：M3 的核心新增量集中在：① invoices 表 + 账单生成服务；② 账单/发票 UI；③ 手动收款闭环（admin mark paid）；④ 团队席位管理（seats 限制 + Collaborators 增强）。**不是从零搭建支付系统，是在 M2 订阅 + 用量计量基础上加装账单层。**

## 二、范围与边界

### 做（M3 / P2 范围，分 S1-S6）

- **S1**：invoices 表（迁移 38）+ 账单生成服务（月度账单自动生成、状态机 draft→open→paid/void）
- **S2**：账单页 UI 增强（Settings billing tab 加账单流水列表、详情、下载入口）
- **S3**：发票生成（HTML 发票模板、可下载，含公司信息/明细/金额/日期）
- **S4**：手动收款闭环（admin 标记账单 paid、收款审计、paid 后确认订阅状态）
- **S5**：团队席位管理（Team 套餐 seats 限制、Collaborators 面板增强、加人超限拦截）
- **S6**：支付网关接入（Stripe/webhook/支付页）—— **P2 低优，待有收款主体后实施**

### 不做（留 P3 或以后）

- ❌ 自动续费扣款（S6 Stripe 后才有，MVP 手动收款）
- ❌ 信用卡/支付宝/微信支付集成（S6，需支付商户号）
- ❌ 按比例补差价（升降级即时生效，不做 prorate，MVP 简化）
- ❌ 年付（只做月付，年付待 Stripe 后）
- ❌ 超额按量加购（视频 $2/段、图片 $0.20/张，只做硬阻断，不做自动加购）
- ❌ 多币种（只做 USD，与 M2 定价一致）
- ❌ 税务计算（VAT/GST，MVP 不含税，MoR 阶段由 Paddle/Lemon Squeezy 处理）
- ❌ 优惠券/折扣码（待有支付网关后）
- ❌ 企业版 SSO/SAML/SIEM（P3）

## 三、数据模型设计

### 3.1 invoices 表（迁移 38）

```sql
CREATE TABLE invoices (
  id            TEXT PRIMARY KEY,                    -- inv_<uuid>
  user_id       TEXT NOT NULL,                       -- 账单归属用户（= tenant_id，自托管单租户退化为 user_id）
  subscription_id TEXT NOT NULL,                     -- 关联 subscriptions.user_id（当前 1:1，未来可扩展）
  period_start  INTEGER NOT NULL,                    -- 账单周期开始（ms epoch，与 subscriptions.current_period_start 对齐）
  period_end    INTEGER NOT NULL,                    -- 账单周期结束（ms epoch）
  plan          TEXT NOT NULL,                       -- 账单对应套餐（free/starter/pro/team）
  amount_usd    REAL NOT NULL,                       -- 账单总金额（USD，套餐基础费 + 超额加购，MVP 阶段=套餐基础费）
  status        TEXT NOT NULL,                       -- draft | open | paid | void
  line_items    TEXT NOT NULL DEFAULT '[]',          -- JSON 数组，账单明细（[{description, quantity, unit_price, amount}]）
  paid_at       INTEGER,                              -- 支付时间（status=paid 时填写）
  paid_method   TEXT,                                 -- 支付方式（manual/stripe/...，MVP=manual）
  notes         TEXT,                                 -- 备注（手动收款时填写转账单号等）
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_invoices_user_id ON invoices(user_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_period ON invoices(user_id, period_start);
```

**设计决策**：
- `user_id` 而非 `tenant_id`：自托管阶段是单租户，tenant_id 退化为 user_id；未来 SaaS 多租户阶段加 tenant_id 列（向后兼容）。
- `line_items` 用 JSON 而非独立表：MVP 阶段账单明细简单（套餐费 + 可能的超额费），JSON 足够；未来复杂时再拆 invoice_items 表。
- `status` 状态机：`draft`（生成中，未发出）→ `open`（已发出，待支付）→ `paid`（已支付）/ `void`（已作废）。MVP 阶段生成即 `open`，`draft` 预留。
- `paid_method`：MVP 只有 `manual`，S6 Stripe 后加 `stripe`。

### 3.2 PLANS 扩展（Team seats）

在 `packages/core/src/plans.ts` 的 `PLANS` 常量中，Team 套餐增加 `seats` 字段：

```typescript
// 现有结构扩展
interface PlanQuota {
  tokens: number;           // 每月 normalizeTokens 配额
  videoSegments: number;    // 每月内置模型视频段
  storageBytes: number;     // 存储配额
  concurrency: number;      // 并发 run 数
  seats?: number;           // 团队席位（仅 team 套餐有，free/starter/pro 为 1）
}
```

- free/starter/pro：`seats = 1`（仅 owner 自己，不可加人）
- team：`seats = 5`（可加 4 个 collaborator，共 5 人），未来可配置

### 3.3 PG DDL 派生

`pg-sql.ts` 的 `toPgDdl()` 函数自动从 sqlite DDL 派生 PG 建表语句，invoices 表加入 base DDL 后自动覆盖。迁移 38 在 `MIGRATIONS` 数组中添加，PG 走相同的迁移版本号。

## 四、分阶段实施方案

### S1：invoices 表 + 账单生成服务

**目标**：建 invoices 表，实现账单生成、查询、状态管理的服务层。

**文件清单**：
- `packages/server/src/sqlite-driver.ts`：base DDL 加 invoices 表 + 迁移 38
- `packages/server/src/pg-sql.ts`：无需改动（toPgDdl 自动派生）
- `packages/server/src/invoiceService.ts`（新建）：账单生成/查询/状态管理
- `packages/server/src/invoiceService.test.ts`（新建）：服务层测试
- `packages/server/src/scripts/generate-invoices.ts`（新建）：手动触发账单生成 CLI

**核心接口**：
```typescript
// 生成指定用户指定周期的账单（幂等：同 user+period_start 已存在则返回现有）
generateInvoice(userId: string, periodStart: number): Promise<Invoice>

// 生成所有活跃订阅的当前周期账单（月度 cron 或手动触发）
generateAllInvoices(): Promise<{ created: number; skipped: number }>

// 查询用户账单列表
listInvoices(userId: string): Promise<Invoice[]>

// 查询单条账单
getInvoice(invoiceId: string): Promise<Invoice | null>

// 标记账单为 paid（admin 手动收款后调用）
markInvoicePaid(invoiceId: string, method: string, notes?: string): Promise<Invoice>

// 作废账单
voidInvoice(invoiceId: string): Promise<Invoice>
```

**账单金额计算（MVP）**：
- 从 `subscriptions` 表取用户当前 `plan`
- 从 `PLAN_PRICES` 取套餐月费（free=$0, starter=$9, pro=$29, team=$149）
- `line_items` = [{description: "<Plan> plan (monthly)", quantity: 1, unit_price: <price>, amount: <price>}]
- 超额加购暂不计（MVP 只做硬阻断，不做按量加购）

**测试**：
- generateInvoice 幂等（同 user+period 不重复创建）
- listInvoices 按时间倒序
- markInvoicePaid 更新 status + paid_at + paid_method
- voidInvoice 更新 status
- 金额计算正确（各套餐价格）
- audit_log 写入（billing.invoice_created / billing.invoice_paid / billing.invoice_voided）

**验收**：typecheck 绿；invoiceService 测试全绿；迁移 38 应用成功；invoices 表可读写。

---

### S2：账单页 UI 增强

**目标**：在 Settings billing tab 内增加账单流水列表和详情视图。

**文件清单**：
- `apps/web/src/components/Settings.tsx`：billing tab 内增加 InvoiceList 区域
- `apps/web/src/components/InvoiceList.tsx`（新建）：账单流水列表
- `apps/web/src/components/InvoiceDetail.tsx`（新建）：账单详情弹窗/展开
- `apps/web/src/lib/api.ts`：增加 `GET /api/invoices` / `GET /api/invoices/:id` client
- `apps/web/src/i18n/locales/zh/billing.json` / `en/billing.json`：新增账单相关 key

**UI 设计**：
- 账单列表：表格形式，列=周期 | 套餐 | 金额 | 状态 | 操作（查看/下载）
- 状态标签：paid（绿色）/ open（黄色）/ void（灰色）/ draft（蓝色）
- 账单详情：弹窗展示账单号、周期、套餐、金额、明细（line_items）、状态、支付时间/方式、备注
- 下载发票按钮：S3 实现后启用，S2 先放占位（disabled + tooltip "即将上线"）

**API**：
- `GET /api/invoices`：当前用户账单列表（按 period_start 倒序）
- `GET /api/invoices/:id`：单条账单详情（仅本人或 admin 可查）

**测试**：
- InvoiceList 组件测试（空状态、有数据、状态标签颜色）
- InvoiceDetail 组件测试（明细展示、金额格式化）
- API 集成测试（权限校验：非本人不可查）

**验收**：typecheck 绿；组件测试全绿；Settings billing tab 可看到账单列表和详情；i18n 中英同构。

---

### S3：发票生成（HTML）

**目标**：基于 invoice 数据生成可下载的 HTML 发票。

**文件清单**：
- `packages/server/src/invoiceTemplate.ts`（新建）：HTML 发票模板生成
- `packages/server/src/api.invoices.ts`（或扩展现有路由）：`GET /api/invoices/:id/download` 返回 HTML
- `apps/web/src/components/InvoiceDetail.tsx`：下载按钮启用

**发票模板内容**：
- 头部：公司名（"Agent World"）、地址（占位，可配置）、发票号（invoice.id）、开票日期
- 账单方：用户邮箱、用户 ID
- 账单周期：period_start ~ period_end（格式化为 YYYY-MM-DD）
- 明细表格：描述 | 数量 | 单价 | 金额
- 合计：总金额（USD）
- 底部：付款方式、备注、"感谢您的使用"

**实现方式**：
- 服务端用模板字符串生成 HTML（不引入额外依赖，MVP 简化）
- `GET /api/invoices/:id/download` 返回 `Content-Type: text/html`，浏览器直接打开或保存
- 未来 S6 Stripe 后可换成 Stripe 托管发票，或用 PDF 库生成 PDF

**测试**：
- invoiceTemplate 生成的 HTML 包含所有必填字段（发票号、金额、周期、明细）
- 金额格式化正确（$XX.XX）
- 日期格式化正确
- download API 权限校验（仅本人或 admin）

**验收**：typecheck 绿；测试全绿；点击下载按钮可打开 HTML 发票，内容完整。

---

### S4：手动收款闭环

**目标**：admin 可手动标记账单为 paid，完成手动收款闭环。

**文件清单**：
- `packages/server/src/api.invoices.ts`（或扩展）：`POST /api/admin/invoices/:id/mark-paid` / `POST /api/admin/invoices/:id/void`
- `packages/server/src/invoiceService.ts`：markInvoicePaid / voidInvoice（S1 已建，此处接 API）
- `apps/web/src/components/AdminPanel.tsx`（或现有管理界面）：增加账单管理入口
- `apps/web/src/lib/api.ts`：增加 admin 账单操作 client

**API 设计**：
```
POST /api/admin/invoices/:id/mark-paid
Body: { method: "manual", notes?: string }
Auth: owner/admin only
Response: Invoice（status=paid）

POST /api/admin/invoices/:id/void
Auth: owner/admin only
Response: Invoice（status=void）
```

**收款闭环流程**：
1. 用户转账（微信/支付宝/银行）→ 通知 admin
2. admin 在管理界面找到对应用户的 open 账单 → 点击"标记已支付"
3. 填写支付方式（manual）和备注（转账单号）→ 提交
4. 系统更新 invoice status=paid + paid_at + paid_method + notes
5. 写 audit_log（billing.invoice_paid）
6. 发公告给用户（"您的账单已支付，感谢您的使用"）
7. 确认订阅状态（如果用户因欠费被停服，paid 后恢复）

**欠费停服（MVP 简化）**：
- MVP 阶段不做自动欠费停服（手动收款，admin 可控）
- 账单超过 30 天未支付 → admin 手动处理（降套餐或停服）
- 未来 S6 Stripe 后做自动 past_due → canceled 流程

**测试**：
- mark-paid API 权限校验（非 admin 403）
- mark-paid 更新 status + paid_at + paid_method + notes
- mark-paid 写 audit_log
- mark-paid 发公告
- void API 权限校验和状态更新
- 已 paid 的账单不可重复 mark-paid（幂等/防重）

**验收**：typecheck 绿；测试全绿；admin 可在界面标记账单 paid，用户收到公告，audit_log 有记录。

---

### S5：团队席位管理

**目标**：Team 套餐支持多席位，Collaborators 面板加 seats 计数和超限拦截。

**文件清单**：
- `packages/core/src/plans.ts`：PLANS 增加 seats 字段（team=5，其他=1）
- `packages/server/src/api.rbac.ts`（或 resource_access 相关）：加 collaborator 时检查 seats 上限
- `packages/server/src/subscriptionService.ts`：增加 `getSeatUsage(userId)` 方法（owner + collaborators 计数）
- `apps/web/src/components/Collaborators.tsx`（或 graph 设置内的共享面板）：增加 seats 计数展示
- `apps/web/src/components/Settings.tsx`：billing tab 增加团队席位管理区域
- `apps/web/src/i18n/locales/{zh,en}/billing.json`：新增席位相关 key

**席位计数规则**：
- 席位 = 1（owner）+ 活跃 collaborator 数（resource_access 表中该用户拥有的所有 graph 的去重 collaborator user_id）
- MVP 简化：按全局 collaborator 去重计数（不按单个 graph）
- free/starter/pro：seats=1，不可加 collaborator（加人时返回 403 "当前套餐不支持团队协作，请升级到 Team"）
- team：seats=5，加到第 6 人时返回 403 "团队席位已满（5/5），请升级套餐或移除成员"

**API 扩展**：
- `GET /api/subscription` 返回增加 `seats: { total, used, available }`
- 加 collaborator 的 API（现有 `POST /api/graphs/:id/collaborators` 或类似）增加 seats 校验

**UI**：
- Settings billing tab：团队席位卡片（"团队席位 3/5"，进度条，成员列表，移除按钮）
- Collaborators 面板：加人时如果席位满，显示错误提示
- PlanComparison：Team 套餐展示"5 席位"

**测试**：
- PLANS seats 字段正确（team=5，其他=1）
- getSeatUsage 计数正确（owner + 去重 collaborators）
- 加 collaborator 时 seats 校验（free/pro 不可加，team 超限 403）
- GET /api/subscription 返回 seats 信息
- 组件测试（席位进度条、超限提示）

**验收**：typecheck 绿；测试全绿；Team 套餐可加最多 5 人，超限拦截；free/pro 不可加人；UI 展示席位使用情况。

---

### S6：支付网关接入（Stripe）—— P2 低优，待有收款主体后实施

**目标**：接入 Stripe Billing，实现自动订阅扣款、webhook 同步、托管支付页。

**前置条件**：
- 有海外收款主体（香港/新加坡公司）或使用 MoR（Paddle/Lemon Squeezy）
- 域名 + TLS 已配置
- Stripe 账户已注册并完成 KYC

**文件清单**（待实施时细化）：
- `packages/server/src/stripe.ts`（新建）：Stripe SDK 封装
- `packages/server/src/api.billing.ts`（新建）：`/api/billing/portal` / `/api/billing/checkout` / `/api/billing/webhook`
- `packages/server/src/subscriptionService.ts`：扩展 setPlan 走 Stripe
- 环境变量：`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_IDS`（走 at-rest 加密或 env 注入）

**核心流程**：
1. 用户点击"升级"→ 创建 Stripe Checkout Session → 跳转 Stripe 支付页
2. 支付成功 → Stripe webhook `checkout.session.completed` → 更新本地 subscriptions（plan=pro, external_id=stripe_sub_id）
3. 每月自动扣款 → Stripe webhook `invoice.paid` → 生成本地 invoice + 标记 paid
4. 扣款失败 → Stripe webhook `invoice.payment_failed` → 本地 subscription status=past_due → 发公告
5. 用户取消 → Stripe portal → webhook `customer.subscription.deleted` → 本地 status=canceled（到期停服）

**测试**：Stripe CLI 本地测试 webhook，mock Stripe SDK 单元测试。

**验收**：端到端支付流程通（测试模式），webhook 同步正确，自动续费/欠费/取消流程完整。

---

## 五、API 汇总

| 方法 | 路径 | 权限 | 说明 | 阶段 |
|---|---|---|---|---|
| GET | `/api/invoices` | 登录用户 | 当前用户账单列表 | S2 |
| GET | `/api/invoices/:id` | 本人/admin | 单条账单详情 | S2 |
| GET | `/api/invoices/:id/download` | 本人/admin | 下载 HTML 发票 | S3 |
| POST | `/api/admin/invoices/:id/mark-paid` | owner/admin | 手动标记账单已支付 | S4 |
| POST | `/api/admin/invoices/:id/void` | owner/admin | 作废账单 | S4 |
| POST | `/api/admin/invoices/generate` | owner/admin | 手动触发生成所有账单 | S1（CLI 也可） |
| GET | `/api/subscription` | 登录用户 | 当前订阅 + 用量 + seats（S5 扩展） | M2 已有，S5 扩展 |

## 六、测试策略

### 服务端测试
- invoiceService：生成/查询/状态管理/幂等/金额计算（~15 例）
- API 集成：权限校验/状态流转/audit_log/公告（~10 例）
- 迁移测试：迁移 38 应用成功，invoices 表结构正确，PG DDL 派生正确（~3 例）
- seats 校验：free/pro 不可加人，team 超限拦截（~5 例）

### 前端测试
- InvoiceList：空状态/有数据/状态标签（~5 例）
- InvoiceDetail：明细展示/金额格式化/下载按钮（~5 例）
- 席位管理：进度条/超限提示/成员列表（~5 例）

### 回归保障
- M2 已有测试（subscription/gate/usage-alert）必须全绿
- 现有 1800+ web + 1000+ server 测试必须全绿
- M3 不触碰 run 执行逻辑（只在账单层加功能），回归风险低

## 七、部署方案

### 迁移
- 迁移 38（invoices 表）随服务启动自动应用
- 无需手建表，无需数据回填（invoices 从空开始，历史账单可选生成）

### 部署顺序
1. push + 合 dev → CI 自动部署 Hasee
2. 迁移自动应用（invoices 表创建）
3. 手动触发一次历史账单生成（`pnpm generate:invoices` 或 admin API），为现有用户生成当前周期账单
4. 验证账单列表可查、发票可下载
5. admin 标记测试账单 paid，验证闭环

### 环境变量
- S1-S5 无需新增环境变量
- S6 Stripe 需要 `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_IDS`

## 八、回滚方案

### 代码回滚
- `git revert` M3 相关 commit（倒序）
- 服务重启后自动回退到旧版本

### 数据回滚
- invoices 表可保留（不影响旧版本逻辑，旧版本不读这张表）
- 如需彻底清理：`DROP TABLE invoices`（迁移 38 的 down 步骤）
- PLANS seats 字段是可选字段（`seats?`），旧版本忽略不影响
- audit_log 中的 billing.invoice_* 记录可保留（审计日志不删）

### 功能降级
- 如账单生成有问题：关闭自动生成 cron，只用手动触发
- 如 seats 校验有问题：临时放宽校验（环境变量或 feature flag），不影响核心功能
- 如发票下载有问题：禁用下载按钮，账单列表仍可查

## 九、里程碑与验收

| 阶段 | 内容 | 验收标准 | 状态 |
|---|---|---|---|
| S1 | invoices 表 + 账单生成服务 | 迁移 38 应用成功；invoiceService 测试全绿；可生成/查询账单 | ⬜ |
| S2 | 账单页 UI 增强 | Settings billing tab 可看账单列表/详情；组件测试全绿；i18n 中英同构 | ⬜ |
| S3 | 发票生成（HTML） | 可下载 HTML 发票，内容完整；测试全绿 | ⬜ |
| S4 | 手动收款闭环 | admin 可标记账单 paid；audit_log + 公告正常；测试全绿 | ⬜ |
| S5 | 团队席位管理 | Team 套餐 seats 限制生效；Collaborators 面板增强；测试全绿 | ⬜ |
| S6 | 支付网关（Stripe） | 端到端支付流程通（待有收款主体） | ⬜ |

**M3 完成定义**：S1-S5 全部完成并部署 Hasee，可对真实用户手动收款、生成账单和发票、Team 套餐支持多席位。S6 Stripe 待有收款主体后另行启动。

**M3 完成后**：P2 收款闭环达成，可正式对用户收费；P3 企业版（多租户/SSO/SIEM/容器隔离）待用户规模触发。
