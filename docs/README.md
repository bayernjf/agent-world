# Agent World 文档地图

> **场景导航 + 文档状态约定**。完整文档清单（每个文档的一句话定位）的单一事实源是 [handoff.md](../handoff.md) 的「Project documents」区——本文档不重复维护清单，只回答「我想做某事该看哪个」。

## 怎么读这个仓库（按场景）

| 我想…                    | 看                                                                           |
| ---------------------- | --------------------------------------------------------------------------- |
| 快速跑起来、了解项目门面           | [README.md](../README.md)                                                   |
| 知道现在做到哪、接下来做什么         | [handoff.md](../handoff.md) ★ 交接必读                                          |
| 看整体进度基线、迭代对照           | [project-progress.md](project-progress.md)                                  |
| 用画布（快捷键 / 交互）          | README.md 的 Canvas interaction 一节                                           |
| 看名下所有产线的运营总览（健康度/最近运行/成本） | 命令面板 → 运营工作台（OperationsDashboard，RTS 阶段 A）；设计见 [design-rts-overview.md](design-rts-overview.md) |
| 套用现成产线模板               | [examples.md](examples.md)                                                  |
| 给项目加节点 / Provider / 工具 | [extending.md](extending.md) + [CONTRIBUTING.md](../CONTRIBUTING.md)        |
| 理解架构 / 数据模型 / API      | [technical-design.md](technical-design.md)                                  |
| 知道产品往哪走                | [PRD.md](PRD.md) + [roadmap-generalization.md](roadmap-generalization.md) ★ |
| 看竞品（Dify/Coze/n8n 等）都被什么坑、我们还缺什么 | [competitor-painpoints.md](competitor-painpoints.md)（6 类共性痛点 + 现状对账 + G1-G7 增强建议，标注哪些已挂触发条件） |
| 把竞品 P0 痛点变成方案：步级 trace / 上游数据契约 / 长任务降级 | [design-step-trace-and-robustness.md](design-step-trace-and-robustness.md)（G1 步级时间线+fork重跑 / G2 上游 schema 护栏 / G4 超时降级，含 G3/G5 补充决策） |
| 接手某个模块的设计决策            | 对应 [design-\*.md](design-mcp-server.md)                                     |
| 给 agent 加技能卡（工具/提示模块/输出契约） | [design-skill.md](design-skill.md)（§11 现状盘点 + §12 作者指南）+ [extending.md](extending.md) §3 |
| 把平台暴露给别的 AI 客户端（MCP Server） | [design-mcp-server.md](design-mcp-server.md)（§12 协议版本协商 / §13 授权 / §14 未实现清单）+ [production-ops.md](production-ops.md) §8（部署形态） |
| 接 Notion / Linear / 邮件 / 内容平台等第三方 | [integrations-future.md](integrations-future.md)（未来集成清单与触发条件；当前外接能力走 MCP / HTTP 节点 / Connector） |
| 看按版本的变更记录              | [CHANGELOG.md](../CHANGELOG.md)（最近 5 条以内看 handoff）                          |
| 看代码质量 / 安全审计 / 待修复项     | [code-audit-2026-09-06.md](code-audit-2026-09-06.md)（全项目 77 项，已修复 73 / 无需修复 3 / 部分修复 1，low 项 2026-09-11 全部清账） + [security-audit-2026-08-31.md](security-audit-2026-08-31.md) |
| 写 / 跑 web 组件测试           | [web-component-testing-plan.md](web-component-testing-plan.md)（组件测试范围、流程与断言约定；E2E 冒烟见根 `e2e/`，跑法见 CONTRIBUTING） |
| 判断产品是否达到可上线 MVP      | [mvp-readiness-review-2026-09-22.md](mvp-readiness-review-2026-09-22.md)（最新：自托管 MVP ✅ 达到且超出；对外商业 SaaS ❌ 功能 Ready、收款/运维 Not Ready；367 runs/3631 测试/备份恢复演练通过）+ [09-21 版](mvp-readiness-review-2026-09-21.md)（历史基线） |
| 查某个功能为什么缓做、什么条件下重启 | [deferred-items.md](deferred-items.md)（缓做/低优事项登记表，每条挂触发条件与决策链接，单一事实源） |
| 理解投料台连接器 / `${...}` 数据插值 | [design-data-interpolation.md](design-data-interpolation.md)（五类 connector 的 data 通道与插值）+ [design-template-connector-presets.md](design-template-connector-presets.md)（模板按 A/B/C/D 类预设 connector）+ [design-connector-database.md](design-connector-database.md)（SQL 连接器） |
| 让产线定时跑 / 事件 / webhook 自动触发 | [design-triggers.md](design-triggers.md)（cron / webhook / event / batch 四类触发器、调度器单实例与恢复） |
| 用高级编排（人工审批 / 子流程 / 状态变量分支 / 错误边重试） | [phase4-design.md](phase4-design.md)（六项高级编排落地；跨 run 状态机方案 B 缓做，见 deferred-items） |
| 写 / 套用产线模板、模板上线校验 | [design-templates.md](design-templates.md)（模板体系与 TemplateField）+ [template-checklist.md](template-checklist.md)（每个内置模板的狗粮验证清单）+ [examples.md](examples.md)（现成模板一览） |
| 看产线版本历史 / 结构化 diff / 回滚 | [design-versions.md](design-versions.md)（节点级 A/B 对比 + 长文本逐字高亮，已落地） |
| 对两条产线做 A/B 对比实验 | [design-ab-testing.md](design-ab-testing.md)（`/api/ab` + RunCompare，单人隔离已覆盖；流量分流缓做） |
| 平台安全 / 合规（角色权限、静态加密、密钥轮换、审计、公告、反馈） | [design-at-rest-encryption.md](design-at-rest-encryption.md) + [design-key-rotation.md](design-key-rotation.md) + [design-audit-log.md](design-audit-log.md) + [design-announcement.md](design-announcement.md) + [design-feedback.md](design-feedback.md) + [design-rbac.md](design-rbac.md)（角色三层分权，均已落地，含 runbook） |
| 代码节点沙箱 / SSRF 防护 | [design-code-sandbox.md](design-code-sandbox.md)（bwrap/sandbox-exec 隔离 + 协作式 HTTP 代理） |
| 做中英双语 / 调整视觉设计规范       | [design-i18n.md](design-i18n.md)（中文/English 双语方案与 key 约定）+ [design-design-tokens.md](design-design-tokens.md)（颜色/间距/圆角/阴影/字号 token 体系） |
| 让新用户免注册先体验真实产品（演示账号/游客转正） | [design-demo-user.md](design-demo-user.md)（is_demo 真实账号 + 体验额度 + 能力黑名单 + claim 原地转正 + TTL 清理，D1-D6 分步） |
| 部署 / 运维 / 多环境 / 检测环境状态 | [engineering-blueprint.md](engineering-blueprint.md)（企业级工程蓝图·总纲）+ [production-ops.md](production-ops.md)（运维与可观测性）+ [environments.md](environments.md)（环境划分）+ [runbooks/](runbooks/deploy-ubuntu-server.md)（部署手册）+ [runbooks/deploy-cicd.md](runbooks/deploy-cicd.md)（push→CI→自部署 Hasee 流水线）+ [runbooks/error-reporting.md](runbooks/error-reporting.md)（错误追踪与告警：webhook sink / relay / 自检 CLI）+ [runbooks/change-management.md](runbooks/change-management.md)（变更管理流程）+ [runbooks/postmortem-template.md](runbooks/postmortem-template.md)（事故复盘模板） |
| 让 Claude 自动开浏览器验收部署 | [browser-verification.md](browser-verification.md)（Chrome DevTools MCP 配置与用法） |
| 查术语 / 名词定义 | [design-glossary.md](design-glossary.md)（领域术语表） |
| SQLite → PostgreSQL 迁移 / 切驱动 | [design-postgres-migration.md](design-postgres-migration.md)（双驱动 + 搬迁脚本 + 端到端演练已完成，生产切换随 SaaS 阶段） |
| 规模化 / 高可用 / 多租户架构 | [design-scaling.md](design-scaling.md) + [design-multitenancy.md](design-multitenancy.md)（自托管先、SaaS 后的分级路线） |

