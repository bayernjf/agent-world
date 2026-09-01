# 产线模板验证与评估待办表

> **定位**：跟踪每个产线模板的**真实狗粮验证与体验评估**状态。模板的存在性/定义以 core `TEMPLATES` 数组为单一事实源（27 个，2026-09-01 确认）；本表只管"哪个模板被真实验证过、体验如何"。
>
> **维护规则**：
> 1. **新增模板必须在此登记一行**（与 core 模板数对不上即视为欠账），登记时验证状态标 ⬜。
> 2. 真实跑通后更新状态为 ✅，并记 run id / 日期 / 评估发现；发现的问题按性质流转：可修的进 [handoff.md](../handoff.md) 待办，暂不修的进 [deferred-items.md](deferred-items.md)。
> 3. **两级验证口径**：① 引擎级冒烟（全部 27/27 已通过，2026-08-31，见 handoff 待办 #4）——只证明形状与执行不崩；② **真实狗粮运行**（本表跟踪的）——配好 provider 真实调用模型、产物可用的端到端验证。

## 状态图例

- ⬜ 待真实验证（引擎冒烟已过，未真实跑过）
- 🟡 部分验证（跑通但有关键缺口，见备注）
- ✅ 已真实跑通（端到端产物可用）

## 待办表

| 分类 | 模板 id | 模板名称 | 状态 | 真实运行记录 | 评估发现 |
|---|---|---|---|---|---|
| 营销内容 | tpl-media-pipeline | 短视频广告工坊 | ✅ | run `e74cba65`（文本链路）+ `49e60631`（全链路 MP4，5m50s），2026-08-31 | 期间修复 undici 对齐、videoAdapter、artifact 落库双 bug；视频生成 5-6 分钟/段属 API 固有耗时 |
| 营销内容 | tpl-product | 淘宝商品详情 | ⬜ | — | 含 2 个 imageGen 节点，验证图片链路 |
| 营销内容 | tpl-xiaohongshu | 小红书种草笔记 | ⬜ | — | 含 2 个 imageGen 节点 |
| 营销内容 | tpl-batch-content | 批量内容工坊 | ⬜ | — | loop 批处理场景 |
| 营销内容 | tpl-review-publish | 人工审核发布 | ⬜ | — | human 审批 + error 边兜底场景 |
| 营销内容 | tpl-news-podcast | 资讯播客工坊 | 🟡 | 复验 run `b6ac0fee`（摘除 voice，代理已通）+ `d57a1b43`（同图），2026-09-01 | 首验 run `829d23af`/`c870fd4d` 发现的 4 条问题已全部修复并复验：① audioGen 静默吞 → 改 node.failed（`b6de7d9`）；② search 不可达 → 可行动报错 + `AGENT_WORLD_PROXY` 代理（`b82f89a`）；③ tts-1 modality 错配 → 派发期阻断（`7b7faf0`）；④ `template` 参数名已纠正文档。**剩余阻塞（非产品缺陷）**：DDG 反爬验证页（已改为响亮报错，不再静默 0 结果）→ 需配 TAVILY_API_KEY 等换源；agnes 无音频模型 → 需配 TTS 供应商才能出音频成品 |
| 数据分析 | tpl-ops-weekly | 运营周报 | ⬜ | — | http + code + 无数据兜底 |
| 数据分析 | tpl-research-brief | 多源研究简报 | ⬜ | — | parallel 汇聚场景 |
| 数据分析 | tpl-competitor-watch | 竞品监控摘要 | ⬜ | — | http + 拉取失败兜底 |
| 数据分析 | tpl-research-loop | 多课题深度调研 | ⬜ | — | loop + 多课题 |
| 数据分析 | tpl-data-report | 数据报表生成 | ⬜ | — | http + code + table |
| 写作 | tpl-draft | 写草稿 | ⬜ | — | 最简 textGen 链路 |
| 写作 | tpl-translation | 翻译流水线 | ⬜ | — | 专用 translate 节点 |
| 办公协同 | tpl-doc-review | 文档审查 | ⬜ | — | 基础 textGen + gate |
| 办公协同 | tpl-doc-ingest | 文档智能解析入库 | ⬜ | — | fileParse + convert/ocr |
| 办公协同 | tpl-scan-ocr | 扫描件数字化 | ⬜ | — | ocr 节点 |
| 开发集成 | tpl-custom-model | 自定义模型接入 | ⬜ | — | http + code + vcs |
| 开发集成 | tpl-release-pr | 发版 PR 助手 | ⬜ | — | vcs 节点 |
| 开发集成 | tpl-code-review | 代码审查助手 | ⬜ | — | http + code + gate |
| 法律合规 | tpl-contract-review | 合同审查助手 | ⬜ | — | fileParse + gate + human |
| 法律合规 | tpl-evidence-brief | 证据清单整理 | ⬜ | — | code 拆条 + table 排序 |
| 财务审计 | tpl-expense-review | 费用报销初审 | ⬜ | — | code 规则校验 + table |
| IT 运维 | tpl-patrol-alert | 定时巡检告警 | ⬜ | — | cron 触发 + notify webhook（需填 webhookUrl 字段） |
| 客户服务 | tpl-customer-service | 客服工单自动处理 | ⬜ | — | branch + human + notify（需填 webhookUrl 字段） |
| 教育 | tpl-course-outline | 课程大纲生成 | ⬜ | — | 教育场景 textGen |
| 生活 | tpl-travel-plan | 旅游行程规划 | ⬜ | — | 生活场景 textGen |
| 生活 | tpl-recipe | 菜谱生成 | ⬜ | — | code 营养估算 |

> 空白产线入口（BLANK_TEMPLATE）不属业务模板，不进本表。
>
> **验证前置条件**（2026-09-01 狗粮总结）：含 `search` 节点的模板（research-brief / competitor-watch / news-podcast / research-loop 等）默认走 duckduckgo，**需要本机能直连或给 server 配置出站代理**（`AGENT_WORLD_PROXY`）；改用 tavily/serpapi/google 需对应环境变量（`TAVILY_API_KEY` 等）且重启 server。含 `audioGen` 的模板需要 provider 有音频模型（当前 agnes 无 TTS，需另配）。
>
> 验证顺序建议：优先覆盖**未验证的节点类型与组合**（imageGen 双图、audioGen 播客、ocr、vcs、loop、notify 告警），再补纯 textGen 的简单场景。
