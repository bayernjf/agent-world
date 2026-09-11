# Handoff

State of Agent World as of 2026-09-11.

> **历史内容已归档**：2026-08-27 之前的全部变更记录、各阶段详细描述、质量门与已知 gap，已整体搬到 [docs/handoff-archive.md](docs/handoff-archive.md)。本文件只保留"项目当前状态 + 活跃任务 + 最近 5 个变更"。

## Project documents

📚 **文档地图（按场景怎么读 + 状态约定）**：[docs/README.md](docs/README.md)。以下为全部文档直达（本区是完整清单的单一事实源，README 只做场景导航、不重复清单）：

* [docs/PRD.md](docs/PRD.md) — phased roadmap and architectural guardrails
* [README.md](README.md) — two core design decisions, layout, running instructions
* [BENCHMARK.md](BENCHMARK.md) — 性能基准测试：运行方式、范围、结果记录表

* [docs/technical-design.md](docs/technical-design.md) — architecture, data models, API

* [docs/roadmap-generalization.md](docs/roadmap-generalization.md) — 通用化路线图（当前主线，5 阶段）

* [docs/deferred-items.md](docs/deferred-items.md) — 缓做/低优事项登记表（挂起项 + 触发条件的单一事实源）

* [docs/security-audit-2026-08-31.md](docs/security-audit-2026-08-31.md) — 安全审计报告 + 修复方案（3 Critical / 10 High / 8 Medium / 8 Low，**29 项全部修复**；含两条旧"已解决"结论的更正）★

* [docs/code-audit-2026-09-06.md](docs/code-audit-2026-09-06.md) — 全项目代码审计报告（77 项：high 8 / medium 38 / low 31；含「六、修复状态」章节——已修复 34 / 部分 1 / 无需修复 2 / 未修复 40，未修复项按类归因，供接力）★

* [docs/design-at-rest-encryption.md](docs/design-at-rest-encryption.md) — 静态加密设计（settings / webhook secret 落盘 AES-256-GCM；审计 L3，已落地）

* [docs/design-mcp-server.md](docs/design-mcp-server.md) — MCP Server 设计方案（让其他 AI 客户端接入 agent-world）

* [docs/design-artifact-display.md](docs/design-artifact-display.md) — 产物统一渲染卡设计（ArtifactCard + 渲染器注册表；已落地）

* [docs/design-artifact-attribution-repo.md](docs/design-artifact-attribution-repo.md) — 产物归属 + 按流水线分组成品仓库设计（已落地）

* [docs/design-code-sandbox.md](docs/design-code-sandbox.md) — 代码节点运行沙箱（P0/P1/P2 + fs/net 策略 + net allowlist SSRF 校验代理全部落地；docker 容器后端待办）

* [docs/design-templates.md](docs/design-templates.md) — 产线模板体系增强（老用户入口/覆盖面/参数化已落地，市场缓做；§6 = 分类分组展示与 `TEMPLATE_CATEGORIES` 单一事实源）

* [docs/design-versions.md](docs/design-versions.md) — 产线版本管理补强（自动快照/run 关联 hash/恢复预览已落地，diff 缓做；A/B 实验为独立特性已落地另见 design-ab-testing.md）

* [docs/phase4-design.md](docs/phase4-design.md) — Phase 4 高级编排落地方案（六项已落地，状态机缓做）

* [docs/design-refactor-engine-inspector.md](docs/design-refactor-engine-inspector.md) — 核心文件重构方案（engine.ts 的 runNode / Inspector.tsx 拆分；**阶段 1+2 已全部完成**——Inspector.tsx -84%、engine.ts -63%、节点执行体迁 nodes/；阶段 3 接口风格约定可延后）

* [docs/feedback-workflow.md](docs/feedback-workflow.md) — owner 怎么高效反馈给我（截图 / computer-use / 防丢）

* [docs/template-checklist.md](docs/template-checklist.md) — 产线模板验证与评估待办表（逐模板真实狗粮验证状态，当前 33 个；**新增模板必登记**，与 core TEMPLATES 数对账）★

* [docs/handoff-archive.md](docs/handoff-archive.md) — historical changes (pre-2026-08-27)

* [docs/PRODUCT\_STRATEGY.md](docs/PRODUCT_STRATEGY.md) — 产品策略汇总（成本/部署/定价/商业化决策基线）

* [docs/project-progress.md](docs/project-progress.md) — 整体进度基线（模块完成度 + 待启动管线 + 迭代规则）

* [docs/design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) — 自媒体电商方向 F1-F10（run 内多变体/审核队列/合规/商品库/批量/效果回流/发布，已全部落地）
* [docs/design-monetization.md](docs/design-monetization.md) — 商业化实施方案（三层计费 / 订阅 gate / P0-P3，已设计未实施）
* [docs/product-content-roadmap.md](docs/product-content-roadmap.md) / [docs/product-industry-roi.md](docs/product-industry-roi.md) — 内容线规划 / 行业 ROI 评估
* [docs/rpa-readback-onboarding.md](docs/rpa-readback-onboarding.md) — RPA 回读真实环境接入清单

* [docs/design-connector-database.md](docs/design-connector-database.md) / [docs/design-data-interpolation.md](docs/design-data-interpolation.md) / [docs/design-template-connector-presets.md](docs/design-template-connector-presets.md) / [docs/design-triggers.md](docs/design-triggers.md) — Database 连接器 / 数据插值（含 09-06 回滚与 09-08 恢复记录）/ 全 33 模板连接器适配盘点与预设方案 / 触发方式
* [docs/design-knowledge-memory.md](docs/design-knowledge-memory.md) — 知识提取与记忆系统

* [docs/design-rbac.md](docs/design-rbac.md) / [docs/design-audit-log.md](docs/design-audit-log.md) / [docs/design-logging.md](docs/design-logging.md) — 角色权限 / 审计日志 / 服务端日志
* [docs/design-announcement.md](docs/design-announcement.md) / [docs/design-feedback.md](docs/design-feedback.md) — 公告 / 用户反馈
* [docs/design-key-rotation.md](docs/design-key-rotation.md) + [docs/runbooks/key-rotation.md](docs/runbooks/key-rotation.md) — 密钥轮换设计 + 运维手册

* [docs/runbooks/deploy-ubuntu-server.md](docs/runbooks/deploy-ubuntu-server.md) — Ubuntu 纯 Server 单机部署手册（Node 24 + systemd 托管 server + nginx 同源托管 web；bwrap 沙箱 / 备份 / 笔记本运维要点；面向商业化 P0/P1 本地测试）

