# [历史决策记录 · 2026-08] Agent World 产品方向讨论记录

> 状态：**历史文档**——产品方向的多轮讨论记录，结论已沉淀进 [PRD.md](PRD.md) 与 [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md)。保留供追溯，勿据此直接实现。
> 日期：2026-08-25
> 形式：围绕一份多 Agent 编排平台行业分析图片，结合项目现状展开的多轮对话
> 性质：产品愿景、架构判断、技术选型与商业化思考，非实施规格
>
> 本文档回答四个问题：
> 1. 这个产品是什么、不是什么（设计语言）
> 2. 能做什么、不能做什么（能力边界）
> 3. 用什么技术、技术怎么用（技术基座）
> 4. 怎么赚钱（商业化路径）

---

## 一、行业分析对照与项目现状评估

### 行业分析图片的核心观点

一份基于市场研究报告的分析，主要结论：

- 多 Agent 编排平台是「AI 工程化 + 分布式系统 + 业务抽象」交叉领域，2026 年进入主流采用周期
- 技术栈推荐：LangGraph/Crewai 做编排，MCP 协议做工具接入，向量库做记忆，React Flow 做前端
- 市场判断：通用型平台机会小，垂直行业定制、开源二次开发、本地化部署有机会
- 风险提示：复杂度爆炸是首要技术风险，落地效果才是生存关键

### 项目已经做对的事

**1. 核心引擎自己写，而不是套 LangGraph**

行业分析建议基于 LangGraph/Crewai 二次开发，这个结论对普通团队成立，但对本项目不成立：

- 两个核心设计决策——返工环作为受约束构造、attempt 作为运行身份——在主流框架里没有一等公民支持。LangGraph 的循环是任意 cycle，需要自己在上面加约束；Crewai 没有 attempt 概念。套框架反而要跟框架的抽象打架。
- `packages/core` 是零依赖纯函数，事件流是唯一真相源，replay 就是 fold 前缀（见 `packages/core/src/runtime.ts` 的 `replay()`）。这个架构比 LangGraph 的 checkpointer 更干净，更适合回放/时间旅行质感。
- 编译器在 `packages/core/src/compile.ts` 里强制一个不变量：去掉所有 rework 边后必须是 DAG，且每条 rework 边必须落在 gate 的祖先上。这让调度器可以产出一个有界的执行计划，而不是在任意环上冒险。

**2. 游戏化隐喻是真正的差异化**

Coze、Dify、扣子、Crewai 都在用同一种语言：节点、边、agent、tool。本项目用厂房/电力/卡车/质检站是另一套语言。这不是装饰，是产品认知上的护城河。用户记住的是"我的草稿被质检站打回了两次"，不是"我的 critic node retry 了两次"。

**3. 路线图的克制是对的**

阶段 1 只做"真能干活"，不做并行、技能卡、多图管理。这跟"复杂度爆炸是首要风险"的判断一致。多 Agent 平台最容易死在什么都想做上。

### 需要注意的方向

- **MCP 不是现在的事，但别堵死。** 阶段 1 接真实 provider 时，工具调用大概率会撑破现在的 `node.delta` + 单次产出结构。工具注册和调用层值得按 MCP 的形状设计接口。
- **记忆层还没碰。** 阶段 2 做技能卡时，可以顺手把记忆模型想清楚，不要等到后面再补。
- **可观测性已有一半。** 事件流 + 回放拖条 + inspector diff 比 LangSmith 的 trace 视图更直观，不需要接 Langfuse/LangSmith。
- **第一个垂直产线模板选什么比技术架构更决定开源后有没有人用。** "写草稿→批评→改写"太通用，不够有记忆点。
- **返工环表达力上限是已知风险。** 嵌套返工、多质检站互相返工还没验证，等真实工作流撞上来再改。

---

## 二、产品基调与设计语言

### 核心定位

**Agent World 是一个工厂，不是一个操作系统。**

工厂有固定的车间布局（source → agent → gate → sink），但可以换设备（skills）、换原料（connectors）、换工人（workers）、查档案（memory）。它不试图成为所有东西，它试图把"一批原料经过可控的、可审计的加工变成成品"这件事做到极致。

### 设计语言原则

**每一个技术概念都必须能在工厂隐喻里找到位置，找不到的就不做。**

- KV Cache 找不到位置——它是工人脑子里的缓存，属于 worker 内部实现，用户不需要看见。
- Milvus 也找不到直接位置——它是档案室的书架，用户只需要知道"能从过去的生产记录里找到相关的东西"。
- 工厂隐喻不是皮肤，是本体论。每个节点类型、每种机制都要能在工厂里对应到真实事物。

### 节点类型是本体论，不开放扩展

节点类型固定为 source / textGen / gate / sink，未来可能加 join（汇合点）。变化通过 skill（装备卡）承载，不通过加节点类型：

- **Source（原料码头）：** 不只是文本输入框。原料可能来自数据库、API、文件、Webhook、另一条产线的成品。原料有形状（schema）、有批次、有来源证明。
- **Agent（厂房）：** 加工原料。可以装备不同的技能卡（工具、prompt 模块、输出契约）。消耗电力（token），产出成品。
- **Gate（质检站）：** 有不同检测手段——模型评判、规则校验、schema 验证、人工审核。这些是"检测设备"，通过 skill 挂载。不合格的沿返工线退回上游。
- **Sink（成品库）：** 成品交付。可以是输出到屏幕、写入数据库、调用 API、发布到平台、喂给另一条产线。
- **数据清洗不是独立节点类型，** 是 agent 装备的清洗工具卡，或是 source 连接器的内置步骤。

### 技能树不是付费墙

skill 是节点上的能力开关和配置预设，不设解锁成本。游戏化体现在质感和隐喻上，不体现在人为的进度阻塞上。

### 一条贯穿始终的红线

凡是只为"开源"或"商业化"服务的东西，现阶段一律不做，但**不要做出会堵死它们的设计**。具体三条：

1. worker 保持可替换
2. 事件流保持带版本
3. 成本计量保持真实（哪怕现在不收钱）

