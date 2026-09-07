# 多租户数据模型设计（Multi-tenancy Data Model）

> 状态：**方案设计（2026-09-07 起草，待评审，未实施）**。
> 定位：把「自托管 + SaaS 都做，先自托管后 SaaS」的产品决策，落到数据模型层面——引入 **tenant（组织/工作区）作为一等概念**，理清 tenant / user / 资源 / 计费四者的关系，并给出**向后兼容**的演进路径。
> 触发：`design-scaling.md` §0.2 产品形态决策；`design-monetization.md` §7 已预判「`users.tenant_id` + 全表行级隔离改造」。
> 原则：**自托管阶段零行为变化（tenant 透明），SaaS 阶段低成本启用**，不提前重构、不破坏现有 `user_id` 隔离。
> 创建：2026-09-07

---

## 1. 背景与现状

| 现状 | 说明 |
|---|---|
| 数据隔离 | 所有资源表（graphs/runs/artifacts/products/brand_terms/...）带 `user_id`，按 `WHERE user_id = ?` 硬过滤 = **单用户边界** |
| 账号 | `users {id, email, role(owner/admin/user), created_at}`，owner 全系统唯一 |
| 共享 | `resource_access {resource_type, resource_id, user_id, role(editor/viewer)}`，graph 为共享单元 |
| 计费（未实施） | `subscriptions(user_id PK)`、`usage_ledger(user_id)`、`invoices(user_id)` 均按 **user** 计 |

**核心问题**：现有模型是「单用户边界」，SaaS 需要「租户边界」——一个组织多个成员、订阅/配额/资源按组织计。直接改会破坏自托管模式。

---

## 2. 核心概念与关系

### 2.1 四个概念

| 概念 | 定义 | 关键属性 |
|---|---|---|
| **tenant**（租户/组织/工作区） | **计费与隔离的边界单位** | 有独立订阅、配额、成员、资源 |
| **user**（成员） | 登录主体，属于某个 tenant | 一个 user 属于一个 tenant |
| **资源** | graphs/runs/artifacts 等 | 归属 user（创建者），租户通过 user 推导 |
| **计费** | 订阅/配额/账单 | 归属 **tenant**（不是 user） |

### 2.2 自托管 vs SaaS 的映射

| | 自托管（当前，先做） | SaaS（后做） |
|---|---|---|
| tenant | **隐式单租户**（不落表，`tenant_id = NULL`） | 显式多租户（每个组织一条 `tenants` 行） |
| user | 个人用户，互不隶属 | 属于某个组织租户 |
| 计费 | 个人订阅（`user_id` 即 tenant 的退化） | 组织订阅（Team = 1 租户 + N 席位） |

**关键洞察**：自托管下「一个实例 = 一个隐式租户」，现状的 owner + user 已经是"单租户"了——**tenant 不是新造的东西，是把已有的"隐式单租户"显式化**。

---

## 3. 数据模型设计

### 3.1 新增 tenants 表 + users.tenant_id

```sql
-- 租户表（SaaS 阶段才有数据；自托管阶段为空）
CREATE TABLE tenants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- user 归属租户：NULL = 自托管单租户（现状兼容），非 NULL = SaaS 组织租户
ALTER TABLE users ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
```

### 3.2 资源归属：**通过 users.tenant_id 推导，不给每张资源表加列**

这是本方案的核心取舍。资源表已都有 `user_id`（创建者），而 user→tenant 映射在 `users.tenant_id`，所以：

- **不**给 graphs/runs/artifacts 等十几张表加 `tenant_id` 列（避免全表改造 + 写入路径侵入）；
- 租户归属由 `resource.user_id → users.tenant_id` **join 推导**；
- 查询「某租户的资源」：`WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)`。

**权衡**：join 推导比直列慢，但「租户内成员数有限」场景可接受。**补列触发条件（2026-09-07 拍板）**：当某个租户成员数超过 **100** 时，再给热点表（graphs/runs）补冗余 `tenant_id` 列 + 索引；此前维持推导。补列是可逆增量，不是重构。

### 3.3 订阅/计费：从 user 迁到 tenant

```sql
-- 现状（monetization §5.1，按 user）
CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY, ...
);
CREATE TABLE usage_ledger (
  user_id TEXT NOT NULL, ...
  PRIMARY KEY (user_id, period_start, metric)
);

-- 演进：key 从 user_id 改为 tenant_id（个人 = 单成员租户的退化）
-- 迁移时：自托管阶段仍按 user_id 存（user 即隐式租户）；
-- SaaS 阶段改按 tenant_id（Team 套餐 = 1 租户 + N 席位共享配额）
```

