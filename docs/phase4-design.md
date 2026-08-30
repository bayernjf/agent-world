# Phase 4：高级编排与 AI Agent — 落地方案

> 基于 2026-08-29 的代码勘察（agent 工具调用 / loop·parallel 子图执行 / halt 机制 / 错误处理现状）写成。
> 目标：把 roadmap-generalization Phase 4 的七项能力对照现状，给出**可执行的落地方案 + 难题与对策**，标明已做 / 真缺 / 缓做。
>
> **落地状态（2026-08-30 更新）：七项中六项已全部落地，仅状态机按决策缓做。**
> 错误处理四件套 = `d31c482`（retry 基建）→ `906a70e`（级联 skip）→ `ce17008`（error 边 + catch）→ `3dea78d`（失败告警 + rerun API）→ `a77f127`（web rerun 按钮）→ `8f40a5e`（web error 边画法）；
> 人工审批 `human` 节点 = `20d9c9f`；子流程节点 = `d66fe52`；变量持久化 = `eb10d75`。

---

## 0. 现状速览（勘察结论，落地后已复核）

| Phase 4 能力 | 现状 | 结论 |
|---|---|---|
| **并行/聚合** | Phase 1 已有 `parallel` 节点（barrier 聚合）+ `loop` + 调度器 `MAX_CONCURRENCY=6` 自然并行 | ✅ **已做** |
| **AI Agent 多轮 ReAct** | **已完整实现**于 `providers/openai-compatible.ts:207-340` 的 `runWithTools`（MAX_ROUNDS=8，非流式，tool result push 回 convo） | ✅ **已做**（注释过期称"reserved for Phase 2"，实际已用） |
| **人工审批节点** | halt 机制完整（gate onExhausted=halt / dangerous-tool HaltRequested），resume 5 action（continue/approve/reject/edit/scrap），notifyHalt webhook | ✅ **已落地**：独立 `human` 节点（`20d9c9f`），任意位置暂停等审批 |
| **子流程调用** | 未做；但 `loop` 节点的"内联 BFS 发现 body + 递归 `runNode`"模式可直接借鉴 | ✅ **已落地**：`subprocess` 节点（`d66fe52`） |
| **错误处理** | RetryPolicy 是**节点级瞬态重试**（textGen/translate/notify/vcs 有，**search/http/code 无**）；无 error 边（EdgeKind 仅 flow/rework）；节点失败后下游**静默搁浅 pending**；无死信、无失败告警、无 try/catch | ✅ **已落地**：§1 四件套全量（`d31c482`/`906a70e`/`ce17008`/`3dea78d`/`a77f127`/`8f40a5e`） |
| **状态机** | 未做 | ⏸ **缓做**（易过度设计） |
| **变量持久化** | 无 graph/run 级变量、DB 无 variables 表；仅节点级临时数据流（前驱 artifact → 节点 context） | ✅ **已落地**：graph variables（`eb10d75`） |

**两个颠覆性发现**：
1. **ReAct 多轮已实现**——roadmap Phase 4 的"AI Agent 节点支持多轮工具调用循环"已满足，不需要重做（只需把 worker.ts 注释"reserved for Phase 2"更新掉）。
2. **错误处理缺口比想象大**——不只是"没有 try/catch"，而是：①search/http/code 最需要重试的节点反而没有；②失败节点的下游静默搁浅在 pending（UI 分不清"还没轮到"和"被跳过"）；③failed/tripped/cancelled 无告警（仅 halt 有）；④translate 的 retry 硬编码在 engine，TranslateConfig 无 retry 字段；⑤重试逻辑在 textGen/translate/notify/vcs 四处复制粘贴。

---

## 1. 错误处理（最高优先级）

### 1.1 目标

让产线能"失败后走备选路径"，而非整 run 报废；让运维知道 run 失败了；让最可能瞬态故障的节点（search/http/code）有重试。

### 1.2 方案：四件套

