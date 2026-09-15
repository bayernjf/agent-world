# M3 S6 Step A5：Stripe 前端（BillingTab）实施方案

> 上游总方案：[design-monetization-m3-s6-stripe.md](design-monetization-m3-s6-stripe.md)（§3 API、§4 流程、§9 Step 5 前端 UI）。
> 后端 A0–A4（SDK 封装、迁移 39、webhook、checkout/portal 路由、35 个 mock 测）已完成并在本地（未 push）。**本文只覆盖 Step 5 前端 A5**，把「M2 手动收款（联系管理员）」升级为「Stripe 可用时在线升级 / 管理订阅，未配置时优雅降级」。
>
> 状态：方案已定（2026-09-15），待按 §7 分步实施。所有「现状」描述均来自当前代码，不是推测。

---

## 1. 范围与目标

**做**

1. `BillingTab` 增加在线升级（Stripe Checkout 托管页跳转）与管理订阅（Stripe Billing Portal 跳转）。
2. 按订阅 `plan / provider / status` 渲染正确的按钮组合；Stripe 未配置（后端 503）时自动回退到现有「联系管理员」。
3. 处理 Stripe 支付完成 / 取消后的回跳（`?billing=success|cancel`）：自动打开「设置 → 套餐与用量」并 Toast 提示。
4. zh/en i18n 完整对齐、样式走设计 token、补组件与纯函数单测。

**不做（边界，沿用上游 §12 与 MVP 约束）**

- 不做 Stripe Elements 内嵌信用卡表单（统一用 Stripe 托管 Checkout / Portal，前端不接触卡号）。
- 不做年付、优惠券、多币种、税务（上游 §12 已排除）。
- 不做自助降级 / proration 计算：**只允许在线「升级到更高级套餐」，降级与取消引导进 Portal**。
- 不做 seats 选择 UI：checkout `seats` 固定传 1（team 多席位留给后续，后端已支持 1–10 入参，前端暂不暴露）。
- 不做订阅状态实时轮询 / 推送：webhook 是服务器到服务器异步，回跳 success 时本地状态可能尚未更新，文案明确「确认后更新」，BillingTab 每次挂载重新拉一次即可。

---

## 2. 现状盘点（以代码为准）

| 项 | 现状 | 位置 |
|---|---|---|
| BillingTab | 已有：当前套餐卡、`UsagePanel`、`InvoiceList`、`PlanComparison`（free/starter/pro/team 四列对比）、末尾一句 `billing:contactOwner`（"M2 阶段暂未接入在线支付…"）。**无任何 Stripe 按钮 / 动作** | `apps/web/src/components/BillingTab.tsx` |
| 订阅状态类型 | `SubscriptionStatus { plan: "free"\|"starter"\|"pro"\|"team"; status: string; provider: string\|null; currentPeriodStart/End; usage }` | `apps/web/src/lib/api.ts:617` |
| 已有 api 方法 | 仅 `getSubscription(): GET /api/subscription`；**无 checkout/portal** | `api.ts:1308` |
| POST 约定 | `method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(...)`；通用 `json<T>` 在非 2xx 时 `throw new Error("${status} ${bodyText}")` | `api.ts:14-21, 697` |
| 套餐单一事实源 | core `PLAN_IDS=["free","starter","pro","team"]`、`PLAN_PRICES={free:0,starter:9,pro:29,team:149}`、`PLANS`（额度/seats） | `packages/core/src/plans.ts` |
| provider 取值 | 手动开通 = `"manual"`；webhook 确认 Stripe 付款后 = `"stripe"`（`stripeWebhook.ts:140`）；历史行可能为 `null`（视同 manual） | server |
| status 取值 | `active / trialing / past_due / canceled`（i18n `billing.planStatus.*` 已覆盖） | — |
| 前端路由 | react-router 仅有 `/login`、`/register`、`/*`（主应用）；**没有 `/settings/billing` 页面路由**，设置是 `Settings` 模态（`open + initialTab`），tab 由 App 的 `settingsTab` state 控制 | `main.tsx`、`App.tsx:1300`、`Settings.tsx:1476` |
| Toast | `useToast.getState().show(message,{ttlMs,actions})`（全局单 toast store） | `store/toast.tsx` |
| 按钮样式 | 统一 `className="btn btn--primary"`（次按钮 `btn--secondary`、小尺寸 `btn--sm`），走 CSS 变量 | 多处 |
| i18n | `locales/{zh,en}/billing.json` 顶层结构当前完全对齐；新增文案必须 zh/en 同步、组件用 `t("billing:…")`，守 `i18n/keys.test.ts` | AGENTS.md |