---

## 三、能做什么、不能做什么

### 工作流的三种形状

企业里的工作只有三种形状，产品只主攻第一种：

**1. 流水线型（Batch Pipeline）——完美匹配，主场**

一个输入单元，经过固定步骤，产出成品，有质检返工。特点是有明确的开始和结束、步骤可预期、质量可检验。这是工厂隐喻的原生形状。

**2. 对话型（Conversational）——不匹配，不做**

多轮对话，没有固定步骤数，对话本身就是产品。实时客服对话、通用聊天机器人不属于流水线——客户不会走上流水线跟工人聊天。但客服背后的"工单分类→草拟回复→审核→发送"是流水线，可以做。对话型是"前台接待"，不是"车间生产"。

**3. 分析型（Analytical / On-demand）——部分匹配，拆成流水线做**

一个查询进来，取数分析出结论。文档问答是前台（不做），但"文档摄入→信息抽取→结构化→入库"是流水线（能做）。销售数据分析如果是"定时跑报告"是流水线，如果是"随意提问即时回答"是分析型——前者做，后者不直接做，但可以让流水线产出一个可供查询的结构化产物。

### 具体工作流能力清单

| 工作流 | 形状 | 能做吗 | 现阶段缺什么 | 哪个阶段补齐 |
|--------|------|--------|-------------|-------------|
| 商品详情页生产 | 流水线 | ✅ 非常适合 | 图片输入、结构化产出(HTML/JSON)、模板 | 阶段2技能卡+模板，阶段4图片/多模态 |
| 社交媒体内容生成 | 流水线 | ✅ 适合 | 多平台适配 skill、发布 connector、排期 | 阶段2模板，阶段4 connector |
| 客服工单分类与草拟 | 流水线 | ✅ 适合 | 工单系统 connector、人工 halt 审核 | 阶段1 halt恢复，阶段4 connector |
| 合同/标书审查 | 流水线 | ✅ 完美适合 | PDF 解析、条款比对 skill、返工环天然适用 | 阶段2技能卡，阶段4文件 artifact |
| 销售数据周报生成 | 流水线 | ✅ 适合 | 数据库 connector、图表产出 artifact | 阶段3 artifact分层，阶段4 connector |
| 内容翻译与本地化 | 流水线 | ✅ 适合 | 术语表 skill、多语言模型 | 阶段2技能卡 |
| 邮件营销文案 | 流水线 | ✅ 适合 | A/B 测试产出、发送 connector | 阶段2并行，阶段4 connector |
| 代码审查辅助 | 流水线 | ✅ 适合 | Git connector、规则校验 skill | 阶段2技能卡，阶段4 connector |
| 文档摄入与结构化 | 流水线 | ✅ 适合 | 文档解析 connector、向量写入 | 阶段4 connector+memory |
| 知识库问答 | 分析型 | ⚠️ 别扭 | 向量检索 memory、实时查询接口 | 阶段5 memory backend |
| 实时客服对话 | 对话型 | ❌ 不做 | 交互模型完全不同，不是流水线 | 永远不做 |
| 通用聊天机器人 | 对话型 | ❌ 不做 | 跟隐喻和架构都不搭 | 永远不做 |
| 实时语音助手 | 对话型 | ❌ 不做 | 完全不同的技术栈和交互 | 永远不做 |
| 任意低代码自动化 | 通用型 | ❌ 不做 | 那是 n8n/Make 的赛道，不是工厂 | 永远不做 |

### 第一个杀手级模板候选：商品详情页

```
[商品信息+图片] → [卖点提炼厂房] → [文案撰写厂房] → [排版生成厂房] → [质检站] → [详情页成品]
                                        ↑                    |
                                        └──── 返工 ←─────────┘
```

- 原料明确：商品文字描述 + 商品图片
- 成品明确：可直接使用的商品详情页（HTML/JSON/图片）
- 返工真实存在：卖点不突出打回、文案违规打回、排版不合格打回
- 电商客户付费意愿强，产出物可直接衡量
- 并行也用得上：卖点提炼和规格整理可以同时跑

### "像公司一样有各种团队"怎么实现

不是做成什么都有的大平台，而是**多产线 + 产线间协作**：

```
[内容生产产线] ──成品──→ [发布产线]
[客服工单产线] ──反馈──→ [内容生产产线]（知识沉淀到档案室）
[数据分析产线] ──报告──→ [决策产线]
[文档摄入产线] ──结构化知识──→ [档案室] ←─ 所有产线检索
```

- 每条产线是一个"团队"，有自己的厂房布局和专业技能
- 产线间通过 Packet 传递协作：一条产线的成品是另一条产线的原料
- 全局视角看到的是工业园区，不同车间同时运转
- 技术上事件流模型已支持：每个 run 有独立 event log，跨产线引用用 artifactId
- 这是后期愿景，早期只做一条产线做到极致

---

## 四、数据模型与数据处理

### 三层数据模型

数据在管道里流动时不能永远是字符串，需要分层。现阶段不全部实现，但要在 schema 和接口上不堵死。

#### 第一层：Packet（在途货物）

卡车拉的是货单，不是全部货物。现在 `packet.sent` 事件只有 `summary: string`，未来扩展为：

```typescript
interface Packet {
  id: string                    // 货物批次号
  kind: "text" | "structured" | "file" | "binary"
  summary: string               // 卡车车身上写的货名（UI 显示用）
  artifactId: string            // 指向仓库里的完整货物（现阶段可选）
  schema?: string               // 结构化数据的 schema 标识
  metadata?: Record<string, unknown>  // 批次元数据：来源、时间、标签
  provenance: {                 // 货源追溯
    sourceRunId: string
    sourceNodeId: string
    attempt: number
  }
}
```

现在的 `engine.ts` 里 `artifacts` 是 `Map<string, string>`，未来变成 `Map<string, ArtifactRef>`。这是引擎内部改动，不影响事件流的版本兼容。

#### 第二层：Artifact（仓库里的货物）

每次 node run 的产出是一个 artifact，不只是文本：