**A. error 边 + catch 节点（容错路径）**

`EdgeKind` 加 `"error"`。节点 failed 时，若有 error 出边 → 走向 catch 节点（而非搁浅下游）。catch 节点是个普通节点（通常是 agent/code），把错误信息作为上游输入。

```ts
// core/graph.ts
export const EdgeKind = z.enum(["flow", "rework", "error"]);
```

engine 改动：`runNode` 失败时，检查 `outgoing(graph, nodeId, "error")`，若有 → 把错误信息塞进 artifacts[nodeId]（一个 `{ error, errorCode, nodeId }` json artifact），catch 节点作为下游正常调度。若**无** error 边，保持现有"搁浅下游"行为（向后兼容）。

**难题①**：error 边指向的 catch 节点，它的其他 flow 前驱怎么算？  
**对策**：catch 节点的入边里，error 边的源是"可能失败的节点"，flow 边的源是"正常数据"。`predecessorsReady` 要放宽：catch 节点只要**任一**前驱 done（而非全部）就 ready。这需要 `predecessorsReady` 区分"全 ready（flow 语义）"和"任一 ready（catch 语义）"。

**难题②**：error 边和 rework 边冲突？gate 已有 rework 边。  
**对策**：语义正交——rework 是"质量不通过回上游重做"（attempt++），error 是"技术失败走兜底"。gate 不挂 error 边（gate 失败用 onExhausted）；只有 textGen/http/vcs/notify 等动作节点挂 error 边。

**难题③**：catch 节点也失败怎么办？  
**对策**：catch 节点本身失败 → 正常搁浅（catch 不再嵌套 catch，避免无限兜底）。死信兜底见 D。

**B. 搁浅节点显式 skip**

现状：失败节点的下游停留在 `pending`，UI 分不清。  
改 `NodeState` 加 `"skipped"`。节点失败后，遍历其 flow 下游（无 error 边的），标记 `skipped` 并 emit `node.skipped`。`predecessorsReady` 已有 `st !== "done"` 判断，加 `&& st !== "skipped"`。`finish` 的 stranded 检查改为"stranded = pending 且非 skipped"。

**难题**：级联 skip——A 失败 → B skip → C（B 的下游）也 skip。  
**对策**：递归 skip，一次 BFS 标记所有受影响下游。复杂度可控（图规模小）。

**C. 失败告警 + 死信**

现状：仅 halt 有 notifyHalt webhook。扩展：run 收尾时若 status ∈ {failed, tripped, cancelled} 且配置了 `RUN_FAILED_WEBHOOK` env → 发告警（复用 notify.ts 的 fire-and-forget 模式，payload 含 runId/graphId/status/失败节点摘要）。

死信：失败的 run 在 DB 已有记录（status=failed）。**不新建死信表**，而是加一个"重跑 failed run"的 API（`POST /api/runs/:id/rerun`——从原 graph + 原 input 重新 execute）。配合 cron 触发器可实现"每隔 N 分钟重跑失败的 run"。这样死信 = failed runs 表 + rerun API，零新表。

**难题**：rerun 要恢复原 input（source 的 raw material）。  
**对策**：execute 时把 sourceInput 持久化到 runs 表（新增 `input` 列）或 events log。rerun 读回。

**D. 重试基础设施补全 + 去重**

- `search`/`http`/`code` 加 RetryPolicy（SearchConfig/HttpNodeConfig/CodeNodeConfig 加 `retry` 字段，默认 `{maxRetries:2}`）。
- `translate` 的 retry 从硬编码提到 TranslateConfig（加 `retry` 字段）。
- 抽公共 `withRetry(cfg.retry, fn, { retryable: (err) => boolean })` 到 `packages/server/src/retry.ts`，notify.ts/vcs.ts/engine 的 agent+translate 循环都改用它。

