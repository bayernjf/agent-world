# 全项目代码审计报告

> 审计时间：2026-09-06。范围：monorepo 全部 ~~5 个包~~ **4 个包**（`packages/core`、`packages/server`、`packages/mcp-server`、`apps/web`）。性质：**代码质量 / 资源管理 / 安全审计**。方法：按包分模块并行审计，仅记录可确证的代码逻辑问题。
>
> 结论：共 ~~**56 个问题**（high 7 / medium 28 / low 21）~~ ~~**57 个问题**（high 7 / medium 25 / low 25）~~ **77 个问题**（high 8 / medium 38 / low 31；2026-09-07 深度复审新增 20 项：high +1 / medium +13 / low +6）。**最严重的是 4 个 server 侧任意文件/数据库读取（越权读密钥）+ 1 个 mcp-server 无鉴权 + 2 个 web XSS（artifact-renderers 未消毒 URL + /api/proxy 反射型）**，建议优先修复。

## 一、高危（high，~~7 个~~ 8 个）—— 必须优先修复

### server

1. `connectors.ts:124` — `file` 连接器用 `expandPaths(c.path)` 直接读用户提供的路径，无白名单/沙箱；配合 `/api/connectors/test`（任意登录用户可调用）可读取 `.jwt-secret`、`.encryption-keys`、数据库等敏感文件并回显。
2. `connectors.ts:203` — `database` 连接器用 `new DatabaseSync(c.path, {readOnly:true})` 打开任意用户提供的 SQLite 路径，任意登录用户可查询主库 `users`/`settings` 表，跨用户泄露凭据。
3. `triggers.ts:226` — 批量触发器 `batch.path` 未校验，`fs.readFileSync` 直接读任意服务器文件，可读密钥/数据库并流入运行结果外传。
4. `code-sandbox.ts:354` — 默认 `rlimit` 后端下 Python 代码节点无文件/网络隔离，仅叠加 ulimit；用户代码可读服务器进程可访问的密钥并主动外发。**注意：这是已知的诚实边界**（[design-code-sandbox.md §6](design-code-sandbox.md) 明确标注「Python 没有进程级权限模型」，JS 代码经 `--experimental-permission` 有隔离，Python 仅 ulimit）。作为安全审计仍列 high，因为默认后端下风险真实存在；生产若要硬隔离须切到 P2 后端（bwrap/sandbox-exec）。
5. `nodes/subprocess.ts:121` + `nodes/fanout.ts:88` — 子运行 `childInit.totalCostUsd` 恒为 0（`runScheduler` 从不回写），子流程/泳道成本漏记，父运行预算与成本统计失真。

### mcp-server

6. `mcp-server/src/http.ts:60` — HTTP 传输层注释声称把客户端 Bearer token 透传给后端，但实现里 `AgentWorldClient` 用的是 env `AGENT_WORLD_TOKEN`（`config.ts:21`），从不解析客户端 Authorization header；任意能连到 `127.0.0.1:3100` 的本地进程都能借 env token 执行 `delete_graph`/`run_graph` 等写操作。风险限于 localhost 可达的本地进程。

### web

7. `apps/web/src/lib/artifact-renderers.tsx:306`（及 230/237/273/390 行）— `UriArtifact` 将原始 `a.uri` 直接写入 `<a href>`，未过 `sanitizeUrl`，`javascript:` 等危险 scheme 可注入造成 XSS。

### server（补充，2026-09-07 深度复审新增）

8. `index.ts:2981` — `/api/proxy` 将上游响应的 `Content-Type` 原样回传（`text/html` 亦然）且无 `X-Content-Type-Options: nosniff`，攻击者可诱导已登录用户访问 `/api/proxy?url=<恶意HTML>`，在应用源站渲染任意 HTML 执行脚本（反射型 XSS），代受害者调用任意 `/api`。

## 二、中危（medium，~~28 个~~ ~~25 个~~ 38 个）

### server 引擎 + 节点（~~7~~ 5，+新增 6 = 11）

