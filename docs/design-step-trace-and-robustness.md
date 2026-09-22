# 步级可观测、上游数据契约与长任务健壮性设计

> 创建：2026-09-16 ｜ 性质：**方案设计（安全子集已落地，执行核心改造留待，见下文「实施进度」）**，落实 [competitor-painpoints.md](competitor-painpoints.md) 里的 **G1 / G2 / G4**，并补 **G3 / G5** 的设计决策。
> 原则：先落方案、再落代码；全部基于现有数据模型增量改造，不推倒重来。

---

## 实施进度（2026-09-16 首批；2026-09-17 执行核心四项落地）

第一批 / 第二批落地的都是**只读、纯函数或配置形态**的安全子集，不改 run 执行核心，不影响 Hasee M1 高频回采；**2026-09-17 第三批把 G1.2 / G2.2 / G3 与 G4.4 的可独立子集接线点亮**（随 PR #319/#325/#331 合 dev 部署 Hasee）：

| 项 | 状态 | 说明 |
| --- | --- | --- |
| G1.1 `GET /api/runs/:id/timeline` | ✅ 已落地 | 从 events 投影步级时间线，只读、无 DB 迁移，含 viewer 鉴权 |
| G1.3 前端 `RunTimelineView` | ✅ 已落地 | 运行历史每行「步骤」按钮内联展开；状态 / 耗时 / token / 成本 / 输出预览 |
| G1 完整输出懒加载 | ✅ 已落地 | `GET /api/runs/:id/nodes/:nodeId/attempt/:attempt/output`；时间线截断输出按需展开，`main` 变体优先 |
| **G1.2 `POST /api/runs/:id/fork` + 「从此处重跑」** | ✅ 已落地（2026-09-17） | engine `fork()`：fork 点及其全部上游复用父 run 产物（合成零成本 `reused:true` 的 node.finished，不重跑、不计费），只重跑 fork 点的 flow 下游（不含其自身）；新 run 全新 runId、继承父 run `budget_usd`、`trigger="fork"`，父 run 审计轨迹不动。时间线对 reused 节点显示「复用」角标，每个成功节点有「从此处重跑」按钮。后端 8 测（engine 3 + HTTP 5）、前端 3 测 |
| G2.1 `validateContract` 纯函数 | ✅ 已落地 | core，含 `ContractSpec` zod schema；无契约 / 空契约恒通过（向后兼容） |
| G2.3 `GraphNode.contract` + Inspector 表单 | ✅ 已落地 | core schema 可选顶层字段 `contract`，Inspector「配置」tab 编辑必填字段与类型；**G2.2 已接线，配置现已真正拦截 run**，hint 已改为「已生效」 |
| **G2.2 engine 契约接线** | ✅ 已落地（2026-09-17） | 唯一发包出口 `sendPackets` 开头加 `enforceContract` 闸门（同步完成节点在 schedule 继续扫描前生效；runNode finally 兜底末端节点）：违例删产物 + 置 failed + `SCHEMA_VIOLATION`（已扩 core `ErrorCode` enum，确定性失败、不重试）+ 拦截 flow 包，error 边可 catch。无契约/空契约字节级向后兼容，9 测 |
| G4.1 deadline 纯函数 | ✅ 已落地 | core `isTimedOut/remainingMs/deadlineAt`；G4.4 本次运行内轮询已复用 `isTimedOut` |
| **G4.4 视频远端任务轮询（本次运行内子集）** | ✅ 部分落地（2026-09-17） | Worker 新增**可选** `submitVideoJob`/`queryVideoJob` 接缝与 `VideoJobHandle/VideoJobPoll`；videoGen 节点在两方法齐备时「提交一次 → 指数退避（2s..20s）轮询 → 5min 上限」，远端 TIMEOUT/RATE_LIMIT 码透传；缺一方法则字节级回退同步 `generateVideo`。**当前无 provider 实现该接缝，生产仍走同步路径，provider 就绪即自动启用。跨 run 断点续跑（重启后凭 jobId 重新附着、不重投、不重复计费）依赖 G4.2 degraded/halt 状态机，随 G4.2 一起做**，5 测 |
| **G3 节点 maxRetries 下放 + 预算 UI** | ✅ 已落地（2026-09-17） | 后端各节点 handler 早已读取 `<kind>.retry.maxRetries`（engine.reliability 覆盖 0/2/3/4、退避、attempt 一致性），run 级 `budget_usd` UI 与超 budget 阻断也早已端到端；本轮补齐**缺口**——Inspector 对 7 类带 retry 策略的节点（textGen/http/code/translate/search/notify/vcs）加「失败重试次数」控件（共享 `RetryField`，clamp 到 schema [0,10]，文案区分 infra 重试与质检返工），2 测 |
| G5 prompt 热迭代（成功样本一键对比 + gate 评分回灌） | ✅ 已落地（2026-09-18） | 见 design-ab-testing.md §5；G5.1 `POST /api/runs/ab` 增 `fromRunId`（Arm A 自动用现网 prompt、投影真实输入、fail-closed 404/422），G5.2 core `ab-gate.ts` 沿 flow 边投影下游最近 gate 最终 verdict 并在 ABReport 增「质检站判定」列；纯只读 + 编译独立 run，不改执行核心 |

