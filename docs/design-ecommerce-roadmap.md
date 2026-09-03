# 自媒体电商方向：流水线编排能力升级落地方案

> 面向：agent-world（core / server / web 三层 pnpm monorepo）
> 范围：自媒体电商内容生产方向（其他行业后续另议）
> 原则：先盘点现有能力，只补真实缺口；每个特性给出 core / server / web / DB / 迁移 / 工作量，可直接据此拆任务。

---

## 0. 现有能力盘点（避免重复造轮子）

读完 `packages/core/src/graph.ts`、`events.ts`、`packages/server/src/engine.ts`、`ab.ts`、`db.ts` 后确认，下列能力**已经存在**，新方案必须复用而非重建：

| 能力 | 现状 | 关键位置 |
|---|---|---|
| 人工节点 | `human` 节点可暂停 run，支持 approve/edit/reject，`POST /api/runs/:id/resume` | `graph.ts` HumanConfig；`events.ts` human.review/decision；`index.ts:1247` |
| 运行级 A/B 多变体 | 克隆图、替换单个 textGen 节点 prompt、每个 arm 起独立 run，共享 ab_group | `ab.ts` buildABVariants/startABExperiment；`/api/runs/ab`、`/api/ab/:groupId` |
| 扇入聚合 | `parallel` 节点 = 屏障，等所有前驱完成后聚合成 object/array | `graph.ts` ParallelConfig |
| 遍历 | `loop`（对数组逐元素跑下游子图并汇总）、`map`（JSON 映射 + iterate） | `graph.ts` LoopConfig/MapConfig |
| 条件路由 | `branch` 节点（有序规则 + defaultTarget） | `graph.ts` BranchConfig |
| 批量触发 | trigger 支持 `batch`，数据源 csv / rows | `graph.ts` TriggerConfig.batch |
| 电商字段 | source 节点已有 productName/brand/audience/priceRange/tone/prohibited/brandTerms | `graph.ts` SourceConfig |
| 违禁词 | source.prohibited（手填词表）；gate.minBrandCoverage（品牌词覆盖率） | `graph.ts` SourceConfig/GateConfig |
| 质检 | `gate` 节点：maxAttempts/criterion/minScore/onExhausted + rework 回退边 | `graph.ts` GateConfig |
| 成本 | node_runs.cost_usd 逐节点计量，`/api/costs`、`/api/costs.csv` | `db.ts` node_runs；`index.ts:819` |
| 品牌词库 | brand_terms 表 + CRUD API | `db.ts:93`；`/api/brand-terms` |
| 通用外呼 | `http` 节点（带 SSRF 防护）、`notify`（飞书/钉钉/企微/Slack/邮件）、`vcs`（GitHub/GitLab） | `graph.ts` |
| 子流程 | `subprocess` 节点可调用另一条图 | `graph.ts` SubprocessConfig |
| 定时 | `cron` 触发器 + scheduler | `triggers.ts`、`cron.ts` |

**结论：真正的缺口集中在四处**——① run 内并行多变体与自动择优（现有 A/B 是 run 级、只换 prompt、无自动选择）；② 跨 run 的审核/批量/日历等"运营态"工作台；③ 商品与素材的一等公民数据实体；④ 效果数据回流与内容级成本。下文 10 个特性按此补齐。

---

## 0.5 节点策略：新增、衍生还是平台层（先控制节点数量）

每提一个能力先过这三条，避免节点面板被行业功能堆满：

1. **执行语义变了**（调度方式、输入输出契约不同）→ **新增节点**；
2. **只是同一职责多几个配置项**（参数化）→ **扩展现有节点 config**（GraphNode 是"一个 kind 对应一个可选 config"，`graph.ts:856`，扩展=加枚举值/加 XxxConfig，不动调度）；
3. **跨节点的数据、运营状态、聚合、界面** → **不做节点**，落到"数据表 + API + 工作台 UI"。

按此原则，本期 10 个特性**只新增 4 个节点**：

| 归类 | 特性与落点 |
|---|---|
| 新增节点（4） | `fanout`、`select`（F1，**通用流程控制，非电商专属**）；`compliance`（F3）；`publish`（F7） |
| 衍生扩展（不加节点） | F4 给 source 的 ConnectorType 加 `"product"`；F2 原样复用 `human`；F5 复用 `loop`/`batch` 触发器 |
| 平台层（非节点） | F2 审核队列、F4 商品库、F5 批次、F6 指标、F8 日历、F9 成本、F10 画布 |

三个"为什么不并进现有节点"的边界（防止实现时走回头路）：

