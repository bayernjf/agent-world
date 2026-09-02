# 安全审计报告与修复方案（2026-08-31）

> 状态：**现行**。本文是 2026-08-31 全量安全审计的单一事实源：全部发现、证据位置、修复方案与优先级。修复进度记在 [handoff.md](../handoff.md)，本文不重复记进度。
>
> ⚠️ 本次审计**推翻了两条此前的"已解决"结论**：DNS-rebinding 防护（check-then-fetch 双解析仍在）与 webhook secret 强制（仅覆盖单条路由，图保存路径可绕过）。引用旧安全基线时以本文为准。

## 1. 审计范围与方法

- **对象**：`feature/20260824` 相对 `main` 的全部增量（267 文件 / +65,194 行），重点为 `packages/server` 全部高风险面与 `apps/web` 渲染面。
- **方法**：三条并行深审线（注入/命令执行面、SSRF/密钥面、鉴权/数据完整性面）+ 近期 6 个提交逐条审查 + 前端渲染面扫描；所有 Critical/High 结论均由第二人逐行复核代码证据。
- **工程基线**：`pnpm -r typecheck` 4 包全过；`pnpm --filter @agent-world/server test` 在 Node 24 下 **470/470 通过**（72 个测试文件）。

## 2. 总体结论

代码工程质量良好，但安全面存在三个系统性根因：

1. **SSRF 防护是"检查点"而非"出口"**：`ssrf.ts` 只被部分调用方使用，且"先查后 fetch"的架构在除 `code-proxy.ts` 外的所有消费者身上都可绕过（重定向、DNS 双解析、provider 路径完全未接入）。
2. **存储/持久层缺约束**：存储键直接 `join` 无路径包含校验；`graphs` 的 upsert 不带 `user_id` 条件；节点 id 无字符集限制。
3. **隔离机制是"建议性"的**：代码沙箱默认后端对 Python 无隔离且失败时静默放开；worker 隔离依赖子进程自觉走 shim。

发现统计：**3 Critical / 10 High / 8 Medium / 8 Low**。

## 3. 发现清单

### Critical

| # | 问题 | 证据 | 影响 |
|---|------|------|------|
| C1 | **操作员 API Key 外泄**：`/api/providers/test` 收到调用方 `baseUrl` + `providerName` 时，若 body 密钥为空/已脱敏，服务端解析出**已保存的真实密钥**并以 `Bearer` 附在请求里 POST 到调用方指定的 URL | `index.ts:625-695`（解析 650-656，发送 687-691） | 任何注册用户一条请求即可窃取运营方内置 provider（AGNES）的网关密钥 |
| C2 | **任意文件写**：节点 id 仅 `z.string().min(1)` 无字符集限制 → 引擎以 `${nodeId}-file` 等拼 artifact id → `LocalStorageBackend.path` 是裸 `join(baseDir, key)`，`put` 无路径包含校验 | `core/graph.ts:769`、`engine.ts:1184/1036/2047`、`storage.ts:39-45` | 构造 `../../...` 形式的节点 id，服务端进程可写任意路径（内容=节点输出，可控）；绕过一切代码沙箱 |
| C3 | **HTTP 节点 SSRF 重定向绕过**：防护只校验初始主机名，`fetch` 未设 `redirect: "manual"`，默认跟随 | `engine.ts:1100-1125` | 公网 URL 302 → `169.254.169.254` 等，响应体成为节点产物 = 完整的内网读原语 |

### High