* [docs/runbooks/deploy-ubuntu-execution-plan.md](docs/runbooks/deploy-ubuntu-execution-plan.md) — Ubuntu 落地执行方案（阶段 0 待填机器信息后执行；阶段 1-7：系统准备→代码构建→配置→systemd→nginx→备份→商业化 P0/P1 验收清单；含验证点/回滚/风险）

* [docs/runbooks/deploy-ubuntu-execution-log.md](docs/runbooks/deploy-ubuntu-execution-log.md) — Ubuntu 部署执行日志（逐步执行记录：每步指导说明 + 文档化命令（敏感信息用占位符）+ 实际结果回填；免密配置 A1-A3 → 阶段 1-7）

* [docs/runbooks/deploy-cicd.md](docs/runbooks/deploy-cicd.md) — CI/CD 自动部署方案（Git + CI 质量门禁 + self-hosted runner；Mac push → CI 测试 → 自动部署到 Hasee；含 Deploy Key / 最小 sudo / runner 安装 / deploy.sh / workflow 五步 + 回滚排障）★

* [docs/environments.md](docs/environments.md) — 环境划分（M0 单机合一 → M3 三套 DEV/TEST/PROD → 未来规模化；环境→分支映射：`feature/*`=DEV / `dev`=Hasee 准生产 / `main`=PROD）

* [docs/production-ops.md](docs/production-ops.md) — 生产级运维与可观测性（环境状态检测 / 密钥注入 / k8s 选型判断 / 可观测性栈 / 日常运维·实时监测与拿日志；2026-09-07 定稿未实施）

* [docs/engineering-blueprint.md](docs/engineering-blueprint.md) — 企业级工程化蓝图（**12 工程域全景**：可观测性/可靠性/发布/安全/配置密钥/IaC/数据/测试/性能/DevEx/运营/FinOps；每域「现状/缺口/补齐方案/优先级」+ M0→M3→规模化分级路线；2026-09-07 定稿未实施）

* [docs/design-scaling.md](docs/design-scaling.md) — 规模化与企业级架构方案（**分布式 / 高可用 / 高并发 / 大数据量 / 托管 / 数据处理 / 合规**七主题，每项「现状/问题/方案/触发条件/落地步骤」；**决策：自托管 + SaaS 都做，先自托管后 SaaS**——自托管阶段只需成本熔断/备份演练/探针/对象存储，SaaS 阶段再补 PG/多副本/分布式锁/合规；2026-09-07 定稿待评审）

* [docs/design-postgres-migration.md](docs/design-postgres-migration.md) — PostgreSQL 迁移设计（主库 SQLite→PG：现状盘点 / 差异清单 / 双驱动改造 / 数据搬迁 / 迁移 SQL 命名规则 / 回滚 / 验收；设计定稿 2026-09-08；**阶段 1-3 + 搬迁脚本均已落地 2026-09-08**——`sqlite-driver.ts` + `DatabaseDriver` 异步接口 + 137 方法 async + `pg-sql.ts`/`pg-driver.ts`（阶段 1-2）；**阶段 3**：`db.ts` `openDatabase()` 按 `DB_DRIVER` 分派（默认/空值=sqlite，未知值 fail-closed，PG 连接走 `DATABASE_URL` 或 `PG_*` env）+ `index.ts` 接线 + FTS 知识库 PG 下诚实降级为 `NoopMemoryBackend` + `db-driver-switch.test.ts` 5 例守护；**搬迁脚本**：`migrate-to-postgres.ts`（`pnpm --filter @agent-world/server migrate:postgres`，VACUUM INTO 快照→toPgDdl 建表→流式批量 INSERT→行数校验，`--dry-run`/`--verify-only`），落地时**修复 DDL 契约缺口**（`resource_access`/`subscriptions`/`usage_ledger`/`idempotency_keys` 4 表只在迁移 32-35 建、DDL 常量缺失，fresh PG 库会缺表——已补 DDL）；server 929/929 绿；**端到端演练 ✅ 2026-09-08**（Docker postgres:16 + dev 库 25 表/12.2 万 events：行数对齐/71 图逐字节一致/enc:v2 密文可解密/PG 冒烟注册→建图→更新→版本列表全通；**演练抓出并修复 9 类方言缺口**——DDL 缺 3 列、BLOB→bytea、rowid→ctid、LIMIT -1→ALL、date() 日桶、INSERT OR IGNORE→ON CONFLICT、upsert 列名歧义、node-pg bigint→string 解析器、PG 别名小写折叠需加引号，详见设计文档 §8 表格）。**剩余：性能压测 + 生产切换等价性，随 SaaS 阶段真实流量验证**）

* [docs/design-multitenancy.md](docs/design-multitenancy.md) — 多租户数据模型设计（**tenant / user / 资源 / 计费**四者关系；tenant=计费与隔离边界，自托管=隐式单租户、SaaS=显式多租户；`users.tenant_id` 推导避免全表加列，订阅计费按 tenant、角色三层分权；向后兼容两阶段演进；2026-09-07 起草待评审）

* [docs/design-ab-testing.md](docs/design-ab-testing.md) / [docs/design-skill.md](docs/design-skill.md) / [docs/design-glossary.md](docs/design-glossary.md) — A/B 实验 / Skill 体系 / 术语表
* [docs/design-design-tokens.md](docs/design-design-tokens.md) / [docs/design-i18n.md](docs/design-i18n.md) / [docs/web-component-testing-plan.md](docs/web-component-testing-plan.md) — 设计 Token / i18n / 组件测试

* [docs/design-canvas-isometric.md](docs/design-canvas-isometric.md) — 画布等距 3D 展示视图设计（受限 3D：俯角固定 + 水平旋转 + 平移；2D/3D 一键切换；**第一、二、三期已实施**）

* [docs/design-rts-overview.md](docs/design-rts-overview.md) — RTS 宏观上帝视角设计总览（L0 工业园区 / L1 单厂 3D / L2 节点三层缩放；六类宏观信息；A 平面工作台→B 宏观沙盘 MVP→C 完整 RTS；**P3 未实施，阶段 A 可在 M1 等待期先行**）

* [docs/examples.md](docs/examples.md) / [docs/extending.md](docs/extending.md) / [docs/integrations-future.md](docs/integrations-future.md) — 模板示例 / 扩展指南 / 未来集成（Notion/Linear/邮件/内容平台）

* 历史（决策记录，勿据此实现）：[docs/product-vision-discussion.md](docs/product-vision-discussion.md) / [docs/tech-stack-assessment.md](docs/tech-stack-assessment.md) / [docs/roadmap-tasks.md](docs/roadmap-tasks.md)