- **select ⊄ parallel**：parallel 是纯屏障聚合（只有 asObject/pick，到齐原样合并）；select 还要调裁判模型打分、排序、取 TopK、支持人工勾选，输出契约不同。
- **compliance ⊄ gate**：gate 是 LLM 主观裁判 + rework 回环（只判过/不过）；compliance 是确定性规则（词表/字数/标签/比例）且**产出一份改写后的 sanitized 文本**。二者串联（compliance 洗稿 → gate 质检），不合并。
- **publish ⊄ sink/http/notify**：sink 是零配置的纯终点标记（GraphNode 中无 sink config）；http 是裸调用、notify 是 IM/邮件；publish 需要平台适配器与发布状态机，独立成节点。

---

## 特性总览与依赖

```
阶段0（差异化引擎根基）
  F1  run 内多变体生成 + 自动择优  ──┐
  F10 fan-out/fan-in 画布体验     ──┴─ 共用 fanout/select 节点，一起做

阶段1（生产提效，快赢）
  F2  人工审核队列（纯增量 UI，引擎已就绪）
  F3  平台适配与合规校验（平台 profile + 违禁词库 + 新节点）

阶段2（规模化）
  F4  商品库 / 品牌素材库（数据实体 + CRUD + 导入）
  F5  批量任务编排（依赖 F4 的行数据模型，但可先独立跑 CSV）

阶段3（运营闭环）
  F7  发布集成（先做"导出包"，再做开放 API 渠道）
  F8  内容日历（依赖 F7 状态，可先只排期不自动发）
  F6  效果数据回流（依赖 F7 拿外部内容 id，也可手填）
  F9  内容级成本归因（依赖 F1 变体 / F5 批量的维度）
```

| ID | 特性 | 类型 | 工作量 | 依赖 |
|---|---|---|---|---|
| F1 | run 内多变体 + 择优 | core+server+web | **大** | — |
| F10 | fan-out/fan-in 画布 | web（少量 core） | 中 | F1 |
| F2 | 人工审核队列 | server+web | 小 | — |
| F3 | 平台适配/合规 | core+server+web | 中 | — |
| F4 | 商品库/素材库 | server+web+DB | 中大 | — |
| F5 | 批量任务 | server+web+DB | 中大 | (F4) |
| F7 | 发布集成 | core+server+web | 小→大（分阶段） | — |
| F8 | 内容日历 | server+web+DB | 中 | (F7) |
| F6 | 效果回流 | server+web+DB | 中 | (F7) |
| F9 | 内容级成本 | server+web | 小中 | F1/F5 |

---

# 阶段 0：多变体引擎（F1 + F10）

## F1　run 内多变体生成 + 自动择优

### 现状与缺口
- 现有 A/B（`ab.ts`）：**run 级**，一次实验 = N 个独立 run，只能替换单个 textGen 节点的 prompt，变体之间无法在同一条图里汇聚、打分、自动选优；对比要靠 `/api/ab/:groupId` 外部轮询。
- `parallel` 只做"扇入"，没有"扇出"；要出 3 版文案得手工摆 3 个 textGen。
- `node.finished` 只有单个 `output`；`artifacts`/`node_runs` 的主键是 `(run_id,node_id,attempt)`，**没有 variant 维度**。

### 目标
在**同一个 run** 内：一个 `fanout` 节点把 1 份输入复制成 N 个变体，下游子图对每个变体独立执行（可不同 prompt / 温度 / 模型），一个 `select` 节点汇聚并按"LLM 打分 / 规则 / 人工"选出 TopK，后续节点只处理选中项。

### Core 变更（`packages/core/src`）

**1) NodeKind 增加两个节点**（`graph.ts:9`）：
```ts
"fanout", "select",
```
并在 `NODE_CATEGORY` 归入 `control`（车间调度）。

**2) 新增配置 schema**：
```ts
// 变体来源：不同 prompt / 不同采样参数 / 不同模型
export const FanoutConfig = z.object({
  count: z.number().int().min(2).max(8).default(3),
  strategy: z.enum(["prompt", "temperature", "model"]).default("prompt"),
  // strategy=prompt：N 段提示词（长度需=count）；为空时由引擎自动生成差异化角度
  prompts: z.array(z.string()).optional(),
  // strategy=temperature：在同一 prompt 上用这些温度各跑一次
  temperatures: z.array(z.number().min(0).max(2)).optional(),
  // strategy=model：N 个模型 id
  models: z.array(z.string()).optional(),
  // 自动生成变体角度时给 LLM 的指令（strategy=prompt 且 prompts 为空）
  angleBrief: z.string().default(""),
});
export type FanoutConfig = z.infer<typeof FanoutConfig>;

export const SelectConfig = z.object({
  mode: z.enum(["llm_score", "rule", "human"]).default("llm_score"),
  topK: z.number().int().min(1).max(8).default(1),
  // llm_score：打分标准（喂给裁判模型），返回 0-10 与理由
  rubric: z.string().default(""),
  model: z.string().optional(),
  // rule：规则排序字段与方向（长度、关键词覆盖率、数值字段）
  rule: z.object({
    field: z.enum(["length", "brandCoverage", "jsonPath"]).default("length"),
    path: z.string().optional(),
    desc: z.boolean().default(true),
  }).optional(),
  // human=true 时，select 表现为 human 节点：暂停等待操作者在 N 个变体里勾选
  passThroughAll: z.boolean().default(false), // true=不筛选，带分数全部下传
});
export type SelectConfig = z.infer<typeof SelectConfig>;
```

