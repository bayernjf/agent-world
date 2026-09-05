# 公告（Announcements）设计方案

> 状态：**P1+P2+P3 全部已落地（P1+P2：2026-09-05，迁移 v30；P3 定向：2026-09-05）**。目标：产品内向用户展示「停机通知 / 版本说明 / breaking change 提醒」的公告体系。
> 创建：2026-09-05
>
> 实施说明：①迁移版本实际为 **v30**（v29 被审计日志占用）；②公告正文以纯文本 `pre-wrap` 渲染（设计稿的 md 渲染暂缓，运维粘贴纯文本即可用）；③**管理端 UI 已就位**（2026-09-05 增补）——管理员点铃铛下拉出现「管理公告」，打开 `AnnouncementManager`（全量列表 + 新建/编辑/删除，双语标题正文 + level + 生效/失效窗口），权限判定靠 `ANNOUNCEMENT_ADMIN_EMAILS` env 白名单，经 `/api/auth/me` 的 `canManageAnnouncements` 下发前端仅对管理员显示入口；管理专用全量列表接口 `GET /api/announcements/manage`（含未开始/已过期）。
> **env 白名单已退役**：见 [design-rbac.md](design-rbac.md) P0——公告管理改走全局 `admin` 角色（owner 在系统内授予，owner=首个注册用户），`ANNOUNCEMENT_ADMIN_EMAILS` 不再需要。
> **P3 定向已实施**：`target` 列的三种取值全部生效（NULL=全员 / `graph:<id>`=能打开该产线的用户，owner/editor/viewer 均命中 / `template:<id>`=自有或被共享了该模板产线的用户）。`GET /api/announcements` 服务端按受众过滤并下发 `target` 字段；未知前缀 fail-closed（谁都看不见，含历史脏数据 `role:admin`），写入侧 `parseAnnouncementBody` 只放行两种合法形态。入口级展示：模板卡「有公告」角标（TemplatePicker，Tooltip 显示标题）+ 打开定向产线时 header 下方横幅（`GraphAnnouncementBar`）；AnnouncementManager 表单支持全员/按模板（下拉选 33 个模板）/按产线（填 graph id）三种受众，列表行显示受众徽标。测试：server 匹配矩阵 + 校验 + 改定向 round-trip（api.announcements.test.ts 16 例），web Alerts/Picker/Manager 专项（AnnouncementAlerts/TemplatePicker/AnnouncementManager）。

## 1. 背景

当前**完全没有**产品内公告能力（全库检索 announcement/公告 零命中，CHANGELOG.md 是开发文档不是产品功能）。单人自用阶段没有消费场景；本方案为「对外/多用户部署」预置，与 [design-audit-log.md](design-audit-log.md) 同批（合规与运营准备）。

**先想清楚再做**的部分：公告的三个真实场景决定了它比「一个 banner」多一点东西——

| 场景                                 | 消费时机       | 关键约束                |
| ---------------------------------- | ---------- | ------------------- |
| 停机/故障通知                            | 用户正在用时必须看到 | 需要置顶强提醒，不能被忽略       |
| 版本说明                               | 用户空闲时看一眼   | 可折叠，别打断工作流          |
| breaking change（如 schema 迁移后旧模板失效） | 相关功能入口处    | 需要指向具体对象（某个模板/节点类型） |

## 2. 设计原则

1. **幂等展示**：同一公告每个用户只主动弹出一次（已读状态落库），刷新页面不重复骚扰；
2. **文案走 i18n**：标题/正文按 locale 出（复用 zh/en 双语体系，key 进新 namespace `announcements`）；
3. **公告内容永不进 git**：通过 API 写入（运维/管理员操作），不随代码发布——否则改公告要发版，失去时效性；
4. 单人自用时零负担：无公告时 UI 完全无感知。

## 3. 方案设计

### 3.1 存储（迁移 v30）