* 根目录元文档：[CHANGELOG.md](CHANGELOG.md)（变更日志） / [CONTRIBUTING.md](CONTRIBUTING.md)（贡献指南） / [AGENTS.md](AGENTS.md)（AI 行为规范：commit / i18n / UI 文案约定，**新会话必读**） / [git-commit-message.md](git-commit-message.md)（commit message 详细规范）

## Current state

* **Monorepo**：`packages/core` / `packages/server` (Node + sqlite, 端口 8791) / `apps/web` (Vite, 端口 5173)

* **核心能力**：5 类 AI 生成节点（textGen / imageGen / videoGen / audioGen / generic）+ **通用节点（HTTP 请求 / 代码执行 / 条件分支 / 映射 / 循环 / 并行聚合 / 表格处理 / 数据库查询 / 文件解析 / 翻译 / OCR / 文件转换 / 搜索 / 通知 / 人工审批 / 子流程 / 合规 / 发布 / 扇出 / 择优）**，节点类型共 29 种（`NodeKind`，按 `NODE_CATEGORIES` 五组：AI 加工 5 / 车间调度 9 / 物料处理 7 / 外接设备 6 / 投料出料 2），**Phase 4 编排能力全部落地（2026-08-30 复核）：人工审批 human 节点 / subprocess 子流程调用 / graph 变量跨 run 持久化 / error 边 + catch 容错路径 / 失败级联 skip / 节点级重试基建（search/http/code/translate）/ 失败告警 + rerun；状态机按决策缓做**，**MCP Server（stdio + HTTP/SSE 双传输，15 工具 + resources + prompts + 实时 notifications 桥接 + Authorization Bearer 认证，P0-P2 全部落地）**，多产线管理，Inspector 模型下拉严格按 modality 过滤，多模态产出（Artifact 分层），流式 + SSE + 断线重连 + halt/resume，成本电表（token + 单价两种模式），评估体系雏形，产物落库归属流水线（artifacts 的 graph\_id/role），**版本管理补强（2026-08-30）**：保存前自动快照（节流 + 每图滚动保留 30 条）+ 版本与最近 run 的 content hash 关联标记 + 只读恢复预览（结构摘要 + SVG 缩略图），**模板参数化全链路（2026-08-30）**：TemplateField 实例化应用（core）+ fieldValues API（server）+ TemplateFieldDialog 参数表单（web 双入口，4 个 HTTP 模板声明 URL 字段），**术语表弹窗（2026-08-30）**：GlossaryModal 标准术语 ⇄ Agent World 游戏化用词对照（design-glossary.md 单一事实源），**Inspector 交互修复（2026-08-30）**：面板改为显式**点击**节点才展开、拖拽节点不再误弹（store.inspectorOpen 信号驱动），**模板能力释放（2026-08-31）**：18 个实用模板覆盖主要节点能力（含 loop 批处理 / vcs / convert+ocr / search+TTS），现有模板容错加固（error 边兜底），routingWorker 补视频音频路由（此前 videoGen/audioGen 生产被静默跳过），**模板分类展示（2026-09-01）**：业务模板增至 27 个（覆盖 25 种节点类型中的 23 种），分类收口为 core `TEMPLATE_CATEGORIES` 有序 11 类，TemplatePicker 改为按分类分组滚动、空白画布钉在最前（design-templates §6）；**专业服务方向（2026-09-04）**：业务模板增至 **33 个**（法律合规 5 + 财务审计 4，新增银行对账/隐私合规/发票 OCR/批量合同审查/审计抽样/尽调清单，全部零新节点 + 逐一真实狗粮），**fileParse 支持多文档解析**（`===== 文件名 =====` 分隔），**Skill 体系用户化（2026-09-09）**：内置卡 5→11 覆盖全部四种 kind，`judge` 卡接进 gate 节点、权限强制改声明驱动、6 张卡预挂 4 模板；**用户可自助接入远端 MCP 服务（http/sse，per-user 连接池 + 保存即试连，stdio 仍只走运维 env）并自建三种数据技能卡（prompt-module / output-contract / judge，强制 `local:` 前缀，不进全局 registry、盖不住内置同名）**；设置弹窗重构为**模型 / 集成 / 技能**三标签页，MCP 服务列表与节点技能面板均支持搜索，技能面板可深链到「设置 → 技能」

* **安全基线（本轮升级）**：⚠️ **2026-08-31 全量审计推翻两条旧结论**——"DNS-rebinding 免疫"实际是 check-then-fetch 双解析（仍可绕），"webhook 强制 secret"只覆盖单条路由（图保存路径可绕过），另发现 3 Critical / 10 High。**29 项已全部修复**（含低优项），报告见 [docs/security-audit-2026-08-31.md](docs/security-audit-2026-08-31.md)。其中**静态加密（L3）**：settings（provider apiKey）与图文档凭证（graphs.doc / graph\_versions.snapshot / runs.snapshot）落盘前 AES-256-GCM 加密（`enc:v1:` / `enc:v2:<keyId>:` 前缀，密钥走 `AGENT_WORLD_ENCRYPTION_KEYS` keyring 或 0600 `.encryption-keys` 文件，旧明文 lazy 迁移兼容），设计见 [docs/design-at-rest-encryption.md](docs/design-at-rest-encryption.md)；**密钥轮换已落地（2026-09-05）**：keyring 有序多密钥（新密钥加密、旧密钥解密）+ 重加密收敛脚本 + 运维手册 [docs/runbooks/key-rotation.md](docs/runbooks/key-rotation.md)，设计见 [docs/design-key-rotation.md](docs/design-key-rotation.md)。~~旧基线描述保留为历史记录~~：settings 按用户隔离 ✓、Secure cookie ✓、`ALLOW_PRIVATE_NETWORK` 逃生口 ✓、代码沙箱 P0-P2 基建 ✓（默认后端 fail-open 已改 fail-closed，审计 H8）

