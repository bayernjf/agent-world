# Changelog

All notable changes are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed
- **修掉「MCP 在设置面板里配」这个不存在的功能** — [extending.md](docs/extending.md) §3 让读者去「settings panel」配 MCP server，**这个面板从来没有被造出来**（`apps/web/src` 里除术语表一行解释文字外零 MCP UI，`/api/mcp` 只有只读 GET）。这不是过期而是错的：会让人去找一个不存在的界面。同节还在宣传「5 张卡全是 tool kind」（实为 11 张、四种 kind）。顺带把两个一直没写进文档的现状盘明：① **接第三方 MCP 服务**——机制齐备（stdio / Streamable HTTP / legacy SSE 三种传输 + 远端默认零权限授予 + `danger` 审批），但配置入口只有 `MCP_SERVERS` 环境变量，启动时读一次、进程级全局不分用户、改配置要重启、远端 token 明文在 env 没进 `SECRET_KEYS`、连不上不重连。准确说法是**技术上能接、产品上用户接不了**，别把「MCP Client ✅ 已实现」读成「用户可自助接入」。② **用户自建技能卡**——`source: "local"` 只有字段没有加载器，而 MCP 路径把 `kind` 写死成 `"tool"`，所以刚补的另外三种 kind **用户完全无法自制**。并修正一个此前的判断错误：三种非 tool kind 的 payload 就是数据（`config.prompt` / `config.schema` / `config.criterion`），没有 `execute`、不跑代码、不碰网络与文件系统，**根本不需要沙箱**——它此前被和 tool kind 的沙箱问题绑在一起 deferred 是分类错了。两个缺口已带触发条件登记进 [deferred-items.md](docs/deferred-items.md)。详见 [docs/design-skill.md](docs/design-skill.md) §13。
- **修掉三处把「未落地」写成「已落地」的文档错误** — ① [extending.md](docs/extending.md) §3 声称「isolated worker loader 在子进程里强制技能卡权限」，实际 `isolation.ts` / `IsolatedWorker` 隔离的是 **Worker（模型 provider 插件，走 `worker-plugins.ts`）**，技能卡完全在主进程内跑（`nodes/textgen.ts` → `executeBuiltinTool`），两件事被混为一谈——而子进程沙箱正是 design-skill §4 明确「缓做」的东西。② 同节的 API 形状是错的：`registerSkill({ id, tool, execute })` 与 `permissions: ["fs:read", "network"]` 都编译不过，实际是 `BuiltinSkill`（`execute` 嵌在 `tool` 子对象里）+ 结构化 permissions 对象；design-skill §12.1 刚写的示例犯了同一个错，一并修正。③ [technical-design.md](docs/technical-design.md) §11.2 声称运行时拿到「被权限约束过的 `ToolContext` 代理」，实际没有这个对象、强制也是按工具硬编码而非从声明推导——保留设计意图，加实现现状注。
- **README 测试数与 MCP 能力描述过期** — `2698+ / mcp-server 50` → 实测 `2809`（core 198 / server 960 / mcp-server 71 / web 1580）；MCP 一行补上协议修订版与 OAuth。docs/README.md 索引新增 Skill 与 MCP Server 两行入口（此前只有笼统的 `design-*.md`，两份文档实际搜不到）。

