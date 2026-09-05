# 角色权限（RBAC）设计方案

> 状态：**P0 已实施（2026-09-05），P1-P3 方案定稿待做**。目标：把当前「`user_id` 硬隔离 + 公告管理员 env 白名单」升级为**全局角色 + 资源级共享权限**的正式 RBAC，为路线图 Phase 5 多租户/团队协作铺底。
> 创建：2026-09-05 ｜ 触发：用户明确要求（不等 deferred-items 的"团队场景出现"），见 [handoff.md](../handoff.md) 待办 #34。
> **P0 落地记录（2026-09-05）**：迁移 v31（`users.role` 列 + `idx_users_owner` 部分唯一索引 + 最早注册用户升 owner bootstrap）；`createUser` 无 owner 时首账号为 owner；`isAnnouncementAdmin` 改读 `owner/admin` 角色，`ANNOUNCEMENT_ADMIN_EMAILS` env 白名单退役（`.env` 已删）；`/api/auth/me` 返回 `role`。测试 `api.rbac.test.ts`（首账号 owner/单 owner 不变量/owner 可管公告/旧库 v31 bootstrap）+ `api.announcements.test.ts` 改角色提升。

## 1. 背景与现状

| 现状 | 说明 |
|---|---|
| 数据隔离 | 所有用户资源表（graphs/runs/artifacts/brand_terms/banned_terms/products/brand_assets）都带 `user_id`，存取按 `WHERE user_id = ?` 硬过滤 = **单用户边界** |
| 全局管理 | 仅公告一项，判定靠 `ANNOUNCEMENT_ADMIN_EMAILS` env 白名单（`isAnnouncementAdmin`），前端经 `/api/auth/me` 的 `canManageAnnouncements` 显隐入口 |
| 认证 | JWT（`signToken(id,email,remember)`）+ HttpOnly cookie；注册受 `ALLOW_REGISTRATION` 门控；`users` 表 `{id,email,password_hash,created_at}` 无角色列 |
| 现状缺口 | ① env 白名单改管理员要改文件重启，不是正式能力；② 资源无法共享给他人——`user_id` 隔离到想把图给同事看都必须复制账号；③ 所有"谁能做什么"散落成 `user_id` 简单过滤，无法扩展审计/运营管理的横向权限 |

## 2. 目标

1. **全局角色**：`owner / admin / user`，覆盖「运营/系统级管理」能力（公告、审计、用户管理）——退役 env 白名单；
2. **资源级共享**：`graph` 及跟随资源可共享 `editor/viewer` 给其他用户，owner 可授权可回收——这是 Phase 5 团队协作的最小网格，先建好再往里填功能；
3. **统一判定**：一处权限判定函数，替换散落的 `isAnnouncementAdmin` 与裸 `user_id` 过滤，杜绝横向越权；
4. **审计联动**：角色变更、共享授权/回收全部写审计日志（复用现有 audit_log）。

## 3. 范围与边界

**In（本期方案）**
- users 表角色列 + owner bootstrap；
- `resource_access` 存取控制表 + 判定函数；
- announcement/audit 等全局管理能力收敛到 `admin` 角色，env 白名单退役；
- graph 维度资源共享 `editor/viewer` + 前端共享 UI + 列表过滤。

**Out（明确不做 / 后续）**
- **真正多租户**（B2B 命名空间/计费/组织架构）：Phase 5，本方案只铺底层 ACL 网格；
- 公告 `target` 定向（P3）：依赖资源 ACL 后可在对应入口查询，本方案不随带；
- 模板用户发布（内置共享目录维持现状）；
- feedback/工单管理（不属权限面）。

## 4. 角色与权限模型

### 4.1 全局角色

| 角色 | 代表 | 权限 |
|---|---|---|
| `owner` | 首个注册用户（全系统唯一） | 全部权限 + 可授予/撤收 `admin`；不可自我移除 owner |
| `admin` | owner 指定的运营/管理员 | 公告管理、审计查看、用户列表；可被 owner 撤销 |
| `user` | 默认 | 无全局管理权，仅拥有/被共享的自己的资源 |

> 全局角色只有"管理类"能力；**文件/图的读写不属于全局角色**，一律走资源级权限。这样 model 干净：全局权限是少数几把"运营开关"，数据面全在资源 ACL。

