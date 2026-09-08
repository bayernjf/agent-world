# Agent World 文档地图

> **场景导航 + 文档状态约定**。完整文档清单（每个文档的一句话定位）的单一事实源是 [handoff.md](../handoff.md) 的「Project documents」区——本文档不重复维护清单，只回答「我想做某事该看哪个」。

## 怎么读这个仓库（按场景）

| 我想…                    | 看                                                                           |
| ---------------------- | --------------------------------------------------------------------------- |
| 快速跑起来、了解项目门面           | [README.md](../README.md)                                                   |
| 知道现在做到哪、接下来做什么         | [handoff.md](../handoff.md) ★ 交接必读                                          |
| 看整体进度基线、迭代对照           | [project-progress.md](project-progress.md)                                  |
| 用画布（快捷键 / 交互）          | README.md 的 Canvas interaction 一节                                           |
| 套用现成产线模板               | [examples.md](examples.md)                                                  |
| 给项目加节点 / Provider / 工具 | [extending.md](extending.md) + [CONTRIBUTING.md](../CONTRIBUTING.md)        |
| 理解架构 / 数据模型 / API      | [technical-design.md](technical-design.md)                                  |
| 知道产品往哪走                | [PRD.md](PRD.md) + [roadmap-generalization.md](roadmap-generalization.md) ★ |
| 接手某个模块的设计决策            | 对应 [design-\*.md](design-mcp-server.md)                                     |
| 看按版本的变更记录              | [CHANGELOG.md](../CHANGELOG.md)（最近 5 条以内看 handoff）                          |
| 看代码质量 / 安全审计 / 待修复项     | [code-audit-2026-09-06.md](code-audit-2026-09-06.md)（全项目 77 项 + 修复状态） + [security-audit-2026-08-31.md](security-audit-2026-08-31.md) |
| 部署 / 运维 / 多环境 / 检测环境状态 | [engineering-blueprint.md](engineering-blueprint.md)（企业级工程蓝图·总纲）+ [production-ops.md](production-ops.md)（运维与可观测性）+ [environments.md](environments.md)（环境划分）+ [runbooks/](runbooks/deploy-ubuntu-server.md)（部署手册） |
| 让 Claude 自动开浏览器验收部署 | [browser-verification.md](browser-verification.md)（Chrome DevTools MCP 配置与用法） |

## 路线图 / 进度系列怎么分工

这类文档最容易看混，各管一段：

| 文档 | 管什么 |
| --- | --- |
| [PRD.md](PRD.md) | 阶段定义 + 架构护栏（5 阶段的「是什么」） |
| [roadmap-generalization.md](roadmap-generalization.md) | 通用化主线（当前推进方向） |
| [product-content-roadmap.md](product-content-roadmap.md) | 内容线专项（淘宝 / 小红书图文） |
| [project-progress.md](project-progress.md) | 进度基线（各模块完成度快照） |
| [roadmap-tasks.md](roadmap-tasks.md) | 历史任务清单（已合并进上面，勿据此实现） |

产品 / 商业化系列：[PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) = 成本/部署/定价基线 → [design-monetization.md](design-monetization.md) = 商业化实施方案（详细，未实施）→ [product-industry-roi.md](product-industry-roi.md) = 行业切入方向评估 → [product-vision-discussion.md](product-vision-discussion.md) = 历史讨论。

## 文档状态约定

- **现行**：当前事实，AI 与开发者以此为准；改动直接更新。

- **历史**：决策过程记录，结论已体现在现行文档；如需修改结论，改现行文档而非历史记录。

- **归档**：冻结内容，只读参考，不追加新内容。

- **实施进度**：统一记在 [handoff.md](../handoff.md)（最近 5 条 + 待办），设计文档只写设计，不重复记进度。

- **完整清单**：所有文档（含一句话定位）见 [handoff.md](../handoff.md)「Project documents」区——那是清单的单一事实源，新增文档先在那里登记。