**3) 事件加可选 variant 维度**（`events.ts`）。给 `NodeRunKey` 增加可选字段，保持向后兼容（缺省即"主路径"，旧 run 解析不受影响）：
```ts
export const NodeRunKey = z.object({
  nodeId: z.string(),
  attempt: z.number().int().min(1),
  variant: z.string().optional(),   // 变体标识，如 "v1".."vN"；主路径为 undefined
});
```
- `node.started/node.delta/node.finished/node.failed/artifact.produced/packet.sent` 都随 NodeRunKey 自动带上 variant。
- 新增两个事件：
```ts
{ type: "variants.spawned", nodeId, variantIds: string[] }          // fanout 产生 N 条 lane
{ type: "variants.ranked",  nodeId, ranking: Array<{variant,score,reason}> , chosen: string[] } // select 结果
```
- `EVENT_SCHEMA_VERSION` 保持 1（仅新增可选字段与新联合成员，属于兼容演进）；若担心旧 reducer，可在 reducer 侧对未知事件做 no-op（现有架构本就如此）。

### Server / 引擎变更（`packages/server/src/engine.ts`）

这是本特性**唯一的硬骨头**。当前调度按"前驱完成 → 节点就绪"，执行身份是 `(nodeId, attempt)`。引入变体后执行身份变为 `(nodeId, variant, attempt)`：

1. **变体作用域传播**：fanout 完成时，对其每条出边发射 N 个 packet（各带一个 variantId）。下游节点在收到带 variant 的 packet 后，以该 variant 作为自己的执行作用域；同一节点对不同 variant 各执行一次。
2. **作用域汇合**：select（以及现有 parallel）等待**同一 variant 集合到齐**。fanout→select 之间的子图形成 N 条"变体泳道"，泳道内沿用现有拓扑，泳道间并发（引擎本就并发调度独立路径）。
3. **select 之后收敛回主路径**：select 输出选中 variant 的内容，出边 packet 不再带 variant（或只带 chosen 标记），下游恢复单路执行。
4. **compile.ts 校验增强**：fanout 出边必须最终汇到一个 select（或显式 sink）；不允许变体 lane 漏接；select 的前驱必须处于同一 fanout 作用域。在 `compile()` 里新增结构性校验，给出明确中文报错（沿用现有 ErrorCode.VALIDATION）。
5. **llm_score 打分**：select 复用现有 LLM 调用通道（与 gate 裁判同一套 worker），要求模型对每个变体返回 `{score, reason}` JSON，做容错解析（解析失败回退规则排序并记录 warning）。
6. **持久化**：`node_runs`、`artifacts` 增加 `variant TEXT` 列（见下），写入时带上；读回/replay 按 variant 分组。

> 备选轻量方案（若不想动调度器）：把 fanout 实现为"内部起 N 个 sub-run"（复用 ab.ts 的克隆思路），select 等 N 个 sub-run 结束。优点是改动小，缺点是变体不是真并行在同一事件流、replay/成本聚合更绕。**推荐主方案（作用域传播）**，备选作为时间不够时的降级，二者 schema 一致，可后补。

### 失败语义（防 silent-success，必须与调度器改造同批落地）

本引擎历史上集中爆发过"把失败记成成功"的缺陷类，2026-09 狗粮验证期间连扫四轮同类：mediaGen 生成失败标 done（`b6de7d9`）、generic 四模态静默跳过（`5d76cc5`）、六个媒体分支空结果当成功（`2797011`）、imageGen 抛错被"降级"吞掉（`a633989`）、空补全当成功（`0a22653`）、fan-in 失败上游导致 merge 永不调度而 run 报 done（`e6dc2c9`）、human approve 后整条尾巴未调度却报 done（`44c3260`）。**共性教训：每多一条并发/分支路径，就多一种"缺了一条路也装作跑完"的机会，且失败路径零覆盖时全量测试会一路绿灯把它们 shipped。** 变体泳道正是新增的一个并发维度，因此 F1 必须与调度器同批落地以下语义与测试，否则会把这个缺陷类原样复刻到高一层维度：

