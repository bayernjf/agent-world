# MCP Server 设计方案

> 让 agent-world 作为 MCP Server，把产线能力暴露给其他 AI 客户端（Claude Desktop、Cursor、豆包、ChatGPT 等）。
> 状态：P0 MVP ✅（2026-08-28）+ P1 增强 ✅（2026-08-29：HTTP/SSE 传输、Resources、Prompts）+ P2-① 管理类 ✅（2026-08-29：6 个管理工具 + readonly 模式）+ P2-② 批量与对比 ✅（2026-08-29：batch_run + compare_runs）+ P2-③ 实时与安全 ✅（2026-08-29：get_run_events + SSE notifications 桥接 + Authorization Bearer 升级）+ **P3 协议升级 ✅（2026-09-09：多版本协商 2024-11-05 / 2025-11-25 / 2026-07-28 + OAuth 2.1 受保护资源发现）** | 优先级：P3
>
> **协议版本**：默认应答 `2026-07-28`（当前最新稳定修订版），同时保留 `2025-11-25` 与 `2024-11-05` 路径。详见 §12；尚未实现的规范条目见 §14。

---

## 1. 目标与背景

### 1.1 目标

用户可以在任意支持 MCP 的 AI 客户端中，通过自然语言直接调用 agent-world 的产线能力。例如：

- "帮我跑一下小红书种草笔记产线，输入是这个挂脖风扇"
- "列出所有产线，分析哪个跑得最快"
- "把刚才产线的产出下载下来"

### 1.2 与现有 MCP Client 的关系

| 功能 | 方向 | 状态 |
|------|------|------|
| MCP Client | agent-world 接入外部 MCP Server，调用外部工具 | ✅ 已实现 |
| MCP Server | 外部客户端接入 agent-world，调用产线能力 | 📋 本方案 |

两者完全独立，互不影响。MCP Server 复用现有 REST API，不需要改主服务核心逻辑。

---

## 2. 传输方式

| 传输 | 场景 | 状态 |
|------|------|------|
| **stdio** | 本地客户端（Claude Desktop、Cursor 等），最常用 | ✅ P0 已落地；**分帧 bug 已修（2026-08-29）**：旧实现用 LSP 风格 `Content-Length` 帧，而 MCP stdio 规范是**换行分隔 JSON**（单行一条消息、禁内嵌换行），Claude Desktop / 官方 SDK 实际连不上。已改规范分帧并补真实 CLI 冒烟测试（`src/stdio.test.ts`：spawn 子进程 initialize→tools/list→ping 回环、坏行 -32700 不中断、中文/emoji id 多字节无错位） |
| **HTTP/SSE** | 远程访问、多客户端共享（Streamable HTTP，`POST /mcp`） | ✅ P1 已落地 |
| WebSocket | 实时双向通信 | 不做（见 §14） |

**服务端推送按修订版分岔**（同一个 `POST /mcp` 端点同时支持两条）：

| 通道 | 适用修订版 | 说明 |
|------|-----------|------|
| `GET /mcp` SSE + `resources/subscribe` | 2024-11-05 / 2025-11-25 | 长连接 GET 建流，订阅走独立 RPC。2026-07-28 已移除，声明该版本的客户端调用会收到 `-32601` |
| `subscriptions/listen` | 2026-07-28 | 一次 POST 换一条长活响应流；客户端在 `types` 里选订阅类别，推送帧带 `_meta["io.modelcontextprotocol/subscriptionId"]` |

**传输切换**：默认 stdio；`AGENT_WORLD_MCP_TRANSPORT=http`（或 `--http`）启动独立 HTTP server（`127.0.0.1:3100`，`AGENT_WORLD_MCP_PORT` 覆盖端口）。

**Origin 校验**（2025-11-25 起规范要求）：跨站 `Origin` 直接 403，防 DNS rebinding。默认放行 `localhost` / `127.0.0.1` / `[::1]` 及无 Origin 的非浏览器调用；额外白名单用 `AGENT_WORLD_MCP_ALLOWED_ORIGINS`（逗号分隔）。

**Claude Desktop 接入**：`bin` 为 `agent-world-mcp`（`dist/index.js`，先 `pnpm --filter @agent-world/mcp-server build`），配置示例：
```json
{ "mcpServers": { "agent-world": {
    "command": "node",
    "args": ["<repo>/packages/mcp-server/dist/index.js"],
    "env": { "AGENT_WORLD_URL": "http://localhost:8791", "AGENT_WORLD_TOKEN": "<jwt>" }
} } }
```

