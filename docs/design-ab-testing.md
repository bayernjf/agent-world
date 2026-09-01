# A/B 实验设计（同图多 prompt 变体对比）

> **状态：已落地**（`4af5452` 引入 A/B 实验执行器，`5b81c74` 随账号系统纳入用户隔离；2026-09-01 文档-代码覆盖盘点时补录设计文档）。
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
- 报告是**运行数据聚合**（成本 + 产物），不做自动评分/偏好判定——自动评估体系另行演进。
- 不做流量分流 / 多用户统计显著性：触发条件见 deferred-items.md 版本线。
