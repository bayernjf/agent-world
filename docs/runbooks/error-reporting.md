# 错误追踪与告警 Runbook

> 适用：agent-world server（`packages/server`）。零依赖进程内错误捕获 + 可选 webhook 外发。
> 对应实现：`packages/server/src/errors.ts`（#57，2026-09-21）；启用点 `src/index.ts`。
> 结论先行：**单机/内网默认零配置即可查**；要把错误推到 Discord/Slack/飞书/Sentry/Loki，需自建一个薄 relay 做格式/鉴权转换（内置 sink 只发裸 JSON、不带鉴权头）。

---

## 1. 能力现状

`errors.ts` 提供零外部依赖的进程内错误捕获：

- **环形缓冲**：默认保留最近 100 条错误（最近优先），进程重启即清空、不持久化。
- **进程兜底**（`installProcessGuards`）：
  - `uncaughtException` → 记录后走 graceful shutdown，让在途 run 排空，再由 systemd 重启干净进程；
  - `unhandledRejection` → 记录但不退出。
- **请求 5xx**：Hono `onError` 记录，`kind="request"`，bindings 只含 `method`/`path`。
- **worker 异常**：节点/run 执行期错误，`kind="worker"`，bindings 含 `runId`/`nodeId`。
- **只读查询接口**：owner/admin 可调 `GET /api/admin/errors?limit=100`；普通用户 403。
- **可插拔 sink**：`addErrorSink()` 注册 `ErrorSink`；内置零 SDK 参考实现 `createWebhookErrorSink()`。

设计约束：**自托管构建不引入 Sentry 等追踪 SDK**；要接外部平台，通过独立 relay 完成（见 §5/§6），主进程保持零依赖。

## 2. 数据形状与隐私边界

每条错误是一个 `ErrorRecord`：

| 字段 | 说明 |
|---|---|
| `id` | UUID，可用于 relay 侧去重 |
| `ts` | ISO-8601 捕获时间 |
| `kind` | `uncaught_exception` / `unhandled_rejection` / `request` / `worker` / `manual` |
| `name` | 错误构造名（`TypeError`、`HTTPException`…） |
| `message` | 错误信息 |
| `stack` | 调用栈，截断到 4000 字符；无则缺省 |
| `bindings` | 白名单上下文：`method`/`path`/`runId`/`nodeId` 等 |

**不采集**：cookie、`Authorization`、请求体、响应体、密钥与任何用户数据。webhook 发出去的就是上面这份对象，不含凭证。

## 3. 默认用法（不接外部平台）

零配置，二选一查看：

```bash
# 方式一：owner/admin 调只读接口（示例，端口按部署，Hasee 直连 8791 / 走 nginx 同源）
curl -s -H "Authorization: Bearer <owner-token>" http://127.0.0.1:8791/api/admin/errors?limit=50 | jq .

# 方式二：服务端日志（systemd）
journalctl -u agent-world -g "captured error" --no-pager -n 50
```

> 环形缓冲非持久，重启清空。需要长期留存/主动告警，才需要下面的 webhook。

## 4. 启用 webhook sink

在仓库根 `.env`（Hasee 路径 `/opt/agent-world/.env`，权限 600、已 gitignore）加一行：

```bash
ERROR_REPORT_WEBHOOK_URL=https://<your-relay>/intake
```

重启并确认启用：

```bash
sudo systemctl restart agent-world
journalctl -u agent-world -g "error webhook sink enabled" --no-pager -n 5
```

（也可用 `sudo systemctl edit agent-world` 加 drop-in `[Service]\nEnvironment="ERROR_REPORT_WEBHOOK_URL=..."`，再 `daemon-reload && restart`。）

**行为边界（务必知晓）**：

- 每条错误以 `POST application/json` 发送，body 即单个 `ErrorRecord` JSON。
- **不带任何鉴权头**（只有 `content-type`）。需要鉴权请：① 在 URL 内嵌一次性 token 且走 HTTPS；或 ② relay 放内网；或 ③ 前置反向代理注入鉴权头。
- **fire-and-forget**：不阻塞请求、不重试、不保证送达；relay 不可达时只在服务日志记一次 `error webhook sink failed`，且该失败不会再被当错误上报（无错误环）。
- sink 抛错已被隔离，不会拖垮主进程或触发该错误的请求。

## 5. 哪些能直连，哪些必须 relay

| 目标 | 能否直接填 URL | 原因 |
|---|---|---|
| 自建 HTTP intake、Cloudflare Worker、AWS API Gateway/Lambda、接受任意 JSON 的中继 | ✅ 直连 | 直接接收裸 JSON |
| Discord / Slack / 飞书 自定义机器人 | ❌ 需 relay | 消息体格式不同：Discord 要 `{content}`、Slack 要 `{text}`、飞书要 `{msg_type,content:{text}}`，直连返回 400 |
| Sentry | ❌ 需 relay | DSN 走 envelope/store 协议并要求 `X-Sentry-Auth`，不是裸 JSON |
| Grafana Loki | ❌ 需 relay | `/loki/api/v1/push` 要求 stream/values 结构 |
| Elasticsearch / OpenSearch `/_doc` | ⚠️ 建议 relay | 能收 JSON 但通常要 `Authorization`/API key（sink 不带），用 relay 或前置代理加头 |

## 6. Relay 示例

Relay 是**独立小服务**，与主项目分离——因此可以放心在 relay 里引 SDK 或加鉴权，不影响 agent-world 自托管构建的零依赖原则。建议部署在同机或内网，错误先到 relay，再由 relay 转换/转发。