---

## 3. 暴露的能力（Tools）

### 3.1 P0 — 核心读写（MVP）

| 工具名 | 能力 | 参数 | 返回 |
|--------|------|------|------|
| `list_graphs` | 列出所有产线 | 无 | 产线列表（id, name, updatedAt） |
| `get_graph` | 获取产线详情 | graphId | 节点/配置/连接完整 JSON |
| `run_graph` | 运行产线 | graphId, input(可选), images(可选) | runId（异步，立即返回） |
| `get_run_status` | 获取运行状态 | runId | status, progress, 当前节点 |
| `list_artifacts` | 列出运行产出 | runId | 产出列表（id, kind, label, uri） |
| `get_artifact` | 获取产出详情 | artifactId | 元数据 + 内容（文本直接返回） |

### 3.2 P1 — 管理增强（规划表）

> **注**：本批 6 个管理工具在 P1 中未实现（P1 实际落地的是 Resources + Prompts + HTTP/SSE 传输），已移至 **P2-①**，详细设计见 §3.3.1。此表保留仅作追溯。

| 工具名 | 能力 |
|--------|------|
| `create_graph` | 从模板/空白创建产线 |
| `update_graph` | 更新节点配置（改提示词、换模型等） |
| `delete_graph` | 删除产线 |
| `cancel_run` | 取消运行中的产线 |
| `download_artifact` | 下载产出文件（base64 或 URL） |
| `search_knowledge` | 全文检索知识库 |

### 3.3 P2 — 高级（P2-① ✅ 已落地）

P2 分三批实现（批次划分见 §9）。全部工具复用主服务现有 REST 端点，MCP 侧为胶水层；仅批量运行与实时事件涉及少量主服务协作。

#### 3.3.1 管理类工具（P2-①，6 个）✅ 2026-08-29

| 工具名 | 能力 | 参数 | 复用端点 |
|--------|------|------|---------|
| `create_graph` | 从模板/空白创建产线 | template(可选), name(可选), config(可选) | `POST /api/graphs` |
| `update_graph` | 更新节点配置（改提示词、换模型等） | graphId, name(可选), nodes(可选), edges(可选) | `PUT /api/graphs/:id` |
| `delete_graph` | 删除产线（需 confirm 确认，防误删） | graphId, confirm(必填) | `DELETE /api/graphs/:id` |
| `cancel_run` | 取消运行中的产线 | runId | `POST /api/runs/:id/cancel` |
| `download_artifact` | 下载产出文件（小文件 base64，大文件返回临时链接） | artifactId | `GET /api/artifacts/:id` |
| `search_knowledge` | 全文检索知识库（历史产出/素材） | query, limit(可选, 默认 10) | `GET /api/knowledge/search` |

> 注：`create_graph` 的 `template` 复用 `GET /api/templates` 的模板 id；`config` 与 `update_graph` 的 `nodes/edges` 均为主服务图 JSON 结构，MCP 侧只透传。

#### 3.3.2 批量与对比（P2-②，2 个）✅ 2026-08-29

| 工具名 | 能力 | 参数 | 说明 |
|--------|------|------|------|
| `batch_run` | 批量运行产线（多组输入） | graphId, inputs: string[], wait(可选, 默认 false), maxConcurrency(可选, 默认 3) | `wait=false` 立即返回 runId 列表（异步）；`wait=true` 聚合全部结果（超时回退轮询）。主服务无批量端点，由 MCP 侧并行调用 `POST /api/runs`，失败单组隔离不拖垮整批 |
| `compare_runs` | 对比两次运行的产出差异 | runIdA, runIdB | 复用 `GET /api/runs/:id/stats`（成本/Token/节点数）+ 同名节点产物对比（文本相似度、数量差异），输出结构化节点级 diff |

> 实现注记（2026-08-29）：`batch_run(wait=true)` 限流按 `maxConcurrency`（1–10，默认 3），总等待超时 30s（`BATCH_WAIT_TIMEOUT_MS`），超时降级返回 runId 列表 + 轮询提示；单组启动失败/状态查询失败均隔离，不拖垮整批。`compare_runs` 输出 `statsDiff`（nodes/tokensIn/tokensOut/costUsd 的 a/b/delta）+ 节点级 diff（onlyInA / onlyInB / both，both 含产物数量与文本相似度）；时长未纳入对比（stats 端点无该字段），图片尺寸因产物元数据不含该信息未对比，后续主服务补齐元数据再扩展。