* **本轮已落地（2026-08-29，均已提交）**：

  * **账号系统 / 按用户隔离**（`5b81c74` + `73d3610`）：users 表 + JWT(HS256, bcrypt12) HttpOnly cookie 会话 + graphs/runs/artifacts/brand\_terms/成本全部按 `user_id` 过滤 + 前端登录/注册/用户菜单 + `authFetch(credentials:include)`。旧库升级自动回填归属（迁移 14/15 幂等，无法归属的行 fail closed 不可见）

  * **产物统一渲染**：`artifact-renderers.tsx`（ArtifactCard 外壳 + 7 类渲染器注册表 + JSON 树 + 共享 renderMarkdown），Inspector/成品面板/画廊三处接入，画廊按流水线分组，节点缩略图

  * **UI 布局交互**：Inspector 可拖拽调宽（localStorage 持久化）、CanvasToolbar 置顶、Inspector 随节点选中自动开合、成品库改版

  * **安全加固**（`17dfbf9`/`299dc63`/`c0dd67d`）：删除死代码 SKIP\_AUTH；artifacts 读写全部按用户归属（堵跨用户读取/下载）；`/api/proxy` 要求登录 + 拒绝内网地址 + 重定向逐跳复检（堵未认证 SSRF）。遗留决策项见"待办"第 4 条

  * **MCP Server P1 增强**：Streamable HTTP/SSE 传输（`POST /mcp` JSON 或 SSE 按 Accept、`GET /mcp` SSE 宣告 endpoint；`AGENT_WORLD_MCP_TRANSPORT=http` 切换）、Resources（`resources/list`/`templates`/`read`：graph:// run:// artifact:// 三类 URI 模板）、Prompts（3 个引导提示词，参数插值）、initialize 能力声明 tools+resources+prompts；协议级测试 22/22 + 真实 socket 冒烟

  * **代码节点沙箱 P0**（`6b2f92b`）：env 只透传 `SAFE_ENV_BASE` + 节点声明的 `env` 白名单；解释器用 `resolveInterpreter` 启动时解析绝对路径并缓存；每次运行独立 `/tmp/aw-code-<run>-<node>-<attempt>-*` 临时目录做 cwd，成功/失败/超时全部 `finally` 清理。测试 405 → 411 通过

* **关键文件**：

  * `apps/web/src/components/Inspector.tsx` — 节点详情面板（model select 严格按 modality 过滤；产物走 ArtifactCard）

  * `apps/web/src/lib/artifact-renderers.tsx` — 统一产物渲染

  * `apps/web/src/components/ProductGallery.tsx` — 成品库（kind 过滤 + 按流水线分组）

  * `apps/web/src/components/Settings.tsx` — 模型/provider/单价管理

  * `apps/web/src/components/Canvas.tsx` — 画布（undo/redo/缩略图/拖拽/对齐）

  * `apps/web/src/components/GraphSwitcher.tsx` — 多产线切换

  * `apps/web/src/components/Onboarding.tsx` — 首次启动引导

  * `packages/server/src/nodes/` — 节点执行体（阶段 2.2 重构产物：28 个 `<kind>.ts` handler + `types.ts` 的 NodeRunContext + `shared.ts` 纯函数集；engine.ts 只留调度器与 NODE_HANDLERS 注册表分发）

  * `packages/server/src/auth.ts` — JWT 签发/校验、密码哈希

  * `packages/server/src/db.ts` — 持久化（users 表 + 按 user\_id 隔离 + 迁移 1-16）

  * `packages/server/src/code-sandbox.ts` — 代码节点沙箱工具（P0：解释器路径缓存 + 工作目录创建清理；P1：rlimit 包裹 + Node permission；P2：可插拔后端）

  * `packages/server/src/code-proxy.ts` — net allowlist 的 SSRF 校验代理（常驻单例 + 一次性 run token + allowlist/内网双重校验 + 审计日志）

  * `packages/server/src/ssrf.ts` — 出站请求 SSRF 防护（proxy + HTTP 节点共用，解析后 IP 校验）

  * `packages/server/src/user-context.ts` — AsyncLocalStorage 按异步上下文归属用户（运行期配置解析）

  * `packages/core/src/` — 领域模型、Provider 抽象、Artifact、节点契约

  * `packages/server/src/` — 持久化、events API、调度

## Active work / 待办

按优先级降序，标 `★` 的是当下要推的：

> ✅ 待办 #1–#45（除活跃的 #39/#41 外）已全部完成。详细过程已分批归档：#1–#37 见 [handoff-archive-2026-09-07.md](docs/handoff-archive-2026-09-07.md)，#24–#43 见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)，#44–#45 见 [handoff-archive-2026-09-11.md](docs/handoff-archive-2026-09-11.md)。本区只留一行结论索引，活跃项（#39/#41/#46）保留详情。

**已完成待办索引（#1–#38、#40、#42–#45）**：

1. ✅ Connector（file/http/form/manual/database/PostgreSQL）+ 四类触发（cron/webhook/event/batch），无人值守产线
2. ✅ 狗粮验证：27/27 业务模板真实运行，修复 20+ 缺陷（详见 template-checklist.md）
3. ✅ 回归测试集（vitest 全局 mock bcrypt、超时预算、core-path 回归基线）
4. ✅ 模板全量测试 + 增至 33 个业务模板（blankGraph 独立、不计入模板数）
5. ✅ README 演示 GIF（docs/images/demo-run.gif，commit `6df0fe7`）
6. ✅ git push / PR #90 同步
7. ✅ web 前端组件测试基建（@testing-library/react + jsdom，四批 P0-P3）
8. ✅ search 成功路径真实取证（Tavily 按源绑 key，run `d80040c5`）；audioGen 待 TTS 供应商
9. ✅ 设计 Token 体系（primitive/semantic/light 三层 CSS，30 批渐进迁移）
10. ✅ i18n 国际化（i18next，7 命名空间，41 组件全迁移，语言切换器，Intl 格式化）
11. ✅ 自媒体电商方向立项与盘点（design-ecommerce-roadmap，F1-F10）
12. ✅ F2 审核队列（reviews.ts + ReviewQueue.tsx + 迁移 20）
13. ✅ F3 平台适配与合规校验（platforms.ts + compliance 节点 + 迁移 21）
14. ✅ F4 商品库/品牌素材库（products/brand_assets + product connector + 迁移 22）
15. ✅ F5 批量任务编排（batch_jobs/items + BatchManager + 迁移 23）
16. ✅ F7-A 平台化导出包（publish.ts buildPublishPackage + publish 节点）
17. ✅ F8 内容日历（content_plan + CalendarView + 迁移 24）
18. ✅ F6 效果数据回流（content_metrics + PerformanceDashboard + 迁移 25）
19. ✅ F9 内容级成本归因（content_costs + ROI 聚合 + 迁移 26）
20. ✅ F1 run 内多变体+择优（fanout/select 泳道 + 迁移 27 + VariantComparison）
21. ✅ F10 fan-out/fan-in 画布（自动泳道布局/折叠/复制支路/错误高亮）
22. ✅ F7-B 开放渠道发布（publish_targets + webhook provider + 迁移 28）
23. ✅ 状态机方案 A 验证（variables + branch 足够，方案 B 登记 deferred）
24. ✅ 「银行流水对账」模板 tpl-reconciliation（第 28 个，狗粮 dogfood-rec）
25. ✅ 「隐私政策合规审查」模板 tpl-privacy-review（第 29 个，dogfood-privacy）
26. ✅ 「发票批量 OCR 台账」模板 tpl-invoice-ocr（第 30 个，dogfood-invoice）
27. ✅ 「批量合同审查」模板 tpl-batch-contract-review（第 31 个，dogfood-batch-contract）
28. ✅ 「审计抽样底稿」模板 tpl-audit-sampling（第 32 个，dogfood-audit）
29. ✅ fileParse 多文档增强 +「尽调清单」tpl-due-diligence（第 33 个，专业服务 9 模板齐）
30. ✅ 核心文件重构（engine.ts 4954→1828、Inspector.tsx 3848→611，纯重构零行为变更）
31. ✅ 合规/运营批次五方案（密钥轮换/审计日志/服务端日志/公告/反馈，P1-P3 全落地）
32. ✅ search 成功路径补证（与 #8 合并）
33. ✅ 服务端日志收编（默认落盘 + console 收编 + 请求日志 + P3 关键路径）
34. ✅ RBAC 角色权限（owner/admin/user + 资源级权限 + 迁移 31/32 + Collaborators/AdminPanel）
35. ✅ 连接器数据插值（ResolvedMaterial.data + ${product.*} 插值，行业无关引擎机制）
36. ✅ 商业化详细实施方案（design-monetization，三层计费 + 套餐 + P0-P3 路线，待 M1 数据定价）
37. ✅ 画布等距 3D 视图（three.js，四期全完成，2D 编辑/3D 查看分离 + 卡车动画）
38. ✅ 商业化 M0 本地运行环境部署（Hasee Ubuntu/systemd/nginx/bwrap + CI/CD 自动部署）
40. ✅ Hasee 异地备份到 Mac（launchd 每日拉取 + 密钥入钥匙串，2026-09-10）
42. ✅ 画布 3D 视图审计欠账清理（7 项全清，Canvas3D.test 3 例，3D 零欠债）
43. ✅ RTS 阶段 A 平面运营工作台（OperationsDashboard，A1-A7，PR #239 已部署 Hasee）
44. ✅ web 组件测试 100% 覆盖 + research-loop 补 sink（组件零「有 tsx 无 test」，详见 09-11 archive）
45. ✅ M1 等待期清账三件套（code-audit L19/20/22/25/26/27 全清 + 7 个 C 类模板 file connector 预设 + 文档同步，详见 09-11 archive）