**仍留待**：

- 🟡 **G2.4 模板预置 contract —— 前置数组契约能力 (A) 已落地（2026-09-20，feature/20260824，未合 dev），预置动作仍缓做**：core `ContractSpec` 扩 `root:"array"`+`items:{requiredFields,types}`+`minItems`（违例按 `[i].字段` 报告）、engine 数组闸门改读 connector 的 `sourceMeta.data`（Product[]/SQL rows，回退 artifactValue 覆盖未来数组型 http/function/code）、Inspector 契约编辑器加对象/数组根形状切换（core `978ab56`/`36135e8`、server `2fbcbe1`、web `33dcc91`）；默认 root=对象且无内置模板声明数组契约，零行为变更。**预置**仍须抓到真实 Product[]/SQL rows 样本、对照真实字段名逐个核对后再给 tpl-product/tpl-xiaohongshu 配置，避免字段名写错误拦真实 run；原料台/纯文本节点输出 Markdown brief，即使数组闸门改读 sourceMeta，无 connector 结构化数据的节点仍不该配契约。
- 📐 **G4.2/G4.3/G4.4 跨 run —— 落地级设计已完成（2026-09-22，§3.4–3.10），代码仍待实施**：方案细化到代码接缝——NodeState 加 `degraded`、新事件 `node.degraded`、新错误码 `REMOTE_JOB_LOST`、新表 `remote_jobs`（migration 41）、videogen 超时走 human 同构 halt（`degraded:video:` 前缀）、submit 幂等（先查 open job 跳过 submit，防重复计费）、ResumeAction 加 `reattach`/`accept-degraded`（query 四分支：succeeded 收结果 / running 恢复 poll / failed 走 error 边 / lost 提示重投计费）、重启默认只读刷新不自动重投、前端橙色 degraded 标识 + 三按钮 + i18n；§3.9 给了 8 步原子提交计划（步骤 1/2 纯增量可先行，4/5 触执行核心须避开回采期）。触发条件与缓做记录见 deferred-items。

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

### 3.3 分步（高层）
1. 纯函数 deadline 判断 + 单测（✅ G4.1 已落地）
2. engine 接线（degraded 状态机分支）
3. 前端 RunTimeline 显示 degraded + "继续此节点"按钮
4. 视频节点接入远端任务进度查询（本次运行内 ✅ 已落地；跨 run 重新附着见 §3.7）

---

### 3.4 落地状态（2026-09-22 细化设计，未实施）

| 子项 | 状态 | 说明 |
| --- | --- | --- |
| G4.1 deadline 纯函数 | ✅ 已落地 | core `isTimedOut/remainingMs/deadlineAt` |
| G4.4 本次运行内 submit+poll | ✅ 已落地（2026-09-17） | `Worker.submitVideoJob/queryVideoJob` 可选接缝 + `VideoJobHandle/VideoJobPoll` + 指数退避（2s..20s）+ 5min 上限；当前无 provider 实现，生产仍走同步 `generateVideo`；5 测 |
| **G4.2 timeout→degraded→halt 状态机** | ⏳ 待实施 | 本文件 §3.5–3.6，改 run 执行核心 |
| **G4.3 前端 degraded 标识 + 决策按钮** | ⏳ 待实施 | 本文件 §3.8，依赖 G4.2 |
| **G4.4 跨 run 重新附着** | ⏳ 待实施 | 本文件 §3.7，依赖 G4.2 的 halted 落点 |

> 触发条件（与 deferred-items 一致）：出现真实长媒体任务在网关超时或服务重启后需要「不重投、不重复计费」续跑的场景；或可安排执行核心改造窗口。G4.2 必须先行，G4.3/G4.4 依赖它。

### 3.5 数据模型与状态扩展

