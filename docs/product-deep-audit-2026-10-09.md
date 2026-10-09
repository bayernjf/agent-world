# Agent World 产品深度审计报告（代码层面 + 全功能点汇总）

- **审计日期**：2026-10-09
- **审计基线代码**：`feature/20260824` @ `dea82df`（生产 Hasee staging 运行 `dev @ 48645e2`，schemaVersion 42）
- **审计方法**：四包源码逐模块只读 + 全量测试实跑（Node 24.20.0）+ CI 质量门核对 + 与历史审计/评审对账
- **对账基线**：[security-audit-2026-08-31](security-audit-2026-08-31.md)、[code-audit-2026-09-06](code-audit-2026-09-06.md)、[code-audit-2026-09-30](code-audit-2026-09-30.md)（含 §七 增量复核）、[mvp-readiness-review-2026-09-25](mvp-readiness-review-2026-09-25.md)

> 本报告是**增量审计**：历史审计已确认并修复的项只做"无回潮"对账，不重复展开；重点是 09-30 以来新增模块与当前产品完整度判定。

---

## 一、结论速览

| 维度 | 结论 |
|---|---|
| **产品定位** | 节点式 AI 工作流（"产线"）可视化编排与执行平台，工厂/车间游戏化皮肤 |
| **自托管（单机 SQLite）** | ✅ **达到"产品核心完全可用的 MVP"**（延续 09-25 判定，10-04/07 再加固） |
| **对外 SaaS（多租户 PG）** | ❌ **不达标**：收款主体/HTTPS/灾备/告警消费端/PG HA 均缺 |
| **代码质量** | 良好。分层清晰、安全纵深完整、测试 3938 passed；无已确认代码层高危 |
| **当前最大风险** | **不是代码，是外部依赖**：agnes 免费额度第二次月度熔断（M1 停摆）、Stripe/灾备/告警 key 全部卡在用户侧 |
| **工程侧阻断项** | **0 个**——不依赖外部输入的技术活已基本清完 |

**一句话**：产品本体（自托管）已经是一个功能完整、可交付的 MVP；要继续推进到"对外收费 SaaS"，剩下的全是需要用户备齐外部资质与密钥的临门一脚，而非写代码。

---

## 二、产品定位与整体架构

### 2.1 定位

Agent World 让用户以"工厂产线"的隐喻，把 AI 能力（文本/图像/视频/音频生成）与通用逻辑（HTTP、代码、条件、循环、数据库、人工审批等）编排成一张有向图，一键或定时执行，并归集产物与成本。面向自媒体内容生产、电商、法律合规、财务审计等专业服务场景。

### 2.2 Monorepo 分层（pnpm workspace，四包）

```
packages/core      领域模型：图/节点类型/29 种 NodeKind/35 模板/编译校验/输出契约/AB/定价
packages/server    Hono API + 执行引擎 + 节点执行体 + 数据持久化（SQLite/PG 双 driver）+ 安全 + 运维
apps/web           React 画布 + Inspector + 3D/RTS 视图 + 设置 + i18n（Vite）
packages/mcp-server 让外部 AI 客户端经 MCP 协议接入（stdio + Streamable HTTP，15 工具）
```

**依赖方向（单向，无环）**：`core ← server ← web`；`mcp-server` 独立依赖 `core` 类型。执行体在 `server/src/nodes/`，引擎 `engine.ts` 只做调度与 `NODE_HANDLERS` 注册表分发（经阶段 2 重构，节点执行体已全部迁出）。

### 2.3 代码规模（实测）

| 包 | 源文件数 | 业务代码行 | 测试代码行 |
|---|---:|---:|---:|
| packages/core | 47 | 9,150 | 4,145 |
| packages/server | 303 | 31,881 | 32,812 |
| apps/web | 268 | 35,072 | 23,691 |
| packages/mcp-server | 14 | 2,140 | 1,155 |
| **合计** | **632** | **78,243** | **61,803** |

测试代码与业务代码比约 **0.79 : 1**，覆盖密度高。

---

## 三、产品全功能点汇总

### 3.1 画布与编排（2D）