### Added
- **L1 3D 视角美化六项 + textGen 写实工业厂房原型** — 画布 3D 从「扁平方块」升级为风格化 RTS 质感，并把 `textGen` 做成写实工业厂房（**全部程序化生成、零外部素材**）。渲染与后处理（`Canvas3D.tsx`）：ACES Filmic 色调映射 + 线性雾、`PMREMGenerator` + `RoomEnvironment` 环境贴图（PBR 金属/玻璃真反射）、`EffectComposer` + `UnrealBloomPass`（strength 0.18 / radius 0.4 / threshold 0.92——只让 LED、厂房窗口、选中光环这类真发光像素 bloom）、选中光环与 running 节点呼吸脉冲；风格化方块（`iso3d-shapes.ts`）每个节点加地台与 12 条硬边蓝图描边（描边 `raycast` 置空，不抢节点拾取）；`.canvas3d::after` 径向渐变暗角。工业原型新增 `industrial-shapes.ts` + `industrial-textures.ts`（混凝土基座 / 锯齿屋顶主厂房 / 锈蚀烟囱 + 蒸汽 / 危险条纹基座钢储罐 / 拱形管线 / 发光高窗 + 正门；三张贴图走 canvas 程序化绘制、模块级单例，材质按节点持有并随既有 graph-sync 释放），**保持 ~150×92 足迹、地面旋转与 LED 契约不变**，管道锚点零改动；仅在 `buildNodeShape` 一处 gate 到 `textGen`，其余 28 种 kind 不受影响（推广 = 翻该 gate + 逐个补 topper）。顺带修掉新增贴图在 headless 下直接抛错（jsdom 的 `getContext("2d")` 返回 null）。测试策略随之调整：`Canvas3D.test.tsx` 需在 `vi.mock("three")` 之外再 stub `PMREMGenerator` 与三个后处理模块（renderer stub 缺它们要用的 API），LED 位置断言改用风格化 kind。详见 [docs/design-canvas-isometric.md](docs/design-canvas-isometric.md) 第五期。
- **节点技能面板支持搜索 + 直达「设置 → 技能」** — 技能卡多起来后节点详情的「技能」页是一条不可搜索的长列表，且想自建卡时没有入口。现 SkillPicker 顶部加搜索框（按名称 / ID / 描述实时过滤，无匹配给提示），标题右侧加「+ 添加技能卡」链接，点击直接打开设置弹窗并定位到**技能**标签页（Settings 新增 `initialTab` 深链参数，侧栏/命令面板等普通入口仍落模型页）。新增 6 个测试。
- **设置 → MCP 服务列表支持搜索** — MCP 服务多起来后设置页是一条不可搜索的折叠卡长列表。现列表上方加搜索框（按名称 / ID / URL / 传输方式实时过滤，无匹配给提示；服务为 0 时不显示搜索框），与节点技能面板复用同一个 `.settings-search` 输入样式。新增 4 个测试。
- **用户自助接入 MCP 服务 + 自建技能卡** — design-skill §13 列的两条「机制通了但用户接不了」的路径同时打通。① **per-user MCP**：`AppConfig.mcpServers` 新增 http/sse 两类远端服务器定义（`stdio` 刻意不开放——让用户填 spawn 命令等于任意代码执行框，仍只走运维 env）；`mcp-pool.ts` 按 userId 维护连接池，endpoint+headers 指纹复用连接、配置变更才重连；`POST /api/mcp/:id/connect` 保存即试连，同步返回发现的工具数/工具名或失败原因（失败是 502 结果不是异常，后台不自动重试）。Authorization header 随设置 blob 整体静态加密落盘，GET 回显打码、表单回传打码值视为不改动（与搜索服务 Key 同一 idiom），试连审计只记字段路径与工具数。② **自建数据卡**：core 新增 `UserSkillCard` zod schema，只允许 `prompt-module` / `output-contract` / `judge` 三种（payload 就是数据、无 `execute`、不需要沙箱；`tool` kind 服务端直接 400），id 强制 `local:` 前缀；契约编辑器是字段名/类型/必填表而不是 JSON schema 框（校验器只读这三样）。③ **隔离机制是关键设计**：用户卡和 MCP 工具**不进进程级全局 registry**（否则串用户），每次运行由 `loadUserSkills` 组装 owner 专属 map 经 engine options 注入，`resolveSkill` **全局优先**——用户卡只能补充，盖不住内置/运维同名 id（有测试钉死）；`/api/skills` 目录合并「内置 + 调用者自己的卡」，技能选择器零改动即可挂载。顺手补上 stdio MCP client 关闭时的 transport 泄漏（此前 `mcpClients` 只 push 不 close，stdio 子进程在服务退出后残留）。设置页新增两个分区（MCP 服务 / 自建技能卡，中英双语），新增 core 7 + server 34 + web 12 个测试。详见 [design-skill.md §13](docs/design-skill.md)。
- **Skill 体系四处补强：从「机制有、没人用」到四种 kind 全部可用** — 上一条盘点列出的四个缺口一次性补齐。① **内置卡从 5 张扩到 11 张**：此前 `prompt-module`/`output-contract`/`judge` 三种 kind 是「机制通了但零内置卡」，用户没有可抄的东西。新增 `zh_style_guide` / `cite_sources`（prompt-module，payload 走 `config.prompt`）、`report_json` / `verdict_json`（output-contract，payload 走 `config.schema`）、`judge_fact_check` / `judge_readability`（judge，payload 走 `config.criterion`）。② **`judge` kind 接线**：它此前在 `SkillKind` 枚举里而 `nodes/gate.ts` **从不读节点 `skills` 字段**——根因是 `skills` 只存在于 `TextGenConfig`，judge 卡**无处可挂**，所以这是 schema 缺口而非漏读。现在 `GateConfig.skills` 落地，`collectJudgeCriteria()` 把各卡 `criterion` 以「附加判据：」拼在 `gate.criterion` 之后再交模型；确定性的违禁词/品牌覆盖率检查不受影响，仍可推翻模型判定。前端 `SkillPicker` 加 `kinds` 过滤，gate 节点只列 judge 卡。③ **模板预挂卡**：49 个槽位此前**全空**，Skill 对用户实际是隐形的。现在 6 张卡落在 4 个模板的 5 个挂载点（`tpl-research-brief` 装引用规范 + 时间工具、`tpl-data-report` 用 JSON 契约 + 中文规范串起「分析出结构化、报告转人话」、`tpl-contract-review` / `tpl-xiaohongshu` 的 gate 各装一张 judge）；新增 `templates.skills.test.ts` 把「模板挂的 id 必须能在 registry 解析」「gate 只挂 judge、agent 绝不挂 judge」钉成回归测试——类型系统管不到字符串 id，改名会静默失效。④ **权限强制改成声明驱动**：`opForTool` 此前只认识 `web_fetch`/`web_search`/fs 三个硬编码分支，一张声明了 `network: {domains}` 的新卡自己 `fetch()` 时**声明拦不住它**。现在 `opForTool(skill, args, cfg)` 从卡自己的 `permissions` 推导本次调用意图：参数里任意嵌套深度（上限 4 层）能解析成 URL 的字符串撞该卡的域名白名单，键名像路径的参数（`path`/`file`/`dir`/`dest` …）按写意图校验并撞 `TOOL_FS_ALLOW`，`subprocess: true` 受服务端开关约束。顺手修一个诚实性 bug：`fs_write` 写文件却**一条 fs 权限都没声明**，旧硬编码路径下畅通无阻。**边界（已用单测钉住，别当 bug 反复修）**：卡在 `execute()` 内部硬编码 `fetch()` 或自己拼路径，参数里留不下痕迹，任何从参数推导的机制都无从下手——补它需要进程/容器隔离，仍在 deferred 沙箱线。相对路径按 `cfg.fsAllow[0]` 解析而非 cwd（与工具自身解析方式一致），`fs` 授权的 `paths: []` 表示「根由运维配」。详见 [docs/design-skill.md](docs/design-skill.md) §5.5、§11、§12.4。
- **Skill 体系现状盘点 + 作者指南** — 设计文档此前只描述设计，容易被读成已全部生效。逐条核对代码后补两节：§11 现状盘点（5 张内置卡全是 `tool` kind；`prompt-module`/`output-contract` 机制可用但**零内置卡**；`judge` kind 在枚举里但 `gate.ts` 从不读节点 `skills`，是**声明了没接线**；**49 个 `skills: []` 槽位全空**——Skill 对用户实际是隐形的；权限强制是按工具硬编码而非从声明推导，`opForTool` 只认识 web_fetch/web_search 与 fs，新卡自己直接 `fetch()` 声明拦不住）+ 缺口按优先级排序；§12 作者指南（三种 kind 怎么加、`danger: true` 是唯一可靠的把关、`SkillMount` 的 per-mount config 覆盖语义、验证清单）。详见 [docs/design-skill.md](docs/design-skill.md)。
- **MCP 协议升级到 2026-07-28（最新稳定修订版），三版本并行协商** — 此前握手固定应答 `2024-11-05`，而设计文档已声称落地了 Streamable HTTP（2025-03-26 才有的特性），文档与代码互相矛盾。现在 `protocol.ts` 作为单一版本注册表，同一个 dispatcher 同时服务 `2026-07-28` / `2025-11-25` / `2024-11-05`——这可行的关键是 2026-07-28 移除的方法（`initialize`/`ping`/`logging/setLevel`/`resources/subscribe`）与它新增的方法（`server/discover`/`subscriptions/listen`）是不相交的两个集合，所以声明的版本只需作为「已移除方法」的闸门。落地项：`server/discover`（免握手宣告版本矩阵 + capabilities + `extensions`）、无状态 `_meta` 上下文（`io.modelcontextprotocol/protocolVersion` 等 6 个键）、`subscriptions/listen`（一次 POST 换长活响应流，按 `types` 过滤推送并打 `subscriptionId`，与老的 `GET /mcp` + `resources/subscribe` 通道并存）、所有 result 无条件带 `resultType: "complete"` + `_meta.serverInfo`、SEP-2549 缓存提示（列表 `public`/300s，运行态 `private`/5s）、`Mcp-Method` 头与 body 矛盾时 400。未知版本的两种处理**故意不同**：`initialize` 里未知则降级（握手语义），`_meta` 里未知则 `-32602` + `UnsupportedProtocolVersionError`（无状态路径没有协商回合）。单测 47→71。详见 [docs/design-mcp-server.md](docs/design-mcp-server.md) §12。
- **MCP Server 按 OAuth 2.1 定位为受保护资源** — `GET /.well-known/oauth-protected-resource`（RFC 9728）免鉴权下发资源标识与授权服务器列表（没 token 的客户端必须能查到去哪儿拿 token）；`AGENT_WORLD_MCP_REQUIRE_AUTH=1` 时无 token 的 POST 返回 401 + `WWW-Authenticate: Bearer resource_metadata=...`。这个开关顺手补上一个洞：关闭时无 token 的本地调用者会**静默继承本进程环境 token 的写权限**。**边界（别当完整合规）**：本进程不验 JWT 签名、不校验 `aud`——密钥在主服务，密码学校验仍委托下游；要让 mcp-server 独立部署在信任边界外，得在这里补 JWKS 验签。详见 [docs/design-mcp-server.md](docs/design-mcp-server.md) §13、未实现清单见 §14。
- **MCP Streamable HTTP 的 Origin 校验** — 2025-11-25 起规范要求对非法 `Origin` 返回 403（防 DNS rebinding）。默认放行 `localhost`/`127.0.0.1`/`[::1]` 与无 Origin 的非浏览器调用，额外白名单走 `AGENT_WORLD_MCP_ALLOWED_ORIGINS`。同时把 MCP Server 的部署形态首次写进运维文档（此前 production-ops.md 零处提及）——含「stdio 无需运维 / HTTP 需自守护」的分野与上 HTTP 形态前必补的 6 项。详见 [docs/production-ops.md](docs/production-ops.md) §8。
- **连接器数据插值覆盖全部 connector 类型** — 此前只有 product 会填 `ResolvedMaterial.data`，其余四类只有文本，任何非商品产线都用不上 `${...}` 取结构化数据。现在五类全部接通：http → 解析后的 JSON body（仅 `application/json`；配了 `extract` 也给完整 JSON）、database → 行对象数组（sqlite/postgres 同形，`format: csv` 也照给）、form → 按字段 `name` 键控的填写值（标签改名不断引用）、file → `[{name, path, content}]` 每份文件一条（`asImages` 无正文）、manual 仍不给（保持裸字符串 ctx）。快捷名注册表按类型语义扩到 8 条：`${response.x}` / `${row.列名}` + `${rows}` / `${form.字段名}` / `${file.x}` + `${files}`，沿用「全图该类型 source 恰好 1 个才注入，≥2 个退化为 `${节点id.data...}`」规则。空数据 warn 从 product 专用泛化到全类型；Inspector 按 connector 类型显示本产线可用的引用名（zh/en）。详见 [docs/design-data-interpolation.md](docs/design-data-interpolation.md) §13。
- **原料台用户自定义字段** — `SourceConfig.custom?: Record<string, string>`：键即标签、值支持 `${...}` 插值（与固定 8 个简报字段同规则，只插值不解析键），行进简报（补充说明之后、原料之前，空键/空值跳过），下游节点用 `${srcId.custom.键}` 引用（复用 `sourceMeta` 旁路，与 `data` 同 namespace）。Inspector 用「键: 值」多行文本框编辑（与 HTTP headers 同一 idiom），zh/en 双语。这是非电商行业字段的最小逃生舱——不动 schema、不建行业包，先看真实使用再决定是否升级。顺手修两个既有 bug：`literal()` 遇到 sidecar 信封（`{content}`）会 JSON 化导致 `${src} > 100` 比较错值；`resolveExpression` 的带下标头段（`${data[0].price}`）解析不到值。详见 [docs/design-data-interpolation.md](docs/design-data-interpolation.md) §13。
- **成本计量开跑前置：单价缺口审计 + 按模型分摊（商业化 P0）** — `unpricedModels()`（core）按 modality 判定模型价格卡「完全没配 / 只配了一部分」，server 启动 warn + `/api/costs` 下发 `unpricedModels`，成本报表顶部警告条点名缺哪几项；缺单价的模型 `cost_usd` 当场按 0 落库、事后无法补算，所以这是 2-4 周真实成本回采的开跑前置。同时补齐**按模型分摊**：`node_runs.model`（迁移 36，带 `down`）记录产生费用的模型，`byModel` 聚合 + 前端「按模型分摊电费」表 + CSV `model` 段，迁移前的行归入 `(未记录模型)` 桶保证与总额对账。详见 [docs/design-monetization.md](docs/design-monetization.md) §9 P0。
- **连接器插值机制恢复 + 全 33 模板盘点** — 恢复 D3/D4/D5（快捷名注册表、简报字段回填与插值、空库/悬空引用 warn），这些在 9/6 被回滚但 9/8 经 git 历史核实为无说明回滚后恢复。两个强商品模板（淘宝详情、小红书种草）预设 product connector（manual selection）。详见 [docs/design-data-interpolation.md](docs/design-data-interpolation.md) §14 回滚/恢复记录 + [docs/design-template-connector-presets.md](docs/design-template-connector-presets.md)。
- **PostgreSQL database connector** — `DatabaseConnector.driver` 增 `postgres`（`pg` 纯 JS）+ `host/port/database/user/password/ssl`；`queryPostgres` 异步连接 + SELECT 白名单 + 会话级只读双保险；密码对齐静态加密（`SECRET_KEYS` 加 `password`）；MySQL 预留扩展点。详见 [docs/design-connector-database.md](docs/design-connector-database.md)。
- **成本硬熔断 + 全局限流（P0）** — `startRun` 入口月度预算硬停（`monthlyBudgetExceeded` + `AGENT_WORLD_BUDGET_BYPASS`）；`rate-limit.ts` 内存滑动窗口挂 login/register/run 三入口。详见 [docs/engineering-blueprint.md](docs/engineering-blueprint.md)。
- **自述式 health 探针 + Metrics（可观测性）** — `/api/health` 报 env/branch/commit + DB/密钥/Provider 就绪（未就绪 503）；`/metrics` Prometheus 端点（HTTP RED + run 业务指标，零依赖）。详见 [docs/production-ops.md](docs/production-ops.md)。
- **优雅关闭/启动 + 幂等审计（可靠性）** — SIGTERM drain 在途 run + 关 DB；`Idempotency-Key` 防重复建 run（`idempotency_keys` 表）。详见 [docs/engineering-blueprint.md](docs/engineering-blueprint.md)。
- **发布工程（P0/P1）** — 一键回滚（`.last-known-good` + rollback.sh）、migration 回滚（`down` + migrate-down.ts）、feature flag（灰度开关）、覆盖率门禁、pre-commit hooks。详见 [docs/engineering-blueprint.md](docs/engineering-blueprint.md)。
- **安全（P0/P1）** — gitleaks 扫历史、依赖漏洞扫描（`pnpm audit` 进 CI + Dependabot）、SAST（CodeQL）。详见 [docs/engineering-blueprint.md](docs/engineering-blueprint.md)。
- **数据与运营（P0/P1）** — 备份恢复演练（RTO<1min/RPO<24h）、事件归档（prune-events.ts）、一致性校验（verifyIntegrity）、postmortem 模板、SLA/SLO、变更管理。详见 [docs/engineering-blueprint.md](docs/engineering-blueprint.md)。
- **搜索服务按源绑定凭证 + 节点 gating** — `searchConfig` 从单一扁平 `apiKey`/`cx` 升级为按搜索源独立绑定（`tavily.apiKey`/`serpapi.apiKey`/`google.apiKey`+`cx`），切换搜索源不再丢失或串用其他源的 key；凭证解析按源隔离（跨源绝不复用，`userSlot` 只取当前源槽）。Settings → 搜索服务按所选源展示对应 key 输入框（并提示其他源配置状态）；search 节点下拉只可选已配置 key 的源（未配源置灰 + 直达设置入口）；旧扁平凭证读时自动迁入对应源槽。本地开发不再依赖 `.env` 的 `TAVILY_API_KEY`。
- **连接器数据插值** — `ResolvedMaterial.data?` 通用通道 + `sourceMeta` 旁路 Map + 快捷名注册表（`product`/`products`）+ `buildSourceBrief(fallbacks)` 留空回填/手填覆写 + 简报 8 字段 `${product.*}` 插值；机制行业无关，product 为首个消费者。详见 [docs/design-data-interpolation.md](docs/design-data-interpolation.md)。
- **Skill 体系设计文档** — 收拢散落三处的 skill 决策（设计原则 / 4 种 kind / 权限模型 / source 三态 / 扩展点）为单一事实源。详见 [docs/design-skill.md](docs/design-skill.md)。
- **商业化详细实施方案** — 把 PRODUCT_STRATEGY 的「方向」落成可实施规格：三层计费模型（内置模型订阅制 / 自定义模型 BYOK / 平台资源）+ 套餐档位 + 配额与订阅 gate（`subscriptions`/`usage_ledger` 表 + `enforceSubscription()` 挂点）+ 账单支付 + 企业版能力 + P0-P3 分阶段路线（方案已设计，未实施）。详见 [docs/design-monetization.md](docs/design-monetization.md)。
- **公告 target 定向（P3）** — `announcements.target` 三态生效：NULL=全员 / `graph:<id>`=能打开该产线的用户（owner/editor/viewer 均命中，复用 RBAC 判定）/ `template:<id>`=自有或被共享了该模板产线的用户（`db.userUsesTemplate`）。`GET /api/announcements` 服务端按受众过滤并下发 `target` 字段；未知前缀 fail-closed（谁都看不见，含历史脏数据 `role:admin`），写入侧只放行两种合法形态（400）；`/manage` 全量列表带 target 供编辑回显。入口级展示：模板卡「有公告」warning 角标（Tooltip 显示公告标题，NewGraphDialog/Onboarding 生效）+ 打开定向产线时 header 下方 dismissable 横幅（`GraphAnnouncementBar`）；AnnouncementManager 表单支持全员/按模板（33 模板下拉）/按产线（graph id 输入）三种受众，列表行显示受众徽标。详见 [docs/design-announcement.md](docs/design-announcement.md)。
- **密钥轮换（at-rest 主密钥，P1+P2+P3）** — keyring（`AGENT_WORLD_ENCRYPTION_KEYS` 逗号有序列表，第一个为加密密钥，其余仅解密；`.encryption-keys` JSON 数组文件模式，旧单值 env/文件等价兼容）+ `enc:v2:<keyId>:` 密文格式（keyId = 密钥材料前 6 hex，解密按 id 路由，未知 id fail-closed；v1 旧密文逐 key 尝试，全兼容）+ 重加密收敛工具 `scripts/rotate-reencrypt.ts`（覆盖 settings.data / publish_targets.config_encrypted / graphs.doc / graph_versions.snapshot / runs.snapshot 五密文面；幂等可续跑、坏密文点名行中止、`--dry-run` 预检、`--table` 分批、residue 报告 + 退出码门禁「可删旧密钥」；顺手补封 whole-column 历史明文行）+ 运维手册 [docs/runbooks/key-rotation.md](docs/runbooks/key-rotation.md)（定期轮换五步 / 泄露应急 / 常见错误排查 / 验证清单）。详见 [docs/design-key-rotation.md](docs/design-key-rotation.md)。
- **用户反馈（P1+P2+P3）** — `feedback` 表（迁移 33）+ `POST /api/feedback`（消息 ≤2000 字符 + 分类白名单 + 服务端上下文白名单二次脱敏 + 截图 base64 ≤1MB + 每用户滚动小时 10 条限流）+ owner/admin 管理端（列表 / 三态流转 / 附件端点，cookie 认证支持 `<img src>`）+ 前端 `FeedbackModal`（分类 + 粘贴截图 + 诊断信息勾选）+ UserMenu「反馈」入口 + AdminPanel 反馈 tab；P3 反馈→公告联动：`POST /api/feedback/announce` 单请求合并同类反馈为产品公告并批量关闭（fail-closed 校验 + 幂等跳过已关闭项 + `feedback.announce` 审计），AdminPanel 多选 + 合并表单（主分类/条数模板预填 + 消息摘要折叠）。详见 [docs/design-feedback.md](docs/design-feedback.md)。
- **RBAC 角色权限（P0-P3）** — 全局角色 owner/admin/user（`users.role`，迁移 31；owner=最早注册用户自动提升，退役公告 env 白名单）+ 资源级共享（`resource_access` 表，迁移 32：graph 为共享单元，run/artifact 向上继承 owner/editor/viewer）+ `rbac.ts`/`permissions.ts` 判定层替换裸 `user_id` 隔离（越权基线改造：列表按可见资源过滤、写操作需 editor、外人 404 不泄露存在性）+ CollaboratorsModal 共享 UI（viewer 只读抑制自动保存）+ AdminPanel 用户管理与跨用户审计 + 权限变更审计。详见 [docs/design-rbac.md](docs/design-rbac.md)。
- **审计日志（P1+P2）** — append-only `audit_log` 表（迁移 29）+ `audit()` helper（写失败只告警不阻塞）+ 全动作词表埋点（账号/设置/图/运行/发布等，IP 取 X-Forwarded-For 首跳）+ `GET /api/audit`（本人记录时间倒序游标分页）。红线：detail 只记字段路径、永不记值。详见 [docs/design-audit-log.md](docs/design-audit-log.md)。
- **服务端日志（P1+P2+P3）** — 裸 console 全部收编 Logger（节点经 `ctx.log` 绑定 runId）+ `LOG_FILE` 未设时默认落盘 `<DB dir>/logs/server.log` + `/api/*` 请求中间件（按 status 分级 + latencyMs + userId，不记 query 防泄露）+ 启动摘要/迁移/触发器关键路径日志。详见 [docs/design-logging.md](docs/design-logging.md)。
- **产品内公告（P1+P2）** — `announcements`/`announcement_reads` 表（迁移 30）+ `GET /api/announcements`（窗口过滤 + 双语字段 + 本人已读状态）+ `POST /:id/read`（幂等）+ 管理 API（owner/admin，含审计）+ AnnouncementBell（info 下拉 / warning 横幅 / critical 模态）。详见 [docs/design-announcement.md](docs/design-announcement.md)。
- **专业服务方向 6 个新模板**（第 28–33 个业务模板，全部复用现有节点、零新引擎能力；逐一真实狗粮验证）：
  - 银行流水对账（`tpl-reconciliation`）：两段流水投料 → code 逐笔配对（date+amount）→ table 差异清单按金额降序 → 对账报告
  - 隐私政策合规审查（`tpl-privacy-review`）：fileParse → 11 维度合规盘点 → 整改建议 + 风险分级 → 人工确认
  - 发票批量 OCR 台账（`tpl-invoice-ocr`）：发票图片 → OCR（chi_sim+eng）→ 字段提取 → 台账按日期排序
  - 批量合同审查（`tpl-batch-contract-review`）：多份合同文本（`=====` 分隔）→ 拆条 → 逐份 8 维度风险审查 → 风险汇总表
  - 审计抽样底稿（`tpl-audit-sampling`）：账目明细 → 抽样规则（大额/重复/非工作日）→ 审计底稿
  - 尽调清单（`tpl-due-diligence`）：多份尽调材料 → 解析 → 7 事项盘点 → 缺口清单
