# 用户反馈（User Feedback）设计方案

> 状态：**P1+P2+P3 全量已实施（2026-09-05）**。目标：产品内的「用户 → 维护者」反馈通道，替代当前「截图发 AI 会话」的人工流程（见 [feedback-workflow.md](feedback-workflow.md)，那是 owner 侧指南，不是产品功能）。
> 创建：2026-09-05
>
> **落地记录（2026-09-05）**：迁移 **v33**（方案写作时预留的 v30 已被公告/RBAC 占用）+ 新库 DDL 双轨。server：`POST /api/feedback`（登录用户，message ≤2000 字 + category ∈ bug/feature/ux/other + **服务端二次白名单脱敏**（route/userAgent/locale/lastRunId/lastError{message,lineno}，白名单外字段一律丢弃——客户端被篡改也拦得住）+ 截图 base64 ≤1MB 限 png/jpeg/webp/gif + 每用户滚动小时 10 条限流（DB 计数，重启不重置））；`GET /api/feedback`（owner/admin，LEFT JOIN users 解析 email，`?status=` 过滤）；`PATCH /api/feedback/:id`（三态 open/acknowledged/closed，同状态幂等返回 `unchanged` 不写审计）；`GET /api/feedback/:id/attachment`（原图字节，cookie 认证天然支持 `<img src>`）。审计埋点 `feedback.submit`（detail 只含 category，不含 message 正文）与 `feedback.status_change`（detail `{to}`）。web：`FeedbackModal`（一句话 + 分类 + 粘贴截图（≤1MB 前端预检 + 预览/移除）+ 诊断勾选默认开（透明原则），lastRunId 取自 run store、lastError 由 `lib/lastError.ts` 全局监听器采集 message+lineno）；入口在 UserMenu（登录即见）；管理端是 **AdminPanel 第三个 tab**（方案写作时的 Settings 区块被 RBAC P3 的 AdminPanel 架构取代）；状态筛选 + 乐观更新三态流转 + 附件懒加载。i18n 新 namespace `feedback`（zh/en）。测试 server 18 例 + web FeedbackModal 11 例 + AdminPanel 反馈 tab 6 例 + UserMenu 入口 3 例；server 838/838 + web 1542/1542（含 i18n 守护）。
>
> **与 §3 的四处偏差**：① 迁移号 v30→v33；② 管理员判定 `FEEDBACK_ADMIN_EMAILS` env 白名单 → RBAC owner/admin 角色（P0 已退役 env 白名单模式，公告同轨）；③ 管理端 Settings 区块 → AdminPanel 反馈 tab（架构随 RBAC P3 演进，且 owner/admin 均可见——与审计 tab 一致）；④ 表加 `attachment_mime` 列 + 新增附件独立端点（列表不传 BLOB，`has_attachment` 布尔 + 懒加载）。
>
> **P3 落地记录（2026-09-05）**：`POST /api/feedback/announce`（owner/admin，单请求完成「建公告 + 批量关反馈」——避免半状态；feedbackIds 非空 ≤50、去重、未知 id 整体 404 拒绝（fail closed 无部分生效）；公告体复用 `parseAnnouncementBody` 校验；已 closed 的条目幂等跳过且不计入 `closed` 返回值；审计 `feedback.announce`，detail `{count, level}`）。web：AdminPanel 反馈 tab 行首 checkbox 多选（切状态筛选清空选择），选中后过滤条右侧出现「合并发公告（N）」；表单预填模板——标题按**主分类**（出现最多的 category，平票取先者）+ 条数生成中英双语（分类名用 `i18n.t(lng)` 双取，不硬编码），正文折叠至多 5 条消息摘要（各截 80 字符），默认级别 warning、endsAt 可选；提交成功 toast + 清空选择 + 重载列表；Escape 先关表单再关面板。测试 server +5 例（403/400/404 无副作用/批量关闭含已关闭幂等/审计断言）、web +5 例（按钮出现与预填/提交与刷新/标题必填/失败保留表单/Escape 分层）；server 838→843、web 1542→1547。

## 1. 背景

当前**没有**产品内反馈功能（全库 feedback 命中均为 F6 内容效果回流，非用户反馈）。单人自用阶段你就是唯一用户、且 [feedback-workflow.md](feedback-workflow.md) 的截图流程已足够；本方案为「出现非 owner 真实用户」预置。

**设计前想清楚的取舍：反馈收集的真正难点不是表单，是上下文。**

用户报「报错了」没用——维护者需要的是：哪个 run、哪个节点、浏览器 console 报错、当时 UI 长什么样。[feedback-workflow.md](feedback-workflow.md) 用「截图」廉价地解决了大半；产品内反馈的增量价值在于**自动附带机器可读的上下文**，这是截图做不到的。

## 2. 设计原则