| 位置 | 问题 |
|---|---|
| `engine.ts:1091-1094` | `runNode` 对已中止的 `signal` 提前 `return`，不执行 `running--`，`running` 永久 >0，运行无法 `finish`，事件流挂起 |
| `nodes/imagegen.ts:53` / `audiogen.ts:61` / `videogen.ts:65` / `generic.ts` 多处 | 计算了 `usage.costUsd` 却不累加进 `ctx.totalCostUsd`，媒体节点预算检查与成本计量失效 |
| `nodes/fanout.ts:85` / `subprocess.ts:113` | 子运行 `artifact.produced` 只前缀 `nodeId`，~~父 `emit` 再前缀，产物 id 双前缀~~（复核：`prefixEvent` 仅重写 `nodeId`、`mergeSubInit` 仅给 map key 加前缀，`artifact.id` 实际完全未加前缀，即“零前缀”而非“双前缀”）；多泳道复用同一子图时 id 冲突被 DB 去重丢弃 |
| `nodes/compliance.ts:47` | `result.sanitized \|\| result.original` 真值判断，~~`sanitized` 为空串时回退到可能违规的原始文本，合规被绕过~~（复核：`sanitized` 恒非空——初始化为 `text` 且仅做 banned 词替换、替换值非空，`\|\|` 回退分支实际不可达，无真实绕过后果） |
| `nodes/compliance.ts:48-50` / `publish.ts:39-41` / `source.ts:81-92` | 文本产物写入 artifacts 后未 emit 文本产物事件，resume 后下游拿不到合规/发布/brief 文本 |
| `nodes/generic.ts:36-73` | generic 节点 **text 模态**调用 `runTextGen` 产生 LLM 成本，但四模态均只把 `costUsd` 累加进局部 `usage`、从不 `ctx.totalCostUsd +=`、不 emit `power.metered`、不检查预算（textGen/translate 有完整检查），通用节点 LLM 成本完全不计费 **（新增）** |
| `nodes/translate.ts:144-160` | 累加 `totalCostUsd` 后仅检查节点预算 `cfg.budgetUsd`，从不检查全局 `budgetUsd`（无 `power.tripped`/`budgetWarned`），translate 可绕过整线预算无限消费 **（新增）** |
| `nodes/http.ts:139-142` | `outputMode:"file"` 时 `response.arrayBuffer()` 无字节上限，任意大响应整块载入内存（fileParse 有 5MB 上限，http 下载无） **（新增）** |
| `run.ts:132` | `storeBinary` 回调硬编码 `kind:"image"`，video/audio/file 节点生成的字节落库时 kind 全部记为 image，产物归类错误 **（新增）** |
| `run.ts:147,158-160` | 完成的 run 的 `entry` 仅置 `done=true` 不从 live Map 删除，`entry.events` 累积全部事件无上限/LRU，完成 run 的内存副本永久驻留（内存泄漏） **（新增）** |
| `providers/openai-compatible.ts:522,545` | `generateImage` 首次请求 finally 里 `clearTimeout`+`removeEventListener` 后，下载 `item.url` 复用已失效的 `controller.signal`，图片下载无超时/取消保护，故障 URL 永久挂起 **（新增）** |

### server 安全 + 持久化（2，+新增 1 = 3）

| 位置 | 问题 |
|---|---|
| `ssrf.ts:156` | `PROXY_DENIED_HOSTNAME` 只拦字面 IP 与 `localhost/.local/metadata`，未覆盖 `nip.io`/`sslip.io` 及十进制/十六进制 IP，配代理后 SSRF 可访问内网 |
| `index.ts:266` / `index.ts:234` | `/api/auth/login` 与 `/api/auth/register` 无速率限制或失败退避，可暴力破解口令或批量注册 |
| `ssrf.ts:347` | `guardedFetch` 跨域重定向仅剥离 `authorization/cookie` 四个头，用户配置的自定义凭据头（如 `x-api-key`/`x-auth-token`）会转发到重定向目标，凭据外泄 **（新增）** |

### mcp-server（5，+新增 1 = 6）

| 位置 | 问题 |
|---|---|
| `config.ts:22` | `Number()` 未校验，`AGENT_WORLD_REQUEST_TIMEOUT_MS` 非法值得到 `NaN`，`AbortSignal.timeout(NaN)` 抛 TypeError 导致所有请求失败 |
| `http.ts:38` | `parseBody` 无请求体大小/读取时间限制，可被超大流式 body 耗尽内存（DoS） |
| `client.ts:124` | 二进制产物 `downloadUrl` 直接 `u.toString()` 不带 Bearer token，主服务开鉴权后下载链接失效 |
| `notifications.ts:83` | SSE 流只按 `\n\n` 分帧，未处理 `\r\n` 行尾，上游用 CRLF 则帧永不切分、`buffer` 无限增长 |
| `tools.ts:455` | `waitForRuns` 捕获异常后直接标 `error` 且不重试，瞬时网络错误误判 run 失败 |
| `tools.ts:293-313` | `batch_run` 的 `inputs` 只校验非空、无数量上限，客户端可传超大数组触发无界次 `startRun`（资源耗尽/DoS） **（新增）** |

