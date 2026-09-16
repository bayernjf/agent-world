# 步级可观测、上游数据契约与长任务健壮性设计

> 创建：2026-09-16 ｜ 性质：**方案设计（安全子集已落地，执行核心改造留待，见下文「实施进度」）**，落实 [competitor-painpoints.md](competitor-painpoints.md) 里的 **G1 / G2 / G4**，并补 **G3 / G5** 的设计决策。
> 原则：先落方案、再落代码；全部基于现有数据模型增量改造，不推倒重来。

---

## 实施进度（2026-09-16）

第一批 / 第二批落地的都是**只读、纯函数或配置形态**的安全子集，不改 run 执行核心，不影响 Hasee M1 高频回采：

| 项 | 状态 | 说明 |
| --- | --- | --- |
| G1.1 `GET /api/runs/:id/timeline` | ✅ 已落地 | 从 events 投影步级时间线，只读、无 DB 迁移，含 viewer 鉴权 |
| G1.3 前端 `RunTimelineView` | ✅ 已落地 | 运行历史每行「步骤」按钮内联展开；状态 / 耗时 / token / 成本 / 输出预览 |
| G1 完整输出懒加载 | ✅ 已落地 | `GET /api/runs/:id/nodes/:nodeId/attempt/:attempt/output`；时间线截断输出按需展开，`main` 变体优先 |
| G2.1 `validateContract` 纯函数 | ✅ 已落地 | core，含 `ContractSpec` zod schema；无契约 / 空契约恒通过（向后兼容） |
| G2.3 `GraphNode.contract` + Inspector 表单 | ✅ 配置形态就绪 | core schema 新增可选顶层字段 `contract`，Inspector「配置」tab 可编辑必填字段与类型。**因 G2.2 未接线，当前仅保存配置、不会真正拦截 run**，UI 已显式标注 |
| G4.1 deadline 纯函数 | ✅ 已落地 | core 纯判断，尚未接 engine |

**仍留待**（改 run 执行核心，为不打断 Hasee M1 回采，本轮有意不做）：

- ⏳ **G1.2 `POST /api/runs/:id/fork`** 断点重跑（复用 halt/resume，reused 节点不计费、继承 `budget_usd`）。
- ⏳ **G2.2 engine 契约接线**：节点完成 output 后、下游派发前调 `validateContract`，违例 failed + `SCHEMA_VIOLATION`（待定是否扩 `ErrorCode` enum）。**在它落地前，Inspector 里配的 contract 不生效。**
- ⏳ **G2.4 模板预置 contract**：等 G2.2 接线后，对照各数据源节点的**真实输出**逐个核对字段名再预置，避免字段名写错在未来误拦。
- ⏳ **G4.2–G4.4** degraded 状态机、前端「继续此节点」、视频远端任务进度轮询。
- ⏳ **G3** 节点 `maxRetries` 下放、run `budget_usd` UI 与超 budget 阻断。
- ⏳ **G5** 在 design-ab-testing.md 补节（纯文档）。

---

## 0. 现状基础（为什么这个方案不大动干戈）

现有 schema 已具备大部分原料：

- `runs`：snapshot / input / status / halted_node_id / halted_reason / budget_usd
- `node_runs`：`(run_id, node_id, attempt, variant)` 主键，已存 `output`、`reasoning`、`error`、`error_code`、`tokens_in/out/cached/reasoning`、`cost_usd`、`model`、`score`
- `events`：事件溯源表 `(run_id, seq, ts, version, type, payload)`
- `artifacts`：按 run/node/attempt 存产物
- 前端已有 `RunHistory`（run 级列表）、`RunCompare`（两次 run 对比），后端已有 halt/resume、节点级重试基建、月级 quota gate（M2）

**gap 不在"没数据"，而在：**
1. 没有"点开一次 run 看到逐节点时间线"的 API 和 UI（G1）
2. 不能从某节点 fork 重跑（G1）
3. 上游 connector/原料台输出不做 schema 校验，空值/缺字段静默传到下游（G2）
4. 长媒体任务超时没有显式降级/续跑路径（G4）