```typescript
interface Artifact {
  id: string
  kind: "text" | "json" | "html" | "file" | "image" | "table"
  mimeType: string
  sizeBytes: number
  storageUri: string            // 本地文件路径 / 对象存储 key / 内联数据
  checksum: string              // 完整性校验
  createdAt: number
  createdBy: { runId, nodeId, attempt }
}
```

- 文本 artifact 可以内联存在数据库（现在的 `node_runs.output`）
- 文件/二进制 artifact 存磁盘或对象存储，数据库只存元数据
- `node_runs.output` 字段未来从 TEXT 变成 artifact_id 引用，但文本类型可以保留内联作为优化
- artifact 不可变——attempt 是身份，同一 attempt 的产出不被覆盖

#### 第三层：Knowledge（档案室）

从历史生产记录中提炼的可检索知识，不是原始 artifact，而是加工过的索引：

```typescript
interface KnowledgeEntry {
  id: string
  kind: "pattern" | "failure-case" | "success-example" | "fact" | "preference"
  content: string
  embedding?: number[]          // 由可插拔 embedder 生成
  embeddingModel?: string       // 记录用的哪个模型生成的 embedding
  source: { runId, nodeId, attempt }
  tags: string[]
  confidence: number            // 提取置信度
  createdAt: number
}
```

数据来源是事件流——每次 gate 驳回、返工后通过、高质量产出都可提取成知识条目。向量数据库只是存储后端之一：

- **小规模（个人/小团队）：** SQLite + sqlite-vec，零依赖，跟现在的架构一致
- **中规模（企业私有化）：** Postgres + pgvector，一个数据库同时存事件和向量
- **大规模（SaaS/多租户）：** Milvus / Qdrant / Weaviate，专门的向量服务
- **不做的：** 硬编码某一个向量库。MemoryBackend 接口可插拔。

### 企业数据差异：Schema as Contract

不做全局统一数据模型。每条产线在 source 节点上声明期望的输入 schema：

```typescript
interface SourceConfig {
  connector?: { type: string; config: unknown }
  inputSchema?: ZodSchema       // 来料规格书
  sampleData?: unknown          // 画布上试跑用的样品
}
```

- Connector 负责把外部数据映射到这个 schema
- Agent 拿到的是符合 schema 的结构化数据
- Gate 可以做 schema 校验作为一种检测手段
- 产线之间通过 Packet 的 schema 标识协商兼容性
- 通用字段（id、createdAt、source）有约定，但业务字段由每条产线自定义

### 数据清洗：怎么做，放在哪

数据清洗是高度场景化的：去重、格式化、字段映射、脱敏、校验、分词、过滤……**不做通用 ETL 引擎。** 正确的做法分三个层次：

**层次一：Connector 内置预处理（原料入库时）**

Connector 从源头拉数据时做最基础的清洗——编码转换、格式统一、去空行、截断。这是"卸货时扫一眼"，每个 connector 自己负责，不抽象。

**层次二：Agent 装备清洗工具卡（加工时）**

需要模型判断的清洗——从非结构化文本提取字段、判断数据质量、智能分类——作为 agent 可调用的 tool（skill 卡）：

```
[Source: 原始商品数据]
    ↓
[Agent: 信息抽取厂房]  ← 装备"字段提取卡"（调 LLM 把自由文本映射到 schema）
    ↓
[Agent: 数据校验厂房]  ← 装备"规则校验卡"（校验价格格式、图片数量、必填字段）
    ↓
[Gate: 来料质检]       ← schema 验证不通过就返工
    ↓
[Agent: 文案撰写厂房]
```

工具卡本质是一个函数：`(input: unknown, context: ToolContext) => Promise<unknown>`。它可以是确定性代码（正则、解析、映射），也可以是 LLM 调用（提取、分类、摘要）。确定性工具和 AI 工具通过同一个 skill 接口挂载。

**层次三：Gate 做最终校验（出厂前质检）**

结构化数据经过加工后，Gate 用 JSON Schema 验证 + 业务规则做最终检查。不合格的返工到具体厂房，而不是整条线重来。

**不做的：**
- 不做拖拽式数据转换节点（那是 ETL 工具的事）
- 不做可视化数据映射界面（早期）
- 不做通用数据质量平台

---

## 五、技术架构与技术选型

### 现有技术栈

| 层 | 技术 | 用途 | 为什么选它 |
|----|------|------|-----------|
| 核心逻辑 | TypeScript + Zod | graph schema、事件 schema、reducer | 零依赖，前后端共用，类型安全 |
| 持久化 | node:sqlite | 事件存储、graph 存储、node_runs 投影 | Node 24 内置，无需 native 编译，WAL 模式够用 |
| 服务端 | Node.js HTTP + SSE | REST API + 实时事件推送 | 不引入框架，事件流天然适合 SSE |
| 前端 | React + TypeScript + Vite | 工业风画布和控制面板 | 生态成熟 |
| 画布 | 自定义 SVG + Canvas overlay | 厂房/管道 SVG，卡车 Canvas 动画 | 不用 React Flow 因为要完全控制工业风视觉 |
| 状态管理 | 自定义 store | graph 编辑态 + run 实时态 | 事件流 fold 到 reducer，不需要 Redux |
| 测试 | Node test runner | 19 个测试（13 core + 6 server） | 零依赖，够快 |
| 单包管理 | pnpm workspace | monorepo（core/server/web） | 依赖隔离，引用方便 |

### 引擎工作原理（现状）

`packages/server/src/engine.ts` 的 `execute()` 是一个 async generator：

1. 编译器（`compile.ts`）产出 `Plan`：flow 边的拓扑序 + rework 环的边界
2. 引擎按拓扑序推进 cursor，遇到 agent 调 `worker.runAgent()`，遇到 gate 调 `worker.judge()`
3. agent 的产出存在 `artifacts: Map<nodeId, string>`，下游通过 `inputFor()` 拼接所有入边产出
4. gate 判定不通过且还有 attempt 时，cursor 跳回 rework entry，环体重跑
5. 每个动作 yield 一个事件，调用方（HTTP 层）把事件同时写 SQLite 和推 SSE
6. 成本在每次调用后累加，超预算 yield `power.tripped` 后停线
7. 纯函数 reducer（`runtime.ts`）把事件流 fold 成运行时状态，live view 和 replay 用同一个 reducer