**关键缺口**：上游 §3.2 示例里 success/cancel URL 写的是 `/settings?billing=success`，后端默认回跳是 `${publicUrl}/settings/billing`（`api.billing.ts:62`），但前端根本没有 `/settings/billing` 路由——回跳会落到主应用却不会自动打开账单页。**A5 必须由前端显式传同源回跳 URL（`${origin}/?billing=success|cancel`），并在主应用挂载时解析该 query。**

---

## 3. 后端契约（以 `packages/server/src/api.billing.ts` 为准）

两个登录态端点（webhook 与前端无关，不在 A5 调用）：

### 3.1 `POST /api/billing/checkout`
- 请求：`{ plan: "starter"|"pro"|"team", seats?: number(默认1,clamp 1–10), success_url?, cancel_url? }`；`plan=free` 或非法 → **400 `invalid_plan`**。
- success/cancel URL 经后端 same-origin 校验（只允许同源，否则回退默认）。
- 成功响应：`{ id: string, url: string }`（`url` = Stripe Checkout 托管页，前端 `window.location.assign(url)`）。
- 错误码：`invalid_plan`(400)、`price_missing`(400，该套餐没配 Stripe price)、`stripe_not_configured`(**503**，服务端没配 Stripe key)、`billing_error`(500)。
- 副作用：会先 `findOrCreateCustomer` 并把 `stripeCustomerId` 立即 mirror 到本地（即使放弃支付，之后 portal 也能用）。

### 3.2 `POST /api/billing/portal`
- 请求（可选）：`{ return_url? }`（同源校验）。
- 前置：本地订阅行必须已有 `stripeCustomerId`，否则 **409 `no_stripe_customer`**（提示先完成一次 checkout）。
- 成功响应：`{ id, url }`（Stripe Billing Portal，改套餐 / 取消 / 更新支付方式）。
- 错误码：`no_stripe_customer`(409)、`stripe_not_configured`(503)、`billing_error`(500)。

---

## 4. 前端设计

### 4.1 api 层（`lib/api.ts`）

新增可判别错误类型，让 UI 能按 code 降级（而不是只能拿到一串 `"503 …"` 文本）：

```ts
export class BillingApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export interface BillingSession { id: string; url: string }

// 内部：POST + 解析 {error,message}，非 2xx 抛 BillingApiError
async function billingPost<T>(path: string, body: unknown): Promise<T> { … }

createCheckoutSession(plan: PlanId): Promise<BillingSession>
//  body: { plan, seats: 1,
//          success_url: `${location.origin}/?billing=success`,
//          cancel_url:  `${location.origin}/?billing=cancel` }

createPortalSession(): Promise<BillingSession>
//  body: { return_url: `${location.origin}/?billing=manage-done` }
```

- 跳转统一 `window.location.assign(session.url)`（整页跳到 Stripe 托管域，返回时整页重载，天然重新拉订阅）。
- `plan` 类型复用 core 的 `PlanId`；`free` 不允许进 checkout（UI 也不会给 free 出升级按钮）。

### 4.2 回跳 query 纯函数（可单测，放 `lib/billingReturn.ts`）

```ts
export type BillingReturn = "success" | "cancel" | "manage-done" | null;
export function parseBillingReturn(search: string): BillingReturn // 只认白名单值，其余 null
export function billingReturnPath(): string // "/?billing=success" 等，供 api 层拼 URL
```

白名单之外一律 `null`，避免任意 query 触发 toast。

### 4.3 按钮 / 状态矩阵（核心）

判定输入：`plan`（当前套餐）、`provider==="stripe"`、`status`、以及一次性的 `stripeUnavailable`（遇到过 503）。

| 场景 | 条件 | 主操作 | 次操作 / 提示 |
|---|---|---|---|
| 免费用户 | `plan==="free"` 且未禁用 | 套餐对比表内每个**更高价**套餐列给「升级」按钮 → checkout(该套餐)；当前列显示「当前套餐」禁用态 | — |
| Stripe 付费生效中 | `provider==="stripe"` 且 `status∈{active,trialing}` | 当前套餐卡「管理订阅」→ portal | 对比表只给**更高价**套餐「升级」（Stripe proration），当前列禁用，更低价列标注「在管理订阅中更改」 |
| 欠费 | `provider==="stripe"` 且 `status==="past_due"` | 橙色警示条 +「更新支付方式」→ portal | — |
| 已取消（到期前） | `provider==="stripe"` 且 `status==="canceled"` | 「重新订阅」→ checkout(当前或更高套餐) | 「管理订阅」→ portal |
| 手动开通的付费用户 | `provider!=="stripe"`（manual/null）且 `plan!=="free"` | 对比表给更高价套餐「升级（在线）」→ checkout（后端会 findOrCreateCustomer，完成后转 stripe） | **不显示 portal 按钮**（无 customer，打了必 409）；保留联系管理员提示 |
| Stripe 未配置 | 任一动作收到 503 `stripe_not_configured` | 隐藏全部 Stripe 按钮，置 `stripeUnavailable` | 回退显示 `billing:contactOwner`（现有文案） |

