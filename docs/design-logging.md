# 服务端日志（Server Logging）设计方案

> 状态：**P1+P2 已实施（2026-09-05）**——默认落盘（`<DB dir>/logs/server.log`，`LOG_FILE=""` 显式禁用）+ console 收编（约 15 个文件改走 Logger；节点经 `ctx.log`，NodeRunContext 新增 runId 绑定的 child logger；例外保留 load-env/at-rest——Logger 初始化前的启动路径）+ `/api/*` 请求中间件（status 分级 + latencyMs + userId，不记 query）。logger 首写自动建父目录；测试 `LOG_FILE=""` 隔离。**P3 未实施**：触发器/迁移/启动信息补齐与 run.resumed 等关键路径，触发条件不变（再遇排障定位困难）。测试：server 747→760（+3 logger 断言），另见 handoff 待办 33。
> 创建：2026-09-05

## 1. 现状盘点

**已有的（质量不错，但覆盖薄）：**

- [logger.ts](../packages/server/src/logger.ts)：JSON 行式结构化日志，级别过滤（`LOG_LEVEL`），按大小轮转（默认 5MB×3，`LOG_FILE` 控制），`child(bindings)` 绑 runId/graphId——引擎/排障的骨架都在；
- 接入点仅 3 个文件：`run.ts`（run 生命周期）、`index.ts`（启动/MCP/trigger 调度错误）、`code-proxy.ts`（auditLog）。

**缺口：**

1. **约 15 个文件裸用 `console.*` 绕过 Logger**——核心执行路径全在内：`engine.ts`（节点意外抛错、调度 debug）、`nodes/generic.ts`（5 处）、`notify.ts`、`auth.ts`、`at-rest.ts`、`load-env.ts`、`nodes/code.ts`、`imagegen.ts`、`worker-plugins.ts`、`triggers.ts`。这些输出无级别、无结构、无轮转；
2. **默认不落盘**：`LOG_FILE` 未设时只有 stdout，进程关了日志就没了。本地跑 `pnpm dev` 时 tsx watch 重启即丢；
3. **无请求级日志**：`/api/*` 只有鉴权中间件（`index.ts:319`），没有 request 日志（谁在什么时候调了什么、耗时多少）；
4. 排障时「一个 run 出错」要同时看 events 表（UI 时间线有）和服务端日志（没有）——两套叙事对不上。

**刻意不做的：**

- 不做日志采集/聚合（Loki/ELK）——单机 sqlite 自托管形态用不上；
- 不做前端日志上报——web 端错误走浏览器 console + 反馈功能（见 [design-feedback.md](design-feedback.md)）兜底；
- `events` 表（run 事件流，UI 时间线/回放用）**不动**——它面向用户展示，本方案面向运维排障，受众与生命周期不同。

## 2. 设计原则

1. **一份 Logger，全部走它**——消灭裸 console（教训同 at-rest §4.3：探测器与改写器分家就是漏修成因；这里同理，两套输出体系必然漂移）；
2. **日志永不包含密钥**——与 [design-audit-log.md](design-audit-log.md) 同一条红线：error message 若可能带 key（如 fetch 报错含 URL query），先脱敏再 log；
3. **默认落盘**——不配 env 也要有 durable 日志；
4. 结构化字段可 grep：每行 JSON 带 `ts/level/msg` + 上下文绑定（runId/nodeId/graphId/component/latencyMs）。

## 3. 方案设计

### 3.1 默认落盘位置

`LOG_FILE` 未设时，默认写到 **DB 同目录**（与 `.encryption-key` 同模式，享受 [DB_FILE 已钉绝对路径](../.env) 的收益）：

```
<dirname(DB_FILE) || .>/logs/server.log   (+ .1 .2 .3 轮转)
```

- 目录自动 mkdir；写失败（只读环境）warn 一次后降级纯 stdout——**不阻塞启动**；
- `.gitignore` 加 `logs/`。

### 3.2 console 收编（一次性机械改造）