#### 3.3.3 实时事件（P2-③，1 个 + 推送通道）✅ 2026-08-29

| 工具名 | 能力 | 参数 | 说明 |
|--------|------|------|------|
| `get_run_events` | 拉取运行事件流（节点进度/完成/失败，供客户端展示） | runId, since(可选, 事件序号), limit(可选, 默认 100) | 复用 `GET /api/runs/:id/events`；与 notifications 桥接共用同一数据源 |

实时推送通道（非工具）：SSE 传输下支持 `resources/subscribe` 订阅 `run://{id}`，MCP Server 桥接主服务 `GET /api/runs/:id/stream` 的事件，运行状态变化时发送标准 `notifications/resources/updated`。stdio 传输无服务端推送通道，客户端只能轮询。

> 实现注记（2026-08-29）：`resources/subscribe` 由 `NotificationsHub` 承载——`GET /mcp` 的 SSE 连接注册为推送 sink，订阅时向主服务 `GET /api/runs/:id/stream` 建立上游 SSE 桥，收到 `run.finished` 事件后广播 `notifications/resources/updated`（params 含 `uri`/`runId`/`status`）。上游连接按 runId 去重；最后一个 sink 断开时清理所有上游桥接（无泄漏）。stdio 传输下 `resources/subscribe` 返回 `-32601`，客户端只能轮询 `get_run_events`。
>
> 协议升级注记（2026-09-09）：2026-07-28 已移除 `GET` 端点与 `resources/subscribe`，替代品是 `subscriptions/listen`（一次 POST 换长活响应流，客户端在 `types` 里选订阅类别）。两条通道**并存**：声明 2026-07-28 的客户端走新的，老客户端继续走 `GET /mcp`。底层复用同一个 `NotificationsHub`，只多了按 `types` 过滤与 `subscriptionId` 打标。详见 §12。

---

## 4. 暴露的 Resources（只读资源）✅ 已落地

MCP 支持 Resources，客户端可以像读文件一样读取（`resources/list` / `resources/templates` / `resources/read`）：

| URI | 内容 |
|-----|------|
| `graph://{id}` | 产线完整配置（JSON） |
| `run://{id}` | 运行状态 + 产出摘要 |
| `artifact://{id}` | 产出内容（文本直接返回，二进制返回下载地址） |

三个 URI 均以模板形式在 `resources/templates` 声明，客户端可据此发现模式资源。

---

## 5. 暴露的 Prompts（提示词模板）✅ 已落地

| 提示词 | 用途 |
|--------|------|
| `run_pipeline` | "帮我运行指定产线并总结结果" 的引导提示词（支持 graphId/input 参数插值） |
| `analyze_pipeline` | "分析产线性能瓶颈和优化建议" 的引导提示词 |
| `create_from_template` | "从模板创建产线并配置" 的引导提示词 |

---

## 6. 架构设计

### 6.1 进程模型：独立进程

```
┌─────────────────┐     stdio      ┌──────────────────┐     HTTP     ┌──────────────┐
│  Claude Desktop │ ◄─────────────► │  MCP Server 进程 │ ◄──────────► │  主 Server    │
│  Cursor / 豆包   │   JSON-RPC     │  (Node 独立进程) │   REST API   │  (现有 :8791) │
└─────────────────┘                └──────────────────┘              └──────────────┘
```

- MCP Server 是**独立 Node 进程**，由客户端（如 Claude Desktop）启动
- 通过 stdio 与客户端通信（JSON-RPC 2.0）
- 通过 HTTP API 调用主服务（复用现有 REST API）
- 不侵入主服务代码，独立部署、独立升级

### 6.2 目录结构

```
packages/
  mcp-server/
    src/
      index.ts                    # 入口：stdio 默认 / --http 切换 HTTP 传输
      server.ts                   # JSON-RPC 分发（server/discover、initialize、tools/resources/prompts、subscriptions/listen）
      protocol.ts                 # 协议版本注册表：支持矩阵、_meta 键、resultType/缓存提示包装、已移除方法错误
      http.ts                     # Streamable HTTP 传输（POST /mcp + GET /mcp SSE + Origin 校验 + 401 挑战）
      oauth.ts                    # OAuth 2.1 受保护资源元数据（RFC 9728）与 Bearer 挑战串
      notifications.ts            # 推送 hub：sink 注册、按订阅类别过滤、上游 run stream 桥接
      resources.ts                # Resources：list/templates/read（graph:// run:// artifact://）
      prompts.ts                  # Prompts：list/get（run_pipeline / analyze_pipeline / create_from_template）
      tools.ts                    # 15 个工具（6 核心 + 6 管理 + batch_run / compare_runs / get_run_events）
      client.ts                   # 主服务 HTTP API 客户端
      config.ts                   # 配置（URL/Token/端口/Origin 白名单/OAuth）
    package.json
    tsconfig.json
```