**难题**：retryable 判断——各节点可重试错误不同（notify 的 AuthError 不重试、vcs 的 ProviderError 不重试、http 的 4xx 不重试 5xx 重试）。  
**对策**：`withRetry` 接受 `isRetryable: (err) => boolean` 回调，各调用方传入自己的判断。

### 1.3 改动点清单

- core：`EdgeKind` 加 error；`NodeState` 加 skipped；SearchConfig/HttpNodeConfig/CodeNodeConfig/TranslateConfig 加 retry 字段。
- server：`retry.ts` 公共重试；engine 的 `predecessorsReady` 支持 catch 语义 + 级联 skip；失败告警 + rerun API。
- web：error 边的画法/Inspector；skipped 状态的画布显示。
- 测试：error 边容错链路、级联 skip、各节点重试、失败告警、rerun。

---

## 2. 子流程调用

### 2.1 目标

产线调另一个产线（函数调用语义），复用通用子流程、降低单图复杂度。

### 2.2 方案：`subprocess` 节点

`NodeKind.subprocess` + `SubprocessConfig`：

```ts
{
  /** 被调用子流程的 graph id（DB 里的另一张图）。 */
  graphId: z.string(),
  /** 调用深度上限，防互递归。默认 3。 */
  maxDepth: z.number().int().min(1).max(10).default(3),
  /** 把上游产物作为子流程 source 的 input。默认取上游 text。 */
  inputFrom: z.string().optional(),
}
```

**执行模型**：复用 loop 的"内联 + 递归 runNode"模式。subprocess 节点 `runNode` 内：
1. 从 DB 加载子 graph（`db.getGraph(graphId)`），compile 之。
2. 把上游 artifact 作为子 graph 的 sourceInput。
3. **关键**：创建子命名空间——独立的 `childArtifacts: Map`、`childStates: Map`，但**共享** `totalCostUsd`（预算不隔离，防止子流程超支）和 `signal`（abort 传播）。
4. 内联跑子 graph 的节点（递归 runNode，但写入 childArtifacts）。
5. 子 graph 的 sink 节点产物 → 作为 subprocess 节点的产物回灌父 artifacts。

### 2.3 难题与对策

**难题①：上下文隔离**  
loop 共享父 artifacts（body 节点直接写全局 map）。subprocess 不能这样——子流程的节点 id 可能和父图冲突，且子流程的中间产物不该泄漏。  
**对策**：subprocess `runNode` 内建 `childArtifacts/childStates` 局部 Map，递归 runNode 时传入这些 Map 而非全局。需要 `runNode` 接受 artifacts/states 参数（目前是闭包变量，要改成参数或 context 对象）。这是**最大改动**——runNode 签名重构。

**难题②：budget 隔离**  
子流程该独立预算还是共享？共享简单但子流程可能耗尽父预算；独立要子流程配 budgetUsd。  
**对策**：第一版**共享** `totalCostUsd`（父预算），子流程不配独立预算。后续可加 `SubprocessConfig.budgetUsd` 做子预算（从父预算扣除）。

**难题③：防无限递归**  
subprocess 调 subprocess，或 A 调 B、B 调 A。  
**对策**：`maxDepth` 默认 3，每次调用 depth+1，超限 → node.failed errorCode=VALIDATION "子流程调用深度超限"。

**难题④：参数/返回值契约**  
父→子（source input）、子→父（sink 产物）的映射不明确。  
**对策**：固定契约——父上游 text 作为子 source 的 inputFrom；子 graph 所有 sink 节点的产物聚合（单 sink 取其值，多 sink 取 `{sinkId: value}`）作为 subprocess 产物。文档说明，不让用户自定义映射（第一版）。

**难题⑤：子流程的 gate halt / dangerous-tool halt**  
子流程跑到一半 halt 了，父流程怎么办？  
**对策**：halt 冒泡——子流程 halt 时，整个 run halt（haltNodeId 是子流程的节点，resume 时从子流程该节点继续）。复用现有 halt 持久化。

### 2.4 改动点清单

