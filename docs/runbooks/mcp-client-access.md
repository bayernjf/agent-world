# 接入手册：其他系统通过 MCP 使用 agent-world

> **这份手册回答的是「我有一个 Claude Desktop / Cursor / 别的 agent，怎么把它接到 agent-world 上」。**
> 反方向（agent-world 去消费外部 MCP 服务）不在这里：那是 `MCP_SERVERS`（运维级 stdio/http）与「设置 → 技能 → 远程 MCP 服务」（用户级 http/sse），见 [design-mcp-server.md §1.2](../design-mcp-server.md)。
> 方案与取舍的理由在 [design-mcp-server.md](../design-mcp-server.md)，本文件只写「照做能通」的部分。

## 0. 先认清你面对的是什么

agent-world 作为 MCP server 暴露 **15 个工具**（`packages/mcp-server/src/tools.ts`）：

| 类别 | 工具 |
| --- | --- |
| 读 | `list_graphs` `get_graph` `get_run_status` `list_artifacts` `get_artifact` `download_artifact` `search_knowledge` `get_run_events` `compare_runs` |
| **写** | `run_graph` `create_graph` `update_graph` `delete_graph` `cancel_run` `batch_run` |

外加只读 Resources（`graph://` / `run://` / `artifact://`）与 3 个引导 Prompts。

**接入方拿到的身份 = 你给它的那个账号的全部权限**，包括花那个账号的模型额度。这不是一个「只读数据接口」，所以第 2 节的令牌部分请先看完。

先构建（`bin` 名 `agent-world-mcp`，入口是 `dist/`，没构建过就是空的）：

```bash
pnpm --filter @agent-world/mcp-server build
```

## 1. 两种形态，先选一种

| 形态 | 适合 | 起法 | 凭据放在哪 |
| --- | --- | --- | --- |
| **stdio**（默认） | 本机一个客户端，客户端自己拉起子进程 | MCP 客户端配置里 `command: node` + `args: [<repo>/packages/mcp-server/dist/index.js]` | 子进程 env 的 `AGENT_WORLD_TOKEN` |
| **Streamable HTTP** | 远程、多个客户端共享、不想每台机器装 node 包 | `AGENT_WORLD_MCP_TRANSPORT=http`（或加 `--http`）常驻，监听 **`127.0.0.1:3100`**（`AGENT_WORLD_MCP_PORT` 改端口），端点 `POST /mcp` | **每个请求自带** `Authorization: Bearer` |

```bash
# http 形态常驻
AGENT_WORLD_URL=http://localhost:8791 \
AGENT_WORLD_MCP_TRANSPORT=http \
  node packages/mcp-server/dist/index.js
```

两条协议细节，客户端挑版本时用得上：

- **服务端推送分岔**：`GET /mcp`（SSE）服务 2024-11-05 / 2025-11-25；2026-07-28 改走一次 `POST` 换长活响应的 `subscriptions/listen`。声明了旧版本的客户端调新通道会拿 `-32601`，反之亦然。
- **`Mcp-Method` 头**：可不带（老客户端就不带）；但**带了又和请求体里的 method 不一致会 400**——所以别拿它当装饰。
- **Origin 校验**：HTTP 形态绑在 localhost 上，2025-11-25 起必须拒掉跨站请求。默认放行 `localhost` / `127.0.0.1` / `[::1]` 与**不带 Origin 的非浏览器调用**；浏览器要从别的源打开，必须显式 `AGENT_WORLD_MCP_ALLOWED_ORIGINS=https://your.app`（逗号分隔），否则 403。

## 2. 令牌：它是什么、怎么取、什么会要命

**它不是 API key。** `AGENT_WORLD_TOKEN` 里要放的是**主服务签发的用户 JWT**——和网页登录后种进浏览器的 `auth_token` cookie 是同一种东西（`packages/server/src/auth.ts`）。所以：给 MCP 一个 token ＝ 把那个账号交出去。

取一个（本人账号，`remember:true` 换较长寿命）：