- **fileParse 多文档能力** — fileParse 从「只解析第一个文档」改为「解析所有文档」，多文档 text 用 `===== 文件名 =====` 头分隔，单文档路径字节不变（向后兼容）；解锁批量 PDF 合同审查、尽调等场景
- **行业 ROI 评估文档**（`docs/product-industry-roi.md`）— 多 agent 流水编排的行业切入方向排序 + 专业服务垂直模板候选清单
- **i18n 国际化** — i18next + react-i18next，11 个命名空间（common/canvas/nodes/modals/settings/run/errors/auth/reviews/announcements/feedback）zh/en 双语全量 keys；41 个组件 + App.tsx 全部 `t()` 迁移（含 Inspector 29 种节点配置约 250 处）；语言自动检测 + localStorage 持久化 + LanguageSwitcher；`i18n/utils.ts` 本地化格式（date/number/currency/relativeTime）；`keys.test.ts` 守护（key 双语齐全 + zh/en 结构一致 + 无硬编码中文 JSX）。详见 [docs/design-i18n.md](docs/design-i18n.md)。
- **设计 Token 体系与明暗主题** — Primitive 层（8pt 间距/圆角/阴影/字号/行高/字重/动画）+ Semantic 层（背景/文字/边框/功能色/accent）+ `[data-theme="light"]` 明暗主题切换；styles.css 全局样式分 30 批全部迁移 semantic token，保留原有 26 个原始 token 向后兼容。详见 [docs/design-design-tokens.md](docs/design-design-tokens.md)。
- **自媒体电商方向 F1-F10**（里程碑 M1-M6 闭环）— run 内多变体择优（fanout/select 节点 + 变体对比视图）、审核队列、平台合规校验、商品库/素材库、批量任务、效果回流、平台化导出包 + 开放渠道 Webhook 发布、内容日历、内容级成本、画布泳道编排；仅新增 4 个节点（fanout/select/compliance/publish），浏览器 RPA 按决策不做。详见 [docs/design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md)。
- **RTS 游戏化运营视图三阶段（A 运营工作台 → B L0 宏观园区 → C 跨厂工业园区）** — 阶段 A：跨产线运营 rollup、operations overview endpoint 与运营工作台；阶段 B：`parkLayout` 纯函数（螺旋碰撞兜底）、迁移 37 园区坐标持久化、L0 宏观园区总览（实时工厂、点击下钻单产线）、拖拽摆位（按厂防抖保存、unmount flush）、B5 FPS 实测达标（无需视口剔除）；阶段 C：跨厂物料边推导、跨厂管道与脉冲卡车、plan-B 同构锚点 zoom 过渡、经济栏（月度成本/token）、排期轴（每厂 cron 状态）、ROI 热度精灵与复盘卡。详见 [docs/design-rts-overview.md](docs/design-rts-overview.md)、[docs/design-rts-stage-b.md](docs/design-rts-stage-b.md)。
- **新用户分步引导 Guided Tour** — 可扩展注册表式 tour 引擎（步骤声明 target/placement/内容，与版本解耦，天然支持后续「新版本/新功能」what's-new 引导）、聚光灯遮罩、首启自动调度、菜单重放；锚点随页面滚动保持在屏、操作按钮尺寸规范化。详见 [docs/design-guided-tour.md](docs/design-guided-tour.md)。
- **M2 订阅配额 gate（S1-S8）** — 套餐档位 Starter/Pro/Team（价格经 M1 回采真实成本校准，视频占成本约九成）、`usage_ledger` 月度计量（幂等回填）、视频段/存储/归一化 token 三类配额在 run 入口强制（超额 402 并引导升级）、`GET /api/subscription`、前端账单 Tab + 用量面板 + 配额升级 gate、80%/100% token 用量预警、Team 席位限制；BYOK 视频不计入平台视频配额。详见 [docs/design-monetization.md](docs/design-monetization.md)、[docs/design-monetization-m2-implementation.md](docs/design-monetization-m2-implementation.md)。
- **M3 Stripe 支付网关（A0-A5，真机待资质）** — stripe-sdk、迁移 39 订阅镜像列、网关 wrapper（env 配置 + 可注入 client）、checkout / billing-portal / webhook 路由、webhook 事件幂等镜像同步、Stripe 返回 query 处理并重开账单页、BillingTab 升级/管理接线（中英 i18n）。真机扣款 Step6 待收款主体与 key。详见 [docs/design-monetization-m3-s6-stripe.md](docs/design-monetization-m3-s6-stripe.md)。
- **演示账号 demo user** — 迁移 40 demo 用户 schema、demo 配额与能力锁、run gate、前端 demo 模式入口 + banner + 认领对话框（claim 后转正式账号）、过期 demo 用户清理脚本（cron）。详见 [docs/design-demo-user.md](docs/design-demo-user.md)。
- **运行可观测与排障增强** — 运行历史全文搜索；失败 run 的 LLM 诊断；运行步骤时间线（core timeline 投影 + 只读 endpoint + 前端步骤视图，完整节点产物懒加载）；产线切换器搜索与置顶。
- **节点输出契约（G2.2）与数组根契约（G2.4 前置）** — `ContractSpec` zod schema + 可选 `GraphNode.contract`，引擎对节点输出与连接器数据强制契约；Inspector 配置 Tab 契约编辑器（支持对象/数组根切换，数组根持久化可选）。
- **从指定节点 fork 重跑（G1.2）与节点级失败重试（G3）** — 从某节点 fork 新 run，上游产物零成本复用（带 reused 徽章）；Inspector 提供每节点失败重试开关。
- **Provider 故障转移 v1** — 备份 provider 槽与 failover 配置，文本与 judge（gate）调用在主源失败时自动切换；修复备份槽 enabled 开关不生效。
- **错误追踪适配层** — 内存环形缓冲 + 进程级兜底捕获进程/请求错误，`/api/admin/errors` 管理端 feed，可插拔 ErrorSink（webhook）+ 自检 CLI。详见 [docs/runbooks/error-reporting.md](docs/runbooks/error-reporting.md)。
- **TTS 语音合成产品化 P1（G-A/G-B/G-D + G-E/G-H）** — 音频按输入 UTF-8 字节计费（适配按字节计费供应商口径）、播客模板 TTS 音色参数化、超长输入 fail-fast 可操作报错、audioGen 模态分发 gate 测试、供应商配置 runbook；真机待供应商 key。详见 [docs/design-tts-provider.md](docs/design-tts-provider.md)、[docs/runbooks/tts-provider-setup.md](docs/runbooks/tts-provider-setup.md)。
- **TTS 无能力软降级（G-C）+ 步骤时间线显示跳过原因** — 零配置 / 纯文本供应商（worker 无 `generateAudio` 能力）时 audioGen 节点不再拖垮整个 run，而是软跳过：发 `node.skipped`（带 reason）+ warn 日志；core 时间线投影新增 `skipReason` 字段，步骤视图对跳过节点显示「跳过原因」。`tpl-news-podcast` 加 script→sink 旁路边（e5），无 TTS 也能把口播稿作为文本成品直送 depot，配了 TTS 模型后文稿与配音一并交付。三类真错误仍明确失败：超长输入（>4096 字符 VALIDATION）、配了能力却返回空结果（UNSUPPORTED）、供应商异常（PROVIDER_ERROR）——无能力才软降级，错误不被吞。新增 core 时间线投影测试 2、web 步骤视图测试 1、engine.audiogen 软降级用例 1。详见 [docs/design-tts-provider.md](docs/design-tts-provider.md)。
- **写实工业风 3D 全面铺开** — textGen 写实工业厂房原型（程序化 PBR 材质/贴图，零外部素材）验证后，可复用工业部件套件推广到全部 29 种节点；3D 第五期美化（ACES 色调映射、UnrealBloom、PMREM 环境反射、硬边蓝图描边、running 呼吸脉冲）。详见 [docs/design-canvas-isometric.md](docs/design-canvas-isometric.md)。
- **长任务跨 run 续跑地基（G4 步骤 1/2，纯增量）** — core 新增 `node.degraded` 事件与 `REMOTE_JOB_LOST` 错误码；server 迁移 41 `remote_jobs` 表 + driver CRUD，为视频等长任务的 degraded/halt 状态机与跨 run 重新附着打底（后续 ③-⑥ 缓做）。详见 [docs/design-step-trace-and-robustness.md](docs/design-step-trace-and-robustness.md)。
- **画布节点透出 skipped 原因** — core `NodeRuntime` 新增 `skipReason`，画布节点 tooltip 在状态行后显示「跳过原因」（zh/en），软降级对操作者可见；至此 skipReason 全链路（事件→core reduce live 投影→画布 tooltip；trace→运行时间线）闭环。新增 core 2 测、web i18n 键，详见 [docs/design-tts-provider.md](docs/design-tts-provider.md) G-C 留尾。
- **G4 步骤 ③ reconstructState 投影 degraded** — resume 恢复时把 `node.degraded` 事件投影为 `ResumeState.degraded`（reason/errorCode/remoteJob 句柄），重跑成功的节点自动剔除、无其他 halt 点时恢复 halted 落点；纯投影不触执行核心，为步骤 ④-⑥（videogen halt/落库、resume、web 标识）备料。新增 engine.reliability 3 测，详见 [docs/design-step-trace-and-robustness.md](docs/design-step-trace-and-robustness.md)。
- **G4 步骤 ④⑤⑥ 长视频跨 run 续跑闭环** — 长视频渲染不再因轮询超时 failed，改为 degraded+halt 并落库 `remote_jobs`，操作员可 reattach（同 attempt 继续轮询、不重复计费）/ accept-degraded（weld 下游、节点保留降级角标）/ 重新提交（job lost、将重新计费）。core 新增 `node.degradedAccepted` 事件与 timeline `degraded` 投影；server 新增经 HTTP 层注入的 `RemoteJobStore` 接缝（handler 不感知 SQL 方言）、videogen 幂等 submit+poll（open job 复用、超时留 open、远端查无 `REMOTE_JOB_LOST`）、resume 两 action + 三路径注入 + reviews degraded 分流；web RunTimelineView 橙色 degraded 卡片与决策按钮、ReviewQueue degraded 分组，zh/en i18n。engine.videogen.async 重写 8 测、core trace +2，总数 core 336 / server 1314。已随 PR #408 合 dev、PR #409 合 main，Hasee 部署 `a557d8b` 零打断、日志零 error。详见 [docs/design-step-trace-and-robustness.md](docs/design-step-trace-and-robustness.md) §3.4–3.10。
- **异地备份与 checkpoint 补丁脚本** — offsite backup + checkpoint patch 脚本，并完成首次异地备份恢复演练（RTO/RPO 验证）。
- **状态机方案 A：分支状态变量守卫** — branch 节点状态迁移编译期校验，画布上分支节点状态变量流转可视化。
- **Playwright E2E 冒烟骨架** — guest 与 demo 流程的端到端冒烟用例。
- **fileParse 支持 Excel（.xlsx）** — 电子表格解析接入文件解析节点（Excel 写出仍缓做）。
- **版本对比升级** — 两个产线版本结构化 diff；长文本产物在对比视图逐字/逐词内联高亮。

