# 审计日志（Audit Log）设计方案

> 状态：**P1+P2 已实施（2026-09-05）**——audit_log 表（迁移 29）+ `audit()` helper + 全部词表埋点（account/register/login/login_failed/logout/password_change、settings.update/test_provider、graph.create/update/delete/restore_version、run.start/cancel、publish_target.create/delete）+ `GET /api/audit` 查询接口 + 专项测试（动作覆盖/detail 红线/写失败不阻塞/隔离分页）。**P3 未实施**：180 天清理与 hash chain 防篡改（触发条件不变）。
> 创建：2026-09-05；实施与方案的两处偏差见 §3.2/§3.3 备注。

## 1. 背景

项目已有 `events` 表，但它是**运行事件流**（节点执行、run 生命周期），不是安全审计：

- 不记录「用户登录 / 修改设置 / 保存图」这类**账户与配置动作**；
- 与 run 无关的操作（改 provider key、换 search 源）完全无痕；
- 合规审计问「你们的审计日志在哪」时，现在没有答案。

## 2. 设计目标

- 记录**安全相关**的用户动作，不重复 events 已覆盖的运行细节；
- 日志**只追加**（append-only），应用层不提供改/删路径；
- 日志内容**永不包含密钥明文或脱敏值**（连 `****` 都不记，只记「哪个字段被改了」）；
- 单用户自用不增加负担（无 UI 也可用 SQL 查询），多用户时可直接升级为用户可见的「账户活动」页。

## 3. 方案设计

### 3.1 存储：独立 `audit_log` 表（新迁移）

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,      -- uuid
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL,        -- 见 §3.2 词表
  object_type TEXT,                 -- settings / graph / run / publish_target / account
  object_id   TEXT,                 -- graph id / run id / provider name 等
  detail      TEXT,                 -- JSON，仅字段名与计数，永不含值
  ip          TEXT,                 -- 请求来源（X-Forwarded-For 首个）
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at);
CREATE INDEX idx_audit_log_time ON audit_log(created_at);
```

不进 `events` 表的原因：生命周期不同（events 随 run 展示，audit 长期留存）、写入方不同（events 由引擎写，audit 由路由层写）、保留策略不同（见 §5）。

### 3.2 动作词表（首期范围）

| 动作 | 触发点 | detail 示例 |
|---|---|---|
| `account.register` / `account.login` / `account.login_failed` | auth 路由 | `{}` |
| `settings.update` | PUT /api/settings | `{ fields: ["providers.my.apiKey", "searchConfig.provider"] }` |
| `settings.test_provider` | POST /api/providers/test | `{ provider: "my", result: "ok" }` |
| `graph.create` / `graph.update` / `graph.delete` | graphs 路由 | `{ graph: "g1", version: 3 }` |
| `graph.restore_version` | 版本恢复 | `{ graph: "g1", version: "v2" }` |
| `run.start` / `run.cancel` | run 路由 | `{ run: "r1", graph: "g1" }` |
| `publish_target.create` / `delete` | publish 路由 | `{ id: "t1", platform: "x" }` |
| `auth.logout` | 登出 | `{}` |

**刻意排除**：只读操作（GET settings / 看图）不记——脱敏后 GET 已无敏感值可读，记录它只产生噪声；多用户对外部署时再评估是否加 `settings.view`。

**实施时新增的一条**：`account.password_change`——改密码是账户组内最敏感的动作，原词表遗漏。

**实施后追加的词表**（RBAC P3 与用户反馈线）：`role.update`（detail `{grantee, role}`，owner 专属操作）、`access.grant` / `access.revoke`（graph ACL，detail `{resourceType, resourceId, grantee, role}`）、`announcement.create` / `update` / `delete`、`feedback.submit`（detail 只含 `{category}`——**不含 message 正文**，正文属用户内容非取证要素，且避免敏感叙述进审计表）、`feedback.status_change`（detail `{to}`，同状态幂等不写）。

**实施偏差**：`settings.test_provider` 记的是「验证通过、真实 key 即将用于出站探测」这一刻（detail 只有 provider 名），不带 result——result 分支太多，而安全取证关心的是 key 何时被用过。

**detail 的红线**：值一律不进日志。改 key 记成 `providers.my.apiKey`（字段路径），不记新旧值；这同时规避了脱敏值回显被当作真值的混淆。新增 provider（旧值不存在）报 provider 级路径 `providers.my`，字段级路径只在同名字段变化时报——由 `changedFields` 递归 diff（深度上限 4）产生。

### 3.3 写入路径：路由层 helper

```ts
// src/audit.ts
export function audit(
  db: Db, userId: string, action: string,
  opts?: { objectType?: string; objectId?: string; detail?: unknown; ip?: string },
): void  // 同步 prepare 插入；失败 warn 不抛（审计不阻塞业务）
```

- 在 `index.ts` 各路由调用点手工埋点（动作少，无需中间件自动推断）；
- `c.get("userId")` 已在鉴权中间件注入，IP 从 `X-Forwarded-For` / `c.env.remote...` 取；
- **写失败只 warn 不抛**：审计可用性不应拖垮业务可用性，但 warn 必须响亮（运维能发现审计失效）。

### 3.4 查询接口

- `GET /api/audit?limit=100&before=<cursor>`：仅本人记录，时间倒序，分页游标；
- 无管理端角色前不做跨用户查询（多租户时随权限体系一起升级）。

## 4. 防篡改边界（诚实声明）

sqlite 单文件下审计日志的**防篡改上限**：

- 应用层 append-only（无 UPDATE/DELETE 代码路径）≠ 攻击者拿到 DB 文件后改不动；
- 与业务数据同库同密钥，**有库写权限即可删审计**；
- 真正的 tamper-evident 需要 hash chain（每行带前行 hash）或外部 syslog 转发——**首期不做**，登记 deferred，触发条件是对外合规审计明确要求 tamper-evidence。届时 hash chain 是纯增量（加一列 + 校验脚本），不破坏本方案结构。

## 5. 保留策略

- 默认保留 **180 天**，每日启动时惰性清理（`DELETE WHERE created_at < now-180d`，与现有调度器复用）；
- 落库体积评估：单用户低频操作 < 每日百行，180 天约几万行、几 MB——无需分区。

## 6. 测试计划

- 每个动作词表条目：触发路由 → 表中出现对应行；
- **红线断言**：`detail` 与全表任何列不含真实 key / `****` / `sk-` 前缀（新增专项测试，防未来埋点回潮）；
- 审计写失败不阻塞业务（模拟 prepare 抛错，路由仍 200）；
- 分页与本人隔离（A 查不到 B 的记录）。

## 7. 分阶段落地

| 阶段 | 内容 |
|---|---|
| P1 | 表迁移 + `audit()` helper + auth/settings/graphs 三组核心埋点 |
| P2 | run/publish 埋点 + `GET /api/audit` 查询接口 |
| P3 | 180 天清理 + （触发后）hash chain 防篡改 |

## 8. 相关文档

- [design-at-rest-encryption.md](design-at-rest-encryption.md) —— 密钥存储（本方案的红线是它的下游）
- [design-key-rotation.md](design-key-rotation.md) —— 同批合规补强
- [deferred-items.md](deferred-items.md) 安全/运维线 —— 触发条件登记