- 节点拖拽、连线（含 error/catch 容错边）、对齐、网格、小地图（Minimap）
- 撤销/重做（undo/redo）、自动保存、节流快照
- Inspector 节点详情面板：点击才展开、可拖拽调宽；模型下拉严格按 modality（文本/图像/视频/音频）过滤
- 多产线管理（GraphSwitcher）、新建/复制/重命名产线
- **版本管理**：保存前自动快照（每图滚动保留 30 条）+ 版本与最近 run 的 content hash 关联 + 只读恢复预览（结构摘要 + SVG 缩略图）
- **模板参数化全链路**：TemplateField 实例化（core）+ fieldValues API（server）+ 参数表单（web，双入口）
- 命令面板（⌘K CommandPalette）、快捷键帮助、深色/浅色主题切换

### 3.2 节点体系：29 种 NodeKind（5 组）

按 `NODE_CATEGORIES` 分组（实测 `nodes/` 29 个执行体）：

| 分组 | 节点 |
|---|---|
| **AI 加工（5）** | textGen 文本生成、imageGen 图像生成、videoGen 视频生成、audioGen 音频生成、generic 通用模型 |
| **车间调度（9）** | branch 条件分支、loop 循环、parallel 并行聚合、fanout 扇出、select 择优、gate 质检评分、human 人工审批、subprocess 子流程、state-machine 状态机（**缓做**） |
| **物料处理（7）** | map 映射、table 表格处理、fileParse 文件解析、convert 文件转换、ocr 光学识别、translate 翻译、vcs 版本/合规校验 |
| **外接设备（6）** | http 请求、code 代码执行、database 数据库查询、search 搜索、compliance 合规、prohibited 禁用词检查 |
| **投料出料（2）** | source 投料、sink/publish 出料发布 |

**配套能力**：
- 节点级重试（search/http/code/translate）、失败级联 skip、失败告警 + rerun
- 从节点 fork 重跑、步级 run 时间线（G1）
- 上游数据契约空值护栏（G2）、数组输出契约（G2.4 部分留待）
- 技能卡体系（Skill）：内置 11 卡覆盖四类节点；用户可自建 prompt-module / output-contract / judge 三种本地技能（强制 `local:` 前缀）
- 术语表弹窗（标准术语 ⇄ 游戏化用词对照）

### 3.3 执行引擎与可靠性

- 流式 + SSE + 断线重连 + halt/resume
- **成本电表**：token 计量 + 单价计量两种模式；成本归集到 node_runs
- **多产线并发**：dispatch-gate 并发闸门，按套餐 `concurrentRuns` 限流
- **halted 死锁治本**：派发前自动 scrap 超 7 天未决策的 halted run（`HALTED_RUN_TTL_DAYS` 默认 7，PR #462）
- **G4 长任务健壮性**：node.degraded 事件 + REMOTE_JOB_LOST + remote_jobs 表（migration 41）+ 视频轮询降级 + resume reattach/accept-degraded + web 橙色标识三按钮
- 月度预算硬熔断（免费额度 2,000,000 折算 token/月，每月 1 号重置）
- 错误处理：进程级 guards（uncaughtException/unhandledRejection）、Hono `onError` 不泄内部细节、错误环形缓冲

### 3.4 模板体系：35 个业务模板

- **35 个零配置业务模板 + 1 个 tpl-blank**（实测 templates.ts 36 个 id）
- 覆盖 29 种节点中的绝大多数；按 core `TEMPLATE_CATEGORIES` 有序分类分组展示
- 方向分布：自媒体内容、电商（F1–F10）、法律合规（5）、财务审计（4）、通用批处理等
- 每个模板登记在 [template-checklist.md](template-checklist.md)，新增模板必登记并与 core 对账
- 模板容错加固（error 边兜底）；TemplatePicker 空白画布钉最前

### 3.5 3D / RTS 视图（差异化亮点）