### Changed
- **设置弹窗改为标签页并正名为「设置」** — 弹窗历史标题「设置 · 模型与密钥」早已名不副实（搜索、预算、Worker、MCP、技能卡都塞在里面）。现标题改为「设置」，内容收进三个下划线式标签页：**模型**（供应商卡片 + 月度预算 + Worker 插件隔离）、**集成**（搜索服务 + MCP 服务，两个外部连接/凭证分区）、**技能**（自建技能卡）；非活动标签页不挂载。侧栏入口与三处引导文案（「去设置 · 模型与密钥」等）同步去掉旧副标题，无引用的 `modelKeys.title` 键删除。新增 3 个标签页切换测试。
- **MCP / 自建技能卡设置分区改用既有 model-card 视觉语言** — 首版两个分区自造了 `.mcp-*` 私有类名、扁平堆叠表单，与同弹窗里的模型供应商列表不一致（删除链接被渲染成整行红色块）。评审发现后重写为折叠式 `.model-card` 列表（chevron / 启用开关 / 等宽名称 / badge / 连接状态圆点的 head，展开后 `.field` 表单 + `.model-card__footer-actions` + `.diag` 状态行），删除按钮收进 head-actions；CSS 里自造类全部删掉，只留 4 个基于现有 token 的小 helper（`.ext-add-row` / `.ext-status-dot` / `.ext-badge` / `.card-fields`）。行为零变化，1593 个 web 测试全绿。
- **核心文件重构（行为零变化）** — `engine.ts` 4954→1828 行：29 种节点执行体迁至 `packages/server/src/nodes/`（28 个 handler + `NodeRunContext` + `NODE_HANDLERS` 注册表分发）；`Inspector.tsx` 3848→611 行：节点配置面板拆至 `InspectorFields/` 27 文件 + 注册表分发。详见 [docs/design-refactor-engine-inspector.md](docs/design-refactor-engine-inspector.md)。
- 模板总数从 27 增至 33（覆盖 29 种节点类型中的 23 种）
- **构建工具链 major 升级** — Vitest 5、Vite 8 + @vitejs/plugin-react 6、TypeScript 7、undici 8（后因与 Node 内置 fetch 不兼容 pin 回 7.x，见 Fixed）；React 19.3 / three 0.186 / hono 4.13.8 跟进；补 jsdom `URL.createObjectURL` stub 与 testing-library 全局异步超时降 flake。
- **限流重试改长退避** — judge/media 节点与翻译产线的 429 从 4 次快速重试改为长等待退避，显著降低 free tier 限流下的 run 失败率。
- **视频生成 run 内轮询远程异步任务（G4.4）** — videoGen 节点在 run 内轮询远程异步视频作业，替代一次性提交即返回。
- **3D 节点常显名称标签** — 园区/3D 视角节点上方常驻名称，降低多节点辨识成本。

