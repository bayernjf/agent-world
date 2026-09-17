# A/B 实验设计（同图多 prompt 变体对比）

> **状态：已落地**（`4af5452` 引入 A/B 实验执行器，`5b81c74` 随账号系统纳入用户隔离；2026-09-01 文档-代码覆盖盘点时补录设计文档）。**§5 G5（线上成功样本一键对比 + 质检站评分回灌）为 2026-09-17 补的方案，未实施**，属只读 + 独立 run 的安全子集。
> 定位：对同一产线的同一个 agent（textGen）节点，一次派发多个 prompt 变体并行运行、汇总对比效果。**不是版本管理的一部分**（版本管理侧的划界决策见 design-versions.md §4），也不是流量分流实验——单人自用场景，全量对比。

---

## 1. 核心机制（`packages/server/src/ab.ts`）

- **`buildABVariants(graph, targetNodeId, variants)`**：对图做 JSON 深拷贝，每个变体一份；在拷贝中把目标节点 `textGen.prompt` 替换为变体文案，arm 依次记 `A`/`B`/`C`…（`String.fromCharCode(65 + i % 26)`）。原图永不改动。
- **校验（fail-closed）**：目标节点不存在、或 kind ≠ `textGen`（厂房/agent 节点）直接抛错，前端展示为 400。
- **`startABExperiment(db, worker, {...})`**：每个变体编译为独立 run，打上共享 `ab_group` + 每 arm 的 `ab_arm`/`ab_target` 标签，后台执行；返回 group id 与各 arm 的 run id 供轮询。

## 2. API（`packages/server/src/index.ts`，按登录用户隔离）

```
POST /api/ab            发起实验 { graphId, targetNodeId, variants: [≥2], budgetUsd?, input? }
                        → { abGroup, arms }
GET  /api/ab/:groupId   汇总报告（db.abReport：各 arm 的 run 状态 / 成本 / 产物对比）
```

## 3. 前端（`apps/web/src/components/`）

- `ABDialog.tsx`：发起对话框（选目标 agent 节点 + 填 ≥2 个变体 prompt + 预算）。
- `ABReport.tsx` / `RunCompare.tsx`：按 group 聚合的报告与逐 run 对比视图。

## 4. 边界与缓做

- 只支持 textGen 单节点 prompt 对比；改模型/改结构的对比请复制产线手工跑。
- 报告是**运行数据聚合**（成本 + 产物），不做自动评分/偏好判定——自动评估体系另行演进；把产线里既有质检站（gate）的评分**呈现**到对比报告见 §5（仍是展示已有 judge 分数，不新增评判器、不做自动阻断）。
- 不做流量分流 / 多用户统计显著性：触发条件见 deferred-items.md 版本线。

---

## 5. G5 — prompt 热迭代闭环（线上成功样本一键对比 + 质检评分回灌）

> 状态：**方案已补（2026-09-17），未实施**。落实 [competitor-painpoints.md](competitor-painpoints.md) 的 P-5（迭代慢、不敢改 prompt），详细任务编号见 [design-step-trace-and-robustness.md](design-step-trace-and-robustness.md) §4 G5。本节只做设计，不单独立新方案。

### 5.1 动机

现有的 A/B（§1–§3）有两处摩擦：

1. 发起时要**手填 input**、还要自己把现网 prompt 抄进 arm A——而线上已经有一批 `done` 的真实 run，它们的起始输入就是现成的对照集。
2. 报告只给成本 + 产物文本，**哪个 prompt 更好靠人眼**——但很多产线在目标节点下游本来就有质检站（gate），`gate.verdict` 事件已经带了 `passed` / `score(0-10)` / `reason`（见 core `events.ts`），这份评分没有被 A/B 报告利用。

G5 把这两步自动化：**对一条线上成功 run 一键发起对比 → arm A 自动用现网 prompt、arm B+ 用新 prompt，跑在同一份真实输入上 → 报告自动带出各 arm 下游质检站的评分。**

### 5.2 安全边界（为什么不影响线上 / M1 回采）