### 4.2 资源角色

| 资源角色 | 代表 | 权限 |
|---|---|---|
| `owner` | 资源创建者（`user_id`） | 读/写/删除/改 ACL |
| `editor` | 被共享的协作者 | 读/写（改内容、跑运行、改版本），不能删/改 ACL |
| `viewer` | 被共享的只看者 | 只读（看内容/产物/运行），不能跑 |

owner 不落 `resource_access`（用资源 `user_id` 判定）；`resource_access` 只存共享给别人的 `editor/viewer` 行。

### 4.3 资源类型与归属继承

| 资源类型(`resource_type`) | 归属基准 | 跟随继承 |
|---|---|---|
| `graph` | `graphs.user_id` | `graph_versions` |
| run | `runs.graph_id → graph` | `node_runs` |
| artifact | `artifacts.run_id → run → graph` | — |
| product / brand_terms / brand_assets / banned_terms | 各自 `user_id` | — |

> 核心共享单元是 **graph**。runs/artifacts/versions 通过 `graph_id` 向上解析到 graph 的 owner/ACL——只对 graph 演 permission，派生资源自动继承，避免每张表都存一套 ACL。

## 5. 存储设计（迁移 v31/v32）

```sql
-- 迁移 v31：全局角色列。无 owner 时把最早注册用户（created_at 最小）提升为 owner，
-- 保证现有库/未来库都有且只有一个 owner。既有用户默认 'user'（当前真实用户会成为 owner）。
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_owner ON users(role) WHERE role = 'owner';
-- 但 owner 是升出来的，不能先有普通索引冲突；idx_users_owner 需在"无 owner 时才建"
--（owner 诞生后再建索引，避免 UNIQUE 全表扫描冲突）。见 6 运营一节。

-- 迁移 v32：资源级共享
CREATE TABLE IF NOT EXISTS resource_access (
  resource_type TEXT NOT NULL,     -- 'graph' | 'product' | 'brand_terms' | ...
  resource_id   TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  role          TEXT NOT NULL,     -- 'editor' | 'viewer'
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (resource_type, resource_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_resource_access_user ON resource_access(user_id, resource_type);
```

- **owner 判定**：`resources.user_id == requester`（不落 access 表）；
- **共享判定**：`resource_access(resource_type, resource_id)` 存在 `editor`/`viewer` 行；
- 所有新增 `graph/product/brand_terms/...` 行仍写 `user_id=创建者`（owner 语义不变），只把"共享他人"放 access 表——**对现有写入路径零侵入**。

## 6. 判定函数（后端核心）

新增 `packages/server/src/permissions.ts`（原子换取现有散落的判定）：

```ts
// 全局角色
type GlobalRole = "owner" | "admin" | "user";
requireGlobalRole(db, userId, "admin" | "owner"): void   // 不符抛 403

// 资源级：解析到的资源归属 + ACL 判定
canResource(db, userId, resourceType, resourceId, minRole): boolean  // owner>editor>viewer
requireResource(db, userId, resourceType, resourceId, minRole): void // 不符抛 403

// 列出"我可见"的资源 id（owner + 共享给我的）
visibleResourceIds(db, userId, resourceType): Set<string>
```

- **替换 `isAnnouncementAdmin`**：公告管理从「env 白名单」改为 `requireGlobalRole(db, userId, "admin")`；`/api/auth/me` 的 `canManageAnnouncements` 由 `role ∈ {owner,admin}` 推算，env `ANNOUNCEMENT_ADMIN_EMAILS` **退役**。
- **越权基线改造**：所有资源读/写路由当前直接 `WHERE user_id = ?`。改为：写路径 `requireResource(... "owner"/"editor")`，读路径 `requireResource(... "viewer")` + 查询用 `visibleResourceIds` 过滤。**这是本方案最大的行为面**——把"只看自己"放宽为"自己 + 共享"。
- 运行（run）归属按 `graph_id` 向上解析；token 里不塞 resource，始终查库判定，避免 JWT 权限过期问题。

### 7. 前端权限