### web（7，+新增 3 = 10）

| 位置 | 问题 |
|---|---|
| `store/run.ts:124` | `loadRun` 中 `api.getEvents(runId)` 无 try/catch，失败产生未处理 Promise rejection |
| `store/graph.ts:690` | `flushSave` 捕获保存异常后仅置 `saveState` 不抛出，切图时无法得知保存失败，丢弃未保存修改 |
| `canvas/Canvas3D.tsx:384` | 拖节点 `pointermove/up` 只绑 `renderer.domElement` 且未 `setPointerCapture`，画布外松手则 `draggingNodeId`/`controls.enabled=false` 残留，相机冻结 |
| `lib/api.ts:777/798` | `listBrandTerms`/`listBannedTerms` 未检查 `res.ok` 就 `res.json()`，401/500 被当成功返回 |
| `store/run.ts:54` | `JSON.parse(msg.data)` 无保护，SSE 返回非法 JSON 时回调内抛异常且不触发重连 |
| `canvas/Canvas3D.tsx:80` | `renderer.setSize` 只在初始化执行一次，无 ResizeObserver，面板折叠/窗口变化后画布不随容器缩放 |
| `store/graph.ts:298` | 自动保存失败仅 `console.error` 置 `saveState:"error"`，无用户可见提示 |
| `store/run.ts:109-137` | `loadRun` 与 `connect` 无取消/代际守卫，`loadRun` 的 async 结果会整体覆盖 `connect` 已建立的 live 状态（stale 竞态） **（新增）** |
| `lib/api.ts:790-1017` / `RunCompare.tsx:63-68` / `ProductGallery.tsx:95-115` / `KnowledgePanel.tsx` / `BatchManager.tsx` | 多处 fetch/DELETE 不检查 `res.ok`、无 catch——删除失败被静默当成功、非 2xx 时 `statsA.cost_usd.toFixed(4)` 抛 TypeError 崩溃、API 失败产生未处理 rejection 且 loading 卡死 **（新增）** |
| `canvas/Canvas3D.tsx` | effect 依赖仅 `[graph]`，每次 graph 变更（拖拽/updateNode）销毁重建整个 WebGLRenderer+灯光+全部 tube 几何体，3D 视图下每次编辑开销极大 **（新增）** |

### core（~~7~~ 6，+新增 2 = 8）

| 位置 | 问题 |
|---|---|
| `pricing.ts:124` | `cachedTokens > 0` 且未配 `cacheRead` 时缓存 token 与 `input` 重复计费 |
| `platforms.ts:260-319` | 标题违禁词的 `span` 区间被套用到正文 `text` 做 autoFix，且替换后不调整后续区间，重叠违禁词错位替换产出损坏文本 |
| `artifact.ts:101` | bare URL 正则未排除 Markdown 图片 URL，~~`![alt](url)` 被重复提取为带 `)` 的无效 artifact~~（复核：仅当图片 URL 带 query 参数时才会被重复提取为带 `)` 的无效 artifact；无 query 时与 mdImg 提取结果相同、被 `seen` 去重，不重复） |
| `variables.ts:259` | 字符串拼接判断只查左操作数，`"1"+"abc"` 返回 `NaN`，分支条件误判 |
| `templates.ts:96` | 节点 id 引用重写按前缀替换，`ocr` 会先破坏 `ocrFallback` 的引用 |
| `templates.ts:2263` | 「目的地」模板字段被应用到 `research` 的 `http.url`，填非 URL 值破坏请求 |
| — | ~~（见下 core low 补充）~~ 悬空引用：low 部分的 core 条目均已单列，无对应补充条目 |
| `variables.ts:133` | `CondParser.parse()` 只 `skipWs()` 后 return、不校验 `pos === src.length`，`"1 == 1 garbage"` 尾随垃圾被静默忽略返回真值，违反「Malformed expressions evaluate to false」承诺 **（新增）** |
| `graph.ts:887/962/394` | 三层 schema 校验过宽：① GraphNode 各 kind 专属配置 `.optional()` 但含必需字段（`{kind:"imageGen"}` 缺 imageGen 配置可通过 parse、运行期才崩）；② ConnectorConfig `type` 与子配置不联动（`type:"database"` 缺 database 通过）；③ FanoutConfig prompts/temperatures/models 未与 `count` 联动，运行期取 lane 参数越界/undefined **（新增）** |