### 6.3 技术选型

- **MCP 协议实现**：手写零依赖 JSON-RPC（与现有 MCP Client 同风格，不引入官方 SDK），`server.ts` 的 `handleMessage` 为纯函数、传输层（stdio / http）可插拔；协议修订版差异集中在 `protocol.ts`，`handleMessage` 只在「已移除方法」这一处按版本分叉
- **HTTP/SSE 传输**：Node 内置 `http` 模块（Streamable HTTP：`POST /mcp` 按 `Accept` 头返回 JSON 或 SSE；`GET /mcp` 建 SSE 流并广播 `endpoint`；`subscriptions/listen` 把响应本身变成长活流）
- **HTTP 客户端**：Node 内置 fetch
- **配置**：环境变量（`AGENT_WORLD_URL`、`AGENT_WORLD_TOKEN`、`AGENT_WORLD_MCP_TRANSPORT`、`AGENT_WORLD_MCP_PORT`、`AGENT_WORLD_MCP_READONLY`、`AGENT_WORLD_MCP_ALLOWED_ORIGINS`、`AGENT_WORLD_MCP_RESOURCE`、`AGENT_WORLD_MCP_AUTH_SERVERS`、`AGENT_WORLD_MCP_REQUIRE_AUTH`）

---

## 7. 客户端配置示例

Claude Desktop 的 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "agent-world": {
      "command": "node",
      "args": ["/path/to/agent-world/packages/mcp-server/dist/index.js"],
      "env": {
        "AGENT_WORLD_URL": "http://localhost:8791",
        "AGENT_WORLD_API_KEY": "your-key-if-needed"
      }
    }
  }
}
```

Cursor / 豆包等客户端配置类似。

---

## 8. 关键设计决策

### 8.1 长运行任务处理

产线运行可能需要几十秒到几分钟，MCP `tools/call` 是同步的。方案：

- **异步模式**：`run_graph` 立即返回 `runId`，不等待完成
- 客户端通过 `get_run_status` 轮询，或通过 MCP notifications 接收进度推送
- 避免单次 MCP 调用超时

### 8.2 大文件处理

- 图片/文件类 artifact 不直接在 MCP 响应中返回二进制
- `get_artifact` 返回元数据 + 下载 URL
- `download_artifact` 返回 base64（小文件）或临时下载链接（大文件）

### 8.3 错误处理

- 主服务不可用时返回清晰的 MCP 错误（code + message）
- 产线运行失败返回失败原因 + 日志摘要
- 工具参数校验失败返回 400 类错误

### 8.4 认证

- 主服务如果需要 API Key，MCP Server 从环境变量读取
- 不硬编码密钥，支持通过客户端 env 注入
- **P2-③ 升级（✅ 2026-08-29）**：token 从 URL query 迁到 `Authorization: Bearer` header；主服务认证中间件新增 Bearer 解析（优先级 cookie → Bearer → query），query 保留兼容旧客户端
- **P3 升级（✅ 2026-09-09）**：按 OAuth 2.1 把 MCP Server 定位为 Resource Server，补受保护资源元数据发现与 401 挑战。**验签仍在主服务**，见 §13

### 8.5 批量运行并发与超时（P2-②）

- `batch_run` 默认 `wait=false`：`Promise.allSettled` 并行启动，单组失败不影响其他组，返回各 runId + 各自的启动状态
- `wait=true`：等待全部完成并聚合结果；受 MCP 客户端超时约束（如 30s），内部按 `maxConcurrency`（默认 3）限流，超时后降级为返回 runId 列表并提示轮询
- 主服务暂不加批量端点；若后续需要"一次任务多输入 + 事件归一"，再评估 `POST /api/runs/batch`

### 8.6 实时 notifications 桥接（P2-③）

- MCP 标准没有任意事件推送；合规路径是 **SSE 传输 + `notifications/resources/updated`**
- 流程：客户端 `resources/subscribe`（URI `run://{id}`）→ MCP Server 向主服务 `GET /api/runs/:id/stream` 建立 SSE → 事件到达时判定状态变化（running→done/failed/halted）→ 发送 `notifications/resources/updated`（含 runId 与最新状态）
- 生命周期：客户端断连时清理订阅与上游 SSE 连接，避免泄漏
- stdio 传输无此通道，文档明示客户端只能轮询 `get_run_events`
- ✅ 2026-08-29 已落地：见 §3.3.3 实现注记