1. **lane 隔离失败**：某变体 lane 内节点失败（重试耗尽后）只终结该 lane——发带 variant 的 `node.failed`，其余 lane 继续执行，不受影响。
2. **select 等待全终态**：select 必须等作用域内**所有** lane 到达终态（done / failed / skipped）才能裁决；禁止"少一条 lane 也提前起跑"（同 `e6dc2c9` fan-in 静默丢弃一类），失败 lane 要在 `variants.ranked` 事件里显式计数。
3. **部分存活与全军覆没**：存活 lane ≥1 但 < topK → 按存活数择优并在事件里记录 warning；**全部 lane 失败 → select 节点 failed**（错误码聚合自 lane 失败原因），禁止把"空集合择优出 0 条"吞成 done（同 `2797011` 空结果当成功一类）。
4. **lane 内 rework/retry 只重跑本 lane**：gate rework 边与节点重试作用于 `(nodeId, variant, attempt)` 组合，不波及兄弟 lane。
5. **human 模式要看得见失败 lane**：mode=human 时失败 lane 不进勾选列表，但审核面板必须展示其失败状态与原因——操作者应感知"N 选 N-1、1 条已失败"，而不是无声少一条。
6. **replay/持久化按 variant 去重**：reconstructState 按 `(nodeId, variant)` 分组合成；node_runs / artifacts 写入带 variant（缺省 `'main'`）。防止兄弟 lane 产物互相覆盖（artifact 主键冲突吞行的坑已踩过，见 2026-08-31 落库双 bug）。
7. **专项测试（引擎级，每条断言真实终态，全部进回归基线）**：单 lane 失败其余照常出产物 / 全 lane 失败 select 报 failed / 存活 < topK 时禁止提前裁决 / lane 内 rework 不波及兄弟 / 变体事件 replay 不吞产物 / human 模式展示失败 lane。

### DB 迁移（`db.ts`，走现有 schema_migrations 机制）
```sql
ALTER TABLE node_runs ADD COLUMN variant TEXT;
ALTER TABLE artifacts  ADD COLUMN variant TEXT;
-- 复合主键需重建表（SQLite 改主键流程：建新表→拷贝→drop→rename，db.ts 已有迁移范式）
-- node_runs 新主键 (run_id, node_id, attempt, variant)，variant 缺省填 'main'
CREATE INDEX idx_artifacts_variant ON artifacts(run_id, node_id, variant);
```
旧数据 variant 统一为 `'main'`，查询行为不变。

### Web 变更（`apps/web/src`）
- 节点面板新增"扇出/择优"两个节点（与 F10 一起做）。
- **变体对比视图（核心亮点）**：run 详情里，select 节点处并排展示 N 个变体卡片（内容、分数、理由），支持人工点选覆盖自动结果（对应 mode=human 或运行时 override）。
- run 状态树按 variant 分组渲染（同一节点的 N 个变体结果可切换/并排）。
- 事件 reducer（`store/run.ts`）识别 variant 维度。

### 迁移与兼容
- 无 fanout/select 的旧图：variant 永远缺省，执行路径、事件、成本完全不变。
- 旧 run 回放：缺 variant 字段按 'main' 处理。
- A/B（run 级）保留不动，作为"跨整条图对比"的工具，与 run 内变体互补。

### 工作量
大（引擎调度器 + 事件模型 + 持久化 + 对比 UI）。建议拆：①schema/事件 ②引擎作用域（**含上节失败语义与专项测试，不可后补**）③select 三种模式 ④DB 迁移 ⑤对比 UI，各自独立提交。

---

## F10　fan-out / fan-in 画布编排体验

### 现状与缺口
`parallel` 已有扇入语义，但用户要手工摆 N 条并行支路，连线繁琐，且画布没有"泳道"概念，变体一多就乱。

### 设计（与 F1 共用节点，主要是 web 工作）
1. **自动泳道布局**：fanout 节点在画布上渲染为"分叉口"，下游自动纵向展开 N 条 lane，select 渲染为"汇聚口"；自动布局（现有画布布局算法）对 lane 内保持拓扑、lane 间等距平行。
2. **连线辅助**：从 fanout 拉线到第一个节点时，提供"为所有变体复制此支路结构"的快捷操作（自动镜像节点与连边，再由用户改各 lane 参数）。
3. **折叠/展开**：变体泳道可整体折叠成一张"变体组"卡片，减少视觉噪音。
4. **校验可视化**：compile 报"变体 lane 漏接"时，在对应 fanout/select 上红框高亮并定位。

### Core
仅复用 F1 的两个节点与 compile 校验，不新增数据模型。

### 工作量
中（画布交互/自动布局为主）。**必须与 F1 同阶段交付**，否则能力不可用。

---

# 阶段 1：生产提效

## F2　人工审核队列（Review Queue）

### 现状与缺口
`human` 节点与 resume API 已完备，但操作者只能"进到某一条 run 里"审核；跨产线、跨 run 的待审事项没有统一入口，也不能批量处理。这是**纯增量、最快见效**的一项。

