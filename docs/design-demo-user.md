# 演示用户（Demo User）落地方案（design-demo-user）

> 状态：**D1–D6 本地端到端走查全部通过（2026-09-15）**。D1 数据层 / D2 额度守卫 / D3 服务路由 / D4 前端 / D5 清理脚本+部署手册均已实现并随 6 个原子 commit 入库（分支 feature/20260824，未合 dev），单测/集成测/组件测全绿、四包 typecheck 绿、web 顺序全量 1865 与 server 全量 1185 通过；D6 本地以 ALLOW_DEMO=1 + MONETIZATION_ENFORCE=1 走完 API + 浏览器全链路。**唯一剩余**：走 PR→CI→merge dev→Hasee 部署后加 systemd override `ALLOW_DEMO=1` 做真机复验、挂每小时 prune cron。
> 目标读者：接手实现的 agent / 工程师。本文是演示用户特性的单一事实源，实现按 §9 的 D1–D6 原子推进。
> 关联：商业化配额见 [design-monetization.md](design-monetization.md) 与 [design-monetization-m2-implementation.md](design-monetization-m2-implementation.md)；认证/RBAC 见 [design-rbac.md](design-rbac.md)；DB 抽象层与 PG 双轨见 [design-postgres-migration.md](design-postgres-migration.md)；新用户引导见 [design-guided-tour.md](design-guided-tour.md)。

---

## 一、背景与目标

新用户在登录页**无需注册**，点一个「先体验演示」按钮即可进入**真实产品**：能编辑画布、能跑真实产线、能看产物；但账号是临时的、能力受限、带体验额度，且随时可「注册转正」并**原样保留**他在演示里做的全部工作。

- 状态定位：**介于「未登录」与「正式登录」之间**——比未登录多一个可操作的真实工作区，比正式账号少外联、持久化与更高额度。
- 商业目标：降低首次体验门槛 → 用真实能力建立认知 → 用「保留我的工作」完成注册转化。
- 非目标：不做多人共享的同一个 demo 沙箱；不做匿名离线模式；不替代正式注册。

---

## 二、核心设计决策

### 2.1 演示用户 = 一行带 `is_demo` 标记的真实账号（不做匿名会话）

现有系统所有数据都按 `userId` 隔离（graphs / runs / artifacts / subscriptions …），认证靠 JWT cookie。让 demo 也成为 `users` 表里的一行、持有真实 `userId`，可以**零改动复用整套隔离、会话、订阅机制**；转正时因为是同一个 userId，数据原地保留、无需搬迁。

否决的替代方案：

- **纯匿名内存会话**：要给每张 user-scoped 表加匿名分支，违背「统一 userId 隔离」与「DB 走 db.ts 抽象层」的既有架构，转正还得做一次数据迁移。否决。
- **新增 `role='demo'`**：`role` 表达的是权限层级（owner/admin/user），demo 表达的是账号生命周期类型，两个维度正交。塞进 role 会污染 `rbac.ts` 里 owner/admin/user 的全部分支。改用独立布尔列 `is_demo`，role 仍为 `user`。

### 2.2 正交的两个维度

| 维度 | 取值 | 由谁管 |
|---|---|---|
| `role` | owner / admin / user（demo 恒为 user） | RBAC（不动） |
| `is_demo` | 0 正式 / 1 演示 | 本特性 |

### 2.3 转正 = 原地升级同一行（claim），不做账号合并

demo 提交邮箱+密码后，直接 UPDATE 同一 users 行（清 is_demo、写真实邮箱与密码），其下 graphs/runs/artifacts 全部天然保留。避免「两个账号再合并」的复杂度。

---

## 三、当前代码库复用盘点（2026-09-15 复核，行号可能漂移，以现状为准）