### 8.7 只读模式（P2-①）

- `AGENT_WORLD_MCP_READONLY=1`：`tools/list` 只暴露读工具（list_graphs / get_graph / get_run_status / list_artifacts / get_artifact / download_artifact / search_knowledge / get_run_events），写工具调用直接返回拒绝（含 run_graph 与 cancel_run）
- 适用于把 MCP 挂给第三方客户端的场景，一行开关、不增加主服务负担

### 8.8 误删保护（P2-①）

- `delete_graph` 要求显式 `confirm: true`，与 UI 删除确认语义对齐
- `cancel_run` 只对 running/halted 状态有效，已终态的 run 返回明确错误

---

## 9. 分期计划

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P0 MVP** | stdio 传输 + 6个核心工具 + 独立进程 + 基本错误处理 | ✅ 2026-08-28 |
| **P1 增强** | Resources + Prompts + HTTP/SSE 传输（管理类工具未做，已拆到 P2） | ✅ 2026-08-29 |
| **P2-① 管理类** | 6 个管理工具（create/update/delete graph、cancel_run、download_artifact、search_knowledge）+ readonly 开关 | ✅ 2026-08-29 |
| **P2-② 批量与对比** | batch_run + compare_runs | ✅ 2026-08-29 |
| **P2-③ 实时与安全** | notifications 桥接 + get_run_events + Authorization header 升级 | ✅ 2026-08-29 |
| **P3 协议升级** | 多版本协商（2024-11-05 / 2025-11-25 / 2026-07-28）+ `server/discover` + `subscriptions/listen` + 缓存提示 + Origin 校验 + OAuth 2.1 受保护资源发现 | ✅ 2026-09-09 |

### P0 MVP 验收标准

- [x] Claude Desktop 能连接 agent-world MCP Server
- [x] `list_graphs` 能列出所有产线
- [x] `get_graph` 能获取产线详情
- [x] `run_graph` 能触发产线运行并返回 runId
- [x] `get_run_status` 能查询运行状态
- [x] `list_artifacts` / `get_artifact` 能获取产出
- [x] 主服务不可用时返回清晰错误
- [x] 基本的单元测试覆盖

### P1 增强验收标准

- [x] `POST /mcp` 支持 JSON 与 SSE 两种响应（按 `Accept` 头）
- [x] `GET /mcp` SSE 流宣告 `endpoint`，可挂载服务端推送
- [x] `resources/list` / `resources/templates` / `resources/read`（graph:// run:// artifact://）
- [x] `prompts/list` / `prompts/get`（3 个引导提示词，参数插值）
- [x] initialize 能力声明包含 tools + resources + prompts
- [x] 传输切换：`AGENT_WORLD_MCP_TRANSPORT=http` / `--http`
- [x] 协议级单元测试 + 真实 socket 端到端冒烟（initialize → tools → resources → prompts → tool call）

### P2-① 管理类验收标准

- [x] `tools/list` 计数 6→12，全部 inputSchema 完整（含必填校验）
- [x] `create_graph`：按模板 id 创建 + 空白创建，返回新 graphId
- [x] `update_graph`：改节点配置/换模型后 `GET /api/graphs/:id` 回读验证生效（MCP 侧先读后合并再 PUT）
- [x] `delete_graph`：无 confirm 或 confirm=false 拒绝；confirm=true 删除成功
- [x] `cancel_run`：取消 running run 成功；对终态 run 返回明确错误（由主服务 404 透传）
- [x] `download_artifact`：文本返回内容、二进制返回 base64/下载链接
- [x] `search_knowledge`：query 命中返回结构化结果，limit 生效（默认 10）
- [x] `AGENT_WORLD_MCP_READONLY=1` 时写工具（含 run_graph）返回拒绝、读工具正常
- [x] 协议级单元测试覆盖（mock 主服务：每个工具正常路径 + 错误路径）— 22→33 通过

### P2-② 批量与对比验收标准

- [x] `batch_run(wait=false)`：多输入并行启动，返回 runId 列表；单组启动失败隔离，其余正常
- [x] `batch_run(wait=true)`：聚合全部结果；受 maxConcurrency 限流；超时降级为 runId 列表 + 轮询提示
- [x] `compare_runs`：输出结构化节点级 diff（成本/Token/节点数/产物差异），无产出节点明确标注（onlyInA/onlyInB/both）
- [x] 协议级单元测试覆盖（并发、超时降级、对比空结果）— 33→41 通过

