# M3 S6 Stripe 支付网关集成设计方案

> 定位：M3 设计文档（design-monetization-m3-implementation.md）S6 阶段的**落地级细化**。
>
> 状态：**设计阶段（2026-09-14）**。S1-S5 已完成并部署 Hasee，手动收款闭环已通。S6 待有收款主体后实施。
>
> 前置条件：有海外收款主体（香港/新加坡公司）或使用 MoR（Paddle/Lemon Squeezy）；域名 + TLS 已配置；Stripe 账户已注册并完成 KYC。
>
> 约定：延续项目惯例——原子提交、英文 commit message、不加助手署名、不 push；typecheck 四包绿、全量测试通过；i18n + 设计 token；DB 迁移双写（sqlite base DDL + 迁移版本 + PG toPgDdl）。

## 一、架构概览

```
用户浏览器              Agent World 后端                Stripe
    |                        |                            |
    |--- 点击"升级" --------->|                            |
    |                        |--- 创建 Checkout Session ->|
    |<-- 302 跳转 Stripe  ----|                            |
    |                        |                            |
    |==== 在 Stripe 支付页完成支付 =======================>|
    |                        |                            |
    |                        |<-- webhook checkout.session.completed ---|
    |                        |--- 更新本地 subscription ---|
    |<-- 跳转回 success_url -|                            |
    |                        |                            |
    |                        |<-- webhook invoice.paid (每月自动扣款) --|
    |                        |--- 生成本地 invoice + mark paid ---------|
    |                        |                            |
```

**核心原则**：Stripe 是 billing system of record，本地 DB 是镜像。所有状态变更以 webhook 为准，API 只触发动作，不直接改状态。

## 二、数据模型变更

### 2.1 subscriptions 表扩展（迁移 39）

现有字段：`user_id` (PK), `plan`, `status`, `provider`, `external_id`, `current_period_start`, `current_period_end`, `created_at`, `updated_at`

**新增字段**：
- `stripe_customer_id` TEXT — Stripe Customer ID（cus_xxx），一个用户一个 customer
- `stripe_subscription_id` TEXT — Stripe Subscription ID（sub_xxx），当前活跃订阅
- `stripe_price_id` TEXT — Stripe Price ID（price_xxx），当前订阅价格

**复用现有字段**：
- `provider`：值为 `'stripe'` 表示 Stripe 订阅
- `external_id`：保留兼容（旧手动收款可能为空）

### 2.2 invoices 表扩展

现有字段已足够：
- `paid_method`：MVP 是 `'manual'`，S6 后加 `'stripe'`
- `external_id`：可加 `stripe_invoice_id`（inv_xxx），用于对账

**新增字段**：
- `stripe_invoice_id` TEXT — Stripe Invoice ID，用于对账和同步

### 2.3 迁移 39 SQL

```sql
-- sqlite
ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE subscriptions ADD COLUMN stripe_price_id TEXT;
ALTER TABLE invoices ADD COLUMN stripe_invoice_id TEXT;

-- 索引
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_invoice ON invoices(stripe_invoice_id);
```

## 三、API 设计