## 路线图 / 进度系列怎么分工

这类文档最容易看混，各管一段：

| 文档 | 管什么 |
| --- | --- |
| [PRD.md](PRD.md) | 阶段定义 + 架构护栏（5 阶段的「是什么」） |
| [roadmap-generalization.md](roadmap-generalization.md) | 通用化主线（当前推进方向） |
| [product-content-roadmap.md](product-content-roadmap.md) | 内容线专项（淘宝 / 小红书图文 / research-loop 研究闭环 / 新闻播客） |
| [project-progress.md](project-progress.md) | 进度基线（各模块完成度快照） |
| [roadmap-tasks.md](roadmap-tasks.md) | 历史任务清单（已合并进上面，勿据此实现） |

产品 / 商业化系列：[PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) = 成本/部署/定价基线 → [design-monetization.md](design-monetization.md) = 商业化实施方案（详细，价格已用 M1 真实数据校准 2026-09-14，P1 代码已完成）→ [design-monetization-m2-implementation.md](design-monetization-m2-implementation.md) = M2 订阅 gate 落地方案（S1-S8 代码全部完成并部署 Hasee，gate 默认由 MONETIZATION_ENFORCE 关闭，等拍板开启）→ [design-monetization-m3-implementation.md](design-monetization-m3-implementation.md) = M3 收款与账单（S1-S5 完成并部署）→ [design-monetization-m3-s6-stripe.md](design-monetization-m3-s6-stripe.md) = S6 Stripe 总方案（后端 A0-A4 完成并部署，schema v39 迁移成功）→ [design-monetization-m3-s6-a5-frontend.md](design-monetization-m3-s6-a5-frontend.md) = S6 A5 前端 BillingTab 实施方案（已完成并部署）**——M3 只剩真机 Step6：待收款主体 + `STRIPE_SECRET_KEY`/`PRICE_IDS` 就绪** → [product-industry-roi.md](product-industry-roi.md) = 行业切入方向评估 → [product-vision-discussion.md](product-vision-discussion.md) = 历史讨论。转化/入门侧：[design-demo-user.md](design-demo-user.md) = 演示用户（免注册一键进真实产品、体验额度、claim 原地转正保留数据；D1-D6 已随 PR #302 合 dev 部署 Hasee 并真机走查，零配置首跑 422 经 PR #305/#307 修复闭环，每小时 prune cron 已挂）。