39. ★ **商业化 M1：成本计量回采（2026-09-08 开跑，高频攒数据中）**：用 M0 环境跑真实产线，攒按用户/模型/月拆分的真实成本，作为 [design-monetization.md](docs/design-monetization.md) §4 定价的数据前提。**开跑前置已落地**（PR #211）：① 单价缺口审计——`unpricedModels()` 判定「完全没配 / 只配了一部分」，启动 warn + 成本报表警告条；② 按模型分摊——`node_runs.model`（迁移 36）+ `byModel` 聚合 + 前端表 + CSV 段。7 个在用模型单价已配全（agnes 单价写源码 `config.ts` 的 `AGNES_PROVIDER.pricing`，custom provider 走设置；当前为 OpenAI 同级占位单价，正式计费前须换 agnes 网关真实费率）。**本阶段不加功能**——要回答三问：一次典型 run 多少钱 / 返工占总电费多少 / 哪个模型吃大头。**2026-09-11 13:35 UTC 提升回采频率**（详见 #41 与下方"下一步主线"）：每天约 57 次 run，回采周期从 2-4 周缩短到 3-5 天，预计 09-14（~200 run）可启动部署类、09-15 完全自由。

41. ★ **M1 回采产线挂载 + 每日体检（4 条成本画像产线，cron 自动攒数据中）**：在 Hasee staging 挂 4 条代表产线：①写草稿·高频文本 ②翻译流水线·带返工（gate 上限 3 次）③短视频广告工坊·媒体中价（imageGen+videoGen）④批量内容工坊·批量放大（Map 5 条）。产线 ID：①`bdb25758-dd2d-4fe1-9ee3-ab2109b32f16`（trg_mtv0zp69）②`71536df1-da29-44fb-ae7a-4250dafe1a8d` ③`b25c9b38-b823-49c4-89ef-4cb432bd341c` ④`edc5183c-f8c3-4c11-9eab-a6e8fe232361`（trg_m1_batch_weekly）。Agnes free tier 429 已按方案 C（降频+长退避 retry）闭环（PR #229 `006186b`：judge/generateImage/generateVideo 包 withRetry 30/60/90/120s ×4；触发器持久化修复 PR #231 `70524df`）。**每日回采体检**：豆包定时任务每日 10:30（CST）触发，检查 run 完成率/成本归集/429 残留，结论回写本条。**📋 每日体检记录**：

- **2026-09-11（第 1 次体检，🔴 P0 阻塞发现 → 同日修复）**：cron 调度器完全未工作——根因 `index.ts` 中 `triggers.restore()`（async）未 await 即 `scheduler.start()`，`list()` 返回空、零定时器挂载。修复 `triggers.restore().then(() => scheduler.start())`（commit `c826052`）+ 兜底 catch 保留 ProviderError code（429 不再记 UNKNOWN，commit `93a7d19`）。附带修复 CI flaky test `ProductLibrary.test.tsx`（表单清空时序，加 await flush，commit `2ecf3f2`，连跑 10 次稳定）。PR #249 合并，03:57 UTC 部署 Hasee（PID 94661，dist 确认含修复）。
- **2026-09-11（06:18 UTC cron 修复实测验证，✅ 通过）**：SSH 交叉验证 server.log + node:sqlite + dist 代码。提频后自动 cron tick 证据确凿——`05:40 trg_mtv0zp69 → run e2142838`、`06:00 trg_m1_batch_weekly → run af9b07ae`、`06:10 trg_mtv0zp69 → run e266d932`，3 run 全部 done；成本归集健康（$0.001481/$0.001773/$0.002425，LLM 节点非 0、非 LLM 为 0、无碎片，全 agnes-2.0-flash）；05:30 后零 429。**判定：调度器自动触发恢复，M1 高频回采正式开始自动攒数据，无需人工干预。** 观察项：②翻译（`0 */4`）、③短视频（`0 3,15`）首次自动触发由后续体检确认。

