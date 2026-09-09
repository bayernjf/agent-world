# Changelog

All notable changes are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed
- **修掉三处把「未落地」写成「已落地」的文档错误** — ① [extending.md](docs/extending.md) §3 声称「isolated worker loader 在子进程里强制技能卡权限」，实际 `isolation.ts` / `IsolatedWorker` 隔离的是 **Worker（模型 provider 插件，走 `worker-plugins.ts`）**，技能卡完全在主进程内跑（`nodes/textgen.ts` → `executeBuiltinTool`），两件事被混为一谈——而子进程沙箱正是 design-skill §4 明确「缓做」的东西。② 同节的 API 形状是错的：`registerSkill({ id, tool, execute })` 与 `permissions: ["fs:read", "network"]` 都编译不过，实际是 `BuiltinSkill`（`execute` 嵌在 `tool` 子对象里）+ 结构化 permissions 对象；design-skill §12.1 刚写的示例犯了同一个错，一并修正。③ [technical-design.md](docs/technical-design.md) §11.2 声称运行时拿到「被权限约束过的 `ToolContext` 代理」，实际没有这个对象、强制也是按工具硬编码而非从声明推导——保留设计意图，加实现现状注。
- **README 测试数与 MCP 能力描述过期** — `2698+ / mcp-server 50` → 实测 `2809`（core 198 / server 960 / mcp-server 71 / web 1580）；MCP 一行补上协议修订版与 OAuth。docs/README.md 索引新增 Skill 与 MCP Server 两行入口（此前只有笼统的 `design-*.md`，两份文档实际搜不到）。

### Added
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

### Changed
- **核心文件重构（行为零变化）** — `engine.ts` 4954→1828 行：29 种节点执行体迁至 `packages/server/src/nodes/`（28 个 handler + `NodeRunContext` + `NODE_HANDLERS` 注册表分发）；`Inspector.tsx` 3848→611 行：节点配置面板拆至 `InspectorFields/` 27 文件 + 注册表分发。详见 [docs/design-refactor-engine-inspector.md](docs/design-refactor-engine-inspector.md)。
- 模板总数从 27 增至 33（覆盖 29 种节点类型中的 23 种）

### Fixed
- **agnes 视频一律按 5s 兜底计费（未按真实成片秒数）** — 真机抓取 agnes 完成任务 JSON 确认成片时长在顶层 `seconds` 字段、且为**数字字符串**（实测 `"5.0"`；`num_frames/frame_rate` 只嵌在 `perf_params` 下、顶层没有）。两处导致 perSecond 表读不到真实时长：agnes videoAdapter 未配 `durationPath`，且 `videoBillingSeconds` 只接受 JSON number。修复（`5ffeb65`，PR #218 已部署 Hasee）：adapter 配 `durationPath: "seconds"`；新增 `positiveNumber()` 同时接受 number 与数字字符串（durationPath、num_frames/frame_rate 两路统一走它）；+1 字符串秒数用例（`"8.0"` → 8s/$0.80，18 provider 测试过）。部署后在 dist 真机回放验证：`"5.0"`→5s/$0.50 不回归、`"8.0"`→8s/$0.80。agnes `omitDuration` 默认出片即 5s，故常规 run 金额仍是 $0.5，本修的价值是非 5s 成片不再被截成 5s。
- **nodemailer high 级 ReDoS（CI 依赖审计阻断）** — `nodemailer < 9.1.0` 的 addressparser 二次方复杂度可被构造地址列表远程打挂（GHSA-2x7j-588g-ccc2），`pnpm audit --audit-level=high` 因此 exit 1、PR #218 门禁失败。dev 先以 9.1.1（`81d6bab`）解除门禁；合并 main 时发现 dependabot PR #179 已将其升到 10.0.0（main 另有 hono 4.13.7 / jose 6.2.11 / i18next 26.4.2），PR #219 的冲突解决最终取 **nodemailer 10.0.0**（merge `9712f52`）。代码仅用 `createTransport`/`sendMail` 稳定 API，无行为变化；CI Node 24 测试全绿，`pnpm audit` 无已知漏洞；2026-09-09 Hasee 真机确认实际解析版本 10.0.0、dist notifier 加载正常、服务干净重启。
- **视频/音频产物成本恒为 $0（M1 成本数据污染）** — provider worker 的视频/音频成功路径硬编码零 usage，从不填 `units`、从不调 `computeCost`，导致 perSecond/perKiloChar 价格卡形同虚设，视频/音频 run 的 `node_runs.cost_usd` 当场按 0 落库、**事后无法补算**。修复（`openai-compatible.ts`）：视频按秒计费，秒数解析顺序为适配器 `durationPath` → `num_frames/frame_rate` → 节点 `duration` → 5s 默认兜底；音频按输入字符数 perKiloChar（金额 ÷1000）；`videoAdapter` 增配 `durationPath` 点路径。+4 媒体计量用例（durationPath 8s=$0.80 / 帧数推导 5s=$0.50 / 无字段兜底 5s / TTS 11 字符）。2026-09-08 部署 Hasee 后端到端复验：视频 run `units:{seconds:5}`、`costUsd:0.5`（修复前 $0）。
- **内置 agnes 模型单价保存后被抹掉（M1 开跑阻塞）** — 内置 `agnes` tier 无价格卡，且 `loadConfig` 每次读取都用内置 `AGNES_PROVIDER` 整体覆盖 builtin provider，导致在「设置 → 模型」里给 6 个 agnes 模型填的单价保存后随重载丢失、电费恒为 `$0.00000`。把价格卡写进源码 `AGNES_PROVIDER.pricing`（随产品发布，非正式占位单价 ≈ OpenAI 同级 list price，正式计费前换真实费率）；custom provider（ceshi）仍走设置持久化。配全后投料实测电费 `$0.00051`、token 830 入/643 出，与 `computeCost` 手算一致。
- **ABReport A/B 对比「单跑成本」测试 flaky** — `renderAndWait` 只等 `api.abReport` 被调用、没等 promise resolve 后 `setReport` 重渲染，CI 高负载下断言撞上「加载中…」偶发失败；改为等加载指示消失（`!report` 门一旦有数据不再回到加载屏）。 — dependabot 提的 6.1.1 peer 是 `vite: ^8` 且 import `vite/internal`，Vite 6 下 `vite.config.ts` 加载即崩（PR #203）。改升到仍支持 Vite 6 的 5.x，并让 dependabot 忽略该包的 major，直到 Vite 升级。
- **代码沙箱 Node 权限门控探测** — `probeNodePermissionGate` 剥离 `NODE_OPTIONS` 后探测（宿主 `--require` 语言 shim 需要 fs 读、被权限模型默认拒绝，导致误判「无权限模型」）；`--allow-fs-*` 只在检测到 `--permission`/`--experimental-permission` 门控后才发出，杜绝 Node ≥ 22.2 下「无门控的 allow 参数」触发 `ERR_MISSING_OPTION` 崩溃。详见 [docs/design-code-sandbox.md](docs/design-code-sandbox.md)。
- **tesseract 语言包缓存目录** — 从 server 进程 CWD 改到 `<DB dir>/tessdata`（与 `artifacts/`、`logs/`、`.encryption-key` 同级），47MB chi_sim+eng 不再污染 CWD。

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