- **2D/3D 一键切换**；L1 单厂 3D：受限 3D（俯角固定 + 水平旋转 + 平移）
- **写实工业风**：`industrial-kit.ts` 可复用 PBR 部件库（钢架/控制柜/压力容器/料仓/管段/阀门/传送带等）+ `industrial-recipes.ts` 每节点配方，已推广全部 29 种节点
- 视觉打磨：ACES 色调映射、线性雾、环境反射、Bloom、暗角、选中光环、running 呼吸脉冲
- **RTS 宏观上帝视角**：L0 工业园区 / L1 单厂 / L2 节点三层缩放
  - 阶段 A（平面工作台）、B（宏观沙盘 MVP，100 厂 60FPS）、C（C1–C8）全部完成
  - 跨厂产物边/跨厂管道（抛物线拱）、经济栏、排期空间化、效果热度、宏观轻操作
- 3D 选中高亮收口：私有克隆材质（不污染共享材质池）+ 地面光环

### 3.6 演示用户（Demo User）

- 免注册一键进入真实产品，`is_demo` 标记的真实账号
- 体验额度 + demoGuard 能力黑名单 + claim 原地转正 + TTL 级联清理（迁移 v40，D1–D6）
- Hasee 挂每小时 prune-demo cron（mode=APPLY，已只读取证闭环）
- 零配置首跑 422 经两轮修复（前端模型选项加载竞态）真机闭环

### 3.7 商业化（订阅 / 账单 / 收款）

- **三层计费**：Starter $9 / Pro $29 / Team $149（价格已用 M1 真实成本数据校准）
- **M2 订阅 gate（S1–S8 已落地部署）**：套餐配额（tokens/concurrentRuns/storageBytes/videoSegments/seats）、订阅升级拦截、`MONETIZATION_ENFORCE=1`
- **M3 收款与账单**：
  - invoices 表 + 账单生成、账单页 UI、HTML 发票、手动收款闭环、团队席位
  - **Stripe 全栈（后端 A0–A4 + 前端 A5 BillingTab）已部署**：数据模型/API/webhook/安全齐备
  - **仅剩真机 Step6：卡收款主体 + `STRIPE_SECRET_KEY`/`WEBHOOK_SECRET`/`PRICE_IDS`**
- 订阅升级按钮当前无 key 时优雅回退"联系管理员"

### 3.8 设置与模型目录

- 设置弹窗三标签页：**模型 / 集成 / 技能**
- **内置模型三件套**：文本 `agnes-2.5-flash`、图像 `agnes-image-2.5-flash`、视频 `agnes-video-2.5-flash`；Base URL `https://apihub.agnes-ai.com/v1`
- **模型目录可插拔**：模型名/模态/单价/启停成为 admin 可改的数据（平台目录行 `__platform__`，零迁移、继承静态加密）；`GET/PUT /api/admin/model-catalog`；下架会列出"打断哪些产线"
- 规则 A（下架即报错，无静默兜底模型名）+ 规则 B（`model:""` 跟随当前默认）
- 集成：MCP 服务列表（per-user 连接池、保存即试连）、数据库连接器、发布目标、品牌资产
- owner 开账号（服务端生成一次性口令、只显示一次）+ 首登强制改密（中间件层 403）+ owner 重置口令 CLI

### 3.9 运维与可观测性

- 健康探针 `/api/health`（ok/env/branch/commit/checks）
- Prometheus 指标 `/metrics`（run 计数、失败数、按模型累计成本；可设 `METRICS_TOKEN`）
- 错误追踪：零依赖环形缓冲 + `GET /api/admin/errors` + 可插拔 ErrorSink/webhook（`ERROR_REPORT_WEBHOOK_URL`）
- 审计日志（`model.catalog_update`/`account.provision` 等，敏感字段不记）
- 静态加密 + 密钥轮换（keyring 多密钥，新密钥加密/旧密钥解密 + 重加密收敛脚本）
- CI/CD：PR 合 dev → 质量门 → Hasee actions-runner 自动部署；部署脚本健康判定（失败 `deploy FAILED`）
- 备份：SQLite 备份、灾备演练；Docker/自托管部署手册齐全

### 3.10 MCP 接入（对外开放能力）