- core：`NodeKind.subprocess` + `SubprocessConfig`。
- server：engine 的 `runNode` 签名重构（接受 artifacts/states context）；subprocess 分支（加载子图 + 隔离命名空间 + 递归）。
- web：subprocess 节点 UI（graphId 选择器，从已保存的 graph 列表选）。
- 测试：subprocess 基本调用、深度超限、halt 冒泡、产物回灌。

---

## 3. 人工审批独立节点

### 3.1 目标

任意位置可暂停产线等人工决策，而非只能绑 gate。

### 3.2 方案：`human` 节点

`NodeKind.human` + `HumanConfig`：

```ts
{
  /** 暂停原因/提示，展示给审批人。默认用上游 text 作为待审批内容。 */
  prompt: z.string().default(""),
  /** 批准后继续；拒绝后走 error 边（若有）或 run failed。 */
}
```

**执行模型**：`runNode` 里 human 节点主动 `status = "halted"; haltNodeId = nodeId; haltReason = "human:" + cfg.prompt; aborted = true; notifyHalt(...)`。复用现有 halt 持久化 + resume 机制。resume 的 action 语义：
- `approve`/`continue` → human 节点标记 done，继续下游。
- `reject` → human 节点 failed（走 error 边或搁浅）。
- `edit` → 用 editOutput 替换上游产物后继续。

### 3.3 难题与对策

**难题①：和现有 halt 的区分**  
haltReason 现有前缀 `dangerous-tool:`。加 `human:` 前缀。reconstructState（从 events 恢复）要识别三种 halt 源。  
**对策**：haltReason 前缀化，reconstructState switch 前缀。

**难题②：human 节点没有"危险工具"上下文，approveTools 语义不适用**  
**对策**：human 节点的 resume 只用 approve/reject/edit，不用 approveTools。resume 函数按 haltReason 前缀路由。

**难题③：UI 展示待审批内容**  
现状 halt 的 UI（run 详情页的"人工决策"面板）展示 haltReason。human 节点要把上游 text 展示出来。  
**对策**：human 节点 halt 前把上游 text 写进 events（`human.review` 事件，content=上游 text），UI 读这个事件展示。

### 3.4 改动点清单

- core：`NodeKind.human` + `HumanConfig`。
- server：engine human 分支（主动 halt）；reconstructState 识别 human halt；resume 路由 human。
- web：human 节点 UI + halt 面板展示待审批内容。
- 测试：human 暂停 + 三种 resume action。

---

## 4. 变量持久化

### 4.1 目标

产线级配置参数（目标语言、品牌词库）跨 run 复用；run 间共享状态（上次结果影响下次）——配合 cron 场景。

### 4.2 方案：graph 级变量 + DB 表

**DB**：加 `graph_variables` 表 `(graph_id, key, value TEXT, updated_at)`。

**core**：`Graph` 加 `variables?: Record<string, unknown>`（图定义时的默认值，持久化后覆盖）。

**engine**：`SchedulerInit` 加 `variables: Map<string, unknown>`（run 级可变副本，从 graph.variables 初始化）。节点 context 可读 `${var.xxx}`。提供两个内置工具或节点动作读写：
- agent 工具 `set_variable` / `get_variable`（skill 形式注册）。
- 或 `code` 节点通过注入的 API 读写。
- run 结束时把 variables 写回 DB（持久化跨 run）。

### 4.3 难题与对策

**难题①：并发写**  
两个 run 同时跑同一 graph，variables 互相覆盖。  
**对策**：第一版**乐观写**（最后写赢），文档说明并发风险。后续可加 version 字段做 CAS。

**难题②：类型**  
variables 值是 JSON，但 `${var.count}` 插值时期望 string。  
**对策**：取值时 `JSON.stringify` 兜底；`getByPath` 支持对象/数组路径。