| # | 问题 | 证据 |
|---|------|------|
| H1 | **跨租户图覆盖**：`PUT /api/graphs/:id` 不校验 body `id` 与路由参数一致；`saveGraph` 无 `If-Match` 时落到 `insertGraph`，其 `ON CONFLICT(id) DO UPDATE` **不带 `user_id` 条件** | `index.ts:522-557`、`db.ts:266-269` |
| H2 | **Webhook secret 绕过**：非空强制只在 `POST /api/graphs/:id/triggers`；`PUT` 图会整体持久化 `triggers`，schema 允许 `webhookSecret: ""`，`fireWebhook` 中 `"" === ""` 匹配成功 → 匿名触发运行 | `triggers.ts:43-51/111-116`、`core/graph.ts:818-846`、`index.ts:522/1001-1066` |
| H3 | **DNS-rebinding TOCTOU**：`hostIsInternal()` 解析一次，`fetch(hostname)` 独立再解析；`ssrf.ts:6-11` 注释声称已防，实际未防（TTL-0 先公网后内网即可绕过） | `ssrf.ts:6-11`、`engine.ts:1100→1120`、`index.ts:1529→1532` |
| H4 | **IPv6 十六进制映射绕过**：`ipv6IsInternal` 只认点分嵌入形式；`http://[::ffff:7f00:1]/`（=127.0.0.1）、`[::ffff:a9fe:a9fe]`（=169.254.169.254）不命中 | `ssrf.ts:37-38` |
| H5 | **Provider baseUrl 完全绕过防护 + 密钥转发**：provider 调用从不经过 `hostIsInternal`；imageGen/videoGen/audioGen 节点配置支持 `baseUrl` 覆盖，且 `config.apiKey || provider.apiKey` 回退 → 图作者把 baseUrl 指向自己、省略 apiKey，服务端就把已存 provider 密钥 Bearer 发过去 | `openai-compatible.ts:96/116/246/436-457/512-534/602-620`、`engine.ts:3054/3108/3163` |
| H6 | **Provider 响应 URL 无防护抓取**：响应里的图片/视频 `url` 直接 `fetch`（baseUrl 用户可控，"provider"可返回任意 url），字节落为可下载产物 | `openai-compatible.ts:484/566/582` |
| H7 | **HTTP source connector 无防护**：`fetch(c.url)` 带用户可控 method/headers/auth，响应体直接作为源素材输出 | `connectors.ts:126-141`、`engine.ts:1007`、`index.ts:1075` |
| H8 | **代码沙箱 fail-open**：权限门探针失败时 gate 记为 `"none"` 且照常执行（Python 只有 `ulimit`，从无 fs/net 隔离；JS 门在 Node <22.2 静默失效），与文档承诺的 `fs: "sandbox"` 不符 | `code-sandbox.ts:186-215`、`engine.ts:1323-1336` |
| H9 | **隔离 worker fs 白名单可绕**：`checkFsPath` 用裸 `startsWith`（无归一化、无分隔符检查，`/allowed/x/../../etc/passwd` 通过；允许 `/data/app` 即允许 `/data/app-secret`）；`TOOL_FS_ALLOW` 未设置时**完全不检查** | `isolation.ts:184-189,191-236` |
| H10 | **Worker"隔离"是协作式的**：`fs-loader.mjs` 只拦截 `node:fs/promises` 规范名；子进程直接 `import node:fs / node:child_process / node:http` 即获得全部能力。唯一硬边界是 env 裁剪 | `fs-loader.mjs:9-17`、`isolation.ts:244-253` |

### Medium

| # | 问题 | 证据 |
|---|------|------|
| M1 | Webhook secret 非常量时间比较、无时间戳/防重放（检查在副作用之前是对的） | `triggers.ts:111-114` |
| M2 | **归属校验缺口（越权）**：`DELETE /api/graphs/:id/triggers/:tid` 不查归属；`POST /api/runs/:id/cancel` 无归属检查；`GET /api/runs/:id/stats`、`GET /api/ab/:groupId` 是无 user_id 过滤的查询（跨用户泄露成本/提示词） | `index.ts:1016/1198/747/1122`、`db.ts:604/1146` |
| M3 | **开放注册**：`/api/auth/register` 无门槛，放大 C1 攻击面，且每个注册者可消耗内置 provider 配额 | `index.ts:199-218` |
| M4 | **readArtifact `up-` 兜底路径穿越**：路由段 `[^/]+` 捕获后 `decodeURIComponent`，`up-%2e%2e%2f...` 解码成穿越 id，经无约束的 `LocalStorageBackend.get` 读任意文件（图配置 `source.images` 可达，内联进模型请求/输出 = 外传通道） | `artifact-reader.ts:28-41` |
| M5 | **解压炸弹**：`unzipSync` 把上传的 DOCX/PPTX 全量解压进内存，无总量/条目上限（无 zip-slip，纯内存不落盘） | `parse-file.ts:201` |
| M6 | **code 节点 env 声明可转运服务端密钥**：`env` 接受任意变量名，`trimEnv` 后传入用户代码子进程——声明 `GITHUB_TOKEN` 等即可在用户代码里打印（与注释"服务端自身密钥从不转发"矛盾） | `core/graph.ts:292`、`engine.ts:1319` |
| M7 | **辅助出站未防护**：① skills `web_fetch` 只限 https 不查内网；② notify 节点 `webhookUrl` 盲 SSRF POST；③ **OCR 的 `langPath/workerPath/corePath` 可让 tesseract 加载并执行任意 URL 的 JS/WASM**；④ isolation 的 fetch 代理只按域名白名单、不查内网 | `skills/registry.ts:49`、`notifier.ts:107`、`ocr.ts:23-27`、`isolation.ts:171-181` |
| M8 | **前端 `javascript:` 链接不过滤**：`renderInline` 的 `[文本](javascript:...)` 直接进 `<a href>`（应用内点击即 XSS）；`product-html.ts` 的 `inlineHtml` 同理进入导出 HTML 与富文本剪贴板 | `artifact-renderers.tsx` renderInline、`lib/product-html.ts:11-18` |