```bash
curl -s -i -X POST http://127.0.0.1:8791/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"…","remember":true}' \
  | grep -i '^set-cookie'
# → auth_token=<这一串就是 AGENT_WORLD_TOKEN>
```

三条必须知道边界：

1. **寿命**：`remember:true` 是 **7 天**，否则 **24 小时**（`auth.ts:31-32`）。到期后接入侧表现为 401，处置是重新登录取一个新的，不是重启服务。
2. **撤销不了**：`verifyToken` 只验签、不查库（`auth.ts:63-79`）。**改口令、`reset:password` 都杀不掉已经签出去的 token**——它会活到自己的自然过期。所以：不要把它提交进任何仓库、不要发给不信任的第三方、人走了只能等过期（要立刻断，目前没有手段；这件「会话可撤销」登记在 [deferred-items](../deferred-items.md) 的「账号自助三缺」里）。
3. **能读全库的是额度不是权限**：产线按用户隔离，token 是谁就只能看见谁的产线；但模型花费、备份体积、成品库都记在这个人头上。给自动化用**建议单开一个专用账号**（owner 在管理面板「用户」tab 开通，见 [部署 runbook 四之五](deploy-ubuntu-server.md)），别用你自己的。

**只读接入就打开只读档**：`AGENT_WORLD_MCP_READONLY=1` 会把上面 6 个写工具**从列表里隐藏并且直接拒绝调用**，只留 9 个读工具。配合上一条，「token 泄漏」的后果从「能烧钱能删产线」降到「能读这个人的产线」。

## 3. stdio 配置（可直接抄）

`claude_desktop_config.json`（Cursor 等结构相同，字段名一致）：

```json
{
  "mcpServers": {
    "agent-world": {
      "command": "node",
      "args": ["/ABS/PATH/TO/agent-world/packages/mcp-server/dist/index.js"],
      "env": {
        "AGENT_WORLD_URL": "http://localhost:8791",
        "AGENT_WORLD_TOKEN": "<第 2 节取到的 auth_token>"
      }
    }
  }
}
```

改完要重启客户端（stdio 子进程由客户端拉起，热重载不生效）。

## 4. HTTP 配置与验收

```json
{
  "mcpServers": {
    "agent-world": {
      "type": "http",
      "url": "http://localhost:3100/mcp",
      "headers": { "Authorization": "Bearer <第 2 节取到的 auth_token>" }
    }
  }
}
```

**注意这里有两层凭据**，很容易搞混：客户端 → MCP server 这一层是「能不能用这个进程」，MCP server → 主服务那一层才是「以谁的身份操作」。HTTP 形态默认**透传调用方自带的 Bearer**（`http.ts:168-173`），env 里的 `AGENT_WORLD_TOKEN` 只是**兜底**。所以如果一台机器上开了一个不带令牌的 HTTP MCP server，任何能连到 3100 的人都在**共享这个兜底账号**。要关掉：

```bash
AGENT_WORLD_MCP_REQUIRE_AUTH=1   # 无 token 的请求直接 401，不再继承 env 兜底
```

设了它之后，`/mcp` 上还挂着 RFC 9728 的受保护资源元数据 `GET /.well-known/oauth-protected-resource`（**故意免鉴权**，客户端要先能查到去哪拿 token），401 的 `WWW-Authenticate` 就指向它。想把它报成正式对外地址时改 `AGENT_WORLD_MCP_RESOURCE` / `AGENT_WORLD_MCP_AUTH_SERVERS`。
**但它只做发现与质询，不自己验签**——真正验 token 的仍然是主服务。所以别为了「有 OAuth」而开它，它换来的只是标准错误体。

验收一条握手：