## 三、低危（low，~~21 个~~ ~~25 个~~ 31 个，含下方「3D 视图补充」4 条）

### server（7，+新增 3 = 10）
- `nodes/http.ts:50-56` — query 模板求值异常被静默吞掉并跳过参数
- `nodes/code.ts:78,87` — `registerNetToken`/`createCodeWorkdir` 在 `try/finally` 外，workdir 创建失败时 token 不注销、目录不清理
- `nodes/parallel.ts:51` / `map.ts:76-77` — `truncateText(content, 60)` 当 `content.length <= 60` 产生负「已截断」标记并截掉开头
- `permissions.ts:95` — 文件系统白名单 `startsWith` 前缀匹配，`/data/foo` 放行 `/data/foobar`
- `db.ts:1178` — `graph_variables` 值 `JSON.stringify` 明文落盘，未做 at-rest 加密
- `index.ts:229` — `clientIp` 无条件信任 `X-Forwarded-For` 首跳，审计 IP 可伪造
- `index.ts:239` + `db.ts:986` — 首个 owner 引导存在 TOCTOU，~~并发注册时输家收到未捕获 500~~（复核：单进程下 `createUser` 内 `countOwners` 查询与 INSERT 为同一段同步调用，后到者被正确分配为普通 `user`，不触发 500；仅多进程/多实例并发写或邮箱并发撞唯一索引时才产生未捕获 500）
- `nodes/select.ts:106` — select 节点开头未 emit `node.started`，却在 setTextArtifact 之后、node.finished 之前补发，事件流中 node.started 时序错乱 **（新增）**
- `providers/index.ts:23,35` — routingWorker 的 worker 缓存 Map 无上限，cacheKey 含 model/baseUrl/apiKey，频繁换模型/baseUrl 会无界累积 worker 实例 **（新增）**
- `index.ts:2888,2904,3034` — `/api/artifacts/upload` 将原始 `Content-Type` 存为 mimeType 并原样回显，认证用户可上传 text/html 获得直链（自 XSS，跨用户影响有限） **（新增）**

### mcp-server（7，+新增 1 = 8）
- `server.ts:51` — `capabilities.resources` 未声明 `subscribe: true`，推送订阅失效
- `tools.ts:274` — `search_knowledge` 的 `limit` 未限制 1–50
- `tools.ts:391` — `get_run_events` 先设 `runId/count` 再展开 `...body`，上游同名字段覆盖计算结果
- `tools.ts:460` — `runIds` 空时误报「全部 0 次运行已完成」
- `index.ts:67` — stdio `onData` 并发执行共享 `buffer`，消息处理未串行化，有乱序/竞态
- `index.ts:43` — `process.stdout.write` 未处理 `error`/EPIPE，客户端关闭 stdout 时可能未捕获异常退出
- `client.ts:34` — `AbortError` 超时被统一包装为「主服务不可达」，误导
- `notifications.ts:158` — `broadcast` 中 `sink.write(frame)` 若 `res.write` 抛异常（连接已断但 close 未到），异常沿 Bridge.start 传播为未捕获 rejection **（新增）**

### web（4）
- `App.tsx:66` — `useGraph()` 不带 selector 订阅整个 store，任意状态变化重渲染整个 App
- `App.tsx:125` — `onDragStart` 在 document 加的 `mousemove/mouseup` 监听~~无卸载清理，泄漏~~（复核：正常 `mouseup` 时 `onUp` 会 `removeEventListener` 清理；仅组件在拖拽中途卸载时命令式监听残留，缺 `useEffect` 兜底清理）
- `lib/artifact-renderers.tsx:62` — `renderMarkdown` 有序列表也渲染成 `<ul>`，丢序号
- `canvas/Minimap.tsx:184` — 拖动 effect 依赖含 `viewport`，拖动中每次 `setViewport` 都拆除重挂监听器