### Low

| # | 问题 | 证据 |
|---|------|------|
| L1 | JWT 经 `?token=` 在**所有** /api 路由被接受（本意 SSE 兜底），密钥进日志/历史/Referer | `index.ts:301` |
| L2 | 存储层无路径包含约束（当前键均为服务端生成，属纵深防御缺口；`GET /api/artifacts/:id` 302 直接重定向到存储的 `uri`，未校验协议） | `storage.ts:39-41`、`index.ts:1572-1573` |
| L3 | ~~API Key 明文存 sqlite `settings.data`~~（已修复：settings 落盘 AES-256-GCM 加密，见 [design-at-rest-encryption](design-at-rest-encryption.md)）；~~webhook secret 明文存图文档~~（已修复：graphs.doc / graph_versions.snapshot / runs.snapshot 三处 webhookSecret 字段落盘加密，读时透明解密，兼容旧明文 lazy 迁移）；~~`CORS_ORIGINS="*"` + `credentials:true` 组合应拒绝~~（已修复：`c3f5eae` 配置层拒绝）。**补记（2026-09-02）：原修复只盖了 `triggers[].webhookSecret` 一条字段路径，图文档里其余凭证仍明文**——imageGen/videoGen/audioGen/generic 的 `apiKey`、notify 的 `secret` 与 `webhookUrl`（群机器人 URL 路径里嵌着 token）、source 连接器的 `http.auth.token` 与 auth 类 `headers`，同样落在 graphs.doc 与两处快照里（本项目无“图导出成文件”功能，盘上风险面就是这几份副本）；**已修复 `f7c333f`**：`sealGraphDoc`/`openGraphDoc` 改为按字段名递归遍历（不再硬编路径），保留旧明文直通 / 幂等 / 字段顺序与无凭证图的引用同一性（明文 content hash 仍可比）；~~**残留边界**：未列入名单的自定义 header 名（如 `X-My-Auth`）里的凭证仍不拦~~（已修复 `ff223bb`：header 名由用户自定，靠名单枚举不可能穷尽，改为在 `headers` 记录内**按名字模式**匹配 auth/token/key/secret/credential/signature/password/session/cookie/bearer 并加密其值；良性 header（`Content-Type` 等）保持明文以便排查，只含良性 header 的图仍返回同一引用，sealer 四条性质不变；db 集成用例直读 doc / 两份版本快照 / run 快照原始字节断言自定义 header 凭证不在盘上）；~~**残留边界**：http 节点 `url` 查询串里内嵌的凭证（`?token=…`）仍明文落库~~（已修复 `043ce5c`：字段名命中 `URL_KEYS` 时逐参数按 `QUERY_SECRET` 精确匹配、只封凭证参数的值，endpoint 与良性参数保持可读；密文在 URL 内 percent-encode，因为 base64 的 `+` 会被服务端解成空格。同时删掉了重复的 `containsSecret` 探测器——探测与改写各写一份规则正是本轮漏修的成因）。**同日再补**：`search`/`vcs` 新增节点级凭证字段（`apiKey`/`cx`/`token`/`baseUrl`，`f914fa9`+`75f02b4`），字段名本就在 `SECRET_KEYS`/`URL_KEYS` 内故直接落在加密范围内，db 用例已把这三处计入盘上原始字节断言。**真正剩下的边界**：写进自由文本的密钥（prompt / `variables` / code 脚本正文）按定义无法识别，静态加密不覆盖 | `security.ts:34-38`、`at-rest.ts` `SECRET_KEYS` / `AUTHISH_HEADER` / `URL_KEYS` |
| L4 | code-proxy 明文 HTTP 路径允许任意端口（CONNECT 已限 80/443） | `code-proxy.ts:246-252,315` |
| L5 | vcs.ts 将 `owner/repo/number` 等直接插值进 URL（仅影响提供方主机内的路径/查询篡改） | `vcs.ts:110/124/130/139/160` |
| L6 | SerpAPI/Google key 以 URL query 参数发送（中间代理可见） | `search.ts:107/122` |
| L7 | MCP `SseMcpTransport` 接受服务端 `endpoint` 事件作为 POST 目标不校验（受 `MCP_SERVERS` 运营方配置约束）；`/api/proxy` 每跳仍有 check-vs-connect 窗口且无响应体大小上限；Teredo `2001::/32` 未覆盖 | `mcp.ts:310/335`、`index.ts:1529-1550` |
| L8 | ~~前端细节：未提交改动把"全选 / 清空"按钮改成"全选"但 `toggleAll` 仍是切换行为，文案与行为不符~~（已修复 `b6b62d4`：把 all-on 计算提到渲染作用域，已全选时按钮显示「清空」、否则「全选」，两个动作都保留但文案与行为一致；“已使用”节点仍不参与计算）；~~`routingWorker` 对缺模态的 provider 静默返回空结果（会掩盖配置错误）~~（已修复 `2797011`：routingWorker 仍返回 `[]`，但引擎侧六个媒体分支——videoGen/audioGen/imageGen 与 generic 的 image/video/audio——不再把空结果当成功，改发 `UNSUPPORTED` 并在报错里带上模型名；此前空结果会走成 node.finished + 零产物 + “生成音频 0 段”报文 + run 报 done，+4 回归用例）——**本项两半均已关闭** | `ModelAssignModal.tsx:208-210`、`providers/index.ts:68-80` |