**难题③：和现有节点级数据流的关系**  
现有 `buildNodeContext` 从前驱 artifact 取值。variables 是另一维度（跨 run 持久）。  
**对策**：variables 作为"全局上下文"注入每个节点的 context，前驱 artifact 仍是主数据流。`${var.x}` 和 `${upstreamId.path}` 共存。

**难题④：安全**  
变量可能存敏感信息（token）。  
**对策**：文档警告"不要把密钥存 variables，用 env"；variables 不进 graph 定义文件（只存 DB），graph 导出时不带 variables。

### 4.4 改动点清单

- DB：`graph_variables` 表 + 迁移。
- core：`Graph.variables` 字段；`buildNodeContext` 注入 variables。
- server：engine 初始化 variables、run 结束写回；`set/get_variable` 工具或 code API。
- web：graph 编辑器的 variables 面板（key-value 编辑）。
- 测试：变量读写、跨 run 持久化、并发写。

---

## 5. 状态机（缓做）

### 5.1 评估

复杂业务流程建模（订单状态：待支付→已支付→已发货→已完成）。但目前 agent-world 的产线模型（DAG + rework）已能覆盖大多数流程，状态机容易**过度设计**。

### 5.2 若要做的方向

不做独立"状态机节点"，而是用 **variables 持久化 + branch 节点**组合：state 存 variable（`var.orderState`），branch 节点按 state 路由，每次 run 推进 state。这样状态机是"用现有积木搭"，不引入新节点类型。

### 5.3 结论

**缓做**。等有明确的复杂状态流转需求（如电商订单全流程）再评估，优先用 variables + branch 组合。

---

## 6. ReAct 多轮（已做，只需清理）

### 6.1 现状

`openai-compatible.ts:207-340` 的 `runWithTools` 已实现完整 ReAct 循环（MAX_ROUNDS=8，tool result push 回 convo）。engine 层单轮调 `runAgent`，worker 内部多轮。

### 6.2 待办

- 更新 `worker.ts:16-17` 的过期注释（"reserved for Phase 2"→"已实现"）。
- `fakeWorker`（worker.ts:167-187）不支持工具调用——测试需要多轮工具场景时要么用真实 openai-compatible worker，要么给 fakeWorker 加 tool-call 循环支持。
- 文档：在 handoff/roadmap 标注 ReAct 已落地。

---

## 7. 优先级与切入顺序

```
1. 错误处理（error 边 + skip + 告警/死信 + 重试补全去重）
   最高优先级。基础设施性质，所有复杂产线受益。改动面广但每块独立可分批。
   建议拆 4 个 PR：①重试去重+补全 ②skip+error 边 ③失败告警 ④rerun API。
   ↓
2. 人工审批节点（human）
   复用 halt 机制，改动小，价值清晰（任意位置暂停）。快速赢。
   ↓
3. 子流程调用（subprocess）
   中等难度，runNode 签名重构是主要成本。降低产线复杂度。
   ↓
4. 变量持久化
   中等，需 DB 迁移 + 工具/节点 API。配合 cron 场景价值显现。
   ↓
5. 状态机 — 缓做，用 variables+branch 组合兜底
```

**为什么错误处理排第一**：它是唯一"不做就拖所有复杂产线后腿"的基础设施。subprocess/human/variables 都是"锦上添花"，错误处理是"雪中送炭"。且勘察发现 search/http/code 无重试、下游静默搁浅、无失败告警——这些是**现在就在咬人的 bug 级缺口**，不是未来需求。

---

## 8. 不做项与说明

| 不做 | 原因 |
|------|------|
| ReAct 多轮重做 | 已实现于 `runWithTools`，只需清理过期注释 |
| 独立状态机节点 | 易过度设计；variables + branch 组合可兜底 |
| 子流程的独立预算 | 第一版共享父预算，简化；后续按需加 |
| 死信队列表 | 复用 runs 表 status=failed + rerun API，零新表 |
| 变量并发 CAS | 第一版乐观写（最后写赢），文档警告 |