### core（3，+新增 2 = 5）
- `table.ts:71` — CSV 解析逐字符比较 `delimiter`，1-4 字符分隔符（如 `||`）永不识别
- `compile.ts:221` — 返工边 `from === to` 时跳过回指校验，gate/textGen 自环被静默放行
- `compile.ts:54` — `topoSort` 每弹节点都线性扫全部边，O(V·E)，大图编译慢
- `graph.ts:1012` — `TriggerConfig` 跨字段约束缺失：`type:"cron"` 不要求 `cron`、`type:"webhook"` 不要求 `webhookSecret`、`batch.source:"csv"` 不要求 `path`，非法触发配置可静默入库 **（新增）**
- `compile.ts:235` — rework 的 `body` 过滤用 `ancestors.has(id)` 收集 gate 全部 flow 祖先，会把与返工路径无关的兄弟上游分支一并纳入重跑集合，返工时多余重跑无关节点 **（新增）**

### 3D 视图补充（web/canvas，4）—— 专项审计发现的资源/竞态

- `canvas/Canvas3D.tsx` cleanup — 节点 base 多面材质数组（每节点 6 个）不 dispose，反复切换视图泄漏 GPU 内存
- `canvas/Canvas3D.tsx` — `useEffect` 依赖 `[graph]` 但 `camera3d` 闭包陈旧，图更新后相机恢复竞态
- `canvas/Canvas3D.tsx` loop — 每帧 `setGroupEmissive` 冗余遍历所有节点（选中状态不常变）
- `canvas/Canvas3D.tsx` — `GridHelper` 材质未 dispose

## 四、修复建议（优先级）

1. **P0（安全，立即）**：server 4 个任意文件/数据库读取（connectors file/database、triggers batch、code-sandbox）+ mcp-server 无鉴权 + 2 个 web XSS（artifact-renderers 未消毒 URL + /api/proxy 反射型）。这些是可被越权利用的漏洞。
2. **P1（正确性）**：成本漏记（subprocess/fanout/media）、产物 id 双前缀、文本产物事件缺失、`runNode` abort 挂起 —— 这些影响运行结果/成本/恢复正确性。
3. **P2（健壮性）**：登录速率限制、SSRF 绕过、`Number()`/`JSON.parse`/`res.ok` 等输入健壮性、Canvas3D pointer/resize。
4. **P3（性能/可维护性）**：topoSort、每帧 emissive、minimap 硬编码、useGraph 无 selector 等。

> 完整明细（含修复方向）见各模块审计结论。本报告为汇总版，可直接作为修复 backlog。

## 六、修复状态（2026-09-07 修复记录）

> 标注：✅ 已修复 / ⚠️ 未修复（附原因）/ ➖ 复核后无需修复（后果不成立）。凡 ✅ 的改动均已通过 `pnpm -r typecheck` + core 188/188、server engine 46 + core-path 18 + connectors 40、mcp 50 全绿。

### 高危（8）

| # | 位置 | 状态 |
|---|---|---|
| H1 | `connectors.ts:124` file 任意读 | ✅ 新增 `fs-guard.ts`：拒绝隐藏文件/服务器 DB/越界路径 |
| H2 | `connectors.ts:203` database 任意读 | ✅ 同 `assertSafeLocalPath` 包裹 `DatabaseSync` 路径 |
| H3 | `triggers.ts:226` batch 任意读 | ✅ 同 `assertSafeLocalPath` |
| H4 | `code-sandbox.ts:354` Python 无隔离 | ⚠️ 诚实边界：需运维切 `CODE_SANDBOX=bwrap/sandbox-exec`，代码已诚实标注 |
| H5 | `subprocess/fanout` 成本恒 0 | ✅ `finish()` 回写 `opts.init.totalCostUsd` |
| H6 | `mcp http.ts` 无鉴权 | ✅ `AgentWorldClient.withToken` + HTTP 层解析 `Authorization` header |
| H7 | `artifact-renderers` XSS | ✅ 5 处 `href` 过 `sanitizeUrl` |
| H8 | `/api/proxy` 反射 XSS | ✅ content-type 白名单 + `nosniff` |

### 中危（38）