画布 / 体验系列：[design-canvas-isometric.md](design-canvas-isometric.md) = L1 单厂等距 3D（**五期已建成**：几何 → 完整效果 → 交互 → 视觉打磨 → 写实工业风，第五期含 ACES/Bloom/暗角/地台描边/选中光环 + textGen 工业厂房原型）→ [design-rts-overview.md](design-rts-overview.md) = L0 宏观工业园区 RTS 视角（阶段 A 平面运营工作台已上线，阶段 B 宏观沙盘 B1-B9 全部完成，阶段 C 全部完成：C1-C3 随 PR #290、C4-C8 随 PR #292 合 dev 并部署 Hasee、真机走查通过；C5 改期为点击延后/cron 只读、C6 暂只 CTR/GMV 两处裁剪见 handoff 待办 #50）→ [design-rts-stage-b.md](design-rts-stage-b.md) = 阶段 B 宏观沙盘 MVP 落地级细化（B1-B9 全部完成，B5 帧率实测 100 厂=60FPS/15 draw calls 达标无需视口剔除，B9 i18n/token+全量回归+真机验收通过）→ [design-guided-tour.md](design-guided-tour.md) = 新用户分步引导（聚光灯 + 上一步/下一步，多引导注册中心，已落地）。

## 文档状态约定

- **现行**：当前事实，AI 与开发者以此为准；改动直接更新。

- **历史**：决策过程记录，结论已体现在现行文档；如需修改结论，改现行文档而非历史记录。

- **归档**：冻结内容，只读参考，不追加新内容。

- **实施进度**：统一记在 [handoff.md](../handoff.md)（最近 5 条 + 待办），设计文档只写设计，不重复记进度。

- **完整清单**：所有文档（含一句话定位）见 [handoff.md](../handoff.md)「Project documents」区——那是清单的单一事实源，新增文档先在那里登记。