---

## 1. G1 — 步级 Run Trace + 断点重跑（P0）

### 1.1 目标
点开一次 run，按时间顺序看到每个节点的：**输入摘要 → 调用模型/prompt 摘要 → 输出 → 耗时 → token → 成本 → 重试次数 → 失败原因**；并支持"从某节点用它已有的输出作为输入，重跑它的下游"。

### 1.2 后端

**新增 API：`GET /api/runs/:id/timeline`**
- 一次返回：run 元信息（status/input/budget/trigger）+ 按执行序合并 `node_runs`（join `events` 补 started_at）+ 每节点 artifacts 列表。
- 不新增大表：直接从 `node_runs` + `events` 现有数据 join，无需迁移。
- 字段裁剪：`output` 可能很大（长文/JSON），API 默认只回摘要（前 N 字符 + hash），完整输出走 `GET /api/runs/:id/nodes/:nodeId/attempt/:attempt/output` 懒加载。

**新增 API：`POST /api/runs/:id/fork`**
- body：`{ fromNodeId, variant? }`
- 语义：以原 run 的 graph snapshot 为底，复制一份新 run；把 `fromNodeId` 节点的**已有 output** 注入为其下游起点输入，只重跑 `fromNodeId` 之后的节点（已成功的上游节点标记 `reused`，不重新计费）。
- 实现关键：复用现有 graph engine 的"从指定节点启动"能力（halt/resume 已能从 halted_node_id 续跑，fork 只是把"续跑"推广到任意已成功节点）。
- 费用：fork 出的新 run 继承原 run 的 budget_usd 上限，已 reused 节点不计费。

### 1.3 前端
- 新组件 `RunTimeline.tsx`：从 RunHistory 点一次 run 展开右侧抽屉，竖向时间线；每节点一行卡片（状态色 + 节点名 + 耗时 + token + 成本 + 模型），点开展开输入/prompt/输出详情。
- 每个成功节点卡片右上角加"从此处重跑"按钮 → 调 fork API → 跑完在 RunHistory 出现新 run。
- 失败节点直接显示 `error_code` + `error`（呼应已修的 halted_reason 记录）。

### 1.4 分步（原子提交建议）
1. 后端 `/timeline` 只读 API + 单测
2. 后端 `/fork` API + 单测（含 reused 节点不计费断言）
3. 前端 RunTimeline 抽屉（只读视图）
4. 前端"从此处重跑"按钮 + 轮询新 run 状态

---

## 2. G2 — 上游数据契约 / 空值护栏（P0）

### 2.1 目标
上游（HTTP / database / file / manual 原料台）输出到下游前做显式校验；缺字段、类型错、空值直接 **failed + error_code=`SCHEMA_VIOLATION`**，而不是把垃圾静默传到 LLM 节点产出"看似正常的错误结果"。

### 2.2 设计
- 节点配置新增可选 `contract`：声明 `{ requiredFields: string[], types?: Record<string, "string"|"number"|"array"|"object"> }`。
- engine 在该节点完成 output 后、把 output 写入下游前，跑一层纯函数 `validateContract(node, output)`：
  - 缺 required 字段 → 节点 failed，error_code=`SCHEMA_VIOLATION`，error 写明缺哪个字段；
  - 类型不符 → 同上；
  - 空字符串/空数组在 required 时按缺失处理。
- 不阻塞已有产线：`contract` 缺省 = 不校验（向后兼容）；模板里推荐的数据源节点把 contract 预置好。
- 与质检站区别：质检站在**下游**用 LLM judge 判质量；contract 在**源头**用确定性 schema 拦脏数据，两者互补不替代。

### 2.3 分步
1. core 纯函数 `validateContract` + 单测（各种缺字段/类型错/空值）
2. engine 接线（节点完成后、下游派发前调用）
3. Inspector 表单加 contract 编辑（可视化填 requiredFields）
4. 给现有模板的原料台/HTTP/database 节点补推荐 contract