### Server
新增聚合接口（`index.ts`）：
```
GET  /api/reviews/pending?status=halted
     → 聚合 runs.status='halted' 且 halted_node_id 非空的记录，
       每条带 graphName、nodeId、human.review.content、等待时长
POST /api/reviews/decide
     body: [{ runId, action: "approve"|"reject"|"edit"|"scrap", editOutput? }]
     → 内部循环调用现有 resume 逻辑，支持批量通过
```
复用 `POST /api/runs/:id/resume` 的内核，抽一个 `decideRun(db, worker, runId, action, editOutput)` 供两处调用。runs 表需能按 halted 过滤（已有 status、haltedNodeId 存在 snapshot/finished 事件中；建议给 runs 增列 `halted_node_id` 便于索引，迁移成本低）。

### Web
- 新增 `ReviewQueue.tsx` 页面/抽屉：待审列表（产线、节点、内容摘要、等待时长排序）、内容预览、快捷键 A 通过 / R 驳回 / E 编辑、批量勾选通过。
- 顶部导航加"待审核 (n)"角标，轮询/SSE 复用现有 run stream。
- human 节点在画布暂停时脉冲高亮，点击直达审核面板。
- 可选：审核结果接 `notify` 节点，待审时推飞书/钉钉。

### 兼容
不改图结构、不改引擎，纯新增页面与聚合接口。

### 工作量
小。

---

## F3　平台适配与合规校验

### 现状与缺口
source.prohibited 是**每次手填**的词表，gate 只查品牌词覆盖；没有"平台规则"概念（淘宝标题 60 字、小红书正文 1000 字 + 话题标签、抖音文案长度/话题、主图比例等），也没有内置广告法极限词库和一键修复。

### Core（`graph.ts`）
1) 新增平台 profile 类型与内置常量（新文件 `packages/core/src/platforms.ts`）：
```ts
export const PlatformId = z.enum(["taobao","xiaohongshu","douyin","wechat","custom"]);
export const PlatformProfile = z.object({
  id: PlatformId,
  titleMax: z.number(), bodyMax: z.number(),
  hashtag: z.object({ prefix: z.string(), max: z.number() }), // 小红书 "#"、抖音 "#话题"
  imageRatios: z.array(z.string()),                          // ["3:4","1:1"]
  bannedWords: z.array(z.string()).default([]),              // 平台特有违禁词
  required: z.array(z.string()).default([]),                 // 必含要素
});
```
内置一份可迭代维护的默认 profile + 一份《广告法》极限词/常见违禁词表（国家级公开监管词，如"最/第一/国家级/特效"等，标注来源与更新时间）。

2) NodeKind 新增 `compliance`（归 data 或 control，建议 control 质检链路）：
```ts
export const ComplianceConfig = z.object({
  source: z.string().optional(),        // 默认单前驱
  platform: PlatformId.default("xiaohongshu"),
  extraBanned: z.string().default(""),  // 用户补充，逗号/换行分隔
  autoFix: z.boolean().default(true),   // 自动产出修复版
  failOnViolation: z.boolean().default(false), // true=有违规即走 error 边
});
```
输出 JSON artifact：
```json
{ "passed": false,
  "violations": [{ "type":"banned|length|hashtag|ratio", "match":"最佳", "span":[12,14], "rule":"广告法极限词", "suggest":"非常出色" }],
  "original": "...", "sanitized": "..." }
```
autoFix 产出 sanitized 文本供下游使用；也可串到 gate（failOnViolation 时回退重写）。

### Server
- 合规检查是纯函数，放 core 便于单测；server 只负责执行与持久化。
- 用户自定义违禁词：复用 brand_terms 模式新建 `banned_terms` 表（user 级补充词库），运行时与内置词库合并。
- API：`GET /api/platforms`（返回 profile 与内置词表元信息）、banned_terms CRUD（仿 brand-terms）。

### Web
- compliance 节点 Inspector：选平台、显示该平台规则、补充词表、开关 autoFix。
- 结果渲染：违规片段**高亮标注**（不同类型不同色）、逐条采纳建议、"一键全部修复"。
- 产物侧显示"平台适配度评分"与字数/标签/比例达标情况。
- 新建产线选模板时可预设目标平台（模板里带 compliance 节点）。

### 兼容
新节点，不使用则无任何影响；内置词表作为静态常量随包发布，可后续热更新。

### 工作量
中（核心是词表整理与规则引擎，逻辑不复杂但要细致）。

---

# 阶段 2：规模化

## F4　商品库 / 品牌素材库

### 现状与缺口
source 节点的商品字段是**单次手填**，database 节点能查 SQLite 但对用户不友好，没有"可复用商品目录"和"品牌素材库"这两个一等公民实体。批量生产 N 个商品内容时无法复用。