**① 节点状态加 `degraded`**（`packages/server/src/engine.ts:283`）

```ts
// 现有
export type NodeState = "pending" | "running" | "done" | "failed" | "skipped";
// 改为
export type NodeState = "pending" | "running" | "done" | "failed" | "skipped" | "degraded";
```

语义区别（关键）：`failed` = 这一节点确定没产出、按 error 边/run 失败处理；`degraded` = **结果未定**——远端任务可能还在跑，节点暂停等待人工决策，run 进入 halted 而非 failed。

**② 新事件 `node.degraded`**（`packages/core/src/events.ts` 的 `RunEvent` discriminatedUnion，与 `node.failed` 平行）

```ts
{
  type: "node.degraded";
  nodeId: string;
  attempt: number;
  reason: string;                 // 人类可读，如「视频任务轮询超时（300s），远端可能仍在渲染」
  errorCode?: ErrorCode;          // TIMEOUT
  remoteJob?: { provider?: string; jobId: string; kind: "video" | "image" | "audio" };
}
```

事件溯源必须记录该事件，`reconstructState` 才能在 resume 时把节点投影回 `degraded`（现有投影只认 artifact→done / skipped / failed，需要加一条：见到 `node.degraded` 且其后无 `node.finished` → degraded，并恢复 `haltedNodeId/haltedReason`）。

**③ 新错误码**（core `ErrorCode` enum，`events.ts:27`）

- 复用现有 `TIMEOUT` 表达「本次轮询窗口超时」；
- 新增 `REMOTE_JOB_LOST`：重新附着时远端查无此 job（provider TTL 过期/已清理），语义不同于本次超时，前端据此提示「需重新提交、会重新计费」。

**④ 新表 `remote_jobs`（SQLite migration 41；当前最新为 40）**——跨 run 重新附着的唯一持久依据

```sql
CREATE TABLE IF NOT EXISTS remote_jobs (
  id            TEXT PRIMARY KEY,           -- 本地 uuid
  user_id       TEXT NOT NULL,
  run_id        TEXT NOT NULL,
  graph_id      TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  attempt       INTEGER NOT NULL,
  kind          TEXT NOT NULL,              -- 'video' | 'image' | 'audio'（本期只 video 写入）
  provider      TEXT,
  remote_job_id TEXT NOT NULL,              -- provider 侧不透明 job id（VideoJobHandle.jobId）
  state         TEXT NOT NULL,              -- 'submitted' | 'running' | 'succeeded' | 'failed' | 'lost'
  submitted_at  INTEGER NOT NULL,
  last_polled_at INTEGER,
  finished_at   INTEGER,
  error_code    TEXT,
  meta_json     TEXT,                       -- provider 特定附加信息
  UNIQUE (provider, remote_job_id)           -- 幂等：同一远端任务不重复登记
);
CREATE INDEX IF NOT EXISTS idx_remote_jobs_open ON remote_jobs (run_id, node_id)
  WHERE state IN ('submitted','running');
```

driver 加四个操作：`insertRemoteJob` / `getOpenRemoteJob(runId,nodeId,attempt)` / `touchRemoteJob(id,state)` / `finishRemoteJob(id,state,errorCode?)`。Postgres 版本在正式迁移时按 design-postgres-migration.md 的方言对照补同等 DDL（部分索引语法 PG 原生支持）。

### 3.6 G4.2 — timeout→degraded→halt 状态机（节点侧）

改造 `packages/server/src/nodes/videogen.ts` 的 `pollVideoJob` / `videoGenNode`（当前超时是 `throw new ProviderError("TIMEOUT", …)`，被 catch 成 `node.failed`）：

1. **submit 后立即落库**：拿到 `VideoJobHandle` 就 `insertRemoteJob({state:'submitted', …})`；每次 poll 到 running/pending 时 `touchRemoteJob('running')` 刷新 `last_polled_at`（节流，如每 3 次 poll 或 ≥10s 刷一次，避免写放大）。
2. **succeeded**：收结果（现有逻辑）→ `finishRemoteJob('succeeded')` → 节点 `done`。
3. **failed（远端明确失败）**：`finishRemoteJob('failed',errorCode)` → `node.failed`（现状不变，error 边可 catch）。
4. **轮询窗口超时（核心改动）**：不再 throw failed，而是
   - `emit({type:'node.degraded', reason, errorCode:'TIMEOUT', remoteJob:{jobId,provider,kind:'video'}})`；
   - `states.set(nodeId,'degraded')`；
   - 仿 `humanNode`（`nodes/human.ts:18-21`）置 `ctx.haltNodeId=nodeId`、`ctx.haltReason='degraded:video:'+nodeId`、`ctx.status='halted'`、`ctx.aborted=true`；
   - **remote_jobs 行保留 `state='running'`**（远端大概率仍在渲染，这是重启后能收回结果、不重复计费的前提）；
   - 发 `notifyHalt`（复用现有通知）。