---

## 3. G4 — 异步长任务超时降级与断点续跑（P1）

### 3.1 目标
画坊/影坊这类几十秒~几分钟的长任务，网络抖动/模型超时时，有显式的超时标记和续跑，而不是整条 run 卡死或全废。

### 3.2 设计
- 节点配置新增可选 `timeoutMs`（缺省沿用现有全局/默认）。
- engine 对长任务类节点（imageGen/videoGen）启动时记录 deadline；超时不直接判失败，而是：
  1. 节点状态置 `degraded`（区别于 failed），
  2. 已有半成品 artifact 保留，
  3. run 不终止，进入 halt/resume 续跑（用户可点"继续"重投这一节点，不重复计费已产出部分）。
- 长任务节点本身应是幂等/可续传的（视频生成任务 ID 可查进度），engine 续跑时先查远端任务状态再决定重投还是直接收结果。

### 3.3 分步
1. 纯函数 deadline 判断 + 单测
2. engine 接线（degraded 状态机分支）
3. 前端 RunTimeline 显示 degraded + "继续此节点"按钮
4. 视频节点接入远端任务进度查询（按 provider 适配，可后置）

---

## 4. G3 / G5 补充设计决策

### G3 — run/节点级成本硬闸 + max-retry 可配（P1）
- M2 已有**月级** quota gate；本项补**单次**维度：
  - 节点级可配 `maxRetries`（当前 maxAttempts 是全局/硬编码，M1 期间已从 3 调到 2，应下放到节点）；
  - 单次 run 可设 `budget_usd`（表已有此列，UI 未暴露）——超出即 halted + error_code=`BUDGET_EXCEEDED`；
  - 复用 G1 的 timeline 让用户看到"这个节点花了多少"。
- 不做实时账单流，只做 run 结束后对账 + 超 budget 阻断。

### G5 — prompt 热迭代闭环（P2，指向已有文档）
- 已有 [design-ab-testing.md](design-ab-testing.md)。本项只补：线上 run 的成功样本可一键"作为对比集"跑新 prompt，质检站评分自动回灌。**不单独立新方案**，在 ab-testing 文档上加一节即可。

---

## 5. 实施顺序与不做什么

**顺序（每步原子提交、英文 message、不 push）：**
G1.1 → G1.2 → G1.3 → G1.4（P0，最大价值）→ G2.1 → G2.2 → G2.3 → G2.4 → G4.1-G4.3 → G3（maxRetries 下放 + budget UI）。

> 实际落地进度（截至 2026-09-16）见文首「实施进度」表：G1.1 / G1.3 / G1 完整输出懒加载、G2.1 / G2.3（仅配置形态）、G4.1 已落地；G1.2 fork、G2.2 engine 接线、G2.4 模板预置、G4.2-G4.4、G3 留待。下一步若继续，优先 **G2.2 engine 接线**（让 G2.3 配的契约真正生效），但它改 run 执行核心，需避开 M1 回采关键期并单独充分测试。

**明确不做：**
- ❌ 不引入 OpenTelemetry / Sentry（deferred-items 已挂触发条件，单机阶段 server 结构化日志够用）。
- ❌ 不做分布式 trace / 跨 run 聚合 trace（当前单租户单实例）。
- ❌ G6 多人协作 / G7 模板市场仍按 deferred-items 触发条件走，本方案不碰。

---

## 6. 与竞品痛点的对应

| 竞品痛点（competitor-painpoints.md） | 本方案对应 |
| --- | --- |
| P-1 不可观测、调试靠猜 | G1 步级 timeline + fork 重跑 |
| P-2 静默失败/空值下传 | G2 上游数据契约 |
| P-3 成本失控/重试叠加重试 | G3 run budget 硬闸 + 节点 maxRetries 可配 |
| P-4 长任务紧耦合、一挂全废 | G4 超时降级 + 断点续跑 |
| P-5 迭代慢不敢改 | G5（在 ab-testing 文档补节） |
