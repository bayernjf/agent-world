# Agent World 文档地图

> 本文档是全部文档的索引与导航。每个文档标注「现行 / 历史 / 归档」。
>
> 约定：**单一事实源**——同一主题只维护一份现行文档；历史决策保留但明确标注，不当作当前事实。

## 怎么读这个仓库（按场景）

| 我想… | 看 |
|---|---|
| 快速跑起来、了解项目门面 | [README.md](../README.md) |
| 知道现在做到哪、接下来做什么 | [handoff.md](../handoff.md) ★ 交接必读 |
| 看整体进度基线、迭代对照 | [project-progress.md](project-progress.md) |
| 用画布（快捷键 / 交互） | README.md 的 Canvas interaction 一节 |
| 套用现成产线模板 | [examples.md](examples.md) |
| 给项目加节点 / Provider / 工具 | [extending.md](extending.md) + [CONTRIBUTING.md](../CONTRIBUTING.md) |
| 理解架构 / 数据模型 / API | [technical-design.md](technical-design.md) |
| 知道产品往哪走 | [PRD.md](../PRD.md) + [roadmap-generalization.md](roadmap-generalization.md) ★ |
| 接手某个模块的设计决策 | 对应 [design-*.md](design-mcp-server.md) |
| 看按版本的变更记录 | [CHANGELOG.md](../CHANGELOG.md)（最近 5 条以内看 handoff） |

## 文档清单

### 现行（当前事实，以此为准）