46. 🟡 **RTS 阶段 B 设计细化 + 技术预研（2026-09-11 启动，M1 等待期先行，不碰业务逻辑）**：设计文档 `docs/design-rts-stage-b.md`（B1-B9 结合当前代码库逐项复核 + 5 项技术风险标注）；技术预研原型 `apps/web/src/canvas/CanvasPark.tsx`（InstancedMesh 100 厂/per-instance color 呼吸/Sprite billboard/raycast instanceId 映射/mount-once 双 effect/选中环/锁俯角/完整 cleanup）。**B1/B2 已正式化到代码级并落地**：B1 = graphs 表加 park_x/park_z（迁移 37，base DDL + 迁移双改，PG 走 toPgDdl），设计就绪待正式落地时机；**B2 parkLayout 纯函数已落地**——`packages/core/src/parkLayout.ts`（类别聚簇 + 类 BFS 行布局 + 距离碰撞 + 阿基米德螺旋黄金角兜底，5 常量，FACTORY_SIZE=200，HARD_CAP=200）+ 11 例测试全绿 + core 导出，CanvasPark 改从 core import、删本地实现（commits `76ad634`/`a252d4f`/`fe4bd30`）。**未做（正式落地时）**：B1 迁移+API、接真实数据、i18n、路由入口、钻取 L1、真机帧率验收。阶段 B 整体落地仍需商业化闭环 + 真实多产线场景（人均 ≥3 活跃产线）触发；阶段 C（完整 3D RTS）同挂 deferred。

> **下一步主线**：待办 #1–#45 已全部完成（活跃项为 #39/#41/#46），第 39 条（M1 成本计量回采）2026-09-08 开跑，商业化 P0 前置（单价缺口审计 + 按模型分摊）已上线。4 条成本画像回采产线已挂载（待办 41），429 限流已按**方案 C（降频+长退避 retry）+ 代码补丁**闭环（待办 41 已记录），产线 cron 自动攒数据中（cron P0 修复 2026-09-11 03:57 UTC 部署，06:00 UTC 首次触发验证通过）；**2026-09-11 13:35 UTC 提升回采频率（Hasee 运维操作，非代码变更）**：①写草稿从每 6h → 每 30 分钟（`10,40 * * * *`，48 次/天）、②翻译从每天 → 每 4 小时（`0 */4 * * *`，6 次/天）、③短视频从每天 → 每 12 小时（`0 3,15 * * *`，2 次/天）、④批量从每周 → 每天（`0 6 * * *`，1 次/天）。全模型 free tier 不考虑成本，错开触发时间避免并发 429。调整后每天约 57 次 run（原约 6 次），回采周期从 2-4 周缩短到 **3-5 天**。Hasee 服务重启（PID 96192）重载触发器，DB 已持久化新 cron。**RTS 阶段 A 平面运营工作台已上线（待办 43，⌘K→运营工作台可跨产线看状态/待审/失败/成本，正是 M1 回采的监控床）**；**RTS 阶段 B 设计细化 + 技术预研已启动（待办 46，设计文档 + CanvasPark 原型 + 7 测试全绿，M1 等待期先行不碰业务逻辑）**；**code-audit 全部 77 项已无未修复项（待办 45，73 修复/3 无需/1 部分）**；**当前主线 = 高频回采攒数据（每天约 57 次 run，3-5 天可回答 M1 三问）→ 据真实成本回答典型 run 成本 / 返工占比 / 模型大头 → 切定价套餐；期间用运营工作台盯 4 条回采产线完成率/失败/成本，同时推进阶段 B 设计细化/技术预研（待办 46）**。RTS 阶段 C（完整 3D RTS）待商业化闭环 + 人均 ≥3 活跃产线再启（deferred-items）。可选项：随时换付费 agnes key（换后 429 彻底消失、回采更顺畅）。

> 全部缓做/低优事项（含上述两条）已统一登记在 [docs/deferred-items.md](docs/deferred-items.md)——每条带触发条件与决策详情链接，触发条件满足时移回本区并标注重启日期。

> **M1 运行床验收（A 只读对账 / B 真实模型冒烟 / C 安全韧性 / D 部署·CI，2026-09-08 真机 Hasee）**：A 对账通过；B 文本/图片计费端到端非零（图片 $0.04/张），**视频/音频曾被计为 $0**——根因是 provider worker 从不填 media units/cost，已在 `6554769`（feature/20260824）修复（视频 perSecond：适配器 durationPath → num_frames/frame_rate → 节点 duration → 5s 兜底；音频 perKiloChar 按输入字符数），17 用例绿；C 层四项全过——**C1 限流**连发 40 次 POST /api/runs，前 30 放行为 404（图不存在，限流在 startRun 前不建 run 不烧钱）、第 31-40 全部 429；**C2 预算硬熔断**置 monthlyBudgetUsd=0.0001 后派发现场 402「monthly budget exceeded」，模型调用前拦截零费用，测后已还原 null；**C3 静态加密**settings.data 为 enc:v2 密文，节点级 apiKey 注入实测 graphs.doc 落 enc:v2、明文 0 命中（已还原）；**C4 SIGTERM drain** 今日部署重启日志 `shutdown started(inflightRuns:0)→shutdown complete(abortedRuns:0)`→迁移重跑→健康恢复，历史 4 次 SIGTERM 全部干净退出。D 层（部署/CI，只读为主）三项全过——**D1 CI 安全门禁** CodeQL + CI 最近运行全 `success`，ci.yml 内含 `pnpm audit --audit-level=high`（高危 CVE 阻断合并）+ gitleaks 扫历史；**D2 部署一致性** Hasee 健康探针 `branch=dev commit=4eb87d2` 与 origin/dev 端点逐字一致（dev=准生产环境映射成立），main 端点 `5b0b29f` 领先一个 merge 属正常；**D3 备份可恢复性（只读演练）** 备份库拷到 /tmp 后 `integrity_check=ok` 可正常打开，行数对账 backup(07:52) vs live 为 ~6h 前一致快照（users 2=2、graphs 4<6、runs 6<9、events 144<196、node_runs 29<40、artifacts 27<40），无损坏可还原，实测 RPO≈6h（满足 <24h 声明）、RTO 秒级（库 823KB）。未做覆盖活库的破坏性 restore（只读已证可恢复）。
>
> ⚠️ **三个真实缺口（按严重度，2026-09-08 真机核实）**：
> 1. ✅ **~~媒体计量修复未上 Hasee~~（已部署并真机验证，2026-09-08）**：修复随 PR #216 合入 origin/dev（merge `a12f404`）并部署到 Hasee——健康探针 `commit=a12f404`、服务重启（PID 59450）、dist 内确有 `videoBillingSeconds`/`mediaUsage` 编译产物。端到端复验：视频 run `546aa2fa` 状态 done，视频节点 `units:{seconds:5}`、`costUsd:0.5`（5 × perSecond $0.10），视频产物正常产出——修复前一律 $0，现按秒计费。**遗留精度项（非阻塞）**：agnes 未设 `durationPath` 且响应无 num_frames/frame_rate、又 omitDuration，故走 5s 兜底；若实际成片时长非 5s 会按 5s 计。**2026-09-09 已修复并真机验证（PR #218，merge `2e23a06` 已部署 Hasee，健康探针 commit 一致）**：真机抓取确认时长在顶层 `seconds` 字段且为数字字符串 `"5.0"`，遂配 `durationPath:"seconds"` 并让 `videoBillingSeconds` 经 `positiveNumber` 接受数字字符串。在**部署后 dist** 上用真实 agnes 完成形态回放：`seconds:"5.0"`→5s/$0.50（不回归），`seconds:"8.0"`→8s/$0.80（旧逻辑会落 5s 兜底），两段全 PASS。
> 2. ✅ **~~备份只在同盘同机 + WAL checkpoint 静默失败~~（已闭环，2026-09-10）**：checkpoint 静默失败已由补丁修复（见待办 40，node:sqlite 替换 + 手动验证通过）；「同盘同机」单点已由 Mac 每日异地备份兜底（见待办 40，含密钥边界）。
> 3. **/metrics 未经 nginx 暴露（可观测性盲点）**：80 端口 `/metrics` 返回 SPA `text/html`，仅直连 :8791 出 Prometheus `text/plain`；外部/容器化 Prometheus 抓不到。已登记 deferred-items（本次新增行）。