### Fixed
- **agnes 视频一律按 5s 兜底计费（未按真实成片秒数）** — 真机抓取 agnes 完成任务 JSON 确认成片时长在顶层 `seconds` 字段、且为**数字字符串**（实测 `"5.0"`；`num_frames/frame_rate` 只嵌在 `perf_params` 下、顶层没有）。两处导致 perSecond 表读不到真实时长：agnes videoAdapter 未配 `durationPath`，且 `videoBillingSeconds` 只接受 JSON number。修复（`5ffeb65`，PR #218 已部署 Hasee）：adapter 配 `durationPath: "seconds"`；新增 `positiveNumber()` 同时接受 number 与数字字符串（durationPath、num_frames/frame_rate 两路统一走它）；+1 字符串秒数用例（`"8.0"` → 8s/$0.80，18 provider 测试过）。部署后在 dist 真机回放验证：`"5.0"`→5s/$0.50 不回归、`"8.0"`→8s/$0.80。agnes `omitDuration` 默认出片即 5s，故常规 run 金额仍是 $0.5，本修的价值是非 5s 成片不再被截成 5s。
- **nodemailer high 级 ReDoS（CI 依赖审计阻断）** — `nodemailer < 9.1.0` 的 addressparser 二次方复杂度可被构造地址列表远程打挂（GHSA-2x7j-588g-ccc2），`pnpm audit --audit-level=high` 因此 exit 1、PR #218 门禁失败。dev 先以 9.1.1（`81d6bab`）解除门禁；合并 main 时发现 dependabot PR #179 已将其升到 10.0.0（main 另有 hono 4.13.7 / jose 6.2.11 / i18next 26.4.2），PR #219 的冲突解决最终取 **nodemailer 10.0.0**（merge `9712f52`）。代码仅用 `createTransport`/`sendMail` 稳定 API，无行为变化；CI Node 24 测试全绿，`pnpm audit` 无已知漏洞；2026-09-09 Hasee 真机确认实际解析版本 10.0.0、dist notifier 加载正常、服务干净重启。
- **视频/音频产物成本恒为 $0（M1 成本数据污染）** — provider worker 的视频/音频成功路径硬编码零 usage，从不填 `units`、从不调 `computeCost`，导致 perSecond/perKiloChar 价格卡形同虚设，视频/音频 run 的 `node_runs.cost_usd` 当场按 0 落库、**事后无法补算**。修复（`openai-compatible.ts`）：视频按秒计费，秒数解析顺序为适配器 `durationPath` → `num_frames/frame_rate` → 节点 `duration` → 5s 默认兜底；音频按输入字符数 perKiloChar（金额 ÷1000）；`videoAdapter` 增配 `durationPath` 点路径。+4 媒体计量用例（durationPath 8s=$0.80 / 帧数推导 5s=$0.50 / 无字段兜底 5s / TTS 11 字符）。2026-09-08 部署 Hasee 后端到端复验：视频 run `units:{seconds:5}`、`costUsd:0.5`（修复前 $0）。
- **内置 agnes 模型单价保存后被抹掉（M1 开跑阻塞）** — 内置 `agnes` tier 无价格卡，且 `loadConfig` 每次读取都用内置 `AGNES_PROVIDER` 整体覆盖 builtin provider，导致在「设置 → 模型」里给 6 个 agnes 模型填的单价保存后随重载丢失、电费恒为 `$0.00000`。把价格卡写进源码 `AGNES_PROVIDER.pricing`（随产品发布，非正式占位单价 ≈ OpenAI 同级 list price，正式计费前换真实费率）；custom provider（ceshi）仍走设置持久化。配全后投料实测电费 `$0.00051`、token 830 入/643 出，与 `computeCost` 手算一致。
- **ABReport A/B 对比「单跑成本」测试 flaky** — `renderAndWait` 只等 `api.abReport` 被调用、没等 promise resolve 后 `setReport` 重渲染，CI 高负载下断言撞上「加载中…」偶发失败；改为等加载指示消失（`!report` 门一旦有数据不再回到加载屏）。 — dependabot 提的 6.1.1 peer 是 `vite: ^8` 且 import `vite/internal`，Vite 6 下 `vite.config.ts` 加载即崩（PR #203）。改升到仍支持 Vite 6 的 5.x，并让 dependabot 忽略该包的 major，直到 Vite 升级。
- **代码沙箱 Node 权限门控探测** — `probeNodePermissionGate` 剥离 `NODE_OPTIONS` 后探测（宿主 `--require` 语言 shim 需要 fs 读、被权限模型默认拒绝，导致误判「无权限模型」）；`--allow-fs-*` 只在检测到 `--permission`/`--experimental-permission` 门控后才发出，杜绝 Node ≥ 22.2 下「无门控的 allow 参数」触发 `ERR_MISSING_OPTION` 崩溃。详见 [docs/design-code-sandbox.md](docs/design-code-sandbox.md)。
- **tesseract 语言包缓存目录** — 从 server 进程 CWD 改到 `<DB dir>/tessdata`（与 `artifacts/`、`logs/`、`.encryption-key` 同级），47MB chi_sim+eng 不再污染 CWD。
- **undici 8 与 Node 内置 fetch 不兼容（P0 热修）** — undici v8 破坏内置 fetch、打挂出站请求；pin 回 7.x，并让 SSRF DNS pin 优先 IPv4（PR #362，事故复盘已归档）。
- **gate 质检节点 0 计费 / 翻译节点 model=None** — `judge()` 不返回 usage 导致 gate AI 调用成本落 0、`computeUsage` 未带 model 致按模型分摊丢桶，两处均修复。
- **占位符插值正则 ReDoS** — `${...}` 占位符解析改为线性扫描器（占位符与嵌套引用两处），杜绝构造性长串二次方回溯。
- **翻译评审返工看不到原文** — gate 返工时评审同时拿到 source 与 draft（此前只喂 draft，评审只能看到译文）。
- **gate 禁用词命中无可读反馈** — 返工提示给出每个命中词的位置与所在子句上下文，而非仅报「命中禁用词」。
- **three.js 3D 视图资源泄漏 + Canvas3D 审计欠账** — 修复 renderer/geometry 泄漏，补齐 iso3d-shapes 与 Canvas3D 组件测试。
- **已有产线后加触发器不持久化** — 修复向已存在产线新增 trigger 后未落库、重启丢失。
- **SSRF 守卫 DNS 瞬时失败即拒绝** — DNS 查询瞬时失败时重试，避免偶发解析抖动误杀正常请求。
- **园区坐标保存抖动** — park 坐标按厂防抖保存，unmount 时 flush，避免拖拽高频写库。
- **demo 首跑 422 / 模型竞态** — 模型选项加载前保留种子模型；settings 在登录前 reject 不清空已 seeded 模型。
- **窄视口布局系列** — HUD/工具栏窄屏不换行、折叠 Inspector 裁剪、进入园区总览自动折叠 Inspector、ParkEconomyBar 缺 cost/token 指标时守卫。
- **Stripe 镜像索引在迁移后创建导致升级崩溃** — 迁移建表后补建 stripe mirror 索引，修复升级即崩。
- **工业程序化贴图在 headless（无 2D context）抛错** — canvas 2D context 获取加守卫，修复 jsdom/headless 测试环境崩溃。
- **Guided Tour 锚点滚出屏、操作按钮尺寸异常竖排** — 锚点在杂散页面滚动下保持在屏；统一操作按钮尺寸、禁止竖排换行。
- **MCP streamable-http 通知错误冒泡** — 尽力而为的 notify 失败被吞掉，不再打断主流程。
- **保存失败色值未走设计 token** — save-failed 颜色改用既有 `--error` token。