**关键不变量：**
- 事件流是唯一真相源，运行时状态是它的纯函数导出
- `(runId, nodeId, attempt)` 是主键，attempt 不被覆盖
- 成本事后计量，从不预扣
- 编译器保证去掉 rework 边后是 DAG

### 未来技术选型（按阶段）

#### 阶段 1：真实模型接入

| 技术 | 用途 | 怎么用 |
|------|------|--------|
| AI SDK (Vercel) 或直接 fetch | 模型调用 | Worker 接口的真实实现。优先选支持多 provider 的 SDK，避免每个厂商写一套 |
| Provider API（Anthropic/OpenAI/火山等） | LLM 推理 | Worker 内部封装，对引擎暴露统一接口 |
| 流式解析（SSE stream） | 实时输出 | 模型返回的 token 流转成 `node.delta` 事件，已有管道支持 |
| 环境变量 / 本地配置文件 | API key 存储 | 不进仓库，不写数据库，本地文件权限 600 |

工具调用在阶段 1 会撞破现在的 `runAgent` 返回 `{ output: string }` 结构。真实模型会返回 tool_calls，需要多轮执行。演进方向：

```typescript
// 现在
runAgent(args): AsyncGenerator<string, { output: string; usage: Usage }>

// 阶段 1 后（可能的形状）
runAgent(args): AsyncGenerator<AgentDelta, AgentResult>
// AgentDelta = text delta | tool call request | tool result
// AgentResult = { artifacts: Artifact[]; usage: Usage }
```

这是阶段 1 最需要认真设计的接口改动，会影响 engine 的 agent 执行循环。

#### 阶段 2：产线表达力

| 技术 | 用途 | 怎么用 |
|------|------|--------|
| 分层调度器 | 并行分支 | 编译器 Plan 从线性 order 变成 levels[][], 引擎按层并发 |
| Promise.all + 限流 | 节点并发 | 同层互不依赖的节点同时跑，信号量控制并发上限 |
| Barrier / Promise.all | 多入边汇合 | 等齐所有上游产出再触发下游 |
| Skill registry | 技能卡 | agent.config.skills 从 string[] 变成可解析的技能描述，前端有装备 UI |
| Graph 版本快照 | 多产线 | runs 表已有 snapshot 字段，每次运行存当时的 graph 定义 |

#### 阶段 3：可信运行

| 技术 | 用途 | 怎么用 |
|------|------|--------|
| 运行历史索引 | 历史列表 | runs 表已存在，加查询/分页/筛选 API |
| 成本聚合查询 | 成本报表 | node_runs 表已有 cost_usd，按 graph/node/attempt GROUP BY |
| SSE 自动重连 | 断线恢复 | SSE 已支持 Last-Event-ID 从 seq 续传，前端加指数退避重连 |
| 节点级重试策略 | 调用失败重试 | 区别于返工环：返工是质检驳回（业务逻辑），重试是网络/限流（技术故障）。在 agent config 加重试策略 |
| 结构化错误分类 | 失败面板 | node.failed 事件的 error 字段加 errorCode: TIMEOUT / RATE_LIMIT / PROVIDER_ERROR / VALIDATION |

#### 阶段 4：开源与扩展

| 技术 | 用途 | 怎么用 |
|------|------|--------|
| Worker 插件加载器 | 第三方 worker | 约定目录放文件，动态 import，实现 Worker 接口即注册 |
| Connector SDK | 外部数据源 | 定义 Connector 接口，文件/API/数据库连接器作为独立包 |
| MCP Client | 工具生态 | 作为 skill 的一种来源——MCP server 暴露的工具自动成为可装备的技能卡 |
| Artifact 存储抽象 | 文件产出 | LocalStorage / S3 兼容存储，通过 StorageBackend 接口可切换 |
| 多模态支持 | 图片/文件输入 | Worker 接口的 input 从 string 变成 Packet[]，支持图片 content part |
| CI (GitHub Actions) | 质量门禁 | typecheck + test + 构建，开源标配 |

#### 阶段 5：企业与商业化

| 技术 | 用途 | 怎么用 |
|------|------|--------|
| Postgres + pgvector | 企业级存储+向量 | 从 SQLite 迁移，DatabaseBackend 接口可切换 |
| Milvus / Qdrant | 大规模向量 | MemoryBackend 的一种实现，SaaS 多租户场景 |
| Redis | 短期状态/缓存 | 运行时状态缓存、限流、会话。非必须，Postgres 也能扛 |
| 对象存储（S3/OSS） | 大文件 artifact | StorageBackend 的企业实现 |
| Docker / K8s | 私有化部署 | 提供 docker-compose（小规模）和 Helm chart（大规模） |
| OpenID Connect / SAML | SSO | 企业版鉴权，RBAC 权限模型 |
| Webhook / 定时触发器 | 产线自动触发 | 产线不只能手动派发，还能被外部事件或定时任务触发 |
| 审计日志导出 | 合规 | 事件流本身就是审计日志，加 SIEM 导出格式 |

### 不引入的技术

| 技术 | 为什么不引入 |
|------|-------------|
| LangGraph / Crewai / AutoGen | 自己的引擎更贴合需求，套框架要跟抽象打架 |
| Langfuse / LangSmith | 事件流 + replay 已是更好的 trace，不依赖外部 SaaS |
| Kafka / RabbitMQ | 单机/小团队不需要，SSE + SQLite 够。未来水平扩展时再考虑消息队列 |
| Redis（现阶段） | 没有多实例部署需求，SQLite WAL 够快 |
| GraphQL | REST + SSE 足够，不需要 over-fetching 解决方案 |
| ORM（Drizzle/Prisma） | 事件是 append-only 的原始 insert，node_runs 是简单投影，手写 SQL 更直接 |
| 微服务 | 单体直到证明需要拆。Worker/Connector 是接缝不是服务 |
| Kubernetes（早期） | docker-compose 够私有化，K8s 是大企业需求，阶段 5 |