### DB 新表（`db.ts`）
```sql
CREATE TABLE products (
  id TEXT PRIMARY KEY, user_id TEXT,
  sku TEXT, name TEXT NOT NULL, brand TEXT, category TEXT,
  price REAL, attributes_json TEXT,       -- 规格/卖点/参数等灵活字段
  images_json TEXT,                       -- ["uri",...]
  status TEXT NOT NULL DEFAULT 'active',  -- active/archived
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_products_user ON products(user_id, status);

CREATE TABLE brand_assets (
  id TEXT PRIMARY KEY, user_id TEXT,
  type TEXT NOT NULL,                     -- logo|image|font|snippet|guideline
  label TEXT NOT NULL, uri TEXT,
  tags TEXT, created_at INTEGER NOT NULL
);
```

### Server
- `/api/products` CRUD + `POST /api/products/import`（CSV/Excel，复用 `parse-file.ts`；列名映射到字段，返回成功/失败行报告）+ `GET /api/products/export`。
- `/api/brand-assets` CRUD + 复用现有 `/api/artifacts/upload` 存文件。
- **接入投料**：`ConnectorType`（graph.ts:735）增加 `"product"`：
```ts
ProductConnector = z.object({ productIds: z.array(z.string()).optional(), selection: z.enum(["manual","filter","all"]).default("manual"), filter: z.record(z.string()).optional() });
```
source 节点选 product 连接器后，运行时把商品字段映射进现有 SourceConfig（productName/brand/images/notes），**下游节点零改动**。

### Web
- 新增 `ProductLibrary.tsx`：表格（搜索、分类筛选、状态筛选、批量选择/归档）、编辑抽屉、CSV 导入向导（字段映射预览、错误行提示）、图片缩略图。
- `BrandAssets.tsx`：素材网格、标签、复用插入。
- source 节点 Inspector 增加"从商品库选择"（替代手填，选中后回填字段，仍可手动覆盖）。

### 兼容
现有手填字段与 file/http/form/database 连接器全部保留；商品库是可选数据源。

### 工作量
中大（CRUD + 导入导出 + 两个管理页），但模式高度复用现有 brand_terms / artifacts，无技术风险。

---

## F5　批量任务编排（Batch Jobs）

### 现状与缺口
`loop` 节点和 `batch` 触发器已有底层零件，但缺端到端体验：上传一份商品表 → 每行跑一次产线 → 在一个面板里看每行成功/失败/产物 → 导出。现在每行 run 彼此孤立，没有"批次"概念，失败行无法单独重跑。

### DB 新表
```sql
CREATE TABLE batch_jobs (
  id TEXT PRIMARY KEY, user_id TEXT, graph_id TEXT NOT NULL,
  status TEXT NOT NULL,           -- pending|running|done|partial|failed|cancelled
  total INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
  source_name TEXT, created_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE TABLE batch_items (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL,
  row_index INTEGER NOT NULL, input_json TEXT NOT NULL,
  run_id TEXT, status TEXT NOT NULL,       -- pending|running|done|failed
  output_summary TEXT, artifact_ids_json TEXT, error TEXT,
  FOREIGN KEY(batch_id) REFERENCES batch_jobs(id)
);
CREATE INDEX idx_batch_items_batch ON batch_items(batch_id, row_index);
```
runs 表加列 `batch_id TEXT`、`batch_item_id TEXT` 便于反查。

### Server
- `POST /api/batches`：上传 rows（CSV/手工粘贴/从 F4 商品库勾选）+ graphId + 并发上限（默认 2，防 API 限流），创建 batch_job，逐行起 run（复用 `execute`，input 注入行数据，变量 `${row.字段}`）。
- `GET /api/batches`、`GET /api/batches/:id`（含 items 与产物指针）、`POST /api/batches/:id/cancel`、`POST /api/batches/:id/items/:itemId/retry`（只重跑失败行）。
- 调度器维护一个简单并发队列（p-limit 风格，避免 N 行同时打爆模型额度），逐 item 更新状态；run 结束回调写回 item。
- 与现有 `batch` 触发器统一：手动批量走本 API，定时批量走 trigger，共用行注入逻辑。

### Web
- `BatchManager.tsx`：批次列表（进度条、成功/失败数、耗时、状态筛选）。
- `BatchDetail.tsx`：每行状态表（行输入摘要、状态、产物缩略、错误、单行重跑）、整体导出（CSV 汇总 + 产物打包 zip，复用 artifact-store）。
- 新建 run 的入口旁加"批量运行"，引导选商品/上传 CSV。

### 兼容
单条手动 run 路径不变；批次是 run 的上层分组。

### 工作量
中大。可先脱离 F4、直接用 CSV 跑通，再接商品库选择器。

---

# 阶段 3：运营闭环

## F7　发布集成（务实分三阶段）