## 4. 修复方案

按优先级分四批，每批独立可提交、可验证。

### 第一批：止血（Critical，预计半天）

| 项 | 方案 | 验收 |
|---|------|------|
| C1 | `/api/providers/test`：**绝不**为调用方提供的 `baseUrl` 解析已存密钥——`providerName` 只能同时锁定已存的 baseUrl 与密钥（二者同源），或要求 body 显式给出新密钥；内置 provider 的探测地址固定为配置端点 | 新增测试：伪造 baseUrl + providerName 组合返回 400，不发出带真实密钥的请求 |
| C2 | 双保险：① `GraphNode.id` 收紧为 `^[A-Za-z0-9._-]{1,64}$`（core schema + 前端生成器本就满足）；② `LocalStorageBackend.path()` 改为 `resolve` 后断言前缀包含于 `baseDir`，越界抛 `StorageError` | 新增测试：恶意节点 id 编译失败；`put("../x")` 抛错 |
| C3 | HTTP 节点改 `redirect: "manual"` + 逐跳（≤5）重验 `hostIsInternal`，复用 `/api/proxy`（`index.ts:1512-1558`）的既有正确模式 | 新增测试：302 到内网地址被拒 |

### 第二批：统一出站防护（High 的 SSRF 簇，预计 1-2 天）

核心动作：把防护从"检查点"重构为"受管出口"。

1. 新增 `guardedFetch(url, init)`：
   - 解析一次 DNS，**连接固定到解析出的 IP**（Host 头保留原主机名）——消除 H3 双解析；参考 `code-proxy.ts:149-161` 的现成正确实现；
   - `redirect: "manual"` + 每跳重验；
   - 内网判定改用成熟的 IP 解析（如 `ipaddr.js` 的 `range()`），覆盖 IPv6 映射/翻译/NAT64/Teredo（H4、L7）；
   - 尊重 `ALLOW_PRIVATE_NETWORK` 逃生口。
2. 全部出站调用方切换到 `guardedFetch`：HTTP 节点、provider 全部调用（含 baseUrl，H5）、provider 响应 URL 抓取（H6）、connector（H7）、notify webhookUrl、skills `web_fetch`、isolation fetch 代理（M7）。
3. **密钥不与用户可控地址组合**：节点级 `baseUrl` 覆盖时**禁止**回退到 `provider.apiKey`（H5 后半），必须同时显式给出密钥。
4. OCR 的 `langPath/workerPath/corePath` 仅允许本地路径或运营方白名单域（M7③）。

验收：`ssrf.ts` 单测补 IPv6 映射/重定向/双解析用例；每个切换点至少一条拒绝内网的引擎级测试。

### 第三批：鉴权与数据完整性（H1/H2/M2/M3，预计 1 天）