### KV Cache：用在哪里，用户看不到

KV Cache 是 transformer 推理的内部优化——缓存已处理 token 的 key/value 矩阵，避免重复计算。在本产品中的位置：

- **它是 Worker 内部实现，** 不是产品概念。用户不需要知道它存在
- **Provider 侧 KV Cache：** Claude/OpenAI API 自动处理，按缓存 token 打折计费，Usage 里会体现。我们要做的只是在 Usage 类型里预留 cachedTokens 字段，计费时区分缓存和非缓存
- **自托管模型侧 KV Cache：** 如果未来支持本地模型（Ollama/vLLM），vLLM 等推理引擎自动管理，不需要产品层介入
- **Prompt prefix caching：** 这是可以间接利用的——如果多个节点的 system prompt 有相同前缀，把公共前缀放前面可以触发 provider 的 prompt caching 降本。这是 Worker 实现的优化策略，不是用户功能

---

## 六、插件与扩展机制

### 三个接缝，现阶段只实现第一个

```
┌─────────────────────────────────────────────┐
│                  Agent World                 │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Worker   │  │ Connector│  │  Memory   │  │
│  │ (已实现)  │  │ (预留)   │  │  (预留)   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │              │              │        │
│  真实模型/假worker   数据库/API/文件  向量库/全文检索  │
└─────────────────────────────────────────────┘
```

#### 1. Worker（已有接缝）——谁来干活

```typescript
interface Worker {
  runAgent(args: {
    node: GraphNode
    config: AgentConfig
    attempt: number
    input: string          // 未来变成 Packet[] 支持多模态
  }): AsyncGenerator<string, { output: string; usage: Usage }>

  judge(args: {
    node: GraphNode
    attempt: number
    input: string
  }): Promise<{ passed: boolean; reason: string }>
}
```

- 假 worker 已实现，确定性离线，测试和画布依赖它
- 阶段 1 加真实 provider worker
- 阶段 4 变成插件：放一个文件在 workers/ 目录，实现接口即注册
- Worker 是最核心的接缝——引擎只认这个接口，不管后面是 Claude、GPT、本地模型还是规则引擎

#### 2. Connector（预留字段，阶段 4 实现）——原料从哪来

```typescript
interface Connector {
  id: string
  type: string                                    // "database" | "api" | "file" | "webhook"
  fetch(spec: ConnectorSpec): AsyncGenerator<Packet>
  test(): Promise<{ ok: boolean; message: string }>
  describe(): ConnectorSchema                     // 声明能提供什么数据
}
```

- Source 节点的 config 预留 `connector?: { type; config }`
- 阶段 1 不实现，source 仍是手动输入
- 阶段 4 先做文件 connector（最简单）和 HTTP API connector
- 企业版卖数据库 connector 套件（MySQL/Postgres/MongoDB/飞书/钉钉/Jira/SharePoint）

#### 3. MemoryBackend（阶段 5 实现）——档案室怎么存

```typescript
interface MemoryBackend {
  remember(entry: KnowledgeEntry): Promise<void>
  recall(query: string, opts?: {
    limit?: number
    filter?: Partial<KnowledgeEntry>
    minConfidence?: number
  }): Promise<KnowledgeEntry[]>
  forget(id: string): Promise<void>               // 被遗忘的权利
  searchByTag(tags: string[]): Promise<KnowledgeEntry[]>
}
```

- 事件流已经在记录一切，数据不缺，缺的只是索引和检索
- 阶段 4 之前不需要——没有足够历史数据值得检索
- 实现顺序：SQLite 全文检索（零依赖）→ sqlite-vec（向量）→ pgvector（企业）→ Milvus（大规模）
- 记忆不是自动注入所有 prompt，而是 agent 可选择装备"档案检索卡"，显式查询相关历史经验

### Skill（技能卡）：节点能力的扩展单位

Skill 不是第四个接缝，它挂在 Worker 下面——是 agent 可以调用的工具/能力：

```typescript
interface Skill {
  id: string
  name: string
  description: string
  kind: "tool" | "prompt-module" | "output-contract" | "judge"
  // tool 类型：一个可调用函数
  invoke?: (input: unknown, ctx: SkillContext) => Promise<unknown>
  // prompt-module 类型：注入到 prompt 的文本片段
  promptTemplate?: string
  // output-contract 类型：产出必须符合的 schema
  outputSchema?: ZodSchema
  // MCP 来源标记
  source?: "builtin" | "local" | "mcp"
}
```

技能卡的种类：
- **工具卡：** 搜索、计算、API 调用、数据清洗、文件读写
- **Prompt 模块卡：** 角色设定、输出格式要求、行业知识包、语气风格
- **输出契约卡：** 产出必须符合 JSON Schema，不合格自动返工
- **质检卡：** Gate 装备不同检测手段（正则规则、schema 校验、模型评判、人工审核）
- **MCP 工具卡：** 从 MCP server 自动发现的工具，跟内置工具卡用起来一样

### 不做的扩展机制

- 不做通用插件市场（早期）
- 不做钩子/中间件/lifecycle 拦截器
- 不开放自定义节点类型
- 不做运行时热加载（重启生效即可）
- 不做沙箱隔离（阶段 5 企业版才需要考虑第三方代码安全）

---

## 七、你可能还没想到的问题

### 1. 触发方式：不只是手动点派发

现在只能手动按"派发任务"。企业场景需要：

- **Webhook 触发：** 外部系统 POST 一个请求，自动启动一条产线（客服工单来了自动分类）
- **定时触发：** 每天早上 8 点自动跑日报产线（cron 表达式）
- **事件触发：** 一条产线完成后自动触发下游产线（产线间协作）
- **批量触发：** 一个 CSV 上传 1000 条商品，每条跑一遍详情页产线