1. **上下文自动采集**——用户只写一句话 + 可选截图，其余（runId、当前页面路由、浏览器 UA、最近的 error 事件）系统自动带上；
2. **反馈内容永不自动上传密钥**——自动采集的字段经过脱敏白名单（只取 id/路由/UA/错误码，不碰 settings）；
3. 轻量：一个入口按钮 + 一个小表单，不建工单系统——反馈落在库里由维护者直接看，状态流转用最简单的三态；
4. 单人自用时入口可隐藏（无反馈时 Settings 里不显示管理区）。

## 3. 方案设计

### 3.1 存储（新迁移 v30）

```sql
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,      -- uuid
  user_id     TEXT NOT NULL,
  message     TEXT NOT NULL,         -- 用户的一句话
  category    TEXT NOT NULL DEFAULT 'other',  -- bug | feature | ux | other
  context     TEXT NOT NULL,         -- JSON，自动采集（见 §3.2），白名单字段
  attachment  BLOB,                  -- 可选截图（单张，≤1MB，sqlite 内联不做对象存储）
  status      TEXT NOT NULL DEFAULT 'open',    -- open | acknowledged | closed
  created_at  INTEGER NOT NULL
);
```

不做 `feedback_comments` 表（维护者回复走外部渠道——邮件/群），首期只单向收集。

### 3.2 自动上下文（采集白名单）

```ts
// 前端采集，随表单提交
{
  route: location.pathname,               // 当前页面
  userAgent: navigator.userAgent,
  locale: i18n.language,
  // 用户确认后才附带（默认勾选，可取消——透明原则）：
  lastRunId: <最近查看的 run id>,
  lastError: <window.onerror 最近一条: message + lineno>,  // 只 message/位置，不含堆栈本地变量
}
```

**红线**：不采集 settings、不采集图内容（可能含密文/业务数据）、不采集 localStorage 全量。`lastRunId` 是链接不是内容——维护者需要时凭 id 自己去查（已有权限体系）。

### 3.3 API 与 UI

| 路由                        | 权限   | 说明                     |
| ------------------------- | ---- | ---------------------- |
| `POST /api/feedback`      | 登录用户 | 提交（限流：每用户每小时 10 条，防灌水） |
| `GET /api/feedback`       | 管理员  | 列表 + 按 status 过滤       |
| `PATCH /api/feedback/:id` | 管理员  | 改 status（三态）           |

- **入口**：Navbar 反馈按钮（或 `?` 帮助菜单内，遵循「About 放 Help 下」的既有菜单结构约定）；表单：一句话 + category 单选 + 截图粘贴（`paste` 事件监听剪贴板图片，与 feedback-workflow 的截图习惯对齐）+ 「附带诊断信息」勾选框；

- **管理端**：Settings 里新增「反馈」区块（仅管理员可见，同公告的 env 白名单判定 `FEEDBACK_ADMIN_EMAILS`——两个白名单合并为一个 `ADMIN_EMAILS` 更简洁，公告方案那边同步改）；

- UI 文案走 i18n 新 namespace `feedback`。

### 3.3 提交后的静默原则

提交成功 toast「已收到」即可，**不做**「维护者已回复」的通知闭环（那是工单系统的职责范围，见 §6 不做清单）。

## 4. 分阶段落地

| 阶段 | 内容                                                               |
| -- | ---------------------------------------------------------------- |
| P1 | 表迁移 + POST + 前端入口/表单（含截图粘贴、上下文勾选）                                |
| P2 | 管理 API + Settings 管理区块 + 限流                                      |
| P3 | ~~（触发后）反馈 → 公告联动~~ **已实施（2026-09-05，提前于触发条件）**：同类 bug 多人反馈时一键发公告 |

## 5. 测试计划

- 限流：第 11 条 429；

- 上下文脱敏：构造含 settings 泄露形态的 payload 被拒/裁剪（白名单外的字段丢弃）；

- 截图：>1MB 拒绝（413 语义），无图路径正常；

- 权限：非管理员 GET/PATCH 403；

- i18n 守护：keys.test.ts 过新增 namespace。

## 6. 边界与不做

- **不做工单系统**：无评论、无 SLA、无通知闭环——反馈是单向收集，维护者处理方式由人决定；

- **不做对外渠道镜像**（同步到 GitHub Issues）：出现「反馈多了人工看不过来」时再评估；

- **不采集用户屏幕/操作录像**：隐私风险大于收益，截图由用户主动粘贴即已覆盖。

## 7. 相关文档

- [feedback-workflow.md](feedback-workflow.md) —— owner 侧截图反馈流程（本方案的产品化目标，两者并存：AI 会话内的快速反馈继续走截图）

- [design-logging.md](design-logging.md) / [design-announcement.md](design-announcement.md) —— 同批三项

- [deferred-items.md](deferred-items.md) —— 实施触发条件登记