- `/api/auth/me` 返回 `role`（owner/admin/user），替换/兼容现有 `canManageAnnouncements`；
- 运营入口（公告管理、未来的审计/用户管理）按全局角色显隐；
- 资源级：graph 详情/产物页对 `editor` 禁用"改 ACL/删除"，对 `viewer` 只读；每条 graph 在资源树/列表显示共享标记；
- 新增 **Collaborators 面板**（graph 设置内）：owner 增删 `editor/viewer`；所有增量走 i18n（新 namespace 或并入现有）、设计 token。

## 8. 审计联动

- `role.update`（owner 授/撤 admin）、`access.grant` / `access.revoke`（共享 editor/viewer）写 audit_log（det「谁、对哪个资源、给了什么」path，不含值，符合红线）；
- 沿用 `audit()` helper + `GET /api/audit`（当前仅本人可见；admin 角色的跨用户审计查看是 admin 权限的自然扩展，本方案先保留"本人"边界，admin 全量查看列为 admin 能力的一个后续项）。

## 9. 管理运作

| 动作 | 谁 | 路径 |
|---|---|---|
| 提升 admin | owner | `POST /api/admin/members/:id/role`（owner 专属） |
| 撤收 admin | owner | 同上（admin 不自我管理；owner 不可被降权） |
| 声明 owner | 首个注册 | 迁移 bootstrap + 注册逻辑兜底（见下） |
| 共享资源 | 资源 owner | `PUT /api/resources/{type}/{id}/access` |

**owner bootstrap 规则**：注册函数里——若 `users` 无任何 `role='owner'`，则本次注册用户成为 owner（满足"首个注册用户=owner"）。迁移 v31 对既有库用最老 `created_at` 升 owner，保证当前真实用户（`2467055074@qq.com`）秒变 owner、无感接管公告管理。

## 10. 分阶段落地

| 阶段 | 内容 |
|---|---|
| P0 | users.role 列 + owner bootstrap + `permissions.ts` 基础判定 + `isAnnouncementAdmin`→全局角色（env 退役）+ /me 返回 role |
| P1 | resource_access 表 + `requireResource`/`visibleResourceIds` + 越权基线改造（graph 及跟随资源的读/写/运行/分支） |
| P2 | 前端 Collaborators 共享 UI + 资源列表过滤 + 角色显隐 |
| P3 | 运营管理 UI（用户列表、owner 授/撤 admin）；admin 跨用户审计查看（可选） |

> P0 是"把 env 白名单落成正规能力"的最小闭环，可独立交付；P1 是数据面真正的资源共享。P2/P3 是 UI 与运营面。

## 11. 安全考量

- **横向越权**是本方案线核心风险——每个资源路由必须过 `requireResource`，测试覆盖正反两侧；
- 运行/产物继承 graph 权限，避免"共享了图但 run 漏了"的旁路；
- owner 唯一性用"注册时无 owner 才升"保证，防止并发注册双 owner（注册路由串行处理即可）；`idx_users_owner` 部门索引保证唯一；
- ACL 变更不可申报删除（操作留痕在 audit）；
- 前端显隐只是体验，真正的判定永远在后端。

## 12. 测试计划

- **P0**：owner bootstrap（空库首注册=owner / 已存在 user 时新注册=user）；`requireGlobalRole` 正反；isAnnouncementAdmin 移除后公告管理仍只对 admin 开放；/me 角色；
- **P1**：`requireResource` 的 owner>editor>viewer>无 四态；visibleResourceIds 含 owner+共享、排除他私有；runs/artifacts 从 graph 继承（只共享 graph，run/artifact 也能被 viewer 读）；越权 403 全路由巡检；
- **P2**：Collaborators 授权/回收/覆盖写（editor→viewer）；列表共享标记；
- **P3**：owner 授/撤 admin 幂等 + 自身不可降权；每次变更 audit 留痕（沿用 audit.test 模式）。

## 13. 相关文档

- [design-audit-log.md](design-audit-log.md)（权限变更留痕）
- [design-announcement.md](design-announcement.md)（env 白名单退役对象）
- [roadmap-generalization.md](roadmap-generalization.md#phase-5生态与平台化持续)（Phase 5 多租户铺底）
- [deferred-items.md](deferred-items.md)（多租户/权限行，触发条件经本方案满足后更新）