```bash
curl -s -X POST http://localhost:3100/mcp \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <auth_token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

**版本协商按实测的说法**：支持矩阵是 `2026-07-28` / `2025-11-25` / `2024-11-05`（`protocol.ts:16`）。声明在矩阵里 → 回显你声明的那一版；**声明不在矩阵里（例如 `2025-03-26`）不报错**，服务端直接答它支持的最新版 `2026-07-28`——所以「服务端回显了什么」要当成协商结果读，不要当成你发出去的echo。

## 5. 一张实测验收表（本机 `dist/index.js` 起进程打出来的，不是推的）

| 打什么 | 期望 | 实测 |
| --- | --- | --- |
| `POST /mcp` 带 `origin: http://evil.example` | 拒 | **403** `{"error":"origin not allowed: …"}` |
| `POST /mcp` 带 `origin: http://localhost:5173` | 放行 | **200** |
| `GET /.well-known/oauth-protected-resource`（不带任何凭据） | 必须能查到 | **200**，`bearer_methods_supported:["header"]` |
| `POST /mcp` 无 token 且 `AGENT_WORLD_MCP_REQUIRE_AUTH=1` | 拒 | **401** + `www-authenticate: Bearer resource_metadata="http://<host>/.well-known/oauth-protected-resource", error="invalid_token"` |
| `tools/list` 且 `AGENT_WORLD_MCP_READONLY=1` | 只剩读工具 | **9 个**，6 个写工具名一个都不出现 |
| `POST /mcp` 带 `mcp-method: tools/call` 而请求体是 `initialize` | 拒 | **-32600** 「`Mcp-Method` 头 … 与请求体的 … 不一致」 |


## 6. 环境变量清单（MCP server 侧全部只有这些）

| 变量 | 默认 | 什么时候要动 |
| --- | --- | --- |
| `AGENT_WORLD_URL` | `http://localhost:8791` | 主服务不在本机 / 不在 8791 |
| `AGENT_WORLD_TOKEN` | 空 | stdio 形态基本必填；HTTP 形态下它是**兜底**，见 §4 |
| `AGENT_WORLD_MCP_TRANSPORT` | `stdio` | 要常驻共享服务时设 `http`（等价于启动加 `--http`） |
| `AGENT_WORLD_MCP_PORT` | `3100` | 端口冲突；注意**它绑的是 `127.0.0.1`**，要给别的机器用得自己放反代，反代要带上 `Origin` 白名单 |
| `AGENT_WORLD_MCP_READONLY` | 关 | 给只需要读的外部系统：`=1` 隐藏并拒绝 6 个写工具 |
| `AGENT_WORLD_MCP_ALLOWED_ORIGINS` | 空（放行 localhost 与无 Origin） | 浏览器形态的客户端从非 localhost 源打开时**必填**，否则 403 |
| `AGENT_WORLD_MCP_REQUIRE_AUTH` | 关 | 只要这个 MCP server 不是纯本机自用，就该 `=1` |
| `AGENT_WORLD_MCP_RESOURCE` | `http://127.0.0.1:<port>/mcp` | 元数据里要报对外地址时 |
| `AGENT_WORLD_MCP_AUTH_SERVERS` | 空 | 你有真授权服务器时（逗号分隔 issuer） |
| `AGENT_WORLD_REQUEST_TIMEOUT_MS` | `120000` | 产线跑得比 2 分钟长（`run_graph` 是异步返回 runId，一般不用动；批量 `batch_run` 才可能撞） |

## 7. 接入方问起来，这几件目前「没有」

- **没有细粒度 scope**。`scopes_supported` 里写的 `read`/`write` 只是元数据声明，**服务端不按它授权**；给出去就是全账号。要么用 `AGENT_WORLD_MCP_READONLY=1` 整体降为只读，要么单开专用账号。
- **没有 token 签发接口**。取 token 只有「登录一次拿 cookie」这条路（§2），所以自动化长期持有 JWT 的做法天然和 7 天寿命冲突——真要长期跑，目前只能定时重新登录。
- **没有撤销列表**（§2 第 2 条）。
- **WebSocket 不做**（理由见 design-mcp-server §14）。
- `download_artifact` 走的是**二进制下载**，那条 URL 目前只能把 token 拼在 `?token=` 上（`client.ts:133-136`）——所以它会进 access log。不需要读产物就别开写之外的权限，或干脆用只读档 + 内网。