规则：`console.warn → log.warn`、`console.error → log.error`、`console.log` 删除或降 `log.debug`；message 改结构化绑定：

```ts
// 改造前
console.warn(`[generic:text:${nodeId}] failed:`, err.message);
// 改造后
log.warn("generic node failed", { kind: "text", nodeId, error: err.message });
```

- 引擎执行体（`nodes/*.ts`）统一通过 `NodeRunContext` 已有的共享状态拿 child logger（`run.ts` 已建 `runLog`，随 ctx 下发），**不新建全局引用**；
- 唯一例外：`load-env.ts`（Logger 初始化前的启动期）与 `at-rest.ts`（key 文件写失败告警，早于任何绑定）保留 console——注释标明原因。

### 3.3 请求级日志（中间件）

在鉴权中间件后加一层：

```ts
app.use("/api/*", async (c, next) => {
  const start = Date.now();
  await next();
  log.info("http", {
    method: c.req.method,
    path: c.req.path,          // 只记 path 模板，query 可能带 token（L1 已防，日志侧同防）
    status: c.res.status,
    userId: c.get("userId"),  // 鉴权失败时 undefined
    latencyMs: Date.now() - start,
  });
});
```

- **排除**：`/api/runs/*/stream`（SSE，长连接会一直挂到 run 结束才记一行且 latency 巨大无意义）——改为在 SSE 建立时记 `log.info("sse opened")`、关闭时记 `sse closed`；
- 4xx/5xx 升 warn/error，2xx/3xx 记 info，`GET /api/health` 之类探活路由 debug 级防刷屏。

### 3.4 关键路径覆盖清单（排障最小集）

| 路径 | 现状 | 补充 |
|---|---|---|
| run 生命周期 | ✅ run.ts 已有 | 补 `run.resumed`（人工介入恢复） |
| 节点执行失败 | ❌ engine.ts 裸 console | `log.error("node failed", {runId, nodeId, kind, errorCode, error})` |
| 触发器 | 部分（scheduler 错误） | 补 webhook 命中/拒绝（不含 secret）、cron tick |
| 沙箱代码执行 | 部分（code-proxy 有 auditLog） | 补 rlimit/sandbox-exec 降级告警 |
| 迁移 | ❌ | 每条 migration 应用前后各一行（version + 耗时） |
| 启动 | ✅ listening 已有 | 补 DB 路径、迁移版本号、加密 key 来源（env/file/内存，不记值） |

### 3.5 与 events 表的关系（不动）

`events`（UI 时间线）与本方案日志**互不替代**：前者是产品功能（用户看 run 怎么走的），后者是运维观测（服务为什么错）。节点失败在两边都出现是**刻意冗余**——排障时以日志的 `runId` 绑定字段为桥接键对齐。

## 4. 分阶段落地

| 阶段 | 内容 | 量级 |
|---|---|---|
| P1 | 默认落盘 + console 收编（机械替换） | 一次 PR |
| P2 | 请求中间件 + SSE 特判 | 一次 PR |
| P3 | 关键路径补齐（触发器/迁移/启动信息） | 一次 PR |

## 5. 测试计划

- 默认落盘：不设 `LOG_FILE` 启动 → DB 同目录 `logs/server.log` 出现 JSON 行；
- 轮转不回归：现有 logger 单测（已有）+ 收编后 message 字段断言（`{ kind, nodeId }` 结构化，非字符串拼接）；
- **红线断言**：logger 输出（构造含 fake key 的 error 场景）不含 key 明文；
- 请求日志：mock 一个 500 路由 → error 级 + latencyMs 存在；SSE 路由无 http 行、有 sse opened/closed。

## 6. 相关文档

- [design-audit-log.md](design-audit-log.md) —— 审计日志（本方案的红线同源：永不记值）
- [design-announcement.md](design-announcement.md) / [design-feedback.md](design-feedback.md) —— 同批三项的另两项
- [feedback-workflow.md](feedback-workflow.md) —— 排障时 owner 与 AI 的协作流程（日志的第一消费者）
