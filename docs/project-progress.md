# Agent World 项目进度总览

> **单一入口**：整体进度基线，供后续产品迭代对照参考。创建：2026-08-31。
> 各文档分工：阶段定义见 [PRD.md](../PRD.md)；通用化主线见 [roadmap-generalization.md](roadmap-generalization.md)；活跃待办见 [handoff.md](../handoff.md)；缓做/低优挂起项见 [deferred-items.md](deferred-items.md)。

---

## 一、进度快照（2026-08-31）

> 完成度为基于项目文档状态的**估算**，用于快速判断"哪块做完了、哪块没动"，不是精确度量。按完成度降序。

| 模块 | 完成度 | 状态 | 说明 / 关联文档 |
|---|---|---|---|
| 安全加固（审计 29 项） | 100% | ✅ 已完成 | 3 Critical/10 High/8 Medium/8 Low 全部修复，含 CORS 通配符拒绝、SSRF、静态加密 L3；推翻 2 条旧"已解决"结论 — [security-audit-2026-08-31.md](security-audit-2026-08-31.md) |
| 账号系统与用户隔离 | 100% | ✅ 已完成 | users 表 + JWT/HttpOnly cookie + 全量按 user_id 隔离 + 旧库回填迁移 |
| 回归测试与质量门 | 100% | ✅ 已完成 | core 153 / server 574 / mcp 50 / web 32；core-path 回归基线 11 用例，Node 24 下稳定复跑 — [handoff.md Quality gate](../handoff.md) |
| MCP Server | 100% | ✅ 已完成 | stdio + HTTP/SSE 双传输、15 工具 + resources + prompts + notifications + Bearer 认证（P0-P2 全落地）— [design-mcp-server.md](design-mcp-server.md) |
| Phase 1 基础通用能力 | 100% | ✅ 已完成 | HTTP/代码执行/条件分支/parallel/数据模型升级 — [roadmap-generalization.md](roadmap-generalization.md#phase-1基础通用能力2-3周) |
| Phase 2 数据与文件处理 | 100% | ✅ 已完成 | 表格/数据库/文件解析/OCR/转换/搜索/翻译 — [roadmap-generalization.md](roadmap-generalization.md#phase-2数据与文件处理2-3周) |
| Phase 3 集成与通知 | 95% | 🟡 主体完成 | notify/搜索/vcs/TTS 已落地；邮件收件、内容平台（小红书/抖音/淘宝）依赖 API 资质缓做 — [integrations-future.md](integrations-future.md) |
| 模板体系 | 95% | 🟡 主体完成 | 18 个实用模板覆盖全部节点能力 + TemplateField 参数化全链路 + 空图画布入口；模板市场（发布/安装）缓做 — [design-templates.md](design-templates.md) |
| Phase 4 高级编排 | 92% | 🟡 主体完成 | 6/7 项落地：并行聚合 / subprocess / error 边+catch / AI Agent 工具循环 / human 审批 / 变量持久化；**状态机缓做** — [phase4-design.md](phase4-design.md) |
| 版本管理补强 | 90% | 🟡 主体完成 | 自动快照 + run 关联 hash + 恢复预览；diff 视图与 A/B 缓做 — [design-versions.md](design-versions.md) |
| 真实产线狗粮验证 | 85% | 🔵 进行中 | 文本链路（短视频工坊）+ 全链路（文坊→画坊→影坊视频 MP4）已真实跑通；README GIF 演示与正式运行记录待收尾 |
| 文档完善 | 40% | 🔵 进行中 | 核心设计文档齐；4.8 文档穿插按模块补录，handoff 最近 5 条需回填 hash |
| 自动数据接入 Connector | 60% | 🟡 进行中 ★ | file/http/form/manual 已落地；**SQLite database 已落地（2026-09-01）**；剩 PG/MySQL 驱动接续（deferred） |
| 定时 / 事件触发 | 95% | 🟢 基本完成 ★ | webhook/cron/event/batch 全落地（TriggersPanel+scheduler+27 测试）；**2026-09-01 修复 event 成功状态契约 bug**（见 design-triggers.md）；多实例分布式锁 deferred |
| 商业化（定价/变现） | 5% | ⚪ 待启动 | 按产品决策**放后面** — [PRODUCT_STRATEGY.md](../PRODUCT_STRATEGY.md) |

图例：✅ 已完成 · 🟡 主体完成（有缓做子项）· 🔵 进行中 · ⚪ 待启动

---

## 二、已完成版图（可迭代的基础能力）

- **执行引擎**：4 类 AI 节点（agent/imageGen/videoGen/audioGen）+ 14 类通用节点（HTTP/代码/分支/映射/循环/并行聚合/表格/DB/文件解析/翻译/OCR/转换/搜索/通知），流式 + SSE + 断线重连 + halt/resume，成本电表（token + 单价）。
- **高级编排**：subprocess 子流程、error 边 + catch 容错、失败级联 skip、节点级重试、失败告警 + rerun、人工审批节点、graph 变量跨 run 持久化。
- **可信运行**：账号/用户隔离、静态加密（AES-256-GCM）、SSRF 防护 + 代码沙箱（P0-P2 + net allowlist 代理）、29 项安全审计闭环。
- **质量体系**：core-path 回归基线（compile→execute→rework→resume→artifact→auth→SSRF）+ 全量测试稳定复跑；模板/引擎修复均带回归用例。
- **可扩展面**：MCP Server（外部 AI 客户端接入）、版本快照与恢复预览、模板参数化、18 内置模板覆盖全节点能力。

---

## 三、待启动 / 进行中管线（按优先级）

> 优先级与决策依据以 [handoff.md 待办](../handoff.md) 与 [deferred-items.md](deferred-items.md) 为准，本文档只做总览。

1. **★ 自动数据接入 Connector（4.2）** —— 让产线能自动拉数据（数据库/API/文件）。file/http/form 已落地；**SQLite database connector 已落地（2026-09-01，见 design-connector-database.md）**；PG/MySQL 待驱动接续（deferred）。
2. **★ 定时 / 事件触发（4.6）** —— webhook/cron/event/batch 已全落地（2026-09-01 修复 event 成功状态 `done` 契约 bug，见 design-triggers.md）；与 Connector 组合即无人值守产线。剩余仅多实例分布式锁（deferred）。
3. **文档穿插（4.8）** —— 每完成一个模块就补对应文档；当前 handoff 最近 5 条待回填 hash。
4. **狗粮验证收尾** —— README 演示 GIF（画布运行 + rework 回环 + 时间轴回放）、真实运行记录归档。
5. **低优 / 缓做** —— 沙箱 docker 容器后端、模板/节点市场、版本 diff/A-B、状态机、监控告警大盘、多租户、Notion/Linear/内容平台集成、Excel 读写、HTML→PDF。触发条件见 [deferred-items.md](deferred-items.md)。
6. **商业化** —— 放后面，决策基线见 [PRODUCT_STRATEGY.md](../PRODUCT_STRATEGY.md)。

---

## 四、迭代参考规则

- **何时更新**：每次功能落地 / 阶段推进 / 待办状态变更时，更新本文档的进度快照与待办管线。
- **如何更新**：模块级完成度只改"状态 + 说明"两列，不编造精确数字；新增待办先写进 [handoff.md 待办](../handoff.md)（活跃事实源），再同步到本文档。
- **文档分工**（避免多源冲突）：
  | 文档 | 职责 |
  |---|---|
  | PRD.md | 产品阶段定义与护栏 |
  | roadmap-generalization.md | 通用化当前主线（5 Phase） |
  | docs/project-progress.md（本文档） | 整体进度基线 + 迭代对照 |
  | handoff.md | 当前状态 + 活跃待办 + 最近 5 条变更 |
  | docs/deferred-items.md | 缓做/低优挂起项（带触发条件） |