| # | 位置 | 状态 |
|---|---|---|
| M1 | `engine.ts:1091` runNode abort 挂起 | ⚠️ 未修复：调度器核心 `running` 计数，需专项回归 |
| M2 | media 节点成本不累加 | ✅ imagegen/audiogen/videogen 加 `totalCostUsd +=` + `power.metered` |
| M3 | fanout/subprocess 产物 id 零前缀 | ⚠️ 未修复：需改 `prefixEvent`/`mergeSubInit` + DB 主键 |
| M4 | `compliance.ts:47` sanitized\|\|original | ➖ 复核后无需修复（sanitized 恒非空，回退不可达） |
| M5 | compliance/publish/source 未 emit 文本产物 | ⚠️ 未修复：需补 `artifact.produced` 文本事件 |
| M6 | `generic.ts` text 成本 | ✅ 四模态统一累加 |
| M7 | `translate.ts` 全局预算绕过 | ✅ 补全局/月度预算检查（对齐 textGen） |
| M8 | `http.ts` outputMode file 无上限 | ✅ 流式读取 + 25MB 上限 |
| M9 | `run.ts:132` storeBinary kind 硬编码 | ✅ 按 mimeType 推断 image/video/audio/file |
| M10 | `run.ts` live Map 泄漏 | ✅ `finally` 里 `live.delete(runId)` |
| M11 | `openai-compatible` 下载无超时 | ✅ 独立 AbortController + 超时 |
| M12 | `ssrf.ts:156` PROXY_DENIED_HOSTNAME | ✅ 增强 nip.io/十进制/十六进制 IP |
| M13 | login/register 无速率限制 | ⚠️ 未修复：需引入 rate limiter 中间件 |
| M14 | `ssrf.ts:347` 自定义凭据头外泄 | ✅ `SENSITIVE_HEADER` 正则剥离 |
| M15 | `mcp config.ts:22` Number NaN | ⚠️ 未修复 |
| M16 | `mcp http.ts:38` parseBody 无限制 | ⚠️ 未修复 |
| M17 | `mcp client.ts:124` downloadUrl 无 token | ⚠️ 未修复 |
| M18 | `mcp notifications.ts:83` CRLF | ⚠️ 未修复 |
| M19 | `mcp tools.ts:455` waitForRuns 不重试 | ⚠️ 未修复 |
| M20 | `mcp tools.ts` batch_run inputs 无上限 | ✅ `MAX_BATCH_INPUTS=500` |
| M21 | `web store/run.ts` loadRun 无 try/catch | ⚠️ 未修复（仅加了竞态守卫，未包 try/catch） |
| M22 | `web store/graph.ts` flushSave 不抛出 | ⚠️ 未修复 |
| M23 | `web Canvas3D.tsx` pointer 拖拽残留 | ⚠️ 未修复 |
| M24 | `web lib/api.ts` listBrandTerms/BannedTerms res.ok | ⚠️ 未修复（只修了 DELETE，list 未修） |
| M25 | `web store/run.ts` JSON.parse 无保护 | ✅ try/catch |
| M26 | `web Canvas3D.tsx` setSize 无 ResizeObserver | ⚠️ 未修复 |
| M27 | `web store/graph.ts` 自动保存无提示 | ⚠️ 未修复 |
| M28 | `web store/run.ts` loadRun/connect 竞态 | ✅ generation 守卫 |
| M29 | web 多处 fetch/DELETE 不查 res.ok | ✅ api DELETE + RunCompare + ProductGallery + KnowledgePanel + BatchManager |
| M30 | `web Canvas3D.tsx` effect 依赖 [graph] 重建 | ⚠️ 未修复：需拆分 effect 依赖 |
| M31 | `core pricing.ts:124` cachedTokens 重复计费 | ⚠️ 未修复 |
| M32 | `core platforms.ts` span 套用正文 | ⚠️ 未修复 |
| M33 | `core artifact.ts:101` bare URL | ⚠️ 未修复 |
| M34 | `core variables.ts:259` 字符串拼接 | ⚠️ 未修复 |
| M35 | `core templates.ts:96` ocr 前缀 | ⚠️ 未修复 |
| M36 | `core templates.ts:2263` 目的地字段 | ⚠️ 未修复 |
| M37 | `core variables.ts:133` CondParser 尾随垃圾 | ✅ pos 校验 + 短路时始终解析右边 |
| M38 | `core graph.ts` 三层 schema 校验过宽 | ⚠️ 部分：FanoutConfig count 联动已加；ConnectorConfig/GraphNode 未改（怕破坏历史数据加载） |

### 低危（31）