5. **同步 worker（无 submit/query 接缝）维持现状**：超时仍 failed——没有 jobId 就没有可续跑的远端句柄，degraded 无意义。
6. **可选 `timeoutMs`**：节点 `videoGen.timeoutMs` 缺省沿用 `VIDEO_JOB_DEFAULT_TIMEOUT_MS`（5min）；degraded 只表示「本次等待窗口结束」，不代表远端失败。

> 注意：degraded halt 与 human/gate halt 共用 runs 表的 `halted_node_id/halted_reason`，用 `halted_reason` 前缀 `degraded:` 区分，reviews/审核队列查询（`reviews.ts:71`）据此分流，不新增 run 状态。

### 3.7 G4.4 跨 run — submit 幂等 + 重新附着（不重投、不重复计费）

**① submit 幂等（防重复计费的第一道闸）**
`pollVideoJob` 开头先 `getOpenRemoteJob(runId,nodeId,attempt)`：
- 存在 open job → **跳过 submit**，直接用持久化的 `{jobId,provider}` 进入 poll 循环；
- 不存在 → 才 `submitVideoJob` 并落库。
这样无论是「同一 run 内 resume」还是「服务重启后 resume」，都不会对一段仍在途的渲染重复下单。

**② `ResumeAction` 扩展**（`packages/server/src/run.ts:300`）

```ts
export type ResumeAction = "continue" | "approve" | "reject" | "edit" | "scrap"
  | "reattach"          // 继续远端任务：先 query，按远端状态决定收结果/继续等/重投确认
  | "accept-degraded";  // 接受降级：无产物放行该节点，flow 继续（下游靠 G2 契约/error 边兜底）
```

**③ `reattach` 流程**（在 `engine.resume`，§3.6 的 halted 落点上）
读 open remote job → 调一次 `queryVideoJob({…args, job})`，按远端状态分流：

| query 结果 | 处理 | 是否计费 |
| --- | --- | --- |
| `succeeded` | 复用现有「收结果→存 artifact→node.finished→done」，`finishRemoteJob('succeeded')`，flow 继续 | 否（只收不投） |
| `running`/`pending` | 恢复 poll 循环（**不 submit**），再次到窗口超时则重新 degraded/halt | 否 |
| `failed` | `finishRemoteJob('failed')`，node.failed，走 error 边/重试 | 否（除非用户显式重跑） |
| 查无此 job（404/UNKNOWN） | `finishRemoteJob('lost')` + errorCode `REMOTE_JOB_LOST`，**保持 halted** 并提示「远端任务已过期/被清理」，提供「重新提交」= 对该节点 `resetFrom` 重跑（明确告知会重新计费） | 重投才计费 |

**④ `accept-degraded` 流程**
emit 一个决策事件（`node.degradedAccepted`，或复用 human.decision 形态），把该节点按「放行但无产物」处理（投影为一个显式终态，UI 仍显示降级角标而非 done 绿勾），随后正常 weld 下游；下游若强依赖该节点产物，由 **G2 契约闸门**（SCHEMA_VIOLATION）或 error 边自然拦截——不静默制造假成功。

**⑤ 服务重启后的恢复策略（保守，默认只读）**
- **默认不自动重投、不自动 resume run**（避免无人值守下重复计费或意外放行）；
- 启动时可选对 `state IN ('submitted','running')` 的 remote_jobs 做**一次只读 query 刷新**（只更新表状态 + 打日志，不改变 run 状态）；已 succeeded 的在用户下次 reattach 时可一键收结果；
- 开关 `REMOTE_JOB_RECOVER_ON_BOOT`（默认 `'poll'` 只读刷新；`'off'` 完全不碰；永不提供自动重投档）；
- 运营台/运行历史对「有在途任务、正等你决策」的 halted run 给计数和入口（G4.3）。

### 3.8 G4.3 — 前端 degraded 标识与决策按钮（`RunTimelineView`）

