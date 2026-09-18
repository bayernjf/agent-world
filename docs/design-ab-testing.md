# A/B 实验设计（同图多 prompt 变体对比）

> **状态：已落地**（`4af5452` 引入 A/B 实验执行器，`5b81c74` 随账号系统纳入用户隔离；2026-09-01 文档-代码覆盖盘点时补录设计文档）。**§5 G5（线上成功样本一键对比 + 质检站评分回灌）方案补于 2026-09-17，已于 2026-09-18 落地**（core `ab-gate.ts`、server `fromRunId` 取样 + abReport gate 投影、web 入口与报告列），属只读 + 独立 run 的安全子集。
> 定位：对同一产线的同一个 agent（textGen）节点，一次派发多个 prompt 变体并行运行、汇总对比效果。**不是版本管理的一部分**（版本管理侧的划界决策见 design-versions.md §4），也不是流量分流实验——单人自用场景，全量对比。

---

## 1. 核心机制（`packages/server/src/ab.ts`）

- **`buildABVariants(graph, targetNodeId, variants)`**：对图做 JSON 深拷贝，每个变体一份；在拷贝中把目标节点 `textGen.prompt` 替换为变体文案，arm 依次记 `A`/`B`/`C`…（`String.fromCharCode(65 + i % 26)`）。原图永不改动。
- **校验（fail-closed）**：目标节点不存在、或 kind ≠ `textGen`（厂房/agent 节点）直接抛错，前端展示为 400。
- **`startABExperiment(db, worker, {...})`**：每个变体编译为独立 run，打上共享 `ab_group` + 每 arm 的 `ab_arm`/`ab_target` 标签，后台执行；返回 group id 与各 arm 的 run id 供轮询。

## 2. API（`packages/server/src/index.ts`，按登录用户隔离）

```
POST /api/runs/ab       发起实验 { graphId, targetNodeId, variants: [≥2], budgetUsd?, input?, fromRunId? }
                        → { abGroup, arms }
GET  /api/ab/:groupId   汇总报告（db.abReport：各 arm 的 run 状态 / 成本 / 产物对比 / 下游 gate 判定）
```

> 路由实际挂载在 `POST /api/runs/ab`（早期方案文字里简写为 `/api/ab`）。`fromRunId` 见 §5.3。

## 3. 前端（`apps/web/src/components/`）

- `ABDialog.tsx`：发起对话框（选目标 agent 节点 + 填 ≥2 个变体 prompt + 预算）。
- `ABReport.tsx` / `RunCompare.tsx`：按 group 聚合的报告与逐 run 对比视图。

## 4. 边界与缓做

- 只支持 textGen 单节点 prompt 对比；改模型/改结构的对比请复制产线手工跑。
- 报告是**运行数据聚合**（成本 + 产物），不做自动评分/偏好判定——自动评估体系另行演进；把产线里既有质检站（gate）的评分**呈现**到对比报告见 §5（仍是展示已有 judge 分数，不新增评判器、不做自动阻断）。
- 不做流量分流 / 多用户统计显著性：触发条件见 deferred-items.md 版本线。

---

## 5. G5 — prompt 热迭代闭环（线上成功样本一键对比 + 质检评分回灌）

> 状态：**已落地（2026-09-18，工作分支 feature/20260824，未 push）**。方案补于 2026-09-17，次日完成 core / server / web 全链路与测试，原子提交：core `8ee7fe3`、server `cb396f1`、web `ff2e017`。落实 [competitor-painpoints.md](competitor-painpoints.md) 的 P-5（迭代慢、不敢改 prompt），详细任务编号见 [design-step-trace-and-robustness.md](design-step-trace-and-robustness.md) §4 G5。

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

- `POST /api/runs/ab` 请求体增加可选 `fromRunId`：
  - **校验（fail-closed → 4xx，任一失败绝不发起任何 arm run）**：复用 `requireRun` viewer 鉴权，run 不可见/不存在统一 **404**（不泄露存在性，与项目其他只读端点一致）；`sample.graph_id !== graphId` → **422**「取样运行不属于当前产线」；`status !== done` → **422**；被取样 run 的 snapshot 中找不到 `targetNodeId` 对应的 textGen 节点 → **422**；起始输入为空 → **422**「没有可用起始输入，请改用手动填写」。
  - **投影 input**：直接取 runs 表自带的 `input` 列（`createRun` 写入、即该 run 的起始喂料），这是最权威的来源；为空才 422。无需新写抓取逻辑，也不从 events 反推。`GET /api/runs/:id/timeline` 的 run 对象同步带上 `input`，供前端预填只读预览。
  - **基线 arm 自动化**：arm A 取目标节点在**当前 live graph（线上图，非取样时的 snapshot）**上的现网 prompt——反映当下生产配置；server 把它前置于变体列表，用户在取样模式下只需填 **≥1 个**新 prompt 作为 arm B/C…。不带 `fromRunId` 的老路仍要求 ≥2 个全手填变体，完全向后兼容。