规则收敛：
- **升级方向单调**：只对「价格高于当前」的套餐出 checkout 按钮；同档禁用；低档走 portal 文案。用 `PLAN_PRICES` 现算，不写死顺序。
- 每次点击进入对应 loading（`"checkout:<plan>" | "portal" | null`），期间所有 Stripe 按钮 disabled，防重复提交；跳转失败后解除。
- 出错：`stripe_not_configured` → 静默降级（不弹错，直接回到联系管理员）；`no_stripe_customer` / `price_missing` / 其他 → Toast 显示对应 i18n 错误文案并解除 loading。

### 4.4 组件改动

**`BillingTab.tsx`**
- 新增 state：`action: string|null`（loading）、`stripeUnavailable: boolean`。
- 抽 `handleUpgrade(plan)`、`handleManage()`、`handleUpdatePayment()`（后两者都是 portal，语义文案不同）。
- 当前套餐卡 `billing-current` 内按矩阵插按钮区 `div.billing-actions`；`past_due` 插 `div.billing-warning`。
- `PlanComparison` 增加可选 props（`currentPlan / provider / status / busyPlan / onUpgrade / disabled / stripeUnavailable`），在表格末加一行「操作」：每列按矩阵渲染按钮 / 禁用 / 低档提示，保持纯展示 + 回调，不自己发请求。
- `contactOwner` 那段改为「仅 `stripeUnavailable` 时显示」；Stripe 可用时不显示"M2 未接入在线支付"这句过时文案。

**`App.tsx`（回跳处理）**
- 主应用（ProtectedRoute 内）挂载时跑一次 `parseBillingReturn(window.location.search)`：
  - `success` → `setSettingsTab("billing"); setSettingsOpen(true)` + Toast `billing:stripe.returnSuccess`（"支付已完成，套餐将在 Stripe 确认后更新…"）；
  - `cancel` → Toast `billing:stripe.returnCancel`（"已取消支付，套餐未变更"）；
  - `manage-done` → 不强制开模态，仅轻提示或忽略（MVP 可忽略，不弹）。
  - 处理后用 react-router 的 `navigate("/",{replace:true})` 清掉 query，避免刷新重复弹。
- 用一个小 `useEffect`，依赖 `[]`，只在整页加载回跳时触发一次。

### 4.5 i18n（先改 zh/en 再写组件，守 AGENTS.md 顺序）

在 `billing.json` 新增 `stripe` 子树（zh、en 结构逐 key 对齐），拟用 key：

```
stripe.upgradeTo            升级到{{plan}} / Upgrade to {{plan}}
stripe.manageSubscription   管理订阅 / Manage subscription
stripe.updatePayment        更新支付方式 / Update payment method
stripe.resubscribe          重新订阅 / Resubscribe
stripe.currentPlan          当前套餐 / Current plan（列禁用 title）
stripe.downgradeInPortal    更低套餐请在「管理订阅」中更改 / Change to a lower plan in the portal
stripe.processing           正在跳转支付… / Redirecting to checkout…
stripe.pastDueTitle         订阅待支付 / Your payment is past due
stripe.pastDueBody         上次扣款未成功，请更新支付方式以免服务中断 / …
stripe.returnSuccess       支付已完成，套餐将在 Stripe 确认后自动更新 / …
stripe.returnCancel        已取消支付，套餐未发生变化 / …
stripe.errPriceMissing     该套餐暂未开放在线购买，请联系管理员 / …
stripe.errNoCustomer       请先完成一次升级购买 / …
stripe.errGeneric          操作失败，请稍后重试 / …
```

（最终措辞以落地时 zh/en 文件为准；`contactOwner` 保留不删，降级路径仍用。）

### 4.6 样式（`styles.css`，最小增量，全走 token）

- `.billing-actions`：flex、`gap: var(--gap-sm)`、`margin-top: var(--space-*)`。
- `.billing-warning`：背景 `var(--warning)` 的低透明变体（无对应 token 时用 rgba 功能色透明变体——AGENTS.md 允许的例外）、文字 `var(--warning)`、圆角 `var(--radius-*)`、内边距 `var(--space-*)`。
- 按钮直接复用 `.btn .btn--primary / .btn--secondary / .btn--sm`，不新造按钮色系；**禁止硬编码 `#hex/rgb()` 实色与 px 尺寸**。