### 6.1 最小通用 relay（Node ≥18，零依赖）

存为 `error-relay.mjs`，`node error-relay.mjs`（可用 systemd 常驻）：

```js
import http from "node:http";
const PORT = process.env.PORT || 9090;

http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/intake")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let rec;
    try { rec = JSON.parse(body); }
    catch { res.writeHead(400).end("invalid json"); return; }

    console.log(`[error] ${rec.ts} ${rec.kind} ${rec.name}: ${rec.message}`, rec.bindings ?? "");
    try {
      // 在这里转发：await forwardDiscord(rec) / forwardSentry(rec) ...
    } catch (e) {
      console.error("forward failed:", e);
    }
    res.writeHead(204).end(); // 回 2xx，避免 sink 记投递失败
  });
}).listen(PORT, () => console.log(`error relay listening on :${PORT}/intake`));
```

把 `ERROR_REPORT_WEBHOOK_URL` 指向 `http://<relay-host>:9090/intake`。

### 6.2 转发 Discord（Slack/飞书改 payload 字段即可）

```js
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function forwardDiscord(rec) {
  const content = [
    `**[${rec.kind}] ${rec.name}**`,
    rec.message,
    rec.bindings ? "```json\n" + JSON.stringify(rec.bindings) + "\n```" : "",
  ].filter(Boolean).join("\n").slice(0, 1900);

  await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}
```

- Slack incoming webhook：把 body 换成 `{ text: content }`。
- 飞书自定义机器人：把 body 换成 `{ msg_type: "text", content: { text: content } }`。
- `uncaught_exception` 通常伴随 systemd 重启，可能短时间重复推送——relay 侧建议按 `rec.id` 去重、按 `rec.name+message` 做简单降噪/限流。

### 6.3 转发 Sentry（推荐在 relay 里用 SDK）

最省事、最可靠的做法是**在独立 relay 里** `npm i @sentry/node`，收到 `ErrorRecord` 后 `Sentry.captureEvent(...)` / `captureException`——主项目依旧零 SDK。

若坚持不引 SDK，可按 Sentry store API 手写（DSN 形如 `https://<key>@o<org>.ingest.sentry.io/<project>`）：

```js
const dsn = new URL(process.env.SENTRY_DSN);
const project = dsn.pathname.replace(/^\//, "");
const endpoint = `https://${dsn.host}/api/${project}/store/`;

async function forwardSentry(rec) {
  await fetch(`${endpoint}?sentry_key=${dsn.username}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Sentry-Auth": `Sentry sentry_key=${dsn.username}, sentry_timestamp=${Date.now()}, sentry_client=agent-world-relay/1.0`,
    },
    body: JSON.stringify({
      event_id: rec.id.replace(/-/g, "").slice(0, 32),
      timestamp: Date.parse(rec.ts) / 1000,
      level: rec.kind === "uncaught_exception" ? "fatal" : "error",
      logger: "agent-world",
      message: rec.message,
      tags: { kind: rec.kind },
      extra: rec.bindings ?? {},
      exception: { values: [{ type: rec.name, value: rec.message }] },
    }),
  });
}
```

> 裸 store 协议的字段/鉴权可能随 Sentry 版本调整，上线前务必用 §7 的自检 + 真实 DSN 验证一条事件能进 Sentry；对可靠性要求高请优先用 relay 内 `@sentry/node`。

## 7. 验证（不依赖真实故障）

仓库自带一个**会等待响应、退出码反映投递结果**的自检 CLI（生产 sink 是 fire-and-forget，无法回传送达状态，故有此脚本）：

```bash
# 在 packages/server 下；URL 也可用位置参数传入
pnpm --filter @agent-world/server run selftest:errorsink -- http://127.0.0.1:9090/intake
```

退出码：

- `0` 已投递（relay 返回 2xx，且能解析 `ErrorRecord`）；
- `1` 不可达或 relay 返回非 2xx；
- `2` 未配置 URL。

建议联调顺序：

1. 先按 §6.1 在本机起 relay（`PORT=9090 node error-relay.mjs`）；
2. 跑自检 CLI，看到 relay 打印 `[error] manual ErrorSinkSelfTest ...` 且退出码 0；
3. 接上 Discord/Sentry 转发，再跑一次自检，确认目标平台收到；
4. 生产 `.env` 配**同一个 URL** 重启，看到启动日志 `error webhook sink enabled`；之后真实错误自动送达，可用 `GET /api/admin/errors` 与 relay 收到的事件对照。

## 8. 运维与安全清单

- `ERROR_REPORT_WEBHOOK_URL` 若内嵌 token，按密钥对待：只放 `.env`（600），不进仓库、不进截图、不入日志参数。
- relay 侧做：按 `id` 去重、限流/降噪、非 2xx 重试（sink 本身不重试）。
- 优先同机/内网部署 relay，减少 `message`+`stack` 外泄面；公网 relay 必须 HTTPS。
- 要长期留存/检索错误就必须接 relay——进程内环形缓冲重启即清空。

## 9. 明确不做（边界）

- 不做指标大盘 / 性能分析 / 日志聚合（属可观测性栈，触发条件见 `docs/deferred-items.md`「生产级运维线」）。
- 不自动采集请求体、响应体或任何用户数据。
- 内置 sink 不做重试、鉴权头与平台格式适配——这些职责归 relay。