这些是阶段 4-5 的功能，但事件流模型天然支持——每次运行有 runId，触发方式只是 run 的来源不同。需要预留的是 `runs` 表加一个 `trigger` 字段（manual / webhook / schedule / event）。

### 2. 人机协作（Human-in-the-Loop）

现在 `halt` 是终态，阶段 1 要加恢复命令。但企业场景需要更多人工介入点：

- **审批节点：** Gate 判定后不自动 pass/scrap，等人审核（现在的 onExhausted: "halt" 是雏形）
- **人工编辑：** Agent 产出后，人可以修改再交给下游（不只是 approve/reject）
- **人工选择路由：** 多个返工路径，人决定退到哪个厂房
- **@提醒：** 产线等人时发通知（邮件/飞书/钉钉）

这些是"质检员"和"班组长"，在工厂隐喻里有自然位置。不需要新节点类型，是 Gate 和 halt 的能力增强。

### 3. 产线版本管理与灰度

Graph 定义会变。跑过的产线用的是旧版本定义：

- 现在 `runs.snapshot` 已经存了运行时的 graph 快照，这是对的——回放能还原当时的产线
- 未来需要 graph 的版本历史：谁在什么时候改了什么、为什么改
- Prompt A/B 测试：同一个节点两个 prompt 版本，流量各 50%，比较合格率和成本
- 产线草稿 vs 已发布：编辑中的改动不影响正在跑的产线

这是阶段 3-4 的功能。数据模型上 graph 表加 version 字段，runs 表引用具体版本。

### 4. 评估体系（Eval）

企业客户会问："我怎么知道改了 prompt 后效果变好还是变差？"

- 每次 gate 的 pass/reject 率是天然的质量指标
- 返工次数（attempts）是效率指标
- 成本和耗时是经济指标
- 需要一个"回归测试集"：固定一批输入，跑新旧版本产线，对比合格率、成本、耗时
- 不需要引入外部 eval 框架——事件流里有全部数据，聚合查询即可

这是阶段 3 做完成本报表后的自然延伸，也是企业版卖点。

### 5. 错误处理的层次

现在只有 `node.failed` 一种失败。真实场景需要区分：

| 错误类型 | 处理方式 | 对应工厂概念 |
|---------|---------|-------------|
| 网络超时 | 自动重试（指数退避） | 设备临时故障，重启 |
| 限流 (429) | 排队等待，降速 | 电力不足，轮流开工 |
| Provider 500 | 重试 N 次后失败 | 设备坏了，报修 |
| 模型返回格式错 | 自动修正或返工 | 产品不合格，返工 |
| 内容审核拒绝 | 立即停线，人工介入 | 违禁品，安检查获 |
| API key 失效 | 停线，通知管理员 | 工人罢工了 |
| 预算耗尽 | power.tripped | 电费没了，拉闸 |

重试是技术故障恢复，返工是质量不合格——这两件事必须分开，不能混。AgentConfig 里需要 `retryPolicy: { maxRetries, backoffMs, retryOn: ErrorCode[] }`。

### 6. 安全与合规

- **API key 安全：** 本地文件存储，权限 600，不进日志不进事件流。企业版用 KMS/Vault
- **数据脱敏：** connector 拉到的数据在进入 LLM 前可能需要脱敏（手机号、身份证）。这是清洗工具卡的一种
- **输出安全：** sink 写回企业系统前需要确认没有敏感信息泄露。这是 gate 的质检卡
- **审计：** 事件流本身就是审计日志——谁在什么时候跑了什么产线、每个节点输入输出是什么、花了多少钱。企业版加 SIEM 导出
- **租户隔离：** 阶段 5 多租户时，数据隔离在数据库行级（tenant_id），不是不同数据库（小规模）或 schema（中规模）
- **不做的：** 不做端到端加密（那是基础设施层的事）、不做 DLP（那是企业安全团队的事，我们提供钩子）

### 7. 成本控制的精细化

现在只有全局预算上限。企业场景需要：

- **节点级预算：** 某个厂房最多花 $5，超了停这个节点而不是整条线
- **产线级预算：** 每次运行不超过 $2
- **月度预算：** 这个月总共不超过 $100
- **成本预警：** 到 80% 发通知，到 100% 跳闸（现在有跳闸没有预警）
- **缓存命中统计：** 多少 token 走了 prompt cache，省了多少钱
- **模型路由：** 简单任务用便宜模型，复杂任务用贵模型（技能卡配置）

事后计量的架构是对的，但需要多层预算和预警。

### 8. 可观测性：你已经有了最好的基础

事件流比任何外部 APM 都更懂这个系统：

- **实时：** SSE 推事件，卡车在动
- **回放：** fold prefix，拖时间轴
- **Diff：** attempt 1 vs attempt 2 逐字对比
- **成本：** 每次调用都有 usage
- **因果：** 事件顺序就是因果链

需要补的是聚合视图（阶段 3）：
- 过去 7 天跑了多少次、成功率、平均耗时、总成本
- 哪个节点最容易被返工、哪个节点最费钱
- 趋势：prompt 改动后合格率有没有提升

**不需要接 Datadog/New Relic/Langfuse。** 事件流是更好的领域专属可观测数据。但要在企业版加 Prometheus metrics endpoint（运维团队的标准需求）。

### 9. 测试策略

- **核心逻辑：** 纯函数，单元测试覆盖 compiler、reducer、graph validation（现在 13 个测试）
- **引擎：** 用假 worker 测调度逻辑、返工环、预算跳闸、取消（现在 6 个测试）
- **Worker：** 真实 provider 调用需要集成测试，标记为 `@integration`，不跑在 CI 里（要钱要网络）
- **端到端：** 阶段 1 真实 worker 接入后，用最便宜的模型跑一条最小产线做 smoke test
- **前端：** 画布逻辑（geometry、pathRegistry）可以单元测试，视觉交互靠手动验证
- **不做的：** 不追求 100% 覆盖率，不做前端组件快照测试

### 10. 部署形态演进