---

## 5. 测试计划

### 5.1 纯函数单测（vitest）
- `lib/billingReturn.test.ts`：`parseBillingReturn` 命中三值、大小写 / 非法值 / 空 → null、`billingReturnPath` 输出。

### 5.2 组件测试（`BillingTab.test.tsx`，mock `../lib/api`）
1. free + Stripe 可用：出现「升级」按钮、**不**出现「管理订阅」、不显示 contactOwner。
2. provider=stripe + active：出现「管理订阅」，点击调用 `createPortalSession` 并 `location.assign`。
3. provider=stripe + past_due：出现警示条与「更新支付方式」。
4. 手动付费（provider=manual）：不出现 portal 按钮、可对更高价套餐升级。
5. checkout 抛 `BillingApiError(503,stripe_not_configured)`：置降级态、显示 contactOwner、Stripe 按钮消失。
6. portal 抛 409 no_stripe_customer：Toast 错误且 loading 解除。
7. 点击升级：调用 `createCheckoutSession("pro")` 并跳转其 url；loading 期间按钮 disabled。
8. 低套餐列不给出 checkout、当前列禁用。

`window.location.assign` 用 `vi.stubGlobal` / 历史 API mock，测试后还原。

### 5.3 守护
- `pnpm --filter @agent-world/web exec vitest run src/i18n/keys.test.ts`（zh/en 对齐、无硬编码中文 JSX）。
- `pnpm --filter @agent-world/web exec tsc --noEmit`。
- web 全量相关目录测试回归。

### 5.4 本地浏览器走查（诚实边界）
**当前本地 / Hasee 都没有 Stripe key**，`requireStripeConfig()` 会抛 `stripe_not_configured` → 后端 503。因此本地走查只能亲眼验证：
- 免费用户点升级 → 收到 503 → **自动降级**为联系管理员（验证降级路径真实生效，不卡死、不白屏）；
- 回跳 query：手动访问 `/?billing=success` / `?billing=cancel`，验证自动开账单模态 + Toast + query 被清。

**happy path（真正跳到 Stripe 支付页、portal）无法在无 key 环境验证**，由 5.1/5.2 mock 单测保证逻辑，真机验证留待 Step 6（收款主体 + Stripe 测试 key 齐了之后，用 Stripe 测试卡 4242… 走端到端）。此限制在交付说明中明确标注，不假装已验证。

---

## 6. 验收标准

- [ ] free 用户可对每个更高价套餐发起 checkout，请求体 / 回跳 URL 符合 §3，跳转 Stripe url。
- [ ] stripe 付费用户可进 portal；past_due 有警示与更新支付方式入口；手动付费用户不出现会 409 的 portal 按钮。
- [ ] Stripe 未配置时整页无 Stripe 按钮、回退联系管理员，无报错弹窗、无白屏。
- [ ] `?billing=success/cancel` 回跳自动打开账单页并 Toast，且 query 被 replace 清除（刷新不重复弹）。
- [ ] zh/en key 完全对齐、组件无硬编码中文；颜色 / 间距 / 圆角全部走 CSS 变量。
- [ ] typecheck 干净、新增单测 + 回归全绿、i18n 守护通过。
- [ ] 不改动任何后端文件（A0–A4 已就绪），不碰已稳定的 CanvasPark/Canvas3D。

---

## 7. 分步实施（每步一个原子 commit，英文 message，不 push）

| 步 | 内容 | 提交类型 |
|---|---|---|
| A5.1 | `api.ts` 加 `BillingApiError/createCheckoutSession/createPortalSession`；新增 `lib/billingReturn.ts` + 单测 | feat(web) |
| A5.2 | zh/en `billing.json` 同步加 `stripe` 子树，跑 i18n 守护 | feat(web) i18n |
| A5.3 | `BillingTab` + `PlanComparison` 按钮矩阵 / 动作 / 降级 / 警示 + 组件测试 | feat(web) |
| A5.4 | `App.tsx` 回跳 query 解析 + Toast + 清 URL | feat(web) |
| A5.5 | `styles.css` 最小增量（token）；typecheck + 全量相关测试；本地浏览器走查降级 / 回跳；回写 handoff | style + docs |

> 实施顺序注意：i18n key（A5.2）先于引用它的组件（A5.3/A5.4），符合 AGENTS.md「先 zh → 再 en → 后 t()」。