- **入口**：`RunHistory` / `RunTimelineView`（G1）里，当 run 与节点均为 `done` 且节点是 textGen 时，节点行加「以此样本做 prompt 对比」ghost 按钮，打开 `ABDialog` 的取样模式（目标锁定为该节点、起始输入只读预填、Arm A 自动占位）。

### 5.4 G5.2 质检站评分回灌（abReport 增 gate 投影）

- 每个 arm 的报告在现有「状态 / 成本 / 产物」之外，投影目标节点**下游最近一个 gate** 的最终判定：`passed`、`score`(0-10)、`reason`，以及该 gate 配置的 **`minScore`**（`GateConfig.minScore`，0-10，optional；低于分数线即未达标），据此给出「达标 / 未达标」。
- **实现为 core 纯函数**（`packages/core/src/ab-gate.ts`）：`findDownstreamGate(graph, targetNodeId)` 只沿 **flow 边 BFS**（不跟随 rework / error 边）找下游最近 gate，并标记最短路径上是否经过「内容变异节点」（textGen/imageGen/videoGen/audioGen/generic/translate；branch 等控制节点不算）；`projectGateVerdict(graph, timeline, targetNodeId)` 复用 G1 的 `buildTimeline`，折叠该 gate 各 attempt 的 `gate.verdict`、取**最终一次**。server `abReport` 为每个 arm 选一条代表 run（优先 `done`、最近），批量取 events 后投影，结果挂到 `ABArmReport.gate`（无顶层 gateSummary）。
- 报告在表格中为每个 arm 增「质检站判定」列：通过/未过徽标（带 score）、低于质量线提示、reason 截断 + 悬浮全文。**winner 推荐逻辑保持原样——gate 仅呈现，不参与自动偏好判定、不自动改图、不阻断**（与 §4 边界一致）。
- 数据全部来自既有 events，纯只读投影，无需新增评判模型；`avgScore`（node_runs 均值）与 gate.verdict 是两个数据源，互不冒充。
- **空态与可比性**：
  - 目标节点下游没有 gate → `gate=null`，该 arm 评分列显示「无质检站」，回退到现状的产物人工对比。
  - gate 存在但该次 run 没有 verdict（如未跑到 gate）→ `passed=null`，显示「暂无判定」。
  - gate 有布尔判定但无 `score` → 只显示通过/未过，不渲染分数与质量线。
  - 目标节点与 gate 之间还有内容变异节点（`mutatesInBetween=true`）→ 徽标旁给 ⚠ 悬浮提示「目标厂房与质检站之间存在改写内容的节点，各分支判定的可比性受限」，避免把分数误读为纯 prompt 差异。
  - gate 多 attempt（返工）→ 取最终一次 verdict，完整历次保存在 `history` 中供详情使用。

### 5.5 落地拆分与测试要点（已完成）

顺序：G5.1 server（`fromRunId` 投影 + 校验）→ G5.1 web（入口 + 预填）→ G5.2 core/server（abReport gate 投影）→ G5.2 web（报告评分列）。全程不改 engine run 执行状态机、不碰 M1 四条回采产线、不部署。

- server 侧复用 `ab.ts`、`buildTimeline`、`requireRun`/`requireGraph` 鉴权，不动 engine。
- 已覆盖的测试：
  - core `ab-gate.test.ts`（10 例）：flow/rework/error 边寻路、最近 gate、变异节点标记、多 attempt 取最终 verdict、minScore 达标判定、无 gate 返回 null。
  - server `api.ab.test.ts`（6 例）：取样成功 200（Arm A=现网 prompt、Arm B=新 prompt）、跨图 422、非 done 422、空 input 422、run 不存在 404、老路无 `fromRunId` 单变体 400；所有失败路径均断言不发起 arm run。
  - server `ab.test.ts`：带 gate 图的端到端 G5.2 集成（passed/score/minScore/meetsBar/history/mutatesInBetween），以及既有无 gate 用例断言 `gate=null`。
  - web `ABDialog.test.tsx`：取样模式（锁定目标、只读预填 input、≥1 新 prompt、2 臂、`fromRunId` 透传）；`ABReport.test.tsx`：质检站列的通过/未过/低于质量线/暂无判定/无质检站/变异警示/注脚。
  - 鉴权不可见统一 404（不是 403），与项目其他只读端点一致，避免泄露 run 存在性。