### 3.1 新增端点

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/billing/checkout` | 创建 Stripe Checkout Session，返回 session URL | 登录用户 |
| POST | `/api/billing/portal` | 打开 Stripe Customer Portal（管理订阅/取消/更新支付方式） | 登录用户 |
| POST | `/api/billing/webhook` | Stripe webhook 接收端点 | 无认证，Stripe 签名验证 |

### 3.2 POST /api/billing/checkout

**请求体**：
```json
{
  "plan": "pro",
  "success_url": "https://app.example.com/settings?billing=success",
  "cancel_url": "https://app.example.com/settings?billing=cancel"
}
```

**逻辑**：
1. 验证 plan 是 paid plan（starter/pro/team）
2. 查找或创建 Stripe Customer（stripe_customer_id）
3. 创建 Stripe Checkout Session，mode=subscription，line_items=[{price: stripe_price_id[plan], quantity: seats}]
4. 返回 `{ url: "https://checkout.stripe.com/..." }`

**响应**：
```json
{
  "url": "https://checkout.stripe.com/c/pay/cs_test_..."
}
```

### 3.3 POST /api/billing/portal

**逻辑**：
1. 验证用户有 stripe_customer_id
2. 创建 Stripe Billing Portal Session
3. 返回 portal URL

**响应**：
```json
{
  "url": "https://billing.stripe.com/p/login/..."
}
```

### 3.4 POST /api/billing/webhook

**关键**：不验证 session cookie，用 Stripe 签名验证。

**事件处理**：

| 事件 | 处理逻辑 |
|------|----------|
| `checkout.session.completed` | 从 session 提取 customer/subscription/plan，更新本地 subscriptions |
| `invoice.paid` | 从 invoice 提取 amount/period，生成本地 invoice + mark paid |
| `invoice.payment_failed` | 更新 subscription status=past_due，发公告给用户 |
| `customer.subscription.updated` | 同步 plan/status/period 到本地 |
| `customer.subscription.deleted` | 更新 subscription status=canceled，到期停服 |
| `customer.updated` | 同步 customer 信息（可选） |

**安全**：
- 用 `STRIPE_WEBHOOK_SECRET` 验证 Stripe 签名
- 事件 idempotency：用 `idempotency_keys` 表（迁移 35 已有）防重复处理

## 四、核心流程

### 4.1 新用户升级（Checkout 流程）

1. 用户在 Settings → 套餐与用量点"升级到专业版"
2. 前端调 `POST /api/billing/checkout`，plan=pro
3. 后端创建或复用 Stripe Customer（stripe_customer_id）
4. 后端创建 Checkout Session（mode=subscription）
5. 前端跳转 Stripe 支付页
6. 用户完成支付
7. Stripe 回调 `checkout.session.completed`
8. 后端更新本地 subscriptions：
   - provider='stripe'
   - stripe_customer_id=cus_xxx
   - stripe_subscription_id=sub_xxx
   - stripe_price_id=price_xxx
   - plan='pro'
   - status='active'
   - current_period_start/end 从 Stripe subscription 同步
9. Stripe 回调 `invoice.paid`（首笔）
10. 后端生成本地 invoice（stripe_invoice_id=inv_xxx，status=paid，paid_method=stripe）

### 4.2 每月自动续费

1. Stripe 每月自动扣款
2. Stripe 回调 `invoice.paid`
3. 后端生成本月 invoice（如果还没有的话）
4. 后端更新 subscription current_period_end
5. 发公告"本月账单已支付"

### 4.3 扣款失败

1. Stripe 扣款失败，回调 `invoice.payment_failed`
2. 后端更新 subscription status=past_due
3. 发公告"账单支付失败，请更新支付方式"
4. Stripe 自动重试（最多 3 次，间隔 3/7/14 天）
5. 重试成功 → `invoice.paid` → 恢复 active
6. 重试全部失败 → Stripe 自动取消订阅 → `customer.subscription.deleted` → 本地 status=canceled

### 4.4 用户取消

1. 用户在 Settings 点"管理订阅"→ 跳转 Stripe Portal
2. 用户在 Stripe Portal 取消订阅
3. Stripe 回调 `customer.subscription.deleted`
4. 后端更新本地 status=canceled
5. **到期才停服**：current_period_end 之前保持 active，到期后降级为 free

### 4.5 升降级

1. 用户在 Settings 选择新套餐
2. 前端调 `POST /api/billing/checkout`（plan=newPlan）
3. 或者：用户在 Stripe Portal 自己改 plan（Stripe 会发 `customer.subscription.updated`）
4. 后端从 webhook 同步新 plan
5. **MVP 简化**：不做 prorate（按比例补差价），下个周期生效

## 五、文件清单

### 5.1 新建文件

| 文件 | 说明 |
|------|------|
| `packages/server/src/stripe.ts` | Stripe SDK 封装（init customer/create session/portal/webhook verify） |
| `packages/server/src/api.billing.ts` | billing API 端点（checkout/portal/webhook） |
| `packages/server/src/stripe.test.ts` | Stripe 服务单元测试（mock SDK） |
| `packages/server/src/api.billing.test.ts` | billing API 集成测试（mock webhook 事件） |

### 5.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `packages/server/src/sqlite-driver.ts` | 迁移 39：subscriptions + invoices 加 Stripe 字段 |
| `packages/server/src/subscriptionService.ts` | 扩展 setPlan 支持 Stripe 路径 |
| `packages/server/src/index.ts` | 注册 billing API 路由 |
| `apps/web/src/components/BillingTab.tsx` | 加"升级"/"管理订阅"按钮，跳转 checkout/portal |
| `apps/web/src/lib/api.ts` | 加 billing API 方法 |
| `apps/web/src/i18n/locales/{zh,en}/billing.json` | 新增 Stripe 相关 i18n key |
| `apps/web/src/styles.css` | billing 按钮样式 |

### 5.3 环境变量

| 变量 | 说明 |
|------|------|
| `STRIPE_SECRET_KEY` | Stripe 密钥（sk_test_xxx / sk_live_xxx） |
| `STRIPE_WEBHOOK_SECRET` | webhook 签名密钥（whsec_xxx） |
| `STRIPE_PRICE_IDS` | JSON 映射：`{"starter": "price_xxx", "pro": "price_xxx", "team": "price_xxx"}` |

**存储**：走 at-rest 加密（enc:v2:），和 API key 一样的存储方式。

## 六、Stripe 侧配置（人工操作）

### 6.1 一次性配置

1. **创建 Product**：Agent World Subscription
2. **创建 Prices**：
   - Starter：$9/月（price_starter）
   - Pro：$29/月（price_pro）
   - Team：$149/月（price_team）
3. **配置 Webhook**：
   - URL：`https://app.example.com/api/billing/webhook`
   - 事件：checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted
4. **配置 Branding**：支付页配色、logo、公司信息

### 6.2 Price ID 对应表

| 套餐 | Price ID（示例） | 月费 |
|------|-----------------|------|
| Starter | price_123abc_starter | $9 |
| Pro | price_123abc_pro | $29 |
| Team | price_123abc_team | $149 |

## 七、安全考虑

1. **Webhook 签名验证**：必须验证 `Stripe-Signature` 头，防止伪造事件
2. **Idempotency**：用事件 ID 做幂等键，重复事件不重复处理
3. **密钥管理**：STRIPE_SECRET_KEY 走 at-rest 加密，不进 git
4. **CORS**：webhook 端点不设 CORS（Stripe 服务器直接调）
5. **Rate limiting**：webhook 端点加 rate limit，防止暴力重试

## 八、测试策略

### 8.1 单元测试（mock Stripe SDK）

- `stripe.test.ts`：
  - 创建 customer / session / portal
  - webhook 签名验证（正确/错误/缺失）
  - 事件处理逻辑（每个事件类型）

### 8.2 集成测试

- `api.billing.test.ts`：
  - POST /api/billing/checkout（未登录 401 / 免费 plan 400 / 正常 200）
  - POST /api/billing/portal（无 customer 400 / 正常 200）
  - POST /api/billing/webhook（无效签名 400 / 有效签名 200 / 重复事件幂等）

### 8.3 端到端测试（Stripe CLI）

用 Stripe CLI 本地测试 webhook：
```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
stripe trigger checkout.session.completed
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
```

## 九、实施步骤（分小步骤）

### Step 1：数据层（迁移 39）
- subscriptions 加 stripe_customer_id / stripe_subscription_id / stripe_price_id
- invoices 加 stripe_invoice_id
- driver 层加对应方法
- 单测：迁移 up/down 正确

### Step 2：Stripe 服务封装
- `stripe.ts`：init SDK / create customer / create checkout session / create portal session / construct webhook event
- 环境变量读取 + at-rest 加密
- 单测：mock SDK 全路径

### Step 3：Webhook 处理
- `api.billing.ts`：webhook 端点
- 事件处理：checkout.session.completed / invoice.paid / invoice.payment_failed / customer.subscription.updated / customer.subscription.deleted
- idempotency 处理
- 集成测试：mock 各事件

### Step 4：Checkout + Portal API
- POST /api/billing/checkout
- POST /api/billing/portal
- 集成测试

### Step 5：前端 UI
- BillingTab 加"升级到专业版"按钮
- BillingTab 加"管理订阅"按钮
- 支付成功/取消提示
- i18n
- 手动验证（Stripe 测试模式）

### Step 6：部署上线
- 环境变量配置（STRIPE_SECRET_KEY / WEBHOOK_SECRET / PRICE_IDS）
- Stripe 侧配置完成（product/prices/webhook）
- 灰度：先开给 owner 测试
- 全量上线

## 十、回滚方案

1. **紧急回滚**：把 `STRIPE_SECRET_KEY` 清空，前端隐藏"升级"按钮，回退到手动收款
2. **数据库回滚**：迁移 39 down 删 Stripe 字段（不影响现有手动收款数据）
3. **Stripe 侧**：暂停 webhook endpoint，防止继续回调

## 十一、验收标准

- [ ] 端到端支付流程通（Stripe 测试模式）
- [ ] webhook 同步正确（5 个事件类型）
- [ ] 自动续费/欠费/取消流程完整
- [ ] 幂等：重复 webhook 事件不重复处理
- [ ] 手动收款仍可用（不 Stripe 的用户不受影响）
- [ ] typecheck 四包绿
- [ ] 全量测试通过
- [ ] i18n zh/en 完整
- [ ] 设计 token 无硬编码

## 十二、不做（留以后）

- ❌ 年付折扣（Stripe 支持，但 MVP 只做月付）
- ❌ 优惠券/促销码（Stripe 支持，但 MVP 不做）
- ❌ 多币种（只做 USD）
- ❌ 税务计算（Stripe Tax 或手动）
- ❌ 发票 PDF 生成（Stripe 自动生成，MVP 用 Stripe 托管发票）