- **只读 + 编译独立 run**：取样是读历史 run 的 snapshot/events，对比 arm 仍由现有 `startABExperiment` 编译成**各自独立的新 run**（带独立 `ab_group`），不改、不重跑、不回写被取样的线上 run，也不改 run 执行状态机。
- 与 G1（步级 timeline）同属安全子集；**不依赖** G1.2 fork、G2.2 契约接线、G4.x 降级状态机这些改执行核心的留待项。
- `fromRunId` 缺省时行为与今天完全一致（向后兼容）。

### 5.3 G5.1 从成功 run 取样（`fromRunId`）

- `POST /api/ab` 请求体增加可选 `fromRunId`：
  - **校验（fail-closed → 4xx）**：该 run 存在、属于当前用户（复用现有 viewer 鉴权）、`status=done`、且其图与 `graphId` 同构并含 `targetNodeId`；任一不满足返回明确中文错误，不静默回退到空 input。
  - **投影 input**：从该 run 的起始输入投影出 §1 现有的字符串 `input`（原料台 / source 节点的初始喂料）。优先复用 G1 timeline 的 events 投影（`buildTimeline`）/ run snapshot，**不新写一套抓取逻辑**；投影不到非空输入时 422 提示"该 run 无可用起始输入，请手填"。
  - **基线 arm 自动化**：arm A 取目标节点**当前图上的现网 prompt**（`buildABVariants` 本就深拷贝原图、天然携带现网 prompt），用户只需填 ≥1 个新 prompt 作为 arm B/C…；仍保留全手填路径。
- **入口**：`RunHistory` / `RunTimelineView`（G1）里某条 done run 的目标 textGen 节点行加「以此样本做 prompt 对比」，打开 `ABDialog` 并预填 `fromRunId` + 只读 input 预览。

### 5.4 G5.2 质检站评分回灌（abReport 增 gate 投影）

- 每个 arm run 跑完后，报告在现有「状态 / 成本 / 产物」之外，投影目标节点**下游最近一个 gate** 的 `gate.verdict`：`passed`、`score`(0-10)、`reason`；该 gate 配了 `qualityBar`（graph.ts gate 配置，低于分数线即 fail）时一并给出「达标 / 未达标」。
- 报告按 arm 列：prompt 摘要 / run 状态 / 成本 / gate passed / score / reason，并给轻量汇总（各 arm score、达标 arm 数）。**不做自动偏好判定、不自动改图、不阻断**——只是把产线里已有的 judge 分数呈现出来（与 §4 边界一致）。
- 数据全部来自既有 events，纯只读投影，无需新增评判模型。
- **空态与可比性**：
  - 目标节点下游没有 gate → 该 arm 评分列显示「无质检站」，回退到现状的产物人工对比。
  - gate 存在但该次 verdict 无 `score`（只给布尔判定）→ 只显示 passed。
  - 目标节点与 gate 之间还有其他会变异内容的节点 → UI 提示「评分来自其下游质检站，跨 arm 可比性受中间节点影响」，避免把分数误读为纯 prompt 差异。
  - gate 多 attempt（返工）→ 取最终一次 verdict，并可在详情里看历次分数。

### 5.5 落地拆分与测试要点

顺序：G5.1 server（`fromRunId` 投影 + 校验）→ G5.1 web（入口 + 预填）→ G5.2 server（abReport gate 投影）→ G5.2 web（报告评分列）。

- 不阻塞 M1 回采，可在 M2 之后或等待期落地；server 侧复用 `ab.ts`、`buildTimeline`、现有 viewer 鉴权，不动 engine。
- 测试要点：
  - `fromRunId` 越权 / run 非 done / 图不同构 / 无非空 input → 分别 403/422/400，且不发起任何 arm run；
  - arm A 的 prompt 严格等于发起时图上的现网 prompt，原图不被修改；
  - abReport 对「无 gate / gate 无 score / 多 attempt / 中间有变异节点」四种情况有空态与提示，不抛错、不编造分数。