- 双传输：stdio + Streamable HTTP（`AGENT_WORLD_MCP_TRANSPORT=http`）
- 15 工具 + resources（graph:// run:// artifact://）+ prompts + 实时 notifications 桥接
- Authorization Bearer 认证（token = 用户 JWT，24h/7d）；只读档 `AGENT_WORLD_MCP_READONLY=1`（隐藏并拒绝 6 个写工具）
- 远程 MCP 指内网/本机需 `ALLOW_PRIVATE_NETWORK=1`（走 SSRF 闸）
- 接入手册 [runbooks/mcp-client-access.md](../runbooks/mcp-client-access.md)

### 3.11 国际化与引导

- **i18n 中英双语**：所有用户可见文案走 `t()`，zh/en 双写；守护测校验 key 存在/结构一致/无硬编码中文 JSX
- **Guided Tour**：聚光灯分步教学，多引导注册中心（引擎与定义解耦、引导即数据、版本化 seen）
- 新用户 Onboarding、What's-new、语言切换器

---

## 四、代码层面深度审计

### 4.1 架构分层与依赖方向 —— 健康

- 四包职责单一、依赖单向无环；领域模型（core）与执行/持久化（server）/表现（web）分离干净
- 引擎经重构后只做调度，29 个节点执行体独立、`NodeRunContext` 显式传参（无隐式全局）
- 四条派发路径（start/resume/fork/ab）共用 `drainRun()` 装配跨切面，消除三份重复代码，保证合规词表/技能/媒体落库/预算/用量归集在所有入口一致（PR 收口）
- **观察**：`index.ts` 已按领域拆分为 `routes/{auth,graphs,runs,ops,admin,settings,feedback,announcements,billing}.ts` + shared/ctx，路由层可维护性提升；sqlite-driver 拆为 schema/mappers/backup/cascade/driver-body 五个文件

### 4.2 数据访问抽象 —— 符合双轨约定

- 所有 DB 访问统一走 `db.ts` 抽象方法（getXxx/insertXxx/listXxx），调用方无裸 SQL
- **双 driver 设计**：`openDatabase()` 按 `DB_DRIVER` 分派 SQLite（默认）/PostgreSQL（`DATABASE_URL`），未知值 fail-closed；137 方法已 async 化
- SQL 方言差异（strftime/EXTRACT、LIMIT OFFSET、upsert、BLOB/bytea、bigint）全部收敛在 driver 层；PG 下 FTS 知识库诚实降级为 NoopMemoryBackend
- 搬迁脚本 `migrate:postgres`（VACUUM INTO 快照 → 建表 → 流式批量 INSERT → 行数校验），端到端演练已抓出并修复 9 类方言缺口
- **改进（对账 09-30 §七）**：CI 已新增独立 **PostgreSQL path smoke** job（跑 `pg-smoke.test.ts`），"CI 从不跑 PG 路径"一条已部分收口（仍非全量 PG 测试，见 P2）

### 4.3 安全纵深 —— 完整，无已确认高危

| 面 | 现状（代码取证） |
|---|---|
| **认证** | JWT(HS256) + bcrypt；HttpOnly cookie；逐请求重读用户行（不信 token 内 role）；强制改密中间件（非 auth 路径 403 PASSWORD_CHANGE_REQUIRED） |
| **授权隔离** | graphs/runs/artifacts/成本全部按 user_id 过滤，跨用户读取 fail-closed；只读协作者不能运行；owner/admin RBAC；demo 能力黑名单 |
| **SSRF** | 出站 fetch 在**解析时**校验 IP（同一 lookup 喂校验与请求，抗 DNS-rebinding）；IPv4/IPv6 内网段全覆盖（含 CGN/link-local/元数据地址）；undici pinned Agent；`ALLOW_PRIVATE_NETWORK` 逃生口 |
| **代码沙箱** | 解释器绝对路径缓存、独立临时 cwd（finally 清理）、env 白名单、rlimit/Node permission、net allowlist SSRF 代理；fail-closed |
| **进程隔离** | isolation.ts 隔离层（09-06 后新增模块） |
| **静态加密** | AES-256-GCM，每条随机 IV；v1/v2 信封，keyring 有序多密钥（新密钥加密/旧密钥解密）；settings 与图文档凭证/快照全加密 |
| **输入安全** | sanitize、DOMPurify（已升 3.4.16）、XSS 出口处理 |
| **供应链** | `pnpm audit --audit-level=high` exit 0；source-map-js CVE 已用 overrides 钉 ≥1.2.2；Dependabot 已改 target-branch dev；Secret scan + CodeQL 在 CI |

