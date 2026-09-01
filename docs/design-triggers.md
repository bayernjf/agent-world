# 触发方式设计与使用（4.6 Triggers）

> 状态：**已落地（2026-09-01 修复 event 状态契约 bug）** | 关联：roadmap-tasks 4.6、design-connector-database.md
> 目标：不手动点「派发」也能让产线自动跑——定时、外部事件、上游完成、批量。配合 Connector 构成"触发 → 自动拉数据 → 加工 → 产出"的完全自动化闭环。

## 1. 五种触发类型

触发器持久化在**产线文档**里（`graph.triggers: TriggerConfig[]`），服务启动时 `TriggerService.restore()` 重建内存索引，`TriggerScheduler.start()` 给每个 cron 定时器上弦。

| 类型 | 何时跑 | 关键配置 |
|---|---|---|
| `manual` | 仅手动点「派发 / 运行一次」 | —（默认，不配置触发器时就是它） |
| `cron` | 按 cron 表达式定时 | `cron`（5 段，**UTC**）、`enabled` |
| `webhook` | 外部 `POST /api/graphs/:id/webhook` | `webhookSecret`（必填）+ 时间戳防重放 |
| `event` | 另一条产线完成 / 某产物生成时 | `eventSource: {kind: "graph"\|"artifact", id}` |
| `batch` | 一批输入，每行跑一次 | `batch: {source: "rows"\|"csv", rows?, path?}` |

## 2. 配置方式

**UI**：画布工具栏 →「触发器」打开 TriggersPanel，可增删改、启停、「运行一次」、看每个 cron 的下次运行时间与最近运行历史。

**API**：

```bash
# 列出 / 创建 / 删除
GET    /api/graphs/:id/triggers
POST   /api/graphs/:id/triggers          # body = TriggerConfig
DELETE /api/graphs/:id/triggers/:tid
GET    /api/graphs/:id/triggers/next-runs
POST   /api/graphs/:id/triggers/:tid/fire   # 手动触发（batch 自动走批量）
```

### 2.1 定时 cron

```json
{ "id": "daily-9", "type": "cron", "cron": "0 1 * * 1-5", "enabled": true }
```

- **5 段：分 时 日 月 周**，支持 `*` `?`、列表 `a,b`、区间 `a-b`、步进 `*/15` / `a-b/n`。
- **按 UTC 计算**（确定性，不随服务器时区漂移）。中国 UTC+8 换算：本地时间 − 8 小时 = UTC。例：**北京 09:00 = UTC 01:00** → `0 1 * * *`；北京每天 18:30 = `30 10 * * *`。
- 到点 fire 后立即按"当前时间"重算下一次；服务重启只从持久化表达式重新推导，不丢计划。

### 2.2 Webhook（外部系统推一下就跑）

```bash
TS=$(($(date +%s)*1000))   # 毫秒时间戳
curl -X POST http://localhost:8791/api/graphs/GRAPH_ID/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: YOUR_SECRET" \
  -H "x-webhook-timestamp: $TS" \
  -d '{"payload": {"topic": "新品上架"}}'
```

- secret 常量时间比较（防时序侧信道）；**空 secret 的 webhook 永不索引**（创建时也拒绝）。
- 必须带 5 分钟窗口内的时间戳（header 或 body），防重放。
- `payload`（对象会被 JSON 序列化）作为本次 run 的 sourceInput 喂给 source 节点。

### 2.3 事件串联（产线 A 完成自动起跑 B）

在 B 上配：

```json
{ "id": "after-a", "type": "event", "eventSource": { "kind": "graph", "id": "GRAPH_A_ID" } }
```

- `kind:"graph"`：A **成功**完成后自动 fire B；`kind:"artifact"`：指定 artifact 产出时 fire。
- 可多级串联形成 DAG 式自动产线（A→B→C），注意避免环。

### 2.4 批量 batch

`source:"rows"` 直接给 JSON 行数组，或 `source:"csv"` 给服务器可读的 CSV 路径（首行表头）；每行作为一次独立 run 的输入，并发池默认 4，避免打爆 worker。

## 3. 状态契约（重要，2026-09-01 修复）

event 触发与"运行后知识提取"依赖**引擎的成功状态字符串**：

- 引擎 `run.finished.status` 成功值是 **`"done"`**（完整集合 `done | failed | halted | tripped | cancelled`）。
- 历史 bug：触发层曾判断 `status === "completed"`，而引擎从不发 `"completed"`，导致**"产线完成 → 自动起跑下游"在成功时永久失效**，且单元测试用假想值 `"completed"` 掩盖了它。
- 修复：`TriggerService.onGraphFinished` 与运行后知识提取统一判断 `"done"`；回归基线新增契约用例焊死"引擎成功必发 `done`"，防止再次脱节。

## 4. 与 Connector 的自动化闭环

```
[cron 到点 / webhook 推入 / 上游产线完成 / 批量行]
        │  startRun(graph, {trigger})
        ▼
  source 节点经 Connector 实时拉取最新原料
        │  file / http / database(SQLite) / form
        ▼
   下游 textGen / image / gate … 加工
        ▼
     sink 成品入库  ──(event: graph done)──▶ 自动起跑下一条产线
```

- Connector 解决"**数据从哪自动来**"（见 design-connector-database.md），每次 run 都实时查询/拉取，无陈旧数据。
- Trigger 解决"**产线何时自动跑**"。两者正交，组合即无人值守产线。

## 5. 运维与边界

- 定时器是 **in-process**（`setTimeout`）：单实例可靠；多实例水平部署时 cron 会在每个实例各触发一次，需要分布式锁（deferred）。
- cron 表达式非法或 10 年内无匹配 → 不上定时器并记 error 日志，不影响其他触发器。
- runs 表用 `trigger` 字段记录每次运行来源（trigger id / `manual`），TriggersPanel 的"最近运行"据此过滤。
- webhook 走独立鉴权（secret），在 session 中间件放行（`/api/graphs/:id/webhook`），不依赖登录态。