### P2-③ 实时与安全验收标准

- [x] `resources/subscribe`（run://{id}）后，运行状态变化推送 `notifications/resources/updated`（含 runId + 最新状态）
- [x] 客户端断连后上游 SSE 连接与订阅被清理（无泄漏）
- [x] `get_run_events`：返回节点进度事件流，since/limit 生效
- [x] token 默认走 `Authorization: Bearer`，query 方式兼容旧客户端
- [x] 协议级测试 + 真实 socket 冒烟（订阅 → 跑一次 → 收到 updated 通知）— MCP 41→47 通过，主服务 405 通过

### P3 协议升级验收标准

- [x] `server/discover` 宣告三个修订版 + capabilities（含 `extensions`）+ `serverInfo`，无需先 `initialize`
- [x] `initialize` 回显客户端请求的已知版本；未知版本降级到最新
- [x] `_meta["io.modelcontextprotocol/protocolVersion"]` 声明未知版本 → `-32602` + `UnsupportedProtocolVersionError` + `data.supportedVersions`
- [x] 声明 2026-07-28 时调用 `initialize` / `ping` / `logging/setLevel` / `resources/subscribe` 等已移除方法 → `-32601` 且指明替代
- [x] 每个 result 带 `resultType: "complete"` 与 `_meta["io.modelcontextprotocol/serverInfo"]`
- [x] `tools/list` / `prompts/list` / `resources/*` 带 `ttlMs` + `cacheScope`（列表 public，运行态 private）
- [x] `subscriptions/listen` 返回 `subscriptionId`，推送帧按客户端选的 `types` 过滤并打标；未知类型 → `-32602` + `supportedTypes`
- [x] 跨站 `Origin` → 403；`Mcp-Method` 头与 body 方法矛盾 → 400 / `-32600`
- [x] `GET /.well-known/oauth-protected-resource` 免鉴权返回 RFC 9728 元数据
- [x] `AGENT_WORLD_MCP_REQUIRE_AUTH=1` 且无 token → 401 + `WWW-Authenticate: Bearer resource_metadata=...`
- [x] 单元测试 47→71 通过；真实 wire 冒烟覆盖上述 6 条主路径（`server/discover` / 缓存提示 / 版本回显 / 已移除方法 / 跨站 403 / 元数据端点）

---

## 10. 风险与注意事项

1. **长运行任务超时**：MCP 客户端可能有默认超时（如 30s），异步模式 + 轮询是必须的
2. **大文件传输**：artifact 可能很大（视频、长图），需要流式或分块处理
3. **认证安全**：API Key 通过环境变量传递，避免硬编码或日志泄露
4. **并发负载**：多客户端同时调用可能给主服务带来压力，需要考虑限流
5. **协议兼容性**：MCP 协议仍在演进，需要关注官方 SDK 版本更新
6. **Windows 兼容性**：stdio 传输在 Windows 上可能有编码问题，需要测试
7. **手写协议无 SDK 兜底**：本实现零依赖手写 JSON-RPC（§6.3），好处是可控、无供应链风险；代价是规范更新时没有 SDK 帮我们兜住——每次修订版发布都要人工比对 changelog 并补 `protocol.ts`。判断标准：只要暴露的 method 集合还这么小（tools / resources / prompts / subscriptions），手写成本低于引入 SDK；一旦要做 MRTR 或 tasks 扩展（§14），重新评估

---

## 12. 协议版本协商（P3，2026-09-09）

### 12.1 支持矩阵

单一 dispatcher 同时服务三个修订版。这可行的原因是：**2026-07-28 移除的方法与它新增的方法是不相交的两个集合**，所以一个 `switch` 能覆盖全部，声明的版本只作为「已移除方法」的闸门。

| 修订版 | 状态 | 本实现的行为 |
|--------|------|-------------|
| `2026-07-28` | 最新稳定版，默认应答 | 无状态：不需要 `initialize`，每请求用 `_meta` 自带上下文；`server/discover` + `subscriptions/listen` 可用；`initialize` / `ping` / `logging/setLevel` / `resources/subscribe` / `resources/unsubscribe` / `notifications/initialized` 返回 `-32601` |
| `2025-11-25` | 兼容保留 | 有状态握手：`initialize` 回显该版本；`GET /mcp` SSE + `resources/subscribe` 推送 |
| `2024-11-05` | 兼容保留（Claude Desktop 等老客户端） | 同上 |