历史安全审计 29 项（08-31）、代码审计 77 项（09-06）、§七 8 条（09-30）对账：**无回潮**。

### 4.4 错误处理与可靠性 —— 健壮

- 进程 guards 幂等安装：uncaughtException 记录后走既有 shutdown 由 systemd 重启，unhandledRejection 只记录不退出
- Hono `onError` 仅对 5xx 记录 method/path、回通用 500（不泄内部细节）
- 错误环形缓冲（默认 100 条、stack 截 4000 字）+ 可插拔 sink，失败只 log 防递归、零 SDK
- G4 长任务降级/续跑、视频轮询、halted TTL 自动 scrap 均已上线
- **低优观察**：后端个别错误 `message` 字段为硬编码中文（如 `index.ts:481` "请先修改一次性密码"），前端按 `code` 翻译、message 仅兜底；建议后端 message 统一为英文或中性，避免中英混杂（见 P2）

### 4.5 测试覆盖与质量门 —— 强

**全量测试实跑（Node 24.20.0，2026-10-09）**：

| 包 | 测试文件 | 结果 |
|---|---:|---|
| packages/core | 24 | **346 passed** |
| packages/server | 170（+2 skipped 文件） | **1,498 passed / 5 skipped** |
| apps/web | 110 | **2,023 passed** |
| packages/mcp-server | 3 | **71 passed** |
| **合计** | — | **3,938 passed / 5 skipped** |

**CI 质量门（10 道，按序）**：① Dependency audit（high）② Build ③ Typecheck ④ Lint（Biome，Checked 700+ files）⑤ i18n guard（key 结构/死键/硬编码中文）⑥ Test（maxWorkers=1）⑦ E2E（Playwright，smoke+flows 共 5 测）⑧ PG path smoke（独立 job）⑨ Secret leak scan ⑩ CodeQL。

- 关键守护测普遍采用"植入缺陷 → 看它变红 → 修复回绿"，非空断言
- 含跨切面守护（源码扫描：派发文件必须引用 drainRun）、表单可达性守护（每个节点配置字段必须可从表单到达）
- **观察**：测试数较 09-30（约 3,800）净增约 140，主要来自运维工具收口、模型目录、provision、媒体表单守护

### 4.6 代码规模与技术债

**偏大文件（可维护性，非缺陷）**：

| 文件 | 行数 | 性质 | 建议 |
|---|---:|---|---|
| core/templates.ts | 3,643 | 数据声明（35 模板） | 可接受；必要时按分类拆分数据文件 |
| server/driver-body.ts | 2,777 | SQLite driver 主体 | 已拆出 schema/mappers/backup/cascade，剩余可按聚合根再拆 |
| server/engine.ts | 2,385 | 调度器（曾更大） | 已重构 -63%；暂可接受 |
| web/Settings.tsx | 1,775 | 设置三标签 | 可按标签拆子组件 |
| web/lib/api.ts | 1,606 | API 客户端 | 可按领域拆 |
| web/App.tsx | 1,440 | 应用装配 | 可抽路由/布局 |
| sqlite-schema.ts | 1,390 | DDL 数据 | 可接受 |

---

## 五、风险与待办（分级）

### P0 —— 卡对外商业化 / 需用户外部输入（工程无法代做）

| # | 事项 | 影响 |
|---|---|---|
| P0-1 | **升级 agnes 付费 key / Token Plan** | 免费额度第二次月度熔断（10-08 烧光），M1 四产线停摆；否则等 11-01 重置、断档约 23 天 |
| P0-2 | **Stripe 收款主体 + 三 key**（SECRET/WEBHOOK/PRICE_IDS） | 商业化临门一脚；代码全栈已部署，缺真机收款 |
| P0-3 | **HTTPS / 域名 + 证书** | 对外 SaaS 上线前置硬条件 |