| 文档 | 一句话定位 | 读者 |
|---|---|---|
| [README.md](../README.md) | 项目门面：两个核心设计决策、架构图、画布交互、部署 | 所有人 |
| [handoff.md](../handoff.md) | 交接文档：当前状态 + 活跃任务 + 最近 5 个变更 | 继续迭代的 AI / 开发者 ★ |
| [project-progress.md](project-progress.md) | 整体进度基线（模块完成度 + 待启动管线 + 迭代参考规则）★ | 决策者 / 开发者 |
| [design-connector-database.md](design-connector-database.md) | Database Connector 设计（SQLite 只读拉数据；PG/MySQL 待触发） | 开发者 |
| [design-triggers.md](design-triggers.md) | 触发方式（webhook/cron/event/batch）设计与使用、UTC cron、状态契约、与 Connector 的自动化闭环 | 开发者 / 使用者 |
| [design-knowledge-memory.md](design-knowledge-memory.md) | 知识提取与记忆系统设计（run 结束自动提取 + FTS5 检索 + archive_search 技能卡；已落地） | 开发者 |
| [design-ab-testing.md](design-ab-testing.md) | A/B 实验设计（同图多 prompt 变体并行对比；已落地，独立于版本管理） | 开发者 |
| [PRD.md](../PRD.md) | 产品路线图（5 阶段）与架构护栏 | 产品 / 开发者 |
| [PRODUCT_STRATEGY.md](../PRODUCT_STRATEGY.md) | 产品策略基线（成本 / 部署 / 定价 / 商业化） | 决策者 |
| [CHANGELOG.md](../CHANGELOG.md) | 按版本的变更日志（Keep a Changelog） | 所有人 |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 环境搭建、测试、commit 规范、PR 流程 | 贡献者 |
| [technical-design.md](technical-design.md) | 技术方案结论：架构、数据模型、API、安全 | 开发者 |
| [security-audit-2026-08-31.md](security-audit-2026-08-31.md) | 安全审计报告 + 修复方案（3 Critical / 10 High / 8 Medium / 8 Low，**29 项全部修复**；推翻两条旧"已解决"结论）★ | 开发者 / 决策者 |
| [design-at-rest-encryption.md](design-at-rest-encryption.md) | 静态加密设计（settings / webhook secret 落盘 AES-256-GCM；审计 L3，已落地） | 开发者 / 运维 |
| [roadmap-generalization.md](roadmap-generalization.md) | 通用化路线图（当前主线，5 阶段） | 决策者 / 开发者 ★ |
| [deferred-items.md](deferred-items.md) | 缓做/低优事项登记表（全部挂起项 + 触发条件的单一事实源） | 决策者 / 开发者 ★ |
| [design-mcp-server.md](design-mcp-server.md) | MCP Server 设计（传输 / tools / resources / prompts） | 开发者 |
| [design-code-sandbox.md](design-code-sandbox.md) | 代码节点运行沙箱设计（env / 网络 / 文件系统 / 资源 / 工作目录隔离，P0-P2） | 开发者 |
| [design-artifact-display.md](design-artifact-display.md) | 产物统一渲染卡设计（ArtifactCard + 渲染器注册表） | 开发者 |
| [design-artifact-attribution-repo.md](design-artifact-attribution-repo.md) | 产物归属 + 按流水线分组成品仓库设计 | 开发者 |
| [design-templates.md](design-templates.md) | 产线模板体系增强设计（老用户入口 / 覆盖面 / 参数化 / 分类分组展示 / 市场缓做决策） | 开发者 |
| [design-versions.md](design-versions.md) | 产线版本管理补强设计（自动快照 / 恢复预览 / run 关联 / diff 缓做决策） | 开发者 |
| [design-glossary.md](design-glossary.md) | 术语对照表：标准术语 ⇄ Agent World 游戏化用词（本体论单一事实源） | 产品 / 开发者 |
| [examples.md](examples.md) | 33 个可直接套用的产线模板（+ 1 个空白产线入口） | 新用户 |
| [template-checklist.md](template-checklist.md) | 产线模板验证与评估待办表（逐模板真实狗粮验证状态；新增模板必登记）★ | 开发者 / 使用者 |
| [extending.md](extending.md) | 如何扩展：Worker / Connector / Skill / Trigger / 节点 | 开发者 |
| [product-content-roadmap.md](product-content-roadmap.md) | 内容线（淘宝 / 小红书图文）专项规划 | 产品 |
| [product-industry-roi.md](product-industry-roi.md) | 行业 ROI 评估：多 agent 流水编排的切入方向排序（专业服务 = 交集最优）+ 垂直模板候选清单 | 产品 / 决策者 |
| [design-ecommerce-roadmap.md](design-ecommerce-roadmap.md) | 自媒体电商方向能力升级方案（F1-F10：run 内多变体择优引擎 / 审核队列 / 平台合规 / 商品库 / 批量 / 发布闭环；**已全部落地**） | 产品 / 开发者 |
| [rpa-readback-onboarding.md](rpa-readback-onboarding.md) | RPA 回读真实环境接入清单（框架已落地，选择器待真实账号逆向） | 开发者 |
| [feedback-workflow.md](feedback-workflow.md) | 用户如何高效反馈给 AI（截图 / computer-use / 防丢） | 用户 |
| [phase4-design.md](phase4-design.md) | Phase 4 高级编排落地方案（subprocess / error 边 / human / 变量持久化；状态机缓做） | 开发者 |
| [integrations-future.md](integrations-future.md) | 集成线（Notion / Linear / 邮件收件 / 内容平台 / VCS 扩展；缓做） | 产品 / 开发者 |
| [design-design-tokens.md](design-design-tokens.md) | 设计 Token 体系（Primitive + Semantic 两层 + 明暗主题；已落地） | 开发者 |
| [design-i18n.md](design-i18n.md) | i18n 国际化（i18next + 7 命名空间 + zh/en 双语；已落地） | 开发者 |
| [web-component-testing-plan.md](web-component-testing-plan.md) | web 组件测试计划（P0-P3 四批，39 组件；已落地） | 开发者 |

### 历史（决策记录，保留参考，勿据此实现）

| 文档 | 说明 |
|---|---|
| [product-vision-discussion.md](product-vision-discussion.md) | 2026-08 产品方向多轮讨论记录（愿景 / 选型 / 商业化思考） |
| [tech-stack-assessment.md](tech-stack-assessment.md) | 2026-08 技术栈评估（当前选型边界与演进建议） |
| [roadmap-tasks.md](roadmap-tasks.md) | 阶段 1-5 旧任务清单，任务已合并进 PRD + roadmap-generalization |

### 归档（冻结内容，只读参考）

| 文档 | 说明 |
|---|---|
| [handoff-archive.md](handoff-archive.md) | 2026-08-27 前的全部 handoff 历史（frozen） |

## 文档状态约定

- **现行**：当前事实，AI 与开发者以此为准；改动直接更新。
- **历史**：决策过程记录，结论已体现在现行文档；如需修改结论，改现行文档而非历史记录。
- **归档**：冻结内容，只读参考，不追加新内容。
- **实施进度**：统一记在 [handoff.md](../handoff.md)（最近 5 条 + 待办），设计文档只写设计，不重复记进度。