```sql
CREATE TABLE IF NOT EXISTS announcements (
  id          TEXT PRIMARY KEY,      -- uuid
  title_zh    TEXT NOT NULL,        -- 双语内联而非 JSON 列：公告是低频小数据，直查直渲染
  title_en    TEXT NOT NULL,
  body_zh     TEXT,                  -- 可选 markdown（复用产物渲染的 md 渲染器）
  body_en     TEXT,
  level       TEXT NOT NULL DEFAULT 'info',  -- info | warning | critical（决定 UI 强度）
  starts_at   INTEGER NOT NULL,      -- 生效窗口（预排停机）
  ends_at     INTEGER,               -- NULL = 长期
  target      TEXT,                  -- NULL=全员 | graph:xxx | template:xxx（定向公告）
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS announcement_reads (
  user_id        TEXT NOT NULL,
  announcement_id TEXT NOT NULL,
  read_at        INTEGER NOT NULL,
  PRIMARY KEY (user_id, announcement_id)
);
```

- `level` 驱动 UI 强度：`info` → 铃铛角标；`warning` → 顶部横幅（可关闭）；`critical` → 模态框（必须点「知道了」才落 read）；

- `target` 三态已全部生效（P3，2026-09-05）：`NULL`=全员 / `graph:<id>`=能打开该产线的用户（owner/editor/viewer 均命中，复用 RBAC 判定）/ `template:<id>`=自有或被共享了该模板产线的用户；未知前缀 fail-closed 谁都看不见，写入侧只放行两种合法形态（详见头部「P3 定向已实施」）。

### 3.2 API

| 路由                                             | 权限      | 说明                                                       |
| ---------------------------------------------- | ------- | -------------------------------------------------------- |
| `GET /api/announcements`                       | 登录用户    | 返回窗口内、target 命中的公告 + 本人 read 状态；SSE 不推——公告变化低频，页面加载拉一次即可 |
| `POST /api/announcements/:id/read`             | 登录用户    | 写 announcement\_reads（幂等 upsert）                         |
| `POST /api/announcements` / `PATCH` / `DELETE` | **管理员** | 内容管理                                                     |

**管理员判定**：RBAC P0 已落地（2026-09-05）——全局 `owner/admin` 角色放行管理路由（`isAnnouncementAdmin` 读 `users.role`）。此前的 `ANNOUNCEMENT_ADMIN_EMAILS` env 白名单方案已退役（[design-rbac.md](design-rbac.md)）。

### 3.3 前端 UI

- **入口**：Navbar 加铃铛（与现有图标风格一致，icon 尺寸遵循项目约定「足够大」）；角标 = 未读数；

- 铃铛下拉：公告列表（标题 + 时间 + level 色点），点击进详情（md 渲染 body）；

- `critical` 级别：登录后首个页面加载时模态框强提醒（复用现有 modal 结构与样式 token，`.modal__body` 滚动规范）；

- 所有文案（「暂无公告」「知道了」等 UI chrome）走 i18n `announcements` namespace，公告内容本身双语字段由写入方提供。

### 3.4 与 CHANGELOG.md 的边界

- CHANGELOG.md：**开发者**文档，随 git 发布，讲技术变更；

- 公告：**用户**消息，API 写入，讲「对你有什么影响」（停机窗口、要重新配置什么）；

- 内容可以互相引用（公告里贴 CHANGELOG 链接），但生产管道分开。

## 4. 分阶段落地

| 阶段 | 内容                                                  |
| -- | --------------------------------------------------- |
| P1 | ✅ 表迁移 + GET/read API + 铃铛下拉（info 级别即可用）             |
| P2 | ✅ 管理 API（后改走全局 admin 角色）+ warning 横幅 + critical 模态  |
| P3 | ✅ target 定向逻辑（graph:/template: 受众匹配 + 入口级展示 + 管理表单） |

## 5. 测试计划

- ✅ 窗口过滤：未开始/已过期的公告不返回；

- ✅ read 幂等：重复 POST 不重复插、不报错；

- ✅ 权限：非管理员用户调管理路由 403；普通用户只能读自己的 read 状态；

- ✅ 双语：zh/en locale 下分别渲染对应字段（i18n keys.test.ts 守护新增 chrome 文案）；

- ✅ P3 定向：graph 命中 owner/editor/viewer、不命中无关用户；template 命中自有/被共享模板产线用户；未知前缀 fail-closed 谁都看不见；写入侧非法 target 400；PATCH 改定向/清定向可见性翻转；web 端角标/横幅/表单序列化专项。

## 6. 相关文档

- [design-logging.md](design-logging.md) / [design-feedback.md](design-feedback.md) —— 同批三项

- [deferred-items.md](deferred-items.md) —— 实施触发条件登记（对外/多用户部署）