未知版本的处理分两种，**故意不同**：

- `initialize` 里的 `protocolVersion` 未知 → **降级**回 `2026-07-28`。这是 2024-11-05 起就定的握手语义（服务端提议自己支持的版本，客户端决定断不断）。
- `_meta` 里声明的版本未知 → **报错** `-32602` / `UnsupportedProtocolVersionError`，`data.supportedVersions` 列出全部。无状态路径没有握手回合可以协商，只能当场拒绝。

### 12.2 `_meta` 键

2026-07-28 把握手信息挪进了每个请求的 `params._meta`（键名带 `io.modelcontextprotocol/` 前缀，集中定义在 `packages/mcp-server/src/protocol.ts`）：

| 键 | 方向 | 用途 |
|----|------|------|
| `io.modelcontextprotocol/protocolVersion` | 客户端 → 服务端 | 本请求按哪个修订版解读 |
| `io.modelcontextprotocol/clientCapabilities` | 客户端 → 服务端 | 替代 `initialize` 的能力声明 |
| `io.modelcontextprotocol/clientInfo` | 客户端 → 服务端 | 客户端名称/版本 |
| `io.modelcontextprotocol/serverInfo` | 服务端 → 客户端 | **每个** result 都带，替代 `initialize` 的回包 |
| `io.modelcontextprotocol/logLevel` | 客户端 → 服务端 | 替代已移除的 `logging/setLevel` |
| `io.modelcontextprotocol/subscriptionId` | 服务端 → 客户端 | 推送帧归属哪条 `subscriptions/listen` |

### 12.3 `server/discover`

规范要求所有服务端实现，且**不需要**先握手。实测响应：

```json
{
  "protocolVersions": ["2026-07-28", "2025-11-25", "2024-11-05"],
  "capabilities": {
    "tools": { "listChanged": false },
    "resources": { "subscribe": true, "listChanged": false },
    "prompts": { "listChanged": false },
    "extensions": {}
  },
  "serverInfo": { "name": "agent-world", "version": "0.3.0" },
  "resultType": "complete"
}
```

### 12.4 无条件字段

`resultType`、`_meta.serverInfo`、`ttlMs`、`cacheScope` 一律无条件下发，**不按协商版本分叉**。理由：规范要求客户端忽略未知字段，也要求 2026-07-28 客户端把缺失的 `resultType` 读作 `"complete"`——所以「总是发」两边都合法，而分叉会多一条要维护的代码路径。

缓存提示（SEP-2549）的取值：

| 结果 | `ttlMs` | `cacheScope` | 理由 |
|------|---------|-------------|------|
| `tools/list` / `prompts/list` / `resources/templates/list` | 300000 | `public` | 静态声明，跨用户可共享 |
| `resources/list` / `resources/read` | 5000 | `private` | 含运行态与产出，按调用者的 token 授权，不可跨用户缓存 |

`tools/list` 的顺序保持**声明序**而非字典序：声明序本身已经确定（满足规范的 SHOULD），并且把读工具排在写工具前面，对只读模式的可读性更友好。

### 12.5 `Mcp-Method` 头

SEP-2243 要求 POST 带 `Mcp-Method`，好让中间层不解 body 就能路由。本实现**容忍缺失**（老客户端不发），但**拒绝矛盾**——头与 body 的 method 不一致返回 400 / `-32600`。让头撒谎比没有这个头更糟。

---

## 13. 授权（OAuth 2.1 受保护资源）

2025-06-18 起，MCP Server 被规范定义为 **OAuth Resource Server**。本实现落地了发现侧：

### 13.1 元数据端点

`GET /.well-known/oauth-protected-resource`（RFC 9728），**故意免鉴权**——没有 token 的客户端必须能查到去哪儿拿 token：

```json
{
  "resource": "http://127.0.0.1:3100/mcp",
  "authorization_servers": ["https://auth.example.com"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["read", "write"],
  "resource_documentation": "https://github.com/bayernjf/agent-world"
}
```

配置项：`AGENT_WORLD_MCP_RESOURCE`（默认 `http://127.0.0.1:{port}/mcp`）、`AGENT_WORLD_MCP_AUTH_SERVERS`（逗号分隔）、`AGENT_WORLD_MCP_REQUIRE_AUTH=1`。

### 13.2 挑战流程