```
阶段 1-3：本地单机
  Node.js + SQLite 文件 + 本地浏览器
  pnpm dev 或 pnpm build && pnpm start

阶段 4：私有化部署
  Docker Compose: app + SQLite volume
  一个 docker-compose up 跑起来
  数据存在挂载卷里

阶段 5：企业私有化
  Docker Compose / Helm Chart
  Postgres + 对象存储 + Redis（可选）
  接企业 SSO、审计导出

阶段 5：SaaS 托管
  K8s + Postgres + Milvus + 对象存储
  多租户隔离、按量计费、高可用
```

不要一开始就做云原生架构。SQLite 单机能撑到几百个并发用户，在那之前没有瓶颈。

---

## 八、自我改进的边界

### 能做的

- 从历史运行中提取模式："过去 10 次质检驳回中，7 次因为缺少错误处理段落"
- 把成功案例和失败案例存入档案室，agent 装备"档案检索卡"后可查询参考
- 统计哪个 prompt 版本合格率更高，给人建议
- 自动生成复盘报告：本周跑了多少条、合格率、返工原因分布、成本趋势

### 不能做的

- Agent 自动修改自己的 prompt（不可审计，失控风险）
- 系统自动调整产线结构（人设计的流程不能让 AI 偷偷改）
- 自动"进化"技能（改了什么、为什么改说不清）
- 基于历史数据自动改 Gate 的判定标准（质量标准是人定的）

### 正确定位

系统提供**复盘报告和改进建议**，人决定是否采纳。这是工厂的"生产例会"——工程师看报表，决定要不要调整工艺。事件流的价值在于每一步有据可查，自动自改毁了这个价值。

---

## 九、商业化路径

### 路径一：企业定制化二次开发（最先能赚钱）

**优势：**
- 事件流是天然审计日志，金融/政务/制造客户最怕 AI 黑盒
- 返工环是真实业务流程抽象（写方案→审→打回→改），比 LangGraph 的任意 cycle 更贴合
- 游戏化界面在交付演示时是加分项
- SQLite + 单机起步比微服务好私有化部署

**目标客户：**
- 有明确重复性流程的企业：保险理赔初审、合同审查、内容生产、客服工单分级、招投标文档
- 已在试 Coze/Dify 但撞墙的团队
- 有私有化部署要求的客户

**卖法：** 不卖平台，卖一条跑通的产线 + 平台运行时授权。每做一个客户沉淀一条行业模板。

**风险控制：** 不为第一个客户改核心引擎。80% 需求收敛到模板+skill，20% 才写代码。阶段 2 结束前不接定制客户。

### 路径二：通用 SaaS 产品（最难，最后做）

这是 Dify、Coze、扣子、n8n 的战场，独立团队在通用赛道没有胜算。如果要做，唯一角度是"唯一让你看得懂 AI 在干什么的工具"，卖点是可控、可审计、可回放，游戏化是记忆点不是卖点。

建议作为开源后的自然延伸，不做主路径。

### 路径三：开源 + 商业（最适合的路径）

- **开源核心：** 引擎、画布、基础 worker、事件流、回放
- **卖企业版能力：** Connector 套件、企业级 MemoryBackend、RBAC/多租户/审计导出、SSO/LDAP、行业模板包、商业支持 SLA
- **卖托管服务：** 不想自己部署的人用云，按用量计费（事后计量和预算上限是计费地基）

**为什么最适合：** 架构天然适合开源（core 零依赖、事件流带版本、worker 可替换、SQLite 单机起步）；开源解决获客；企业客户主动来找企业版。

三条路径递进：前几个定制客户提供行业模板和资金，开源获客，企业版规模化收入。

### 模型分层与商业化（内置模型订阅制）

**两层模型，两类入口：**

| 层 | 用户视角 | 权限 |
|---|---|---|
| **内置模型（产品预置）** | 只能**选择**使用 | **只读**——不能改 baseUrl/apiKey/单价，订阅 gate 控制访问 |
| **用户自定义模型** | 自己**添加**自己的 provider/模型 | 完全自主，可增删改 |

**设计约束：**
- 内置模型和自定义模型在 UI 上是两种形态：内置只出「选择器」，自定义才有「增删改表单」
- 模板对模型的引用（如 `agnes-2.0-flash`）指向**内置模型命名空间**——用户无需配置、也无法配置它们
- 计费：内置模型走订阅 quota；自定义模型按用户自己的 key 计实际消耗
- 订阅 gate 属阶段 5「订阅套餐」待办（roadmap-tasks §14），**落地前内置真实模型不向普通用户暴露**（避免免费白嫖 LLM 成本）；阶段 5 前用户要用真实模型，走自定义模型入口

**当前实现对照：** `DEFAULT_CONFIG` 仅 demo/fake（纯本地占位、无订阅 gate）；用户自定义 provider 已落地（settings 表）；「内置真实模型 + 订阅 gate」未实现。

---

## 十、分类清单：做什么、什么时候做

| 时间 | 做什么 | 商业化状态 |
|------|--------|-----------|
| 现在→阶段 1 | 真实模型接入，自己每天用 | 不赚钱，验证产品 |
| 阶段 2 | 并行、技能卡、多产线、模板 | 可接第一个定制客户 |
| 阶段 3 | 可信运行、历史、成本、重连 | 定制交付的底气，敢签 SLA |
| 阶段 4 | Worker 插件化、文档、开源 | 开源发布，开始有人用 |
| 阶段 5 | 企业版能力、托管、多租户 | 企业版+托管+定制并行 |

---

## 十、分类清单：做什么、什么时候做

### 现阶段做（阶段 1：真能干活）

**技术基座：**
- 真实 provider worker 接入（Worker 接口是接缝，引擎不用大动）
- Worker 接口扩展应对工具调用和多轮（runAgent 返回值可能要从 string 变 artifact[]）
- API key 本地配置与存储（不进仓库，权限 600）
- 真实失败处理：超时、限流、provider 报错分类落到 node.failed
- 事件 schema 预留：packet.sent 加可选 artifactId/metadata，source 加可选 connector config，Usage 加 cachedTokens
- 节点级 retryPolicy（技术故障重试，区别于返工）

