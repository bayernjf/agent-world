# Agent World 文档地图

> 本文档是全部文档的索引与导航。每个文档标注「现行 / 历史 / 归档」。
>
> 约定：**单一事实源**——同一主题只维护一份现行文档；历史决策保留但明确标注，不当作当前事实。

## 怎么读这个仓库（按场景）

| 我想… | 看 |
|---|---|
| 快速跑起来、了解项目门面 | [README.md](../README.md) |
| 知道现在做到哪、接下来做什么 | [handoff.md](../handoff.md) ★ 交接必读 |
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
| [PRD.md](../PRD.md) | 产品路线图（5 阶段）与架构护栏 | 产品 / 开发者 |
| [PRODUCT_STRATEGY.md](../PRODUCT_STRATEGY.md) | 产品策略基线（成本 / 部署 / 定价 / 商业化） | 决策者 |
| [CHANGELOG.md](../CHANGELOG.md) | 按版本的变更日志（Keep a Changelog） | 所有人 |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 环境搭建、测试、commit 规范、PR 流程 | 贡献者 |
| [technical-design.md](technical-design.md) | 技术方案结论：架构、数据模型、API、安全 | 开发者 |
| [security-audit-2026-08-31.md](security-audit-2026-08-31.md) | 安全审计报告 + 四批修复方案（3 Critical / 10 High；推翻两条旧"已解决"结论）★ | 开发者 / 决策者 |
| [roadmap-generalization.md](roadmap-generalization.md) | 通用化路线图（当前主线，5 阶段） | 决策者 / 开发者 ★ |
| [deferred-items.md](deferred-items.md) | 缓做/低优事项登记表（全部挂起项 + 触发条件的单一事实源） | 决策者 / 开发者 ★ |
| [design-mcp-server.md](design-mcp-server.md) | MCP Server 设计（传输 / tools / resources / prompts） | 开发者 |
| [design-code-sandbox.md](design-code-sandbox.md) | 代码节点运行沙箱设计（env / 网络 / 文件系统 / 资源 / 工作目录隔离，P0-P2） | 开发者 |
| [design-artifact-display.md](design-artifact-display.md) | 产物统一渲染卡设计（ArtifactCard + 渲染器注册表） | 开发者 |
| [design-artifact-attribution-repo.md](design-artifact-attribution-repo.md) | 产物归属 + 按流水线分组成品仓库设计 | 开发者 |
| [design-templates.md](design-templates.md) | 产线模板体系增强设计（老用户入口 / 覆盖面 / 参数化 / 市场缓做决策） | 开发者 |
| [design-versions.md](design-versions.md) | 产线版本管理补强设计（自动快照 / 恢复预览 / run 关联 / diff 缓做决策） | 开发者 |
| [design-glossary.md](design-glossary.md) | 术语对照表：标准术语 ⇄ Agent World 游戏化用词（本体论单一事实源） | 产品 / 开发者 |
| [examples.md](examples.md) | 10 个可直接套用的产线模板 | 新用户 |
| [extending.md](extending.md) | 如何扩展：Worker / Connector / Skill / Trigger / 节点 | 开发者 |
| [product-content-roadmap.md](product-content-roadmap.md) | 内容线（淘宝 / 小红书图文）专项规划 | 产品 |
| [feedback-workflow.md](feedback-workflow.md) | 用户如何高效反馈给 AI（截图 / computer-use / 防丢） | 用户 |

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
