# Agent World 通用化路线图

> **当前主线路线图**（2026-08 起）。
> 从"内容生成流水线"升级为"通用自动化平台"的产品路线图。
> 状态：Phase 1 与 Phase 2 已全部落地（2026-08-29）；Phase 4 六项已落地、状态机缓做（2026-08-30 复核） | 创建：2026-08-28
> 历史任务清单见 [roadmap-tasks.md](roadmap-tasks.md)（已合并到本文档）；内容线专项见 [product-content-roadmap.md](product-content-roadmap.md)。

---

## 1. 背景与目标

### 1.1 当前定位

当前 agent-world 本质是**"内容生成流水线"**：
- 节点类型围绕文本/图片/视频/音频生成设计
- 数据模型以文本和图片为主
- 编排方式以线性流程 + 质检返工循环为主
- 典型场景：小红书种草、淘宝详情、公众号文章、短视频脚本

### 1.2 通用化目标

成为**通用自动化平台**（类似 n8n / Zapier / Make，但以 AI Agent 为核心），能处理：
- 内容生成与发布
- 数据处理与分析
- API 集成与自动化
- 业务流程编排
- IT 运维自动化
- 任意需要"AI + 工具 + 流程"的场景

### 1.3 核心问题

| 维度 | 当前 | 通用化目标 |
|------|------|-----------|
| **节点类型** | 7种（source/agent/imageGen/videoGen/audioGen/gate/sink） | 20+ 种，覆盖数据处理、API、代码、数据库、通知等 |
| **数据模型** | 文本 + 图片 + artifact | 任意 JSON / 表格 / 二进制文件，节点间灵活映射 |
| **编排方式** | 线性 + 质检返工循环 | 分支 / 合并 / 循环 / 并行 / 子流程 / 错误处理 |

---

## 2. 分阶段路线图

### Phase 1：基础通用能力（2-3周）

**目标**：让产线能处理"非内容生成"任务，能对接外部系统。

#### P0 节点（必须做）

| 节点 | 能力 | 说明 |
|------|------|------|
| **HTTP 请求** | 自定义 method/headers/body/query，调用任意 REST API | 对接外部系统的基础，能发通知、拉数据、发布内容 |
| **代码执行** | 跑 Python/JS，做数据处理、格式转换、复杂计算 | "万能胶水"，临时需求不用等开发新节点 |
| **条件分支** | if/else/switch，根据条件走不同分支 | 产线不再是线性的，能根据输入内容走不同路径 |
| **映射（map）** | JSON 模板映射/字段重命名/批量数组转换 | 声明式数据转换，纯占位符自动保留数字/对象类型 |
| **循环（loop）** | 对数组每项执行下游子图，聚合每轮输出 | 批量处理一组数据；循环体内 `${item.x}` 可用 |
| **并行聚合（parallel）** | 等待所有分支完成，把输出聚合成数组/对象 | 分支天然并行 + 显式结构化汇合点 |

#### P1 节点（建议做）

| 节点 | 能力 | 状态 |
|------|------|------|
| **循环** | for/while，批量处理一组数据 | ✅ 已随 P0 落地（loop 节点） |
| **Webhook 触发** | 接收外部事件触发产线 | ✅ 已有（webhook 触发器） |

#### 数据模型升级

- 节点输出支持任意 JSON，不只是文本
- 节点间支持数据映射（从上游 JSON 里取字段传给下游）
- 支持变量系统（产线级变量、节点级变量）
- 支持表达式（在节点配置中引用上游数据和变量）

#### 验收标准

- [x] HTTP 请求节点能调用任意 REST API，支持 GET/POST/PUT/DELETE
- [x] 代码执行节点能跑 Python/JS，能访问上游数据，能输出结果给下游
- [x] 条件分支节点能根据条件路由到不同分支
- [x] 映射节点能做 JSON 模板映射与数组批量转换
- [x] 循环节点能对数组逐项执行下游子图并聚合结果
- [x] 并行聚合节点能等所有分支并把输出聚合成数组/对象
- [x] 节点间能传递任意 JSON 数据
- [x] 能用通用节点搭一个"调用 API → 处理数据 → 条件判断 → 循环处理 → 聚合输出"的产线

---

### Phase 2：数据与文件处理（2-3周）

**目标**：能处理结构化数据和各种文件格式。