### 现实约束（先讲清楚，避免踩坑）
淘宝/小红书/抖音**没有面向个人的免费内容发布开放 API**：官方开放平台多需企业/商家资质且接口范围受限；第三方模拟上传属于灰色地带、有封号与合规风险。因此不能承诺"一键自动发到小红书"。按可落地程度分阶段：

**阶段 A（本方案推荐先做，低风险）——平台化导出包**
- 新增 `publish` 节点（NodeKind，归 integrations）：按选定平台 profile（复用 F3）把上游产物整理成"待发布包"——标题、正文、话题标签、按比例裁好的图片清单、复制按钮 / 下载 zip；输出 `uri`/`json` artifact 并标记 `ready_to_publish`。
- 价值：人工到各平台粘贴时零排版成本，且保证合规（与 F3 联动）。
- 工作量：小。

**阶段 B（对接真正开放的渠道）**
- 优先支持有正规 API 的：微信公众号草稿箱、Shopify/独立站商品 API、企业飞书/钉钉审核流、Webhook 到自建中台。
- 抽象 `Publisher` 适配器接口（provider/action/token，模式对齐现有 vcs/notify，token 走同一套加密），新增 `publish_targets` 表存渠道配置。
- 工作量：中（每个适配器独立增量）。

**阶段 C（浏览器/RPA 自动化）**
- 单独评估合规与稳定性，默认不做；如做需显式风险提示、用户自备账号、限速。
- 工作量：大且持续维护。

### 配套数据
```sql
CREATE TABLE publish_targets (id TEXT PRIMARY KEY, user_id TEXT, platform TEXT, name TEXT, config_encrypted TEXT, created_at INTEGER NOT NULL);
CREATE TABLE published_contents (
  id TEXT PRIMARY KEY, user_id TEXT, graph_id TEXT, run_id TEXT, artifact_id TEXT,
  platform TEXT, status TEXT,              -- ready|submitted|published|failed
  external_id TEXT, external_url TEXT, published_at INTEGER, detail_json TEXT
);
```

### 工作量
A 小 / B 中 / C 大（带风险）。

---

## F8　内容日历（Content Calendar）

### 现状与缺口
只有 cron 定时触发，没有"内容排期视图"和"内容状态机"，运营无法按周/月规划"哪天哪个平台发什么"。

### DB
```sql
CREATE TABLE content_plan (
  id TEXT PRIMARY KEY, user_id TEXT,
  graph_id TEXT, run_id TEXT, artifact_id TEXT,
  platform TEXT, title TEXT,
  scheduled_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft|pending_review|scheduled|published|failed
  published_url TEXT, note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_content_plan_time ON content_plan(user_id, scheduled_at);
```

### Server
- `/api/plan` CRUD；到 scheduled_at 由现有 scheduler（cron.ts）触发：若产物已就绪则走 F7 发布/标记，未就绪则自动跑产线生成。
- 状态机联动 F2（pending_review 进审核队列）与 F7（published 回写 external_url）。

### Web
- `CalendarView.tsx`：周/月视图、拖拽改期、状态色、平台图标；`PlanDrawer` 绑定产线/产物/平台/时间。
- 与审核队列、批量任务在导航上组成"运营工作台"。

### 兼容与依赖
纯增量；可先只做"手动排期 + 提醒"，自动发布待 F7-B。

### 工作量
中。

---

## F6　效果数据回流（Performance Feedback）

### 现状与缺口
完全没有效果数据；内容发出去后，曝光/点击/转化/GMV 无法回流，也就无法判断哪条产线、哪个变体、哪种提示词真正有效，闭环断在最后一步。

### DB
```sql
CREATE TABLE content_metrics (
  id TEXT PRIMARY KEY, user_id TEXT,
  graph_id TEXT, run_id TEXT, node_id TEXT, variant TEXT, artifact_id TEXT,
  product_id TEXT, platform TEXT, external_content_id TEXT,
  impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0, gmv REAL DEFAULT 0, ad_spend REAL DEFAULT 0,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX idx_metrics_content ON content_metrics(artifact_id, recorded_at);
```

### Server
- `POST /api/metrics`（单条手填 / CSV 批量导入 / 预留 webhook 供外部中台回传）。
- 关联链：artifact →（F7）external_content_id → 指标；支持按 run/node/variant/product 聚合 CTR、CVR、ROI。
- `GET /api/performance`：多维聚合（按产线、按变体 arm/variant、按商品、按平台、按时间）。
- **远期优化闭环**（先只采集，不急于做）：把高表现内容沉淀为 few-shot 示例或 gate 评分基线（与 knowledge 模块打通）。

### Web
- `PerformanceDashboard.tsx`：内容效果表 + 漏斗（曝光→点击→转化）+ 按变体/模板对比（直接呼应 F1 的择优：用真实 CTR 验证裁判模型打分是否靠谱）。
- 手工录入弹窗、CSV 导入、与 run/产物详情互跳。