**关键决策**：订阅/配额是**租户级**，不是 user 级——Team 套餐的「5 席位」= 一个 tenant 下 5 个成员共享同一份 quota，不是每人一份。

---

## 4. 向后兼容演进（两阶段）

### 阶段 1（自托管，现在可选做，**零行为变化**）

- 新增 `tenants` 表 + `users.tenant_id`（默认 NULL）；
- **所有查询逻辑不变**（仍按 `user_id` 过滤）；
- `tenant_id = NULL` 语义 =「自托管单租户」，现有单用户/自托管部署**完全无感**。

这一步只是"铺地基"，不改变任何行为，可以随任一迁移顺手落地，也可以等到 SaaS 阶段再做。

### 阶段 2（做 SaaS 时）

1. 创建组织租户：`POST /api/tenants` 建 `tenants` 行；
2. 成员归属：用户注册/邀请时写 `users.tenant_id`；
3. 资源隔离升级：查询从 `WHERE user_id = ?` 升级为「按 tenant 的成员集合」过滤；
4. 订阅/配额迁 tenant：`subscriptions`/`usage_ledger` 的 key 从 user 迁 tenant；
5. 存量数据迁移：把现有自托管用户归入各自的单成员租户（或保持 NULL 作为"平台级单租户"）。

**兼容保证**：阶段 2 只发生在「明确开始做 SaaS」时（`design-scaling.md` §5 阶段 2），自托管用户的现有部署永不升级到阶段 2，因此**两条路线互不干扰**。

---

## 5. 角色体系分层（三层，向后兼容）

引入 tenant 后，角色从「两层」变为「三层」，现有角色**含义不变、只增不改**：

| 层 | 角色 | 现状 | 演进 |
|---|---|---|---|
| **平台级**（全局） | `owner` / `admin` / `user` | ✅ 已有 | 语义收紧为「平台运营者」（跨租户管理）；自托管下 owner=平台所有者 |
| **租户级**（新增） | `tenant_owner` / `tenant_admin` / `tenant_member` | ❌ 无 | SaaS 阶段新增：每个组织租户内的管理员/成员 |
| **资源级**（ACL） | `owner` / `editor` / `viewer` | ✅ 已有（`resource_access`） | 不变，仍在租户内共享 |

**关键点**：现有「全局 owner（首个注册）」在 SaaS 下对应「平台 owner」；「租户管理员」是新增概念，不冲突。资源级 ACL 完全复用，不重造。

---

## 6. 与 monetization 的衔接

| monetization 表/逻辑 | 现有 | 多租户演进 |
|---|---|---|
| `subscriptions` | `user_id PK` | 改为 `tenant_id PK`（个人 = 单成员租户退化） |
| `usage_ledger` | `user_id` | 改为 `tenant_id`（Team 共享 quota） |
| `invoices` | `user_id` | 改为 `tenant_id`（组织账单） |
| Team 套餐「席位」 | 未定义 | = tenant 内成员数（`users.tenant_id` 计数） |
| `enforceSubscription()` | 按 `userId` | 按 `tenantId`（owner 上下文 → tenant 上下文） |
| 企业版「多租户 tenant_id」 | 预判为「全表加租户维度」 | 本方案简化为「users.tenant_id 推导」，避免全表加列 |

---

## 7. 分阶段落地

| 阶段 | 做什么 | 触发条件 | 状态 |
|---|---|---|---|
| 阶段 1 | `tenants` 表 + `users.tenant_id`（NULL）+ 无行为变化 | 可随任一迁移顺手做 | 方案，未实施 |
| 阶段 2 | tenant 维度启用：隔离升级 + 订阅迁 tenant + 租户角色 + 成员邀请 | 明确开始做 SaaS（`design-scaling` §5 阶段 2） | 方案，未实施 |

---

## 8. 相关文档

- [design-scaling.md](design-scaling.md) —— 规模化方案（本设计的产品形态前提）
- [design-monetization.md](design-monetization.md) —— 商业化（subscriptions/usage_ledger 的上游）
- [design-rbac.md](design-rbac.md) —— 角色权限底座（本设计的资源级 ACL 复用）
- [deferred-items.md](deferred-items.md) —— 「多租户/权限」触发行

> 一句话：**tenant = 计费与隔离的边界；自托管是"隐式单租户"（tenant 透明、零行为变化），SaaS 是"显式多租户"（通过 `users.tenant_id` 推导，避免全表加列）。核心原则：资源归属靠 user 推导、订阅计费靠 tenant 计、角色三层分权——向后兼容，自托管永不升级到 SaaS 阶段。**