- degraded 节点用**橙色**标记（failed 红 / done 绿 / degraded 橙 / skipped 灰，颜色+文字双编码，不只靠颜色）；
- 展示：halt 原因、远端 jobId（截断显示，可复制）、提交时间与已在途时长；
- 两个主动作：
  - **「继续此节点」** → `POST /api/runs/:id/resume` body `{action:'reattach'}`；
  - **「接受降级结果」** → `{action:'accept-degraded'}`，点击后二次确认（「该节点没有产出，下游可能因缺素材失败，确定放行？」）；
- job 状态为 `lost` 时，主动作换成 **「重新提交（将重新计费）」** → 走现有 `resetFrom` 重跑该节点；
- 文案走 i18n（zh/en）与设计 token，按钮规格遵循全局按钮规范（避免尺寸不一致）；
- 审核队列/运行历史列表识别 `halted_reason` 前缀 `degraded:`，归到「待决策（在途任务）」分组，与人工审批、危险工具审批区分。

### 3.9 分步实施（原子提交，每步独立可回滚，英文 message、不 push）

1. **core**：ErrorCode 加 `REMOTE_JOB_LOST` + `node.degraded` 事件 zod schema + 类型导出（+core 单测）。
2. **server**：migration 41 `remote_jobs` 表（DDL 进最新 CREATE 块 + 旧库 CREATE TABLE IF NOT EXISTS 兜底）+ driver CRUD（+driver 单测）。
3. **server**：`reconstructState` 识别 `node.degraded`（投影 degraded + halted 落点）（+engine 单测）。
4. **server**：videogen degraded/halt + submit 幂等 + remote_jobs 落库/状态流转（+扩展 `engine.videogen.async.test.ts`：超时→degraded/halt、重启后 open job 跳过 submit、succeeded 收结果不重投）。
5. **server**：resume `reattach` / `accept-degraded` 两个 action + HTTP 接线 + reviews 分流（+run/api 单测覆盖 query 四分支）。
6. **web**：RunTimelineView degraded 标识 + 三按钮 + i18n + 审核队列分组（+web 测试）。
7. **（可选后置）** 启动只读恢复开关 + 运营台在途任务计数。
8. docs：更新本文件进度表、handoff、deferred-items（G4 行从缓做转已落地/部分落地）。

> 改造窗口纪律：步骤 4/5 触及 run 执行核心，需避开关键回采期，单独充分测试；步骤 1/2 是纯增量（新枚举、新表、新事件，旧 run 无 `node.degraded` 事件时行为字节级不变），可先行合入。

### 3.10 明确不做

- ❌ 不做远端任务的**自动重投**——重投必然重新计费，必须用户在看到 `lost`/失败后显式确认；自动档最多只读刷新状态。
- ❌ 本期不给 imageGen/audioGen 接 degraded（现有异步接缝是 video 专属）；`remote_jobs.kind` 与 `VideoJobHandle` 形态预留，等对应 provider 出现再泛化。
- ❌ 不做跨实例分布式锁 / 多副本抢任务恢复——当前单租户单实例，SQLite 写在本地。
- ❌ 不改同步 worker（`generateVideo`）路径的失败语义。
- ❌ 不把 degraded 当成功——「接受降级」是显式、带角标、下游仍受 G2 契约约束的放行，不制造假绿勾。

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
- ✅ 已于 2026-09-18 落地（见 design-ab-testing.md §5 与文首进度表）：G5.1 `fromRunId` 取样 + G5.2 下游 gate verdict 投影，core/server/web 全链路 + 测试齐备，未改执行核心。

---

## 5. 实施顺序与不做什么

**顺序（每步原子提交、英文 message、不 push）：**
G1.1 → G1.2 → G1.3 → G1.4（P0，最大价值）→ G2.1 → G2.2 → G2.3 → G2.4 → G4.1-G4.3 → G3（maxRetries 下放 + budget UI）。

> 实际落地进度（更新至 2026-09-18）见文首「实施进度」表：G1.1 / G1.3 / G1 完整输出懒加载、G2.1 / G2.3、G4.1，以及 **G1.2 fork、G2.2 engine 接线、G4.4（09-17 收口，随 PR #319/#325/#331 合 dev）与 G3（09-18 `703c47d`，PR #341）** 均已落地；**G2.4 前置 (A) 数组契约能力已于 2026-09-20 落地**（core/server/web，工作分支未合 dev；批量预置仍待真实 Product[]/SQL rows 样本）；剩 **G2.4 批量预置、G4.2 降级状态机、G4.3 前端「继续/降级」按钮** 留待（改 run 执行核心，避开 M1 回采关键期并单独充分测试）。

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