### 兼容与依赖
纯增量；external id 依赖 F7，但允许手动填写外部链接/编号先跑起来。

### 工作量
中。

---

## F9　内容级成本归因（Unit Cost & ROI）

### 现状与缺口
成本已按 run/node 计量（node_runs.cost_usd），但一次批量产出 N 条内容、或一次 run 内 N 个变体时，无法回答"这条商品文案花了多少钱""哪个变体 ROI 最高"。

### 设计（以聚合为主，改动小）
- 借助 F1 的 variant 维度与 F5 的 batch_item 维度，把 node_runs 成本按内容单元归集：
  - 单条内容成本 = 该内容经过的所有 (node, variant) 成本之和；
  - 批量场景按 batch_item 汇总；
- `/api/costs` 增加 `groupBy=run|node|variant|batchItem|product` 参数与对应导出 CSV。
- 与 F6 联动算 **内容 ROI = gmv / 内容成本**、**单次合格产出成本**（被 gate 打回的重写成本也计入，反映真实良品成本）。

### Web
成本报表增加"按内容/商品/变体"维度视图，与 Performance 页共用筛选器。

### 兼容
现有 run/node 维度报表保留，新维度是额外聚合。

### 工作量
小-中（SQL 聚合 + 前端视图）。

---

# 落地路线图（建议顺序）

| 里程碑 | 内容 | 交付后用户可感知的价值 |
|---|---|---|
| **M1 引擎差异化** | F1 + F10（含 DB 变体迁移、对比 UI） | 一次出 N 版并自动择优，相对 Coze/Dify 的核心差异点 |
| **M2 提效快赢** | F2 审核队列、F3 平台合规 | 审核有统一入口；出稿自动过平台规则/广告法，减少返工 |
| **M3 数据资产** | F4 商品库/素材库 | 商品资料可复用，投料不再每次手填 |
| **M4 规模化生产** | F5 批量任务（先 CSV 后接商品库） | 一份商品表批量出 N 条内容，失败可单跑，结果可导出 |
| **M5 发布与排期** | F7-A 导出包、F8 日历（手动排期） | 合规待发包 + 周月排期 |
| **M6 效果闭环** | F6 效果回流、F9 内容级成本/ROI，F7-B 开放渠道 | 用真实数据反哺择优与选品 |

**关键取舍**：
1. F1 是技术难度最高、也最值得先投入的——它是"多变体择优"这条差异化主线的地基，F10/F9/F6 的变体对比都依赖它；建议优先且给足时间，宁可先只支持 strategy=prompt + mode=llm_score 一条最常用路径，再补 temperature/model/rule/human。
2. F2/F3 与引擎解耦，可以和 F1 **并行开发**、提前上线拿正反馈。
3. F7 坚决先做"导出包"，不向用户承诺自动发布到主流 C 端平台，规避合规与封号风险。
4. 每个特性独立成系列原子提交（沿用现有 conventional commits 习惯），DB 变更统一走 schema_migrations，保证旧图/旧 run 可回放。
5. **兼容性承诺（现有产线/模板零破坏）**：所有增强一律走"加枚举值 / 加可选字段 / 加新表 / 加新 API"的增量路径，不修改既有节点语义、不重排事件、不改旧数据主键。唯一例外是 F1 的 variant 维度——已设计缺省 `'main'` 兜底，保证不含 fanout/select 的旧图执行路径、事件、成本**完全不变**（见 §F1「迁移与兼容」）。**已验证（2026-09-03）**：F2/F3 落地后，27 个内置模板（`packages/core/src/templates.ts`）在新 schema 下全部兼容；F2 的 `runs.halted_node_id/halted_reason`、F3 的 `banned_terms` 表均为纯增量迁移，旧图/旧 run 可回放。

---

# 附：新增节点/表/接口速查

**新增 NodeKind**：fanout、select（F1/F10）、compliance（F3）、publish（F7）。
**新增 ConnectorType**：product（F4）。
**新增 DB 表**：banned_terms(F3)、products/brand_assets(F4)、batch_jobs/batch_items(F5)、publish_targets/published_contents(F7)、content_plan(F8)、content_metrics(F6)；node_runs/artifacts 加 variant 列(F1)、runs 加 halted_node_id/batch_id(F2/F5)。
**新增主要 API**：
- F1：事件流扩展（无新独立接口，run 内完成）
- F2：`GET /api/reviews/pending`、`POST /api/reviews/decide`
- F3：`GET /api/platforms`、banned_terms CRUD
- F4：`/api/products`(+import/export)、`/api/brand-assets`
- F5：`POST /api/batches`、`GET /api/batches[/:id]`、cancel、item retry
- F6：`POST /api/metrics`、`GET /api/performance`
- F7：`/api/publish-targets`、`/api/published-contents`
- F8：`/api/plan` CRUD
- F9：`/api/costs?groupBy=...` 扩展