| 节点 | 能力 | 状态 |
|------|------|------|
| **数据库查询** | MySQL/PostgreSQL/SQLite/MongoDB，执行 SQL/查询 | ✅ 已落地（database 节点，`db-drivers.ts` driver 抽象 + SQLite 首实现，MySQL/PG 可按接口扩展） |
| **表格处理** | CSV/Excel 读写、筛选、排序、聚合（类似 pandas） | ✅ 已落地（table 节点，CSV/JSON 解析 + 筛选/排序/聚合步骤，JSON/CSV 双输出；Excel 未做） |
| **文件解析** | PDF/Word/PPT 提取文本和图片 | ✅ 已落地（fileParse 节点，pdfjs-dist + fflate 纯 JS，提取文本与内嵌图片） |
| **文件转换** | 格式转换（PDF→图片、HTML→PDF、图片格式转换） | ✅ 部分落地（convert 节点：PDF→提取内嵌图片 + PNG/JPEG 互转；HTML→PDF 纯 JS 无中文排版方案，暂缓） |
| **OCR** | 图片文字识别 | ✅ 已落地（ocr 节点，tesseract.js WASM 零原生依赖，多语言 + 离线路径覆盖） |
| **翻译** | 多语言翻译（调用 LLM 或翻译 API） | ✅ 已落地（translate 节点，LLM 翻译 + 流式 + 重试 + 成本核算） |
| **搜索** | 网络搜索（Google/Bing/SerpAPI） | ✅ 已落地（search 节点，DuckDuckGo 免 key 默认 + Tavily/SerpAPI/Google CSE，env key 不入图） |

#### 验收标准

- [x] 数据库节点能执行 SQL 查询并返回行集（SQLite 首实现，driver 抽象可扩展 MySQL/PostgreSQL）
- [x] 表格节点能解析 CSV/JSON，支持筛选、排序、聚合，输出 JSON/CSV
- [x] 文件解析节点能提取 PDF/DOCX/PPTX 的文本与内嵌图片
- [x] 文件转换节点能 PDF→图片（提取内嵌图）与图片 PNG/JPEG 互转（HTML→PDF 需浏览器引擎或嵌入中文字体，暂缓）
- [x] OCR 节点能识别图片文字（tesseract.js，eng/chi_sim 等多语言，支持离线部署）
- [x] 翻译节点能通过 LLM 翻译上游文本并保留结构
- [x] 搜索节点能执行网络搜索并输出结构化结果（text + json 双产物）
- [x] 能搭「HTTP 下载 → 文件解析 → OCR → 翻译」「搜索 → 总结」「数据库 → 表格聚合」等端到端产线

---

### Phase 3：集成与通知（2-3周）

**目标**：能对接主流 SaaS 和通知渠道，实现"端到端自动化"。