## [0.3.0] - 2026-08-29

### Added
- **账号系统与按用户隔离** — users 表 + JWT(HS256, bcrypt12) HttpOnly cookie 会话；graphs/runs/artifacts/brand_terms/成本全部按 `user_id` 过滤；前端登录/注册/用户菜单；旧库自动回填归属（迁移 14/15 幂等，无法归属的行 fail closed 不可见）。
- **通用节点六类（通用化 Phase 1 P0）** — HTTP 请求（SSRF 防护）、代码执行（JS/Python 子进程）、条件分支（安全表达式求值，无 eval）、映射 map（JSON 模板 + 类型保留）、循环 loop（内联子图 + `${item.x}` 上下文 + `{results:[...]}` 聚合）、并行聚合 parallel（barrier 结构化聚合）。
- **MCP Server（新包 `packages/mcp-server`，P0-P2 全部落地）** — stdio + Streamable HTTP/SSE 双传输；15 个工具（6 个核心 + 6 个管理类 create/update/delete graph、cancel_run、download_artifact、search_knowledge + batch_run/compare_runs + get_run_events）；Resources（`resources/list`/`templates`/`read` + `resources/subscribe`，graph:// run:// artifact:// 三类 URI）；Prompts（run_pipeline / analyze_pipeline / create_from_template 三个引导提示词）；实时 notifications 桥接（`notifications/resources/updated`）+ `AGENT_WORLD_MCP_READONLY` 只读模式 + Authorization Bearer 认证。详见 [docs/design-mcp-server.md](docs/design-mcp-server.md)。
- **产物统一渲染** — `ArtifactCard` 外壳 + 7 类渲染器注册表 + JSON 树 + 共享 `renderMarkdown`；Inspector / 成品面板 / 画廊三处接入；画廊按流水线分组；节点缩略图。
- **产物归属** — artifacts 表加 `graph_id` / `role`（source/intermediate/final）+ `label` + `mimeType: text/markdown`，落库归属流水线。
- **Canvas 交互增强** — Shift 多选 + 框选；批量移动 / 批量删除；首载自适应；视口 pan/zoom 持久化；节点执行时长展示；Inspector 可拖拽调宽。
- **Multi-select on canvas** — Shift+click plants/pipes to toggle selection; Shift+drag on empty backdrop draws a marquee box to select all plants inside; ⌘/Ctrl+A selects all plants.
- **Batch operations** — drag any selected plant to move the whole selection together (relative positions preserved); Delete/Backspace removes all selected plants and pipes at once.
- **First-load auto-fit** — the canvas auto-fits to all plants on first load so new users never see a blank board.
- **Viewport persistence** — pan/zoom state persists per graph in localStorage; refreshing or dispatching a new run no longer resets the viewport.
- **Node execution duration** — the Inspector shows how long each node ran (startedAt/finishedAt, formatted as ms/s/m/h/d).