**用户功能：**
- 质检标准生效：inspector 加 criterion 输入框，judge 读它
- prompt 编辑刷新不丢（自动保存而非只在派发时存）
- halt 后能人工恢复继续
- 用真实模型跑通一条对自己有用的产线

### 不急着做但要留缝（只设计不实现）

- Packet/Artifact 分层（现在管道是 string，engine 内部 Map 未来换类型，事件保持兼容）
- Connector 接口（source 预留字段，不写实现）
- MemoryBackend 接口（事件流已记录一切，随时可加）
- Skill 注册机制（保持 string[]，想清楚未来承载工具/prompt 模块/输出契约/质检卡）
- 产线输入契约（source 未来声明 inputSchema，现在不做）
- runs 表加 trigger 字段（manual/webhook/schedule/event）
- 多模态输入（Worker 接口 input 未来从 string 变 Packet[]）

留缝方式：写在代码注释、PRD、本文档里，不写抽象层、工厂模式、配置文件。

### 后面做（按阶段）

**阶段 2（产线表达力）：**
- 并行分支调度 + 多入边汇合（Plan 从线性 order 变 levels，引擎按层并发）
- 技能卡 UI（skills 从 string[] 变成可装备卡片，含工具卡/prompt 模块/输出契约）
- 多产线管理：列表、新建、复制、命名、删除
- 产线模板（第一个模板：商品详情页）
- 节点级预算配置

**阶段 3（可信运行）：**
- 运行历史列表与详情（runs 表已有，加查询 API 和 UI）
- 成本报表：按产线/厂房/attempt/时间 拆分聚合
- 长跑断线重连（SSE 已有 Last-Event-ID，前端加自动重连）
- 结构化失败面板（错误分类、重试建议、一键返工）
- 成本预警通知（到 80% 提醒）
- 评估体系雏形：合格率/返工率/成本趋势聚合
- Packet/Artifact 分层：图片产物已落库与前端展示（imageGen→artifact），视频/音频产物仍为阶段 4

**阶段 4（开源准备）：**
- Worker 插件化：从改代码变成约定目录放文件
- Connector 第一个实现（文件 connector → HTTP API connector）
- MCP Client：MCP server 工具自动成为技能卡
- Artifact 存储抽象（本地文件系统 → S3 兼容）
- 多模态支持（图片/文件作为原料）
- 示例产线、文档（架构/扩展/贡献）、CI、首次启动引导
- Webhook 和定时触发（产线自动启动）
- Docker Compose 部署
- 人机协作增强：人工编辑产出、审批后继续

**阶段 5（商业化）：**
- MemoryBackend 真实实现 + 向量检索（档案室/知识库）
- 复盘报告与改进建议（人决策，系统不自动改）
- 企业数据库 connector 套件
- 多租户、RBAC、SSO/LDAP、审计日志导出
- 真实计费与配额（事后计量+预算上限是地基）
- 产线版本管理与 A/B 测试
- 回归测试集与对比评估
- 团队协作与产线共享
- Postgres/Milvus/对象存储/Redis 后端
- K8s Helm Chart、高可用
- Prometheus metrics endpoint

### 技术基座（实现方式，用户不直接感知）

| 技术 | 定位 | 什么时候用 |
|------|------|-----------|
| KV Cache | Worker 内部推理优化，用户无感 | 阶段 1 起，provider 自动处理 |
| Prompt Caching | Worker 层降本策略，公共 prompt 前缀放前面 | 阶段 1 worker 实现时考虑 |
| 向量数据库（Milvus 等） | MemoryBackend 的大规模存储后端 | 阶段 5，SaaS 场景 |
| sqlite-vec / pgvector | MemoryBackend 的中小规模存储 | 阶段 4-5 |
| SQLite | 单机/小团队主数据库 | 阶段 0-3 |
| Postgres | 企业级主数据库 | 阶段 5 |
| Redis | 缓存/限流/会话 | 阶段 5，有需要时 |
| 对象存储 | 大文件 artifact | 阶段 4 |
| Docker/K8s | 部署 | 阶段 4-5 |
| MCP 协议 | 工具接入标准 | 阶段 4 |
| SSE | 实时事件推送 | 阶段 0 已用 |
| WebSocket | 双向通信（协作场景） | 阶段 5，如果需要 |

### 不做

- 通用 ETL/数据清洗引擎（清洗是 agent 的 tool/skill，不是编排层独立模块）
- Agent 自动改自己的 prompt 或产线结构（系统只提建议，人决策）
- 通用节点类型扩展/插件系统（节点类型固定，变化通过 skill 承载）
- 全局统一数据模型（每条产线有自己的输入契约 schema）
- 自研编排框架跟 LangGraph 竞争（core 是内部引擎不是对外 SDK）
- 对话型产品（实时客服、聊天机器人、语音助手——不是流水线）
- 任意低代码自动化平台（那是 n8n/Make 的赛道）
- 技能树付费墙
- 账号/权限/订阅/协作光标（阶段 5 之前不写）
- 为未来设计的抽象层（等有第二个真实需求再抽象）
- 微服务拆分（单体直到证明需要拆）
- 端到端加密、DLP（基础设施和企业安全团队的事，提供钩子不自己做）
- 100% 测试覆盖率、前端快照测试

---

## 十一、一句话总结

**不要做"能实现任何需求的虚拟公司"，做"一条你能看着它运转的 AI 生产线"。**

原料进去，成品出来，每一步看得见、查得到、改得了。先做一条产线帮人省时间，然后十条，然后产线之间开始互相喂料——那时候就有了"公司"，但它是长出来的，不是设计出来的。

技术只是入场券。事件流是比任何竞品 trace 系统都更有价值的黑匣子——它是实时状态、是回放时光机、是审计日志、是档案室的数据源、是自我改进的原料。这一个设计决策撑起了可观测性、可信运行、知识沉淀和商业化合规四件事。

阶段 1 先把真实工人接进来，让工厂真正能出活。其他的，架构留缝，实现延后。