## Recently shipped (last 5)

按 commit 时间倒序，每条一行影响面 + commit hash：

1. **test(web) ThemeSwitcher 组件测试（2026-09-11，`48de996`，未 push）**——补全新增主题切换器的测试（镜像 LanguageSwitcher 4 例：暗色时 label 显示将切到的亮色 + title、点击翻 data-theme 并写 localStorage 再切回、挂载尊重已持久化的 light、英文环境显示 Light/Switch to light theme），web 1761→**1765/1765（82 文件）**。
2. **docs README/docs 索引同步（2026-09-11，`d2e31ed`，未 push）**——实跑各包测试校准计数（core 224 / server 1024 / mcp 71 / web 1765，总 **3084**，原 badge 3068、core 212 过时）；Feature map 补 dark/light theme toggle + 三层 token、新增 Operations 行（OperationsDashboard / `/api/operations/overview`）；5-minute first run 段夹杂中文统一英文。docs/README 场景表补运营工作台、RTS 阶段 A 上线/B-C 未实施状态。
3. **refactor(web) 代码注释英文化收尾（2026-09-11，`bfe8333`，未 push）**——18 文件剩余中文注释/示例字符串英文化（InspectorFields/RunHistory/Toast/AnnouncementManager/i18n utils 等）。**有意保留的中文**（已 grep 验证勿再清）：GlossaryModal 的工厂隐喻源数据（文坊/质检站，英文隐喻名待产品拍板）、LanguageSwitcher 的"中文"、i18n/utils 的 zh 日期输出示例、store/graph translate 节点 target「简体中文」（翻译目标语言）。
4. **feat(web) 明暗主题切换器（2026-09-11，`69a778c`，未 push）**——三层 CSS（primitive/semantic/`[data-theme=light]`）本已在 styles.css 建好，唯一缺口是无激活亮色的入口。新增 `theme.ts`（localStorage key `agent-world-theme`，getTheme 读存储否则 matchMedia 系统偏好，import 即 initTheme 防首帧闪烁，try/catch 兜隐私模式）+ `ThemeSwitcher.tsx`（镜像 LanguageSwitcher，挂 UserMenu）；styles.css 仅剩 2 处 plant__collapse-chip 的 steel 引用迁到 semantic token；zh/en common.json 各加 4 key。JSON token 源文件 + 生成脚本判定可选不做（CSS 变量已是事实 single source）。
5. **feat(core)+refactor(web) RTS 阶段 B B2 parkLayout 纯函数落地（2026-09-11，`76ad634`/`a252d4f`/`fdd73aa`，origin 已含）**——`packages/core/src/parkLayout.ts`（类别聚簇 + 类 BFS 行布局 + 距离碰撞 + 阿基米德螺旋兜底，5 常量，11 例测试），CanvasPark 原型改从 core import、删本地实现，core 213→224。B1（迁移 37 + API）设计就绪待正式落地时机。详见待办 #46。

> 第 6 条及更早（2026-09-10 及以前：web 组件测试 100% 覆盖、research-loop 补 sink、连接器清账、RTS-A、清账三件套等）已归档至 [handoff-archive-2026-09-11.md](docs/handoff-archive-2026-09-11.md)、[handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md) 与更早 archive。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

* `pnpm -r typecheck`：全绿（core/server/mcp-server/web `tsc --noEmit` 全部干净，2026-09-11 复核）

* 测试总数 **3084**（2026-09-11 实跑）：

  * `pnpm --filter @agent-world/core test`：**224/224 通过**（15 文件；含 parkLayout 11 例、file/product connector 形状断言、compile trigger warning 5 例、模板 33 形状守护、单价缺口 7 例等）
  * `pnpm --filter @agent-world/server test`：**1024 总数**（127 文件；Node 24 下应全绿）。⚠️ **本机 Node v22 + macOS seatbelt 下依赖 spawn JS sandbox 子进程的用例失败（status 71），干净 HEAD 同样失败、CI Linux bwrap 正常，非回归**；另有 2 个 RPA 用例需先 `pnpm exec playwright install` 装 chromium，本机未装属环境阻塞。
  * `pnpm --filter @agent-world/mcp-server test`：**71/71 通过**（3 文件；含 stdio 端到端冒烟 3 个。负载性 flaky：`pnpm -r test` 并行时 stdio 冒烟可能超 5s，单独跑稳定）
  * `pnpm --filter @agent-world/web exec vitest run`：**1765/1765 通过**（82 文件；组件目录零「有 .tsx 无 .test.tsx」，ThemeSwitcher 4 例为最新增量）

* 各用例逐波来源（单价审计/连接器插值/PG/加密/RBAC/公告/重构/狗粮九波等）已随对应待办归档到三份 handoff-archive，本 snapshot 只记当前数，不堆历史。

* **Node 版本硬要求**：依赖 `node:sqlite`，必须 Node ≥ 22（CI 用 Node 24；本地默认 Node 20 会误报 `No such built-in module: node:sqlite`，用 `fnm exec --using=24` 跑）。**P1 沙箱实跑测试必须在 Node 24 下验证**（否则 resolveInterpreter 版本探针走不同分支）。

  * ### ⚠️ 版本不对时的症状指纹
    非 Node 24 下跑全量 server 测试，失败会呈现为 **32-36 个用例波动失败**，且**全部依赖 code 节点子进程**（`engine.code`/`loop`/`map`/`table`/`generic`），报错 `ENOENT lstat '<internal-path>'` 或 `finished` 为 `undefined`——看起来像沙箱跑不起来而非版本问题，失败数随超时随机浮动。**判定**：`fnm exec --using=24 -- pnpm --filter @agent-world/server exec vitest run`，全绿即为版本问题。`git stash` 对比基线只能证明"不是本次改动引入"，**不能**证明"是环境问题"，两者是不同命题。