| 能力 | 位置 | 复用方式 |
|---|---|---|
| JWT 签发/校验 | `packages/server/src/auth.ts`：`signToken(userId,email,remember)`、`verifyToken`；remember=true→7d，false→24h | demo 用 `signToken(id,email,false)` 发短会话 |
| Cookie 写入/清除 | `packages/server/src/index.ts` `setAuthCookie/clearAuthCookie`（约 340-348，HttpOnly SameSite=Lax） | demo 登录直接复用 |
| 认证中间件 | `index.ts:521-555`：`/api/health`、`/api/auth/*`、webhook 跳过；其余 cookie→Bearer→SSE `?token=`，`verifyToken` 后 `c.set("userId",…)` | 新端点挂 `/api/auth/*` 自动公开 |
| 注册/登录/me/改密 | `index.ts:402/437/476/496`；首个账号=owner，其后默认关注册（`ALLOW_REGISTRATION`） | demo 端点仿此写；登录路由需显式拒绝 is_demo |
| users DDL | `sqlite-driver.ts:58-64`：`id PK / email UNIQUE NOT NULL / password_hash NOT NULL / role DEFAULT 'user' / created_at` | 迁移 v40 加两列 |
| user driver 方法 | `createUser(id,email,passwordHash)`（1047，内部按 countOwners 决定 owner/user）、`findUserById/Email`、`countUsers`、`updateUserPasswordHash`、`listUsers` | 新增 createDemoUser/claim/listExpired/deleteCascade；find* 扩列 |
| 最新迁移 | **v39**（`sqlite-driver.ts:3812`，`SCHEMA_VERSION=LATEST_VERSION:3942`）；迁移形如 `{version,description,detect,up,down}`，用 `columnExists` 防重 | demo 用 **v40** |
| 订阅懒建 | `subscriptionService.ts:39 getOrCreateSubscription` → 无则建 free | demo 首次访问自动得 free 行，额度另走 §6.3 |
| 套餐配额 | `packages/core/src/plans.ts`：**free = tokens 0 / concurrentRuns 1 / storage 100MB / video 0**；starter/pro/team | demo **不新增 PlanId**，用独立 DEMO_QUOTA |
| run 订阅 gate | `index.ts:2338-2365`：`MONETIZATION_ENFORCE==="1"` 时 `enforceSubscription(...)`，`QuotaError`→402 | 在其前/内加 is_demo 分支 |
| 限流 | `packages/server/src/rate-limit.ts` `RateLimiter`；index.ts 已有 login/register/run 三个实例 | 新增 demoLimiter |
| 模板实例化 | `packages/core/src/templates.ts:146 instantiateTemplate(tpl,{id,name,fieldValues})` → Graph；index.ts:666 已在用 | demo 预置产线用它克隆 |
| DB 抽象层 | `packages/server/src/db.ts`：`Db = ReturnType<typeof createSqliteDriver>`、`DatabaseDriver` 接口、`openDatabase()` 按 DB_DRIVER 分派 sqlite/pg | 新方法 sqlite + pg 各一份，禁止裸 SQL 进路由 |
| 前端路由 | `apps/web/src/main.tsx`：/login、/register 公开，/* 包 `ProtectedRoute` | 登录页加演示入口 |
| 前端鉴权 gate | `apps/web/src/components/ProtectedRoute.tsx`：挂载 fetch `/api/auth/me`，ok 渲染、否则 Navigate /login | me 返回带 isDemo，灌进 session store |
| 登录/注册页 | `apps/web/src/components/AuthPages.tsx`：`LoginPage/RegisterPage`，`postAuth(url,body)` 成功后 navigate | 加「免注册体验」按钮 |
| 用户菜单 | `apps/web/src/components/UserMenu.tsx`（自己 fetch /me） | demo 态替换菜单项 |

---

## 四、范围与边界

### 做
1. users 表加 `is_demo / demo_expires_at`（迁移 v40，sqlite + pg）。
2. 后端：`POST /api/auth/demo`（创建/复用）、`GET /api/auth/me` 带 isDemo、`POST /api/auth/claim`（转正）。
3. `demo-guard.ts`：集中式能力黑名单，受限操作返回 403 `DEMO_LOCKED`。
4. 独立 `DEMO_QUOTA` 体验额度 + run gate 的 demo 分支（禁视频）。
5. 过期 demo 级联清理脚本（仿 prune-events，--dry-run）。
6. 前端：登录页演示入口、全局 DemoBanner、转正弹窗、403 统一引导、UserMenu 适配、i18n（zh/en）。
7. 单元 + HTTP 集成 + 组件测试；本地端到端走查；Hasee 部署手册（`ALLOW_DEMO`）。

### 不做（留后续）
- 不新增 demo 商业化套餐档（不进定价表 / Stripe）。
- 不做 demo 之间、demo 与正式用户之间的协作分享（demo 恒为单席位、不可被分享）。
- 不做 demo 数据云端长期保留：过期即清，只有 claim 转正才长期保留。
- 不做「同一 demo 多设备同步」：以浏览器 cookie 为准，cookie 丢了就开新 demo。

### 能力矩阵（demo 能做 / 不能做）

| 类别 | demo | 正式 free 用户 |
|---|---|---|
| 浏览/编辑画布、节点、模板库、2D/3D/园区 | ✅ | ✅ |
| 跑**文本类**产线（内置 provider） | ✅（体验额度内） | 受 free 配额（当前 free token=0，需 owner 配额度/套餐） |
| 跑 imageGen | ⚠️ 受总 token/次数硬顶 | 按套餐 |
| 跑 **videoGen / audioGen 等贵价媒体** | ❌ 直接引导注册 | 按套餐 |
| 改密码 `/api/auth/password` | ❌（没密码，走 claim） | ✅ |
| publish 外发、webhook/trigger 外联 | ❌ | ✅ |
| 挂载远端 MCP / 自定义 http、database connector | ❌（防 SSRF / 外联滥用） | ✅ |
| 管理功能（admin/公告/改他人套餐） | ❌（role=user 已挡，双保险） | 仅 admin/owner |
| billing checkout 付款 | ❌（先 claim 转正再付） | ✅ |
| 资源被他人分享 / 分享给他人 | ❌ | 按 RBAC |
| claim 转正后保留全部数据 | ✅ | — |

---

## 五、数据模型（迁移 v40）

### 5.1 users 加两列

base DDL（`sqlite-driver.ts:58` 的 `CREATE TABLE users`，fresh 库）与迁移（老库 ALTER）**双写**；PG 由 toPgDdl 派生 + pg-driver 同步：

```sql
ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN demo_expires_at TEXT;   -- ISO8601 UTC，可空；正式账号恒 NULL
```

迁移对象（紧跟 v39 之后）：

```ts
{
  version: 40,
  description: "demo users: is_demo flag + demo_expires_at (design-demo-user)",
  detect: (db) => columnExists(db, "users", "is_demo"),
  up: (db) => {
    if (!columnExists(db, "users", "is_demo"))
      db.exec("ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0");
    if (!columnExists(db, "users", "demo_expires_at"))
      db.exec("ALTER TABLE users ADD COLUMN demo_expires_at TEXT");
  },
  down: (db) => {
    // SQLite 老版本 DROP COLUMN 受限；回滚以「清零标记」代替，不重建表
    db.exec("UPDATE users SET is_demo = 0, demo_expires_at = NULL");
  },
}
```

> 教训（见 handoff commit `7118990`）：老表加列时，相关索引不要放进 base DDL 抢在迁移前跑。本特性不需要在 users 上加新索引（清理走全表扫描，demo 量小），故无此坑。

### 5.2 driver / db.ts 新增方法（sqlite + pg 各一份）

所有方法进 `DatabaseDriver` 接口与两个驱动实现，**路由只经 db.ts 调用**：

| 方法 | 签名 / SQL 要点 |
|---|---|
| `createDemoUser` | `(id, email, passwordHash, expiresAt) => {id,email,role:'user'}`，**显式 role='user'、is_demo=1**（不复用 createUser 的 owner 推断，避免任何边界下误建 owner） |
| `findUserById` / `findUserByEmail` / `listUsers` | SELECT 扩出 `is_demo, demo_expires_at`，返回类型同步扩 |
| `findActiveDemoByEmail` 或复用 findUserByEmail | 复用判断时识别 @demo.local |
| `claimDemoUser` | `(id, email, passwordHash)`：`UPDATE users SET email=?, password_hash=?, is_demo=0, demo_expires_at=NULL WHERE id=? AND is_demo=1`，返回受影响行数（0 表示不是 demo 或已转正） |
| `listExpiredDemoUsers` | `(nowIso) => … WHERE is_demo=1 AND demo_expires_at IS NOT NULL AND demo_expires_at < ?` |
| `countRecentDemoByIp`（可选） | 若不存 IP 则用内存 RateLimiter，不落库 |
| `deleteUserCascade` | 见 5.3，事务内按序级联删 |

### 5.3 deleteUserCascade —— 级联清理顺序

user-scoped 表分两类。**直接挂 user_id**：graphs、runs、node_runs、events、graph_variables、graph_versions、subscriptions、usage_ledger、invoices、settings、idempotency_keys、publish_targets、published_contents、resource_access、feedback、announcement_reads、audit_log，以及电商系列 brand_assets / products / content_plan / content_metrics / content_costs / batch_jobs / batch_items / banned_terms / brand_terms（以实际 DDL 为准）。**间接归属**（经 graph_id / run_id）：artifacts、node_runs 等。

删除顺序（单事务）：

1. 先删间接子表：以 `WHERE run_id IN (SELECT id FROM runs WHERE user_id=?)` / `graph_id IN (SELECT id FROM graphs WHERE user_id=?)` 删 artifacts、node_runs；
2. 再删直接 user_id 表；
3. 最后 `DELETE FROM users WHERE id=? AND is_demo=1`（**只删 demo，加 is_demo=1 兜底，防止误删正式账号**）。

> 工程护栏：写一个测试枚举「所有建表语句里含 user_id（或经 graph/run 间接归属）的表」，断言 deleteUserCascade 全部覆盖——以后新增 user-scoped 表若漏删，测试红。

---

## 六、后端设计

### 6.1 `POST /api/auth/demo`（公开，挂 /api/auth/* 白名单）

流程：

1. **开关**：`ALLOW_DEMO` ∈ {1,true} 才启用，否则 403 `{error:"demo_disabled"}`（默认关，与 ALLOW_REGISTRATION 同部署哲学）。
2. **限流**：新增 `demoLimiter = new RateLimiter(10, 60min)`（每 IP 每小时 10 次，默认值可调）；超限 429。
3. **复用**：若请求带的 cookie 能 verify 出一个**仍未过期的 is_demo 用户** → 不新建，直接返回该用户（同浏览器回来还是同一个）。
4. **新建**：
   - `id = randomUUID()`；
   - `email = \`demo+${randomUUID().slice(0,8)}@demo.local\``（保留域，正则上不可能是真实邮箱，登录路由据此 + is_demo 双重识别）；
   - `passwordHash = await hashPassword(randomBytes(32).toString('hex'))`（无人知晓、不可密码登录）；
   - `expiresAt = new Date(Date.now()+DEMO_TTL_MS).toISOString()`（默认 24h）；
   - `db.createDemoUser(...)`；
   - 用 `instantiateTemplate` 克隆 1–2 条**精选纯文本模板**（白名单 templateId，见 §13 决策 D3）作为预置产线并落库；
   - `audit(db,id,"account.demo_start",{ip})`；
   - `signToken(id,email,false)`（短会话，不 remember）+ `setAuthCookie(c,token,false)`。
5. 返回 `201 { user:{id,email,isDemo:true}, demo:{expiresAt, quota:DEMO_QUOTA} }`。

### 6.2 `GET /api/auth/me` 扩展与 `POST /api/auth/claim`

- `/me` 返回体在 `user` 内补 `isDemo:boolean`，demo 再附 `demo:{expiresAt,quota,remaining?}`（remaining 可由 currentUsage 现算）。
- `POST /api/auth/claim`（需登录且 is_demo=1）：
  1. 从 cookie 解析当前用户，非 demo → 400 `{error:"not_a_demo"}`；
  2. body `{email,password}`，复用注册同款校验（邮箱正则、密码 ≥6、两次一致由前端保证）；
  3. `findUserByEmail(email)` 若已被**别的**账号占用 → 409；
  4. `db.claimDemoUser(id,email,await hashPassword(password))`，受影响行数=0 则 409；
  5. `audit … account.claim`；重发 `signToken(id,email,true)`（转正后 7 天）+ setAuthCookie；
  6. 返回 `{user:{id,email,isDemo:false}}`。其下数据全部保留。
- **登录路由加守卫**：`/api/auth/login` 查到用户后若 `is_demo=1`，拒绝密码登录（401，文案引导走 claim / 重开演示），杜绝随机 hash 之外的旁路。

### 6.3 体验额度 DEMO_QUOTA（不进套餐枚举）

在 `packages/core/src/plans.ts` 旁新增（或 server 侧 constants，单一事实源、前后端可共享）：

```ts
export const DEMO_QUOTA = {
  tokens: 30_000,          // normalized token（normalizeTokens 口径），够 2–3 条文本产线
  videoSegments: 0,       // 禁贵价媒体
  concurrentRuns: 1,
  storageBytes: 20 * 1024 * 1024,
  maxRunsTotal: 15,       // 生命周期内 run 总数硬顶（额外保险，独立于月度窗口）
};
export const DEMO_TTL_MS = 24 * 60 * 60_000;
```

run gate（`index.ts:2338` 一带）改造：在 `MONETIZATION_ENFORCE` 分支里，先取 user；**is_demo 走 DEMO_QUOTA 判断**（新增 `enforceDemoQuota(graph,{usedTokens,activeRuns,usedStorage,totalRuns})`，抛与 QuotaError 同形的错误，code 用 `DEMO_QUOTA_*`，前端引导「注册转正」而非「升级套餐」）；正式用户维持原 enforceSubscription。

- **videoGen/audioGen 节点**：demo 在派发前直接拦（按 graph 节点 kind 判定），返回「演示暂不支持视频/音频生成，注册后解锁」。
- demo 的内置模型走**实例 owner 配置的内置 provider**（不要求 demo BYOK），因此额度必须从严，成本由实例承担。
- 注意部署现状：Hasee 开着 `MONETIZATION_ENFORCE=1` 且 free token=0；demo 分支必须正确放行，否则 demo 一步都跑不动。

### 6.4 demo-guard.ts（集中能力黑名单）

新建 `packages/server/src/demo-guard.ts`：

```ts
export class DemoForbiddenError extends Error { code = "DEMO_LOCKED"; }
// 载入调用方 user（含 is_demo）；命中即抛，路由转 403 {error:"demo_forbidden",code,feature}
export function assertNotDemo(user: {is_demo?: number|boolean}, feature: string): void
```

挂载点（在对应路由 handler 开头，c.get("userId") → findUserById → assert）：

- `POST /api/auth/password`
- publish / published_contents、publish_targets 写操作
- webhook / trigger 外发、远端 MCP server 增删、自定义 http/database connector 写操作（SSRF/外联面）
- admin / 公告管理 / 改套餐（setPlan 对他人）
- billing checkout / 创建 Stripe customer

统一返回：`403 {error:"demo_forbidden", code:"DEMO_LOCKED", feature, claimUrl:"auth:claim"}`。其余产品功能一律不拦。

### 6.5 过期清理脚本

新建 `packages/server/scripts/prune-demo-users.ts`（仿现有 prune-events）：

- 参数 `--db <path>`、`--dry-run`（默认 dry-run，需 `--apply` 才真删）；
- `listExpiredDemoUsers(now)` → 逐个 `deleteUserCascade`，打印删除用户数与各表行数；
- 已 claim（is_demo=0）天然不在列表；
- 部署：systemd timer / cron 每小时跑一次 `--apply`（部署手册给命令）。

---

## 七、前端设计

全部新文案走 i18n（先 `i18n/locales/zh/auth.json` 加 key → 再 `en/auth.json` 同构 → 组件 `t("auth:…")`），颜色/间距/圆角/字号走 CSS 变量，守护测试 `vitest run src/i18n/keys.test.ts` 必过。

1. **登录页入口**（`AuthPages.tsx` LoginPage）：提交按钮下加次要按钮「免注册，先体验演示」→ POST `/api/auth/demo`（loading/error 同 postAuth）→ 成功 `navigate("/")`。注册页也放一个弱化入口。
2. **session store**：新增 zustand `useSession`（`{user,isDemo,demoQuota,refresh,setSession}`）。`ProtectedRoute` 的 /me 结果写入；`UserMenu`、`AnnouncementBell` 原本各自 fetch /me，改为优先读 store（减少重复请求，不改也可并行）。
3. **全局 DemoBanner**：App 顶部常驻一条横幅（demo 才渲染）——「演示模式 · 剩余 {runsLeft} 次运行 / 额度将在 {expiresAt} 清空」+ 主按钮「注册并保留我的工作」（开 ClaimDialog）+ 次按钮「退出演示」（调 /logout 回 /login，数据留待 TTL 清理）。
4. **ClaimDialog 转正弹窗**：邮箱+密码+确认密码 → POST `/api/auth/claim` → 成功后 refresh session（isDemo=false）、关横幅、toast「已保存你的全部工作」。
5. **403 统一引导**：api 层（`apps/web/src/lib/api.ts`）识别 `DEMO_LOCKED` / `DEMO_QUOTA_*`，统一 toast 并可一键开 ClaimDialog，不在各组件散落处理。
6. **UserMenu 适配**：demo 时隐藏「修改密码」，改为「注册转正 / 退出演示」；不显示套餐升级（demo 先转正）。
7. **组件测试**：登录页演示按钮、DemoBanner 剩余额度渲染与按钮、ClaimDialog 校验与成功流、DEMO_LOCKED toast。

---

## 八、安全与防滥用

| 风险 | 对策 |
|---|---|
| demo 跑内置模型 = 实例真金白银 | DEMO_QUOTA 从严（30k token、禁视频/音频、并发 1、≤15 run）+ IP 限流 + ALLOW_DEMO 总开关 |
| 批量开 demo 爆库 | demoLimiter 每 IP 限速 + 同浏览器复用不新建 + TTL 级联清理 |
| 利用 demo 做 SSRF / 垃圾外发 | demo-guard 禁一切外联面（webhook/trigger/远端 MCP/自定义 connector/publish） |
| demo 被当永久免费账号 | 24h 账号 TTL + 2h cookie 短会话；过期清理；不可改密、不可付款、不可被分享 |
| 随机密码 hash 被用于登录 | 密码无人知晓；登录路由对 is_demo 显式拒绝，只许 claim |
| 清理误删正式账号 | deleteUserCascade 的 users 删除带 `AND is_demo=1` 兜底；默认 dry-run |
| demo 提权 | 恒 role=user、createDemoUser 显式 user；admin 路由 role 层 + demo-guard 双拦 |
| 邮箱撞真实用户 | 保留域 @demo.local；claim 时目标邮箱占用则 409 |

---

## 九、分阶段实施（D1–D6，原子提交，每步可独立测）

> 测试运行环境为 Node 24：`fnm exec --using=24 -- pnpm --filter @agent-world/<pkg> exec vitest run [path]`；类型 `pnpm -r typecheck`。

- **D1 · 数据模型** ✅（commit `e305dc8`，6 单测绿；迁移 v40，down 只清标记不 DROP 列）：迁移 v40（base DDL + 迁移双写、pg 复用同一 driver body）；driver 新增 createDemoUser、find* 扩列、claimDemoUser、listExpiredDemoUsers、deleteUserCascade（前置 is_demo 短路 + 末级 AND is_demo=1 纵深防御）。单测：v39→v40 升级、fresh 库、claim、过期查询、级联删除覆盖护栏。
- **D2 · 额度与守卫（纯逻辑）** ✅（commit `0390ba6`，7 单测绿；落在 `src/demo.ts`）：DEMO_QUOTA 常量、`enforceDemoQuota`、DemoForbiddenError/assertNotDemo + DemoFeature 黑名单联合类型（路由侧统一 `blockDemo` helper）。纯函数单测覆盖各超限分支与黑名单。
- **D3 · 服务与路由** ✅（commit `ae84d45`，10 集成测绿）：demo 服务（create/reuse/claim）+ `/api/auth/demo`、`/me` 扩 isDemo+demo{expiresAt,quota}、`/claim`、login 对 demo 返回 401 DEMO_CLAIM_REQUIRED、改密/billing/publish/admin/webhook 外联等 9 处 blockDemo、run gate 独立分支（自带 30k token 池，不受 MONETIZATION_ENFORCE/free token=0 影响）；预置模板克隆 **tpl-draft**（见 §13 D3 登记）。限流上限 env `DEMO_RATE_LIMIT` 可覆盖。HTTP 集成测：开关关闭、限流、复用、创建、claim 保留数据、login 拒绝、guard 403、额度 402、ENFORCE=1 下 demo 文本 run 200。
- **D4 · 前端** 🔄（代码与组件测完成：useSession store、登录/注册页演示入口、DemoBanner、ClaimDialog、api 层 DEMO_LOCKED/DEMO_QUOTA 自动开 claim、UserMenu 适配、zh/en auth.json 同构 i18n、CSS var 样式；AuthPages/UserMenu/DemoBanner/ClaimDialog 合计 86 测绿、i18n 守护绿、web typecheck 绿；web 全量回归与原子 commit 收尾中）。
- **D5 · 清理脚本 + 文档 + 部署手册** ✅：`scripts/prune-demo-users.ts`（默认 dry-run、`--apply` 真删，已用「过期 demo/未过期 demo/正式账号」三夹具验证只删过期项；npm script `prune:demo`）+ 部署手册补 ALLOW_DEMO / DEMO_QUOTA_* / DEMO_TTL_HOURS / DEMO_RATE_LIMIT 与每小时清理 cron + 本文档勾选落地状态。
- **D6 · 端到端走查** ✅ 本地通过（2026-09-15，ALLOW_DEMO=1 + MONETIZATION_ENFORCE=1）：API 层——demo 201 并克隆 tpl-draft「写草稿」、/me 带 isDemo+quota、demo 邮箱密码登录 401 DEMO_CLAIM_REQUIRED、publish/billing/admin 均 403 DEMO_LOCKED、**demo 文本 run 在 ENFORCE=1/free token=0 下返回 200 且真实调 agnes-2.0-flash 产出中文文本与 artifact（关键坑验证）**、claim 200 同 userId 原地转正且产线/产物全保留、新邮箱密码登录 200；浏览器层——登录/注册页「免注册先体验」→一键进主界面见预置产线 + DemoBanner→点转正弹 ClaimDialog→填写提交后弹窗与 Banner 消失、数据保留；prune 三夹具（过期 demo/未过期 demo/正式号）验证只删过期项。四包 typecheck 绿、server 1185 / web 1865 全绿。**余 Hasee 真机**：合 dev 部署后 systemd override 加 `ALLOW_DEMO=1` 复验同一关键坑，并按部署手册挂每小时 prune cron。

---

## 十、测试策略

- **纯函数单测**：enforceDemoQuota 各 metric 边界、assertNotDemo、邮箱/TTL 计算。
- **driver/迁移**：v39 老库升 v40、fresh 库、claim 幂等、级联删覆盖全部 user-scoped 表（枚举 DDL 反查）。
- **HTTP 集成**：demo 创建/复用/限流/开关、/me isDemo、claim 保留数据、login 拒 demo、guard 各挂载点 403、run gate 文本放行/视频拦截/超限 402。
- **前端组件**：入口按钮、Banner 剩余额度与倒计时、ClaimDialog 校验与成功、DEMO_LOCKED 统一引导。
- **i18n 守护**：`vitest run src/i18n/keys.test.ts`；**全量回归**：core/server/mcp/web 四套测试全绿（基线 core 246 / server 1162 / mcp 71 / web 1874，新增后只增不减）。
- **真机**：本地 happy path + 部署 Hasee 后用 ALLOW_DEMO=1 验证（含 MONETIZATION_ENFORCE=1 下 demo 能跑）。

## 十一、回滚方案

- 代码层：特性由 `ALLOW_DEMO` 开关控制，关闭即不可新建 demo（已有 demo cookie 仍可访问到 TTL，必要时可让 /demo 与 /me 对 is_demo 提前失效）。
- 数据层：迁移 v40 只加可空/带默认值列，down 不清数据只清标记，回滚安全；正式账号行 is_demo 恒 0，不受影响。
- 提交层：D1–D5 原子提交，可按 commit 单独 revert；无 Stripe/计费写入，不涉及资金回滚。

## 十二、验收标准（完成定义）

1. 未登录用户在登录页一键进演示，看到预置产线，无需任何表单。
2. demo 能跑文本产线并看到真实产物；视频/音频被明确拦截并引导注册；外联/改密/管理操作返回 DEMO_LOCKED。
3. 额度用尽被拦，提示转正而非升级套餐。
4. claim 转正后同一账号、密码可登录、之前的 graphs/runs/artifacts 全在。
5. 过期 demo 被 prune 级联清理且不碰正式账号；--dry-run 不删数据。
6. ALLOW_DEMO 关闭时无演示入口可用。
7. zh/en i18n 无硬编码中文、无硬编码颜色/尺寸；四包 typecheck + 全量测试绿；Hasee 部署手册可照做。

## 十三、待拍板决策点（括号为当前默认，可调整）

| # | 决策 | 候选 | 默认采用 |
|---|---|---|---|
| D1 | 账号策略 | 每次新建 / 同浏览器复用+TTL | **复用 + 24h TTL** |
| D2 | 体验额度 | 数值大小 | **30k token、禁视频音频、并发 1、≤15 run、20MB** |
| D3 | 预置内容 | 空画布 / 克隆哪些模板 | **已选定：仅克隆 `tpl-draft` 一条**（纯 agnes-2.0-flash 文本产线 source→初稿 textGen→润色 textGen→gate→sink，无媒体节点，demo 禁视频音频下保证可跑；其余 tpl-product/tpl-xiaohongshu/tpl-media-pipeline/tpl-news-podcast 含媒体节点故不选）。由 `DEMO_SEED_TEMPLATE_IDS` 常量承载 |
| D4 | 有效期 | cookie / 账号 TTL | **已确认：沿用 signToken(false)=24h，不改 auth.ts 不加 maxAge**（账号 24h TTL 到期由 prune 清理使其失效，cookie 与账号同寿命，接受此简化） |
| D5 | 全局开关默认 | 开 / 关 | **ALLOW_DEMO 默认关，Hasee 显式开** |
| D6 | 转正数据 | 保留 / 清空 | **原地保留** |

> 注：`signToken(false)` 当前给的是 24h 上限。若要 demo cookie 严格 2h，需要给 signToken 增加一个可选 maxAge 参数（小改 auth.ts，D2/D3 一并做），不改则 demo cookie 最长 24h、但账号 24h TTL 到期后服务端清理使其失效。此项开工时确认。

## 十四、工作量估算

| 阶段 | 估算 |
|---|---|
| D1 迁移+driver（含 pg 双份与级联删） | 0.5–1 天 |
| D2 额度+守卫 | 0.5 天 |
| D3 服务+三路由+集成测 | 1 天 |
| D4 前端全套+i18n+组件测 | 1–1.5 天 |
| D5 清理脚本+文档+部署手册 | 0.5 天 |
| D6 端到端走查+回归 | 0.5 天 |
| **合计** | **约 4–5 个工作日** |

## 十五、部署（Hasee）

- 环境变量：`ALLOW_DEMO=1` 开启；可选覆盖 `DEMO_QUOTA_*` / `DEMO_TTL_MS`（若实现为可覆盖）。
- 与 `MONETIZATION_ENFORCE=1` 共存：确认 demo 分支在 gate 中正确放行文本产线。
- 清理 timer：脚本与其它运维脚本一样用 **tsx 跑 TS 源**（不依赖 dist），命令 `pnpm --filter @agent-world/server prune:demo`（默认 dry-run，`--apply` 真删，`DB_FILE` 指定库）。**Hasee 已于 2026-09-16 落地为 agentworld 用户 crontab**（每小时第 17 分；落地前先 dry-run 核对范围）：
  ```cron
  17 * * * * DB_FILE=/var/lib/agent-world/agent-world.sqlite /opt/agent-world/node_modules/.bin/tsx /opt/agent-world/packages/server/scripts/prune-demo-users.ts --apply >> /var/lib/agent-world/logs/prune-demo.log 2>&1
  ```
  详见 [runbooks/deploy-ubuntu-server.md](runbooks/deploy-ubuntu-server.md)「四之一、演示用户」。
- 迁移 v40 随服务启动自动执行（沿用现有迁移机制），部署前备份 sqlite。

## 十六、真机走查缺陷修复记录

### 2026-09-16：demo 零配置首跑 422（前端模型选项加载竞态，非后端缺模型）

- **现象**：demo 一键进入后，预置 tpl-draft 的两个 textGen 节点首跑被 `422 graph has unconfigured model(s)` 打回，必须手动到「模型分配」勾模型才能跑，违背"零配置先体验"。
- **取证（排除后端）**：tpl-draft 模板节点本就带 `textGen.model="agnes-2.0-flash"`（`packages/core/src/templates.ts`，且 core schema `TextGenConfig.model` 有同值 default 兜底）；纯后端 seed→存库→读回→`validateModels` 0 error。真机只读库佐证为**偶发时序**：走查账号的图被清空（手动配回 2.5），稍后新建的第二个 demo 图仍保留默认 2.0。
- **根因（前端 `apps/web/src/store/graph.ts`）**：`setGraph()` 每次加载图都同步执行 `migrateGraphModels()`，而模型选项 `cachedModelOptions` 初值为 `[]`、由模块加载时 `void refreshDefaultModel()`（异步 `GET /api/settings`）填充。demo 落地即加载预置图，若选项尚未返回，`remapNodeModel()` 把有效内置模型误判为"未知"，`defaultModelFor()` 在空选项下返回 null，遂把节点 `model` 改写为 `""` 并经 `scheduleSave()` 自动写回；派发时 `validateModels()` 见空 model 即报错（它不认 `config.defaultModel` 运行时兜底）。手动分配时选项已就绪，故配完能跑。普通用户从模板新建同样潜伏该竞态，demo 零配置首屏最必现。
- **修复原则：选项未就绪绝不清空非空 model；就绪后补跑一次迁移。** ① 新增模块级 `modelOptionsReady`，`refreshDefaultModel()` 在 `finally` 置位，并在选项就绪后对当前已加载图补跑一次迁移（有变更才 `setGraph`）；② `remapNodeModel()` 对非空 `current` 且 `!modelOptionsReady` 直接保留（`return false`），就绪后维持原逻辑（有效保留 / 占位符替换 / 确无候选才清空）。
- **回归测试**：`graph.migrate.test.ts` 增 2 例（未就绪不清空有效模型；未就绪先保留占位符、就绪后补迁移为真实模型；禁用守卫则 2 例必红）；`api.demo-user.test.ts` 增 1 例后端契约护栏（demo seed 图 textGen 节点 model 非空且开箱即过 `validateModels`）。

## 十七、相关文档

- [design-monetization.md](design-monetization.md) / [design-monetization-m2-implementation.md](design-monetization-m2-implementation.md)：套餐配额与订阅 gate
- [design-rbac.md](design-rbac.md)：role 权限层级（与 is_demo 正交）
- [design-postgres-migration.md](design-postgres-migration.md)：sqlite/pg 双轨，driver 方法需两份
- [design-guided-tour.md](design-guided-tour.md)：新用户引导（demo 进入后是否自动触发引导，D4 可衔接）
- [design-code-sandbox.md](design-code-sandbox.md)：代码节点 / 外联 SSRF 策略（demo 外联限制与之对齐）