| 项 | 方案 |
|---|------|
| H1 | `insertGraph` 改为"先查归属再写"：存在但非本人 → 拒绝；同时 `PUT` 路由校验 `body.id === param.id`（不一致 400） |
| H2 | webhook secret 在**三处**强制非空：图保存路径（校验 `graph.triggers`）、`TriggerService.restore()`、`fireWebhook`（空/缺省一律拒绝）；存量空 secret 触发器恢复时置为禁用并告警 |
| M1 | 比较改 `crypto.timingSafeEqual`（定长摘要）；加 `X-Webhook-Timestamp` 5 分钟窗口（重放台账缓做，见 [deferred-items](deferred-items.md) 候选） |
| M2 | 四处补 `user_id`：trigger 删除、run cancel、`runStats`、`abReport` |
| M3 | 注册加开关 `ALLOW_REGISTRATION`（默认：已有用户时关闭，首个用户免审） |
| M4 | `readArtifact` 解码后拒绝含 `/`、`..` 或非 `[A-Za-z0-9._-]` 的 id |
| L1 | `?token=` 仅限 SSE 路由 |

验收：`api.security.test.ts` 补跨租户 PUT、trigger 删除、stats/ab 越权、空 secret 图保存共 ≥6 条用例。

### 第四批：隔离诚实化与杂项（H8-H10/M5-M6/其余，预计 1-2 天）

| 项 | 方案 |
|---|------|
| H8 | 沙箱 **fail-closed**：JS 权限门不可用且无 OS 后端（bwrap/sandbox-exec）时，按配置策略拒绝执行或显式降级为 `noop` 并标记节点失败原因；文档与 `design-code-sandbox.md` 同步"默认后端不隔离 Python"的事实 |
| H9 | `checkFsPath`：`path.resolve` + realpath 后做带分隔符的前缀包含检查；`TOOL_FS_ALLOW` 未设置 = 默认拒绝（或最小默认集），不再 fail-open |
| H10 | 文档化为"协作式边界"（对齐 design §10 口径），把硬隔离承诺移到 bwrap/容器后端；`extending.md` 的插件章节加安全警告 |
| M5 | `parse-file.ts` 改流式解压，累计字节数与条目数上限（先拒绝后展开） |
| M6 | `trimEnv` 增加敏感前缀黑名单（`*_TOKEN`/`*_SECRET`/`*_KEY` 等，可配置放行），或把密钥转发改为运营方显式开关 |
| L4/L5/L6 | code-proxy 明文路径套用 `connectPorts`；vcs 各段 `encodeURIComponent`；搜索 key 能走 header 的改 header |
| M8 | 前端统一 `sanitizeUrl`：仅放行 `http:`/`https:`/`mailto:`（img 另允 `data:image/`），`renderInline` 与 `inlineHtml` 共用 |

## 5. 已验证良好（勿重复审计）

- `__no_login__`：全仓仅 `db.ts:1682` 一处占位，实测 `bcrypt.compare` 恒 false，无任何路由/头/参数接受该值（fail-closed ✓）。
- 路由级认证：所有路由注册在 `app.use("/api/*")` 之后；仅 `/api/health`、`/api/auth/*`、`/api/graphs/:id/webhook` 豁免（webhook 豁免为设计使然，见 H2）；SSE 已认证且按归属过滤。
- `GET /api/settings` 密钥脱敏正确（有测试）；`sanitizeError` 对事件流脱敏 bearer/authorization/api_key/sk-/ark- 模式；未发现密钥进日志。
- 无命令注入：所有 `spawn` 均 argv 形式（无 `shell: true` 承接攻击者输入）；唯一 `bash -c` 包裹只插值已引号转义的非攻击者值（`code-sandbox.ts:154 q()`）。
- 无 zip-slip / symlink 逃逸（`parse-file.ts` 纯内存，条目从不落盘）。
- 重定向/跨源时 undici 按规范剥离 Authorization；CRLF 头注入被 undici 拒绝。
- `code-proxy.ts` CONNECT 路径（解析一次 + 固定 IP 连接 + 端口限制）与 `/api/proxy`（逐跳复检）是正确实现范本。
- 模板实例化：仅应用模板声明的字段（多余 `fieldValues` 被忽略），出口过 `Graph.parse` zod 校验；模板不硬编码密钥（GitHub token 走服务端环境变量）。
- 上传存储键为服务端生成（`up-<sha1>`），不可被请求参数直接操纵。

## 6. 工程与环境备注

- 仓库 `.nvmrc` 固定 **Node 24.0.0**；shell 默认 fnm v20 会因 `node:sqlite` 缺失造成 51 个测试文件假失败，跑测试用 `fnm exec --using=24`（handoff Quality gate 已有同款记录）。
- 测试有轻微 flaky：470 用例中曾偶发 1 个失败（复跑全绿），修复批次提交时如遇偶发失败需复跑确认而非忽略。
- 未提交改动 `ModelAssignModal.tsx`（"全选"按钮文案）与本报告 L8 相关，随第四批一并处理。