## Feedback workflow

* 看到不爽：**截图 + 6 字标签**发我。详细见 [docs/feedback-workflow.md](docs/feedback-workflow.md)

* 想让我看你的 Chrome：说"computer use 看一下 \[位置]"

* 防丢：我在 "Active feedback" 区块自动记，你不用管

### Active feedback

<!-- 自动维护：用户最近反馈的未解决问题，按时间倒序 -->

## How to run

```bash
# server (background, 8791)
cd packages/server && node dist/index.js
# 或 detach 版：python3 -c "import subprocess; subprocess.Popen(['node','dist/index.js'], start_new_session=True, cwd='packages/server')"

# web (foreground, 5173 — vite.config.ts 配的)
cd apps/web && pnpm dev
# → http://localhost:5173

# 沙箱里启动 server / vite 都会被 EPERM 拒（详见 Known issues）
```

## Known issues

* **沙箱不让 listen socket**：node `dist/index.js` / `pnpm dev` / `python3 start_new_session` 起服务全部 EPERM（IPv4/IPv6 loopback 都试过）

* **沙箱不让写** **`.git/index.lock`**：`git commit` 需要 escalated 权限；escalation 通道的 token 上限是整个调用包级别，即使 `-m x` 也会被 review 拒

* **"沙箱 EPERM"在 archive 章节里出现 12+ 次**：历史上每节都重复写"未在 8791 端到端复现"，现在归档后本文件只留一次

### ⚠️ RLIMIT\_NPROC 陷阱（2026-08-29 CI 排查半天才定位，务必记住）

`ulimit -u`（RLIMIT\_NPROC）在 Linux 上限制的是**整个用户（UID）的进程+线程总数**，不是单个子进程。CI runner 上 vitest 多 worker 已让 runner 用户任务数逼近默认 128，代码节点子进程的 node 启动时创建平台线程 EAGAIN → 断言崩溃 → **SIGABRT（`r.status === null`、\~200ms 秒挂）**。症状随并发负载波动，时好时坏，极易误判为 env/stdin/挂死问题。教训：验证 shell 行为（引号等）的测试不要叠加宿主敏感的 NPROC 小值限额，用 `maxProcs: 4096` 覆盖；NPROC 生产语义由 engine 集成测试覆盖。另一个相关坑：开发机 shell 里若有本地代理（如 `HTTP_PROXY=127.0.0.1:7897`），会污染"客户端是否走代理"类的手工验证，排查前先 `env | grep -i proxy`。

## Conventions (carry over from archive)

* **commit 消息**：英文、`<type>(<scope>): <subject>` 格式；不加 `Co-Authored-By: ...`；不 `push`（除非用户明确说）

* **commit 颗粒度**：原子提交；一次 commit 解决一件事（bug 修复 / 单一 feature / 单一迁移）

* **UI 文案**：中文，遵循 `--steel-*` / `--power` / `--ink*` / `--alert` 等设计 token，**不改主题样式**

* **新增功能必加 handoff 章节**：本文件只记最近 5 个 + 待办；超过 5 个的全部进 archive

* **Active work 完成项归档**：编号待办标 ✅ 后，详细过程记录滚到 [docs/handoff-archive.md](docs/handoff-archive.md)，本文件只留一行结论 + commit hash，避免无限膨胀

### ⚠️ server 重启 bug（2026-08-27 14:40 踩过）

`start_new_session` 起 server 时 **cwd 必须是** **`packages/server`**，不能是仓库根：

```bash
# ✅ 对的
python3 -c "import subprocess; subprocess.Popen(['node','/Users/jiangfeng/000mycodes/agent-world/packages/server/dist/index.js'], start_new_session=True, cwd='/Users/jiangfeng/000mycodes/agent-world/packages/server')"

# ❌ 错的（cwd=仓库根 → server 打开仓库根的空 agent-world.sqlite，看不到任何产线）
python3 -c "import subprocess; subprocess.Popen(['node','packages/server/dist/index.js'], start_new_session=True, cwd='/Users/jiangfeng/000mycodes/agent-world')"
```

**两个 DB 文件**：

* `packages/server/agent-world.sqlite` 180KB — 真正的数据（产线、run、artifact）

* `agent-world.sqlite` 4KB — 仓库根的"幽灵"空 DB，server 在仓库根跑就用这个

**验证起对没**：

```bash
PID=$(lsof -ti :8791)
lsof -p $PID | grep "agent-world.sqlite "   # 应该指向 packages/server/agent-world.sqlite
```

**事故原因**：之前我帮用户重启时图省事把 cwd 写成绝对路径的仓库根（因为 dist/index.js 用了相对路径 `node 'packages/server/dist/index.js'`），但 server 进程内找 DB 用 `./agent-world.sqlite`——cwd 在仓库根就直接落到根的空 DB 上。**下次绝对不能用仓库根 cwd**。

### ⚠️ server 重启：用双 fork，不要用 `start_new_session`（2026-08-27 14:43）

**问题**：`subprocess.Popen(..., start_new_session=True, cwd=...)` 起的 server 进程在 exec 退出后会被 sandbox 带走（kill 老 server → 几秒后新 server 也死）。

**解决**：Python 双 fork + `os.setsid()`，彻底脱离 process group：

```python
import os, sys
pid = os.fork()
if pid > 0: sys.exit(0)
os.setsid()
pid2 = os.fork()
if pid2 > 0: sys.exit(0)
os.chdir('/Users/jiangfeng/000mycodes/agent-world/packages/server')
log = os.open('/tmp/aw-server.log', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(log, 1); os.dup2(log, 2)
devnull = os.open(os.devnull, os.O_RDONLY)
os.dup2(devnull, 0)
os.close(log); os.close(devnull)
os.execvp('node', ['node', '/Users/jiangfeng/000mycodes/agent-world/packages/server/dist/index.js'])
```

**macOS 没有** **`setsid`** **命令**，但 Python 的 `os.setsid()` 等价。

**验证**：

```bash
sleep 5 && lsof -i :8791    # 5 秒后还在 → 真独立
lsof -p $(lsof -ti :8791) | grep agent-world.sqlite  # 指向 packages/server/
```