`AGENT_WORLD_MCP_REQUIRE_AUTH=1` 时，无 token 的 POST 返回：

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="http://<host>/.well-known/oauth-protected-resource", error="invalid_token"
Cache-Control: no-store
```

这个开关同时补上一个安全洞：在它关闭时，无 token 的本地调用者会**静默继承本进程的环境 token**，连带继承它的写权限。要把 MCP 挂给第三方就应该打开它（也可以叠加 §8.7 的 `READONLY=1`）。

### 13.3 边界：本进程不验签

**这一点必须说清楚，别当成完整合规。** mcp-server 进程不校验 JWT 签名、也不校验 `aud` claim——密钥在主服务里，token 的真正校验发生在主服务的认证中间件（§8.4）。本模块加的是**发现能力 + 真实的 401 挑战**，密码学校验仍然委托给下游。

后果：一个伪造的 Bearer token 能通过 mcp-server 的 `requireAuth` 检查，但会在主服务被拒。攻击面没扩大（原本也是主服务把关），但如果以后要让 mcp-server 独立部署在信任边界之外，就得在这里补 JWKS 验签。

### 13.4 客户端侧责任（RFC 8707）

规范要求 MCP **客户端**在换 token 时带 `resource` 参数（Resource Indicators），把 token 绑定到具体的 MCP Server，防止 token 被拿去打别的资源。这是客户端的活儿；服务端这边只保证 `resource` 值与元数据里宣告的一致。

---

## 14. 未实现清单（明确不做 / 待评估）

规范里存在、本实现**没有**做的部分，列出来避免下次误以为已覆盖：

| 条目 | 修订版 | 状态与理由 |
|------|--------|-----------|
| **MRTR**（`InputRequiredResult` / `resultType: "input_required"`） | 2026-07-28 (SEP-2322) | 待评估。用于工具执行中途向用户要输入。当前 15 个工具都是一问一答，没有需要中途追问的场景；`run_graph` 的长运行用异步 runId 解决（§8.1） |
| **tasks 扩展**（`io.modelcontextprotocol/tasks`） | 2026-07-28 (SEP-2663) | 待评估。它是长任务的标准答案，但会与既有的 runId 轮询 + `subscriptions/listen` 三套并存。等有真实客户端要求再做 |
| **elicitation**（`elicitation/create`、URL 模式、`EnumSchema`） | 2025-06-18 / 2025-11-25 | 不做。需要服务端反向请求客户端，与「MCP 侧只做胶水层」的定位冲突 |
| **sampling**（含 SEP-1577 工具调用） | 全部 | 不做。agent-world 自己就是模型编排方，不需要借客户端的模型 |
| **SSE 可恢复性**（`Last-Event-ID`） | 2025-03-26 起，2026-07-28 移除 | 不做。2026-07-28 已把它删掉，往回补是负债 |
| **`x-mcp-header` 透传** | 2026-07-28 (SEP-2243) | 未做。等有中间层部署需求再说 |
| **OpenTelemetry `_meta` trace 键** | 2026-07-28 (SEP-414) | 未做。主服务尚无 tracing 后端，先埋键没有消费方 |
| **icons 元数据** | 2025-11-25 (SEP-973) | 未做。纯展示增强 |
| **增量 scope 同意**（`WWW-Authenticate` 携带 scope） | 2025-11-25 (SEP-835) | 未做。当前只有 read/write 两个粗粒度 scope，且未真正生效（§13.3） |
| **OAuth Client ID Metadata Documents** | 2025-11-25 (SEP-991) | 未做。属于客户端注册流程，服务端侧无对应实现 |
| **JWKS 验签 / `aud` 校验** | 2025-06-18 起 | 未做，**已知缺口**。见 §13.3 |
| **WebSocket 传输** | 非规范 | 不做。Streamable HTTP 已覆盖远程场景，`subscriptions/listen` 覆盖双向推送 |
| **引入 `@modelcontextprotocol/sdk`** | — | 不做。见 §10 第 7 条 |

---

## 15. 参考资料

- [MCP 官方规范](https://modelcontextprotocol.io/)
- [MCP 规范修订版索引](https://github.com/modelcontextprotocol/modelcontextprotocol/tags)（`2026-07-28` 为当前最新稳定 tag，2026-09-09 核对）
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)（本项目未使用，仅作规范对照）
- [RFC 9728 · OAuth 2.0 Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728)
- [RFC 8707 · Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707)
- [版本注册表实现](../packages/mcp-server/src/protocol.ts)
- [授权元数据实现](../packages/mcp-server/src/oauth.ts)
- [现有 MCP Client 实现](../packages/server/src/mcp.ts)
- [主服务 REST API](../packages/server/src/index.ts)