| 节点 | 能力 | 状态 |
|------|------|------|
| **飞书/钉钉/企业微信** | 发消息、建文档、审批 | ✅ 群机器人发消息已落地（notify 节点，含钉钉加签 + markdown）；建文档/审批需开放平台应用，P2 |
| **邮件** | 收发邮件、带附件 | ✅ SMTP 发送已落地（notify 节点，nodemailer，密钥走 env）；收件/附件见 [integrations-future.md §3](integrations-future.md#3-邮件收件--附件)，作为触发器扩展 |
| **小红书/抖音/淘宝** | 发布内容、获取数据（需要 API 权限） | ⏸ 依赖商家 API 资质，走连接器市场，不建原生节点，见 [integrations-future.md §4](integrations-future.md#4-内容平台小红书--抖音--淘宝) |
| **GitHub/GitLab** | 提 PR、查 issue、触发 CI | ✅ 已落地（vcs 节点，create_pr/comment_issue/trigger_workflow/list_issues，token 走 env，Bitbucket/Gitea 同构可扩展） |
| **Slack/Notion/Linear** | 主流协作工具集成 | ✅ Slack 已落地（notify 的 slack provider，chat.postMessage）；Notion/Linear 见 [integrations-future.md §1/§2](integrations-future.md) |
| **定时触发增强** | cron 表达式、复杂调度 | ✅ 已有（触发器体系：cron/webhook/event/batch 四类 + TriggerScheduler 调度 + Web 配置 UI） |
| **Webhook 输出** | 产线完成后调用外部 Webhook | ✅ 已有（http 节点可调任意 REST API 兜底） |

未来集成（Notion / Linear / 邮件收件 / 内容平台 / Bitbucket 等）的接口草案与入手路径见 [docs/integrations-future.md](integrations-future.md)。

---

### Phase 4：高级编排与 AI Agent（3-4周）

**目标**：产线能处理复杂流程，AI 节点能做自主决策。

> 详细落地方案、难题与对策、优先级见 [docs/phase4-design.md](phase4-design.md)（基于 2026-08-29 代码勘察）。

| 能力 | 说明 | 状态 |
|------|------|------|
| **并行/聚合** | 并行跑多个分支，然后聚合结果 | ✅ 已有（Phase 1 的 `parallel` 节点 + 调度器 `MAX_CONCURRENCY`） |
| **子流程调用** | 产线调用另一个产线（类似函数调用） | ✅ 已落地：`subprocess` 节点（`d66fe52`），方案见 [phase4-design §2](phase4-design.md#2-子流程调用) |
| **错误处理** | try/catch、重试策略、降级、死信队列 | ✅ 已落地：retry 基建 + 级联 skip + error 边/catch + 失败告警 + rerun（`d31c482`→`8f40a5e` 六连），方案见 [phase4-design §1](phase4-design.md#1-错误处理最高优先级) |
| **AI Agent 节点** | 增强版 agent，支持多轮工具调用循环（ReAct），能自主规划 | ✅ 已实现（`openai-compatible.ts` 的 `runWithTools`，MAX_ROUNDS=8） |
| **人工审批节点** | 产线运行中等待人工输入/审批，然后继续 | ✅ 已落地：独立 `human` 节点（`20d9c9f`），方案见 [phase4-design §3](phase4-design.md#3-人工审批独立节点) |
| **状态机** | 复杂业务流程建模 | ⏸ 缓做（variables + branch 组合可兜底，易过度设计） |
| **变量持久化** | 产线运行间共享状态 | ✅ 已落地：graph variables（`eb10d75`），方案见 [phase4-design §4](phase4-design.md#4-变量持久化) |

---

### Phase 5：生态与平台化（持续）

| 能力 | 说明 |
|------|------|
| **节点市场** | 用户可以发布/安装自定义节点 |
| **模板市场** | 预置大量产线模板（电商运营、内容生产、数据分析、IT 运维等） | ⚠️ 起步完成：内置 10 模板（四类场景全覆盖）+ 首启/老用户双入口 + TemplateField 参数化 schema（UI 缓做），见 [design-templates.md](design-templates.md)；用户发布/安装缓做 |
| **多租户/权限** | 团队协作、权限管理 |
| **版本管理** | 产线版本、回滚、A/B 测试 | ✅ 补强已落地（2026-08-30）：自动快照（节流+滚动保留）+ run 关联 hash 标记 + 恢复预览（结构摘要+缩略图），见 [design-versions.md](design-versions.md)；diff 视图与 A/B 缓做 |
| **监控告警** | 产线运行监控、失败告警、性能分析 |
| **MCP Server** | 把 agent-world 能力暴露给其他 AI 客户端（✅ 已全部落地，详见 [design-mcp-server.md](design-mcp-server.md)） |

---

## 3. 与现有功能的关系

### 3.1 现有节点保留

所有现有节点（source/agent/imageGen/videoGen/audioGen/gate/sink）保留，作为通用平台的"内容生成类"节点。

### 3.2 MCP Client 保留

现有 MCP Client 功能（接入外部 MCP Server）保留，作为 agent 节点的工具扩展机制。

### 3.3 MCP Server 纳入路线图

MCP Server 作为 Phase 5 的一部分（✅ 已全部落地：P0 MVP + P1 增强 + P2 管理类/批量对比/实时与认证），详细设计见 [design-mcp-server.md](design-mcp-server.md)。

### 3.4 质检站（gate）演进

现有质检站在通用化场景下演变为"条件判断 + 人工审批"节点的组合：
- 自动质检 → 条件分支节点
- 人工审批 → 人工审批节点（Phase 4）

---

## 4. 技术架构影响

### 4.1 数据模型

- 节点输出从"文本 + artifact"扩展为"任意 JSON + 二进制数据"
- 引入数据类型系统（string/number/boolean/object/array/binary）
- 节点间数据传递支持引用和映射

### 4.2 引擎

- 从"线性 DAG 执行"扩展为"支持分支/合并/循环/并行的流程引擎"
- 引入变量作用域和表达式求值
- 支持错误传播和错误处理节点

### 4.3 节点 SDK

- 提供统一的节点开发 SDK
- 节点声明输入/输出 schema
- 支持自定义节点的注册和加载

### 4.4 前端画布

- 支持分支/合并/循环的可视化编排
- 节点配置面板支持数据映射和表达式
- 支持子流程的嵌套展示

---

## 5. 风险与挑战

| 风险 | 影响 | 应对 |
|------|------|------|
| **范围蔓延** | 通用化可能变成"什么都做但什么都不精" | 每个 Phase 聚焦核心能力，非核心通过代码执行节点兜底 |
| **复杂度爆炸** | 分支/循环/并行让引擎和前端复杂度大幅上升 | 渐进式引入，先做条件分支，再做循环，最后做并行 |
| **安全风险** | 代码执行节点、HTTP 请求节点可能带来安全问题 | 沙箱执行、权限控制、网络白名单、人工审批 |
| **用户学习成本** | 通用平台比内容生成工具复杂得多 | 提供大量模板、引导式配置、渐进式复杂度暴露 |
| **性能问题** | 大数据量处理、长运行产线可能有性能瓶颈 | 流式处理、分页、异步执行、资源限制 |

---

## 6. 优先级建议

如果资源有限，按以下顺序投入：

1. **Phase 1 P0**（HTTP 请求 + 代码执行 + 条件分支 + 数据模型升级）—— 通用化的基石，做完就能处理 80% 场景
2. **Phase 2 数据库 + 表格处理** —— 数据处理是自动化的核心场景
3. **Phase 3 飞书/钉钉/邮件通知** —— 通知是"端到端自动化"的最后一公里
4. **Phase 4 并行/子流程/错误处理** —— 复杂流程编排，进阶需求
5. **Phase 5 生态/平台化** —— 长期建设，持续投入

---

## 7. 参考文档

- [MCP Server 设计方案](design-mcp-server.md)
- [技术方案](technical-design.md)
- [产品愿景讨论](product-vision-discussion.md)
- [路线图任务](roadmap-tasks.md)
- [产品内容路线图](product-content-roadmap.md)