### P1 —— 生产健壮性缺口（部分需外部 key）

| # | 事项 | 现状 |
|---|---|---|
| P1-1 | 第二灾备源 `BACKUP_BASE_URL/API_KEY/MODELS`（须不同 host） | failover 已启用但无 backup，启动持续 warn（#44） |
| P1-2 | Sentry DSN / 告警 webhook | 错误 sink 生产端就绪、缺消费端，第一次真事故时唯一记录可能丢失 |
| P1-3 | TTS 真机 SiliconFlow/OpenAI key | 配音链路代码已部署，缺真机端到端 |
| P1-4 | 生产 `/metrics` 设 token、`BIND_HOST` 收口 | 开关已给、默认未收，公网暴露前必须 |

### P2 —— 技术债（不卡 MVP，可排期）

| # | 事项 |
|---|---|
| P2-1 | PG 路径仅 CI smoke、非全量；多副本/PG HA 待 SaaS 阶段 |
| P2-2 | G2.4 数组输出契约剩余部分 |
| P2-3 | 后端错误 message 中英一致性（去硬编码中文兜底消息） |
| P2-4 | 偏大文件继续拆分（driver-body / Settings / api / App） |
| P2-5 | 派发口限流/幂等/审计三条跨切面语义口径需用户拍板 |

### P3 —— 低优 / 缓做

| # | 事项 |
|---|---|
| P3-1 | §七 7.8：systemd `Environment=` 密钥对本地用户可读的最终收口（**需 root**） |
| P3-2 | 状态机节点（等 variables+branch 兜不住的真实流程语义再开） |
| P3-3 | 账号自助（找回密码）；sprintf-js 无补丁 moderate（随上游） |
| P3-4 | Docker 代码沙箱后端、模板市场 |

---

## 六、与历史审计对账

| 报告 | 项 | 当前状态 |
|---|---|---|
| security-audit-2026-08-31 | 29 项（3C/10H/8M/8L） | ✅ 全修复，无回潮 |
| code-audit-2026-09-06 | 77 项（H8/M38/L31） | ✅ 清账（修复 73/不成立 3/部分 1 配套迁移） |
| code-audit-2026-09-30 §七 | 8 条（含 2 高危） | 7.1–7.7 ✅ 已修；**7.8 待 root（P3-1）** |
| mvp-readiness-2026-09-25 | 自托管 ✅ / SaaS ❌ | 判定维持，本报告确认 |

**本次新增发现**：仅 P2-3（后端错误 message 中英混杂）一条低优，其余均为历史已登记的外部依赖项，**无新增代码层高危**。

---

## 七、审计判定

1. **自托管（单机 SQLite）：✅ 达到产品核心完全可用的 MVP。**
   画布编排、29 节点、执行引擎、35 模板、产物/成本归集、3D/RTS、Demo、订阅 gate、安全纵深、运维与质量门全部落地并经真机/测试验证；无代码层阻断项。

2. **对外 SaaS（多租户 PG）：❌ 不达标。**
   差距不在功能代码（Stripe 全栈、PG 双驱动、多租户模型均已就绪），而在**外部资质与生产配置**：收款主体/key、HTTPS 域名、灾备源、告警消费端、PG HA。

3. **推进建议（按序）**：
   - 先备 **agnes 付费 key**（P0-1）——解除 M1 停摆，恢复成本/完成率数据回采；
   - 再备 **Stripe 收款主体 + key**（P0-2）——走通真机付费 happy path，商业化闭环；
   - 公网暴露前完成 **HTTPS + metrics 收口 + 灾备/告警 key**（P0-3/P1）；
   - P2 技术债利用 M1 等待窗口按需清理，不阻塞主线。

**总评**：Agent World 工程完成度高、安全与质量门扎实，产品本体已可交付；当前是"等米下锅"阶段——所有剩余高优项都依赖用户提供外部 key 与资质，工程侧已无阻塞。

---

*审计人：Doubao（代码只读 + Node 24 全量测试 + CI 核对）；报告落档 docs/product-deep-audit-2026-10-09.md。*