### Changed
- 引擎 `setTextArtifact` 现在为文本产物填 `label`（首行 H1）与 `mimeType: text/markdown`。
- Left-drag on empty backdrop in select mode now pans the canvas (was marquee); marquee selection moved to Shift+drag.
- Removed unused `reset()` method from canvas store (the "适应" button's fit-to-bounds replaces it).
- Vite dev server port restored to 5173.

### Security
- **settings 按用户隔离** — settings 表（迁移 16），provider key 互不可见；运行期配置解析用 AsyncLocalStorage（runAsUser，并发 run 互不串）。
- **SSRF 防护** — HTTP 节点与 `/api/proxy` 共享 `ssrf.ts`（DNS 解析后按 IP 校验，DNS-rebinding 免疫），`ALLOW_PRIVATE_NETWORK=1` 逃生口；`/api/proxy` 要求登录 + 重定向逐跳复检。
- **cookie Secure** — 登录 cookie 按 `SECURE_COOKIES` / production 默认加 `Secure`（localhost 豁免）。
- **webhook 触发器强制非空 secret** — 空 secret 返回 400，杜绝匿名触发。

### Fixed
- Marquee selection coordinates now convert from viewport (SVG viewBox) space to content (graph) space, matching node x/y.
- Multi-select drag now snapshots selected node IDs at drag start, avoiding stale React closure state after a Shift+click toggle.
- Marquee selection now uses window-level pointer events (instead of React synthetic events + pointer capture on inner `<rect>`), preventing the selection rectangle from sticking to the cursor when pointerup is dropped.
- Added `pointercancel` listener so macOS trackpad gestures / system interruptions clean up the marquee instead of leaving it stuck.
- product-json parsing now tolerates a blocks-only array, and long-image export has end-to-end timeout protection (previously could hang on "生成中...").
- Removed the `max-height` on `product__body` so the sink content scrolls with the Inspector (previously nested scrolling made content unreachable).
- Inspector and Control Panel bodies now scroll internally.
- Upstream prohibited terms / brand words are now injected into every agent node's input (previously omitted).
- A `node.failed` event is emitted when a gate exhausts its rework attempts, so the failure reason is visible.
- Upstream image URIs are included in agent text input so product-json can reference real images.
- Bare media extraction now skips URLs inside fenced code blocks.

## [0.2.0] - 2026-08-26

### Added
- **4.5 Multimodal** — `ContentPart` (text + image) across engine, providers, and canvas.
- **4.7 Human-in-the-loop** — gate approve / edit / reject / scrap with run-halt webhook.
- **4C.7 Plugin process isolation** — `child_process.fork` with env trimming and fetch/fs proxy allowlists.
- **4D.7 MCP remote transports** — `stdio` / `http` / `sse` servers and tool-call permission governance.
- **4.9 Engineering**
  - GitHub Actions CI (typecheck + build + test) and gitleaks secret-leak scan.
  - CORS restricted to `CORS_ORIGINS` (was allow-all) plus basic security response headers.
  - Dockerfile + `docker-compose.yml` deployment.
  - MIT `LICENSE`.

### Changed
- CORS now requires `CORS_ORIGINS` in shared deployments; local dev keeps allow-all when unset.

## [0.1.0] - 2026-08-01

### Added
- Initial agent-world event-sourced pipeline engine, worker plugin system, triggers, MCP integration, and web canvas.