| # | 位置 | 状态 |
|---|---|---|
| L1 | `http.ts:50-56` query 吞异常 | ✅ 加 `ctx.log.warn` |
| L2 | `code.ts:78,87` token/workdir 在 try 外 | ✅ 守卫 + 失败预清理 |
| L3 | `parallel/map` truncateText 负数 | ✅ `shared.ts` 加 `length <= maxChars` 早返回 |
| L4 | `permissions.ts:95` startsWith 前缀 | ✅ `isPathUnder` 路径边界 |
| L5 | `db.ts:1178` graph_variables 明文 | ⚠️ 未修复：需接入 at-rest 加密 |
| L6 | `index.ts:229` clientIp 信任 XFF | ⚠️ 未修复：需 trusted proxy 白名单 |
| L7 | `index.ts:239`+`db.ts:986` TOCTOU | ➖ 复核后无需修复（单进程同步重检弥合） |
| L8 | `select.ts:106` node.started 时序 | ✅ 开头 emit、删末尾补发 |
| L9 | `providers/index.ts` routingWorker 缓存 | ✅ LRU 64 |
| L10 | `/api/artifacts/upload` 危险 content-type | ✅ text/html/svg 降级 octet-stream |
| L11 | `mcp server.ts:51` capabilities subscribe | ✅ `resources: { subscribe: true }` |
| L12 | `mcp tools.ts:274` limit 未限 | ✅ `clampInt 1-50` |
| L13 | `mcp tools.ts:391` spread 覆盖 | ✅ `...body` 前置 |
| L14 | `mcp tools.ts:460` runIds 空误报 | ✅ `runIds.length > 0` 前置 |
| L15 | `mcp index.ts:67` onData 共享 buffer | ⚠️ 未修复 |
| L16 | `mcp index.ts:43` stdout EPIPE | ⚠️ 未修复 |
| L17 | `mcp client.ts:34` AbortError 误导 | ✅ 区分超时/不可达 |
| L18 | `mcp notifications.ts:158` broadcast write | ⚠️ 未修复 |
| L19 | `web App.tsx:66` useGraph 无 selector | ⚠️ 未修复 |
| L20 | `web App.tsx:125` onDragStart 清理 | ⚠️ 未修复（仅中途卸载残留，复核已降级） |
| L21 | `web artifact-renderers.tsx:62` 有序列表 | ✅ ol/ul 区分 |
| L22 | `web Minimap.tsx:184` effect 依赖 | ⚠️ 未修复 |
| L23 | `core table.ts:71` 多字符分隔符 | ⚠️ 未修复 |
| L24 | `core compile.ts:221` 返工自环 | ⚠️ 未修复 |
| L25 | `core compile.ts:54` topoSort O(V·E) | ⚠️ 未修复 |
| L26 | `core graph.ts:1012` TriggerConfig 约束 | ⚠️ 未修复（运行时已有兜底，加严格校验有历史数据风险） |
| L27 | `core compile.ts:235` rework body 祖先 | ⚠️ 未修复（可能为设计意图） |
| L28 | 3D 材质不 dispose | ⚠️ 未修复 |
| L29 | 3D camera3d 闭包竞态 | ⚠️ 未修复 |
| L30 | 3D 每帧 setGroupEmissive | ⚠️ 未修复 |
| L31 | 3D GridHelper 未 dispose | ⚠️ 未修复 |

### 汇总

- **已修复：34 项**（high 7 / medium 14 / low 13）
- **无需修复：2 项**（M4、L7，复核后后果不成立）
- **部分修复：1 项**（M38，FanoutConfig 已修，其余未改）
- **未修复：40 项**（high 1 / medium 23 / low 16）

**未修复项归因**（供后续接力时按类推进）：
1. **诚实边界 / 运维配置**：H4（Python 隔离，切 P2 后端）。
2. **需专项重构 / 回归**：M1（runNode abort）、M3（产物 id 前缀）、M5（文本产物事件）、M13（速率限制中间件）、M30（Canvas3D effect 拆分）。
3. **需配套迁移（怕破坏历史数据）**：M38 的 ConnectorConfig/GraphNode、L5（at-rest 加密）、L6（proxy 白名单）、L26（TriggerConfig）。
4. **低优健壮性 / 性能**：M15-M19、M21-M24、M26-M27、M31-M36、L15-L16、L18-L20、L22-L25、L27-L31。
5. **复核后判定为设计意图 / 风险低**：L20（已降级）、L27。
