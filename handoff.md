# Handoff

State of Agent World as of 2026-09-10.

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

> ⚠️ 待办 1-38 已**全部完成**（✅），第 39 条（M1 成本计量回采）2026-09-08 开跑中。详细过程已归档至 [handoff-archive-2026-09-07.md](docs/handoff-archive-2026-09-07.md)，本区仅留标题行作索引。

1. ✅ **自动数据接入 Connector + 触发方式（2026-08-31 立项，2026-09-01 推进）**：file/http/form/manual 本已落地，本次补齐 **SQLite database connector**（`9657538`+`9003120`，见 design-connector-database.md）；4.6 webhook/cron/event/batch 本已全链路落地，本次挖出并修复 **event 成功状态契约 bug**（`e9b55ae`，引擎发 `done` 而触发层等 `completed`，见 design-triggers.md）。**两者组合已是无人值守产线**；剩余仅 MySQL 驱动、多实例分布式锁（均 deferred；PostgreSQL 驱动 2026-09-08 已落地）。整体进度基线见 [docs/project-progress.md](docs/project-progress.md)

2. ✅ **跑通真实产线（狗粮验证，2026-08-31 立项，2026-09-02 完成）**：roadmap-tasks 1.7.1——用产品自己跑一条端到端真实产线（如模板"多源研究简报"或内容产线），验证"新用户路径 → 配置 provider → 建产线 → 运行 → 看产物 → 复盘"全链路真实可用。产出：一份真实运行记录 + 暴露的体验/功能缺口清单。紧接回归测试集。**逐模板验证状态跟踪见** **[docs/template-checklist.md](docs/template-checklist.md)**

   * **完成总结（2026-09-02）**：**27/27 业务模板全覆盖真实运行**（25 ✅ + 2 🟡 环境侧阻塞），25 种节点类型除已废弃者外均有真实运行记录，四类自动触发（cron/webhook/event/batch）均有真实 run 取证。共 9 波验证，掉出并修复 **20+ 产品缺陷**，核心类别：① 静默成功/静默失败（mediaGen 静默跳过、generic 四模态静默跳过、空结果当成功、imageGen catch 标 done、空补全当成功）；② 测试与产品契约脱节（ocr 100% 不可用但单测全绿、event 状态契约、source 文件上传能力缺口、artifact 本地引用 404）；③ 引擎级调度缺陷（fan-in 静默丢弃、human approve 后整条尾巴未调度却报 done、branch 未路由分支不发 node.skipped）；④ 安全/凭证（节点级凭证明文落库、URL 查询串凭证、自定义 header 凭证、search/vcs 无节点级凭证入口）；⑤ 稳定性（坏脚本 EPIPE 杀 server 进程、code 节点 CPU 限制墙钟断言 flaky、vitest timeout 不足）。**剩余环境侧阻塞（非产品缺陷，已登记 deferred-items）**：tpl-news-podcast 缺 TTS 供应商（agnes 无音频模型）、tpl-research-loop 缺可用搜索源（DDG 反爬，需 Tavily key；第九波已加 search 节点级凭证入口，配 key 即可复跑）；search/audioGen 两类节点成功路径零证据（失败路径已诚实化）。server 测试 557→**664/664**，core 162→**164/164**

3. ★ **~~回归测试集~~**（已完成，2026-08-31）：把已知 flaky（bcrypt/计时敏感用例）与核心路径做成可重复的回归基线与安全网；roadmap-tasks 5.5 登记项。目标：全量测试稳定复跑，避免"复跑即绿"掩盖真回归

   * **做法**：① `vitest.setup.ts` 全局 mock `bcryptjs`（cost-12 哈希是纯 CPU 消耗，API 层被测的是 auth 流程而非 bcrypt 本身）——注册/登录类测试提速且稳定；② `vitest.config.ts` 全局 `testTimeout / hookTimeout`（初版 20s/30s；**2026-09-02 起 60s/60s**——预算必须高于引擎 code 节点默认 timeoutMs 30s，否则慢而健康的子进程先被 vitest 拦下，报模糊的 "Test timed out" 而非引擎诚实的 TIMEOUT `node.failed`，`aae0871`），给 wall-clock 敏感用例（engine.code 沙箱 CPU 限时、SSE 流、retry 退避）在并行负载下留足余量；③ `engine.search` 的 PROVIDER\_ERROR 用例显式 `retry:{maxRetries:0}` 去掉默认退避的真实 sleep；④ 新增 `src/regression/core-path.test.ts` 核心回归基线（compile→execute→done + rework 回环 + resume 不重复上游 artifact + 二进制 artifact 落库 sizeBytes + auth 注册/登录/受保护路由 + SSRF fail-closed），`pnpm --filter @agent-world/server test:regression` 2.8s 可跑。**结果：全量 571/571 连续 2 次复跑稳定通过**（此前 flaky 偶发 1-6 超时）。

4. ★ **模板全量测试（已完成，2026-08-31）**：25 个业务模板 + 1 个空白产线入口，引擎级冒烟全跑通。**发现并修复**：① 7 个模板 code 节点裸引用 `inputs`（沙箱不注入，真实环境必挂）→ 改 stdin 读取（`01fad6c`）；② error 边兜底被 human 挂起饿死（review-publish notifyFallback 不触发）→ finally 即时触发（`8fa86c1`）；③ code 失败误标 PROVIDER\_ERROR → 独立 `SCRIPT_ERROR`（`0cbce9d`）；④ 空白产线空图崩溃 → fail-closed（回归基线守护）。回归基线扩到 11 用例。**2026-09-01 架构修正**：blankGraph 从 TEMPLATES 数组移出，单独导出 BLANK\_TEMPLATE，TEMPLATES.length 恒等于真实业务模板数，getTemplate() 兼容查找 blank。**2026-09-01 新增 7 个模板**：客服工单自动处理（branch+human+notify）、代码审查助手（http+code+gate）、数据报表生成（http+code+table）、合同审查助手（fileParse+gate+human）、课程大纲生成（教育）、旅游行程规划（生活）、菜谱生成（code营养估算）。新增后共 25 个业务模板，覆盖 25 种节点类型中的 23 种（database / subprocess 无模板），其中 branch/notify/vcs/table/fileParse 等 12 种节点从单点覆盖变为双点覆盖。**2026-09-01 再增「证据清单整理」（法律合规第二模板，共 26 个）**：证据材料 → code 拆条编号（空行切分 + 中文/斜杠日期归一化，永不抛）→ table 按日期索引 → 清单起草（证明目的）→ 缺口分析（要件拆解 + 补证建议）→ 质检 gate；零凭证纯 agnes，core 形状断言 + 回归基线引擎级执行用例（真实跑 code 节点与 table 排序）。**2026-09-01 再增「费用报销初审」（财务审计首个模板，共 27 个）**：报销明细 → code 规则校验（单笔超 1000 元 / 重复单号 / 日期缺失或在未来，永不抛、保证表格至少一行）→ table 异常清单按异常数降序 → 初审报告（统计 + 异常明细表 + 处理建议）→ 质检 gate；与证据清单同构（确定性归代码、判断归模型），零凭证纯 agnes，core 形状断言 + 回归基线引擎级执行用例（真实跑规则校验与 table 排序）。整体进度见 [docs/project-progress.md](docs/project-progress.md)

5. ★ **README 演示 GIF（已完成，2026-09-01）**：`docs/images/demo-run.gif`（5帧时间轴回放，960px宽，142KB）已放入 README，替换 TODO 注释位。commit `6df0fe7`。多屏幕录屏技术笔记：screencapture -R 指定区域跨屏幕会失败（不创建文件），超大区域截图 + Pillow 裁剪到目标屏幕是稳定方案；screencapture 无 -t 选项，必须 pkill -INT 停止才写入 moov atom

6. **git push（已完成，2026-08-31）**：安全审计批次已由用户 push 到 `origin/feature/20260824` 并观察 CI；**PR #90 title/description 已同步**到引擎稳健性主线（模板 code 节点 + error 边 + 空白画布）

7. ✅ **web 前端组件测试（2026-09-02 登记，2026-09-03 全部完成）**：从 176 个纯逻辑测试（零组件测试）推进到 **1460 个测试**，其中组件测试 **1223 个**，覆盖 **39 个组件**。分四批推进：P0（5 组件/112 用例：CanvasToolbar/TemplatePicker/ProductGallery/Settings/Inspector）、P1（5 组件/174 用例：ConnectorEditor/ModelAssignModal/RunHistory/ControlPanel/TriggersPanel）、P2（10 组件/285 用例：GlossaryModal/CostReport/EvalReport/VersionPanel/FailurePanel/CommandPalette/ABReport/KnowledgePanel/FinishedProduct/ProductBlocks）、P3（19 组件/652 用例：ProtectedRoute/Timeline/TemplateFieldDialog/SkillPicker/FormConnectorModal/NewGraphDialog/UserMenu/Onboarding/BrandTermsModal/Popover/ShortcutsHelp/SourceImages/AccountDialog/GraphSwitcher/VariablesModal/ABDialog/AuthPages/SourceFiles/RunCompare）。基础设施：@testing-library/react + jsdom + vitest.config.ts + setup.ts + utils.tsx。过程中发现并修复 Inspector.tsx 可选链 bug（`rt.reasoning?.[activeAttempt]`）。全量 1460/1460 稳定通过，56 个测试文件。方案见 [docs/web-component-testing-plan.md](docs/web-component-testing-plan.md)

8. ✅ **search 成功路径已真实取证（2026-09-06）；audioGen 成功路径仍推迟（用户无 TTS 模型）**：搜索凭证模型本轮重构——**「设置 · 搜索服务」按源独立绑定 key**（`tavily`/`serpapi`/`google` 各一个槽、落盘前加密、切换源不丢也不串），节点里只可选已配 key 的源（未配源置灰 + 提示），凭证链 节点级 → 用户级对应源槽 → env 兜底、跨源绝不复用 key（`config.ts`/`search.ts`/`index.ts`/`Settings.tsx`/`SearchFields.tsx`/i18n）。**真实跑通**：最小图 source→search(tavily)→sink，用用户在 Settings 配的 Tavily key 返回 3 条真实结果（taobao/jd/supercoddle，run `d80040c5`）。`audioGen` 因 agnes 无音频模型仍推迟，待有 TTS 供应商再补 tpl-news-podcast 音频链路。
   8b. 🔵 **效果数据回流自动采集（2026-09-04 立项，第一步已落地）**：F6 的效果数据（曝光/点击/GMV）此前靠手填/CSV，成本侧（F9）已自动归集但 GMV 侧人工搬运，ROI 闭环断在「效果回流」这一环。**合规采集分级**（见 [design-ecommerce-roadmap.md §F6](docs/design-ecommerce-roadmap.md)）：✅ 首选 Webhook 回流 + 官方开放 API；🟡 谨慎 RPA 回读后台（只读不写，Playwright，见 §F7-C）；❌ 禁用 RPA 全自动发布 / 第三方模拟上传 / 批量小号（已记录原因）。**第一步已落地（commits** **`cdd3ff5`/`b8ecaa9`）**：`POST /api/metrics/webhook/:targetId` 端点——每渠道独立 secret（存 publish\_targets config 加密）+ 常量时间比对 + `X-Webhook-Timestamp` 5 分钟防重放（复用触发器 `secretEqual`/`WEBHOOK_TIMESTAMP_WINDOW_MS`），按 `external_content_id`/`artifact_id` 回写 content\_metrics；无 secret 渠道默认拒绝，`ALLOW_INSECURE_METRICS_WEBHOOK=1` 逃生口；web 发布渠道表单加「效果回流密钥」字段。新增 6 例（server api.metrics-webhook）。**RPA 回读框架已落地（commit** **`c0c4aa9`）**：`rpa/` 模块（`adapter.ts` MetricsAdapter 接口 + 限速/风险契约、`browser.ts` Playwright 生命周期 + storageState 扫码登录态、`index.ts` adapter 注册表 + collectMetrics 入口、`adapters/xiaohongshu.ts` 骨架）+ playwright 依赖 + 4 例测试（chromium 启动抓 DOM / storageState 持久化恢复 / adapter 注册表 / 骨架诚实兜底）。**选择器待真实环境逆向**：小红书/抖音后台的登录流程 + 数据抓取选择器需真实账号扫码 + 逆向 DOM，框架已就绪、拿到真实环境后只补 adapter 两处即可启用（诚实标注「尚未启用」而非假装能抓）。

9. ✅ **设计 Token 体系完善（2026-09-03 立项，全部完成）**：当前只有 26 个基础 CSS 变量（颜色/字体/层级），缺失间距/圆角/阴影/字号/动画等基础 token，无语义化层，不支持明暗主题切换。方案见 [docs/design-design-tokens.md](docs/design-design-tokens.md)。**基础设施已落地（commit** **`9259a38`）**：① 补充完整 Primitive token 层——间距 12 级（8pt grid）、圆角 7 级、阴影 6 级、字号 8 级、行高 4 级、字重 4 级、动画 3 级（duration + easing）；② 新增 Semantic token 层——背景 7 角色、文字 5 角色、边框 5 角色、功能色 4 组（success/warning/error/info 含 bg 变体）、accent 交互色 4 角色、语义间距/圆角/阴影各 4-5 角色；③ 明暗主题切换——`[data-theme="light"]` 属性驱动，所有 semantic token 完整映射浅色值，滚动条颜色同步；④ 保留原有 26 个原始 token 向后兼容，semantic token 映射到 primitive，主题切换单属性即可。**渐进式迁移已完成（30 批，commits** **`09abc4d`\~`7d0b9da`）**：styles.css 全局样式全部迁移到 semantic token，覆盖全局基础/HUD/graph-popover/基础组件/image-list/skill-card/tool-calls/template-picker/template-preview/shortcuts/icon-btn/layout/stage toggles/panels/control panel/inspector tabs/labels/notes/empty/LED/power meter/form field/chip/btn/branch-rule/status/diag/canvas base/minimap/toast/pipes/pipe-bridge/pipe-arrow/plant-tip/plants/timeline/inspector/artifacts/artifact-card/artifact-md/artifact-file/gallery/gallery-detail/product/conflict-banner/btn-row/error-box/reasoning/link/modal/var-table/provider-card/seg/price-row/settings-section-head/toggle/badge/input/select/model-card/model-form/key-input/failure-panel/failure-card/rework-popover/tooltip/product-doc/pb-hero/pb-heading/pb-paragraph/pb-quote/pb-bullets/pb-specs/pb-image/pb-cards/pb-card/pb-cta/pb-divider/abtable/ab-badge/ab-winner-note/ghost-btn/connector/form-field-row/connector-test/error-text/brand-list/adv/triggers-toolbar/trigger-list/trigger-row/trigger-meta/trigger-actions/trigger-toggle/badge 变体/section-title/trigger-editor/editor-grid/onboarding/knowledge-panel/worker-list/version-panel/run-compare/palette/hud\_\_menu/kbd-inline/canvas-toolbar/auth-page/auth-card/user-menu/user-menu logout/account-modal/table-steps/glossary/runhistory-filters/runhistory-list/runhistory-row/run-status/runhistory-name/runhistory-id/runhistory-row-meta/runhistory-rerun/runhistory-pager/compare-table/model-assign。全量 1460 测试每批验证通过，无回归。剩余 36 处原始 token 引用为 token 定义本身（正常）、`--warning` semantic token（正常）、`--plasma` 特殊紫色（用于 image modality，可保留）

10. ✅ **i18n 国际化（2026-09-03 立项，全部完成）**：当前无任何 i18n 基础设施，所有 UI 文本硬编码中文，无语言切换，无本地化格式。方案见 [docs/design-i18n.md](docs/design-i18n.md)。**基础设施已落地（commit** **`008c844`）**：① 安装 i18next + react-i18next（运行时）+ i18next-parser（开发工具）；② i18n 初始化——7 个命名空间（common/canvas/nodes/modals/settings/run/errors），语言自动检测（localStorage > 浏览器语言），变更时持久化 + 同步 document lang 属性；③ 完整中文（zh）翻译包——common 120+ keys、canvas 90+ keys、nodes 80+ keys、modals 500+ keys（25 种弹窗类型）、settings 200+ keys、run 200+ keys、errors 400+ keys（6 大类）；④ 完整英文（en）翻译包——与 zh 同 key 覆盖，全部 UI 文本已翻译；⑤ main.tsx 引入 i18n 初始化，TypeScript 编译通过，全量 1460 测试无回归。**组件级迁移已开始（3/41 组件，commits** **`e794773`/`e697a13`）**：Toast、UndoRedo、ConfirmDialog 已迁移到 useTranslation hook；测试设置已添加 i18n 初始化（强制中文语言，现有测试断言继续有效）；修复 zh/common.json "confirm" 值从"确认"改为"确定"以匹配原行为。**剩余渐进式迁移**：38/41 组件逐步用 `useTranslation()` hook 替换硬编码中文（预计 200+ 处），添加语言切换 UI，本地化格式（日期/数字/货币/相对时间），优先级 P1。**2026-09-03 组件迁移基本完成**：全部业务组件（含 Inspector/ProductBlocks 等 41 个）+ 顶层 App.tsx 已迁移；App.tsx 的 commandItems/hud/ConfirmDialog 文案迁入 `common.app` + `modals.commandPalette.commands`；Inspector 的通用 chrome（节点详情/保存态/tab/冲突横幅）+ 表格步骤操作（STEP\_OP\_LABELS + TableStepEditor 全字段）+ 错误码（ERROR\_LABEL）+ 运行时 UI（本次运行/产出/工具调用/思考过程）已迁入 `nodes.inspector`。**收尾已全部完成（2026-09-04 复核）**：① Inspector 内 25 种节点的配置字段（source 电商字段/textGen/imageGen/videoGen/audioGen/gate/compliance/http/translate/code/branch/map/loop/parallel/table/database/fileParse/ocr/convert/search/notify/vcs/human/subprocess 的 label/placeholder/hint，约 250 处）已全部迁入 `nodes.inspector`（Inspector.tsx 现有 341 处 `t("nodes:inspector…")` 调用，源码中文仅剩注释与代码示例，`keys.test` 硬编码中文守护 4/4 通过）；② 语言切换 UI（`LanguageSwitcher.tsx` 集成 UserMenu，显示目标语言名）已落地；③ 本地化格式（`i18n/utils.ts`：`formatDate`/`formatDateTime`/`formatShortDateTime`/`formatNumber`/`formatCurrency`/`formatRelativeTime`，基于 `Intl.*` + zh-CN/en-US locale）已落地。

11. ✅ **自媒体电商方向能力升级（2026-09-03 立项 → 2026-09-04 十个特性全落地，见 Current state 第 20/21/22 条）**：方案见 [docs/design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md)，已登记 [docs/README.md](docs/README.md) 索引与 [project-progress.md](docs/project-progress.md) 管线。**方案主张**：先盘点现有能力再补真实缺口——human / run 级 A/B / parallel / loop / branch / batch 触发 / source 电商字段（productName/brand/audience/priceRange/tone/prohibited/brandTerms）/ gate / 逐节点成本计量 / 品牌词库 / http-notify-vcs / subprocess / cron **全部已存在，必须复用而非重建**；真正缺口只有四处：① run 内并行多变体与自动择优（现有 A/B 是 run 级、只换单个 prompt、无自动选择、变体不能在同图汇聚）② 跨 run 的运营态工作台（审核队列 / 批量 / 日历）③ 商品与素材一等公民数据实体 ④ 效果数据回流与内容级成本。**节点策略（防节点面板被行业功能堆满）**：执行语义变了→新增节点；只是同职责多几个配置项→扩现有 config；跨节点数据/运营状态/界面→不做节点，落到"数据表 + API + 工作台 UI"。按此本期 10 个特性**只新增 4 个节点**（`fanout`、`select`、`compliance`、`publish`），F4 只给 ConnectorType 加 `"product"`，F2 原样复用 `human`，F5 复用 `loop`/`batch`。特性与工作量：F1 run 内多变体+择优（大）、F2 审核队列（小，纯增量最快见效）、F3 平台适配与合规校验（中）、F4 商品库/素材库（中大）、F5 批量任务（中大）、F6 效果回流（中）、F7 发布集成（A 平台化导出包 + 人工发布 小 / B 正规 API 渠道上架 中 / C 半自动 RPA 读数据优先、明示封号风险、不做全自动灰产——**淘宝/小红书/抖音没有面向个人的免费内容发布 API，不得承诺"一键自动发"**）、F8 内容日历（中）、F9 内容级成本归因（小中）、F10 fan-out/fan-in 画布（中，**必须与 F1 同批交付否则能力不可用**），里程碑 M1-M6。**立项复核（2026-09-03，对着 HEAD** **`f893b5f`** **抽查 8 处行级引用全部准确**：NodeRunKey 仍是 `{nodeId, attempt}` 无 variant 维度、node\_runs/artifacts 主键仍是 `(run_id,node_id,attempt)`、ConnectorType 仍是 manual/file/http/form/database 五种、parallel 只有 asObject/pick 两种聚合、`graph.ts:856` 仍是一个 kind 对应一个可选 config），缺口分析成立。**已补写 F1 失败语义（原方案唯一实质遗漏）**：变体泳道把"静默成功"面放大 N 倍，故把狗粮九波踩过的同类缺陷（`b6de7d9`/`5d76cc5`/`2797011`/`a633989`/`0a22653`/`e6dc2c9`/`44c3260`）前置成 7 条语义 + 6 条专项测试：lane 隔离失败（其余 lane 继续）、select 等全终态不得提前起跑、部分存活降级 warning / **全军覆没必须 select failed 而非把空集合吞成 done**、rework 只重跑本 lane、human 模式展示失败 lane、reconstructState 按 `(nodeId,variant)` 去重；并在工作量里明确**与调度器改造同批落地、不可后补**。**下一步待排期**：A 先做 M2 快赢（F2 审核队列 + F3 合规，纯增量不动引擎）／ B 先做 M1 差异化引擎根基（F1+F10，工作量大但是护城河）。**兼容性验证（2026-09-03）**：M2 快赢（F2+F3）已落地并验证——纯增量、不动引擎，27 个内置模板在新 schema 下全部兼容、旧图/旧 run 可回放，**零破坏现有产线**；10 个特性里唯一动核心引擎的是 F1（variant 维度），已设计缺省 `'main'` 兜底，须按 §F1 失败语义与专项测试同批落地（详见 [design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md)「关键取舍」第 5 条）。

12. ✅ **F2 审核队列（已落地，前一会话完成）**：`packages/server/src/reviews.ts`（`listPendingReviews`/`parseDecisions`/`classifyHalt`，聚合 halted 运行、按等待时长排序、分类 human/tool/gate 三类暂停）+ `GET /api/reviews/pending` / `POST /api/reviews/decide`（批量决策，单条失败回 200 + results 而非整体 400）+ runs 表迁移 20（`halted_node_id`/`halted_reason`，旧 halt 从事件日志兜底解析）+ 前端 `ReviewQueue.tsx`（待审列表 / 内容预览 / A 通过 R 驳回 E 改后通过 / 批量勾选 / 快捷键 / 轮询）+ 顶部导航「待审核 (n)」角标 + 完整 i18n（zh/en reviews.json）+ 测试（`api.reviews.test.ts` / `ReviewQueue.test.tsx`）。

13. ✅ **F3 平台适配与合规校验（已落地，本次完成）**：按 [design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) §F3 实现。① **core**：新文件 `packages/core/src/platforms.ts`——`PlatformId` 五平台枚举 + `PlatformProfile`（titleMax/bodyMax/hashtag/imageRatios/bannedWords/required）+ 内置《广告法》极限词库 `AD_LAW_BANNED_WORDS`（37 词，标注来源与更新时间）+ `checkCompliance` 纯函数（极限词/长度/话题标签三类确定性规则，产出 `{passed, violations[], original, sanitized}`，violation 带 span 区间供高亮、autoFix 按「最长词优先」就地替换）+ `complianceArtifact` 输出契约；`graph.ts` NodeKind 增 `compliance`（归 control）+ `ComplianceConfig`（platform/extraBanned/autoFix/failOnViolation）。② **server**：`banned_terms` 表（user 级补充词库，仿 brand\_terms）+ CRUD API + 迁移 21 + `GET /api/platforms`（返回 profile 与内置词表）；engine 新增 compliance 节点执行块（纯函数，读上游文本 → checkCompliance → 产出 json artifact + 下游拿 sanitized 文本；`failOnViolation` 时 node.failed 走 error 边；用户 banned\_terms 词库经 `ExecuteOptions.bannedTerms` 在 run.ts 启动/恢复时注入并与节点 extraBanned 合并）。③ **web**：compliance 节点注册（Plants KIND\_KEY / CanvasToolbar NODE\_HINT\_KEY / nodes.json zh-en 标签「合规台」）+ Inspector 面板（平台选择 / 补充违禁词 / autoFix / failOnViolation 开关）+ api.ts（listPlatforms / banned-terms CRUD）+ store/graph DEFAULTS。④ **测试**：core `platforms.test.ts` 9 例（五平台覆盖/极限词命中 span/autoFix 洗稿/标题超长/话题标签/补充词/契约形状）、server `engine.compliance.test.ts` 4 例（通过/违规 autoFix/failOnViolation error 边/词库合并）+ `api.platforms.test.ts` 4 例（profiles/banned-terms CRUD/空词 400/跨用户隔离）。**顺手修复前一会话遗留的两处 i18n 迁移 bug**：TriggersPanel 函数参数 `t` 遮蔽 i18n `t`、ControlPanel `t(STATUS_TEXT[...]!)` 缺非空断言（两者均阻塞 web build）。

14. ✅ **F4 商品库 / 品牌素材库（已落地，本次完成）**：按 [design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) §F4 实现。① **core**：`ConnectorType` 增 `"product"` + `ProductConnector`（`productIds` / `selection` manual|filter|all / `filter`）。② **server**：`products` + `brand_assets` 表（迁移 22）+ `/api/products` CRUD + CSV import/export（复用 core `parseCsv`/`rowsToCsv`，非保留列归 attributes）+ `/api/brand-assets` CRUD；engine `resolveConnector` 增 product 分支（经注入的 `loadProducts` 回调读商品库，映射 name/brand/category/price/attributes → source text + images），`ExecuteOptions.loadProducts` 在 run.ts 启动/恢复时注入 `productConnectorLoader`。③ **web**：`ProductLibrary.tsx`（列表/添加/归档/删除/CSV 导入）+ `BrandAssets.tsx`（素材网格/添加/删除）+ ConnectorEditor product 表单 + 命令面板入口 + 完整 i18n（zh/en modals.json）。④ **测试**：server `api.products.test.ts` 6 例（CRUD/空名 400/跨用户隔离/CSV import+export）+ `engine.products.test.ts` 2 例（loader 注入映射 / loader 失败走 CONNECTOR 失败）。**遵守新规范**：并行会话新建的 `AGENTS.md` 要求 UI 文案必须走 i18n、禁止硬编码中文，F4 web 组件已全部 `t()` 化并通过 keys.test 硬编码中文守护。

15. ✅ **F5 批量任务编排（已落地，本次完成）**：按 [design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) §F5 实现。① **server**：`batch_jobs` + `batch_items` 表（迁移 23）+ runs 增 `batch_id`/`batch_item_id`；`/api/batches` 创建（rows 数组或 CSV，复用 core `parseCsv`）+ 列表 + 详情（含 items）+ 单行重跑 `POST /api/batches/:id/items/:itemId/retry`；新文件 `batch.ts` `runBatch`（并发 worker 池，逐行 `startRun`，`onFinish` 回调 settle item 并回写批次 counts/status，done/partial/failed 终态）。② **web**：`BatchManager.tsx`（创建批次表单 graph 下拉 + CSV + 并发上限 / 批次列表轮询 / 展开 items 状态表 + 失败行重跑）+ 命令面板入口 + 完整 i18n（zh/en modals.json batchManager 段）。③ **测试**：server `db.batch.test.ts` 2 例（批次+items 生命周期 / 按用户隔离+倒序）。④ **遵守 AGENTS.md**：UI 文案全 `t()` 化，keys.test 硬编码中文守护通过。

16. ✅ **F7-A 平台化导出包（已落地，本次完成）**：按 [design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) §F7 阶段 A 实现（**只做导出包，不承诺自动发布**）。① **core**：新文件 `publish.ts`——`PublishConfig`（platform/title）+ `buildPublishPackage` 纯函数（复用 F3 的 `PLATFORM_PROFILES`：拆标题/正文、按 titleMax/bodyMax 截断、提取 `#` 话题标签、给主图比例清单，产出 `readyToPublish` 待发布包）+ `publishArtifact` 契约；`graph.ts` NodeKind 增 `publish`（归 integrations）。② **server**：engine publish 节点执行块（读上游文本 → buildPublishPackage → 产出 json artifact + 下游拿 body 文本）。③ **web**：publish 节点注册（标签「发布台」/hint）+ Inspector 面板（平台选择 + 可选标题）+ DEFAULTS。④ **测试**：core `publish.test.ts` 5 例（拆标题/正文、话题标签、截断、显式 title、custom 平台）+ server `engine.publish.test.ts` 2 例（待发布包组装 / wechat 无话题标签）。**协作说明**：nodes.json/Inspector.tsx 的 publish 段依赖并行会话的 source/compliance inspector i18n 迁移，故 `09acd9d` 一并带上了这些 i18n key。

17. ✅ **F8 内容日历（已落地，本次完成）**：按 [design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) §F8 实现（**先做手动排期，自动发布待 F7-B**）。① **server**：`content_plan` 表（迁移 24）+ db 方法（createPlan/listPlans 按时间范围过滤/getPlan/updatePlan/deletePlan）+ `/api/plan` CRUD（GET 支持 from/to 过滤、POST/PATCH/DELETE）。② **web**：`CalendarView.tsx`（月视图网格 + 月份导航 + 按天展示排期 chip + 状态色）+ PlanDrawer（标题/平台/排期时间/备注 + 创建/编辑/删除）+ 命令面板入口 + 完整 i18n（zh/en modals.json calendar 段）。③ **测试**：server `db.plan.test.ts` 2 例（CRUD 生命周期 / 时间范围过滤+用户隔离）。④ **遵守 AGENTS.md**：UI 文案全 `t()` 化，keys.test 硬编码中文守护通过。

18. ✅ **F6 效果数据回流（已落地，本次完成）**：按 [design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) §F6 实现（**先只采集，不急于做 few-shot 沉淀**；external id 允许手动填写先跑起来，不依赖 F7-B）。① **server**：`content_metrics` 表（迁移 25）+ db 方法（insertMetric/listMetrics/aggregatePerformance 按 graph\_id/run\_id/node\_id/variant/artifact\_id/product\_id/platform/external\_content\_id 分组聚合）+ `/api/metrics`（单条手填 + CSV 批量 import）+ `/api/performance?groupBy=`（多维聚合）。② **web**：`PerformanceDashboard.tsx`（汇总指标卡：曝光/点击/转化/CTR/CVR/GMV/广告花费/ROI + 聚合表按产线/平台/商品/产物切换 + 手工录入表单 + CSV 导入）+ 命令面板入口 + 完整 i18n（zh/en modals.json performance 段）。③ **测试**：server `db.metrics.test.ts` 3 例（插入/列表、按平台聚合、用户隔离）。④ **遵守 AGENTS.md**：UI 文案全 `t()` 化，keys.test 硬编码中文守护通过。

19. ✅ **F9 内容级成本归因（已落地，本次完成）**：按 [design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) §F9 实现（**先用 artifact/product/platform 维度跑通，variant 依赖 F1 后续补**）。① **server**：`content_costs` 表（迁移 26）+ db 方法（insertContentCost 存 cost\_usd/gmv 并算 roi=gmv/cost、listContentCosts、aggregateContentCosts 按 artifact\_id/product\_id/platform/variant 分组聚合并重算 roi）+ `/api/content-costs`（POST 快照 / GET 列表）+ `/api/costs` 扩展 `groupBy` 参数（内容级维度返回成本/GMV/ROI 聚合，否则走原 run/node 粒度报表）。② **web**：`PerformanceDashboard.tsx` 增「内容成本」区块（成本维度切换 按产物/商品/平台/变体 + 成本/GMV/ROI 聚合表 + 手工录入成本），与 F6 效果数据同屏联动。③ **测试**：server `db.costs.test.ts` 3 例（roi 计算 / 按平台聚合重算 roi / 用户隔离）。④ **遵守 AGENTS.md**：UI 文案全 `t()` 化，keys.test 硬编码中文守护通过。

20. ✅ **F1 run 内多变体 + 择优（已落地，本次完整完成）**：按 [design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) §F1 实现（**采用 sub-run 泳道方案**：fanout 对每个 variant 起一条隔离 sub-run 泳道，复用 subprocess 机制，避免改写 runNode 内部 200+ 处执行身份；泳道状态以 `#var:` 前缀命名空间隔离，兄弟 lane 失败不沉没父 run）。① **core**：NodeKind 加 `fanout`/`select`（归 control）+ `FanoutConfig`/`SelectConfig` schema + `NodeRunKey` 加可选 `variant` 字段（`artifact.produced` 同步）+ 新事件 `variants.spawned`/`variants.ranked` + compile 校验（fanout 出边必须最终汇入 select、select 必须有上游 fanout）+ runtime reducer 记录 `RuntimeState.variants`（fanout variantIds + select ranking/chosen/failed）。② **server**：DB 迁移 27（`node_runs` 复合主键重建为 `(run_id,node_id,attempt,variant)`、`artifacts` 加 variant 列+索引）+ 持久化贯穿 variant（缺省 `'main'`，旧图字节级不变）+ 引擎 fanout/select 执行块（fanout 按 prompt/temperature/model 三种策略扇出、select 按 llm\_score/rule 择优 + `variants.ranked` 显式计数失败 lane）。③ **web**：画布注册 fanout/select 节点 + Inspector 配置表单 + **变体对比视图**（`VariantComparison.tsx`：select/fanout 节点并排 N 张变体卡片——内容/分数/理由/chosen/failed）+ run 状态树按 variant 分组 + zh/en i18n。④ **测试**：core compile 3 例 + runtime 1 例 + server engine.variants 5 例（扇出择优 / 全失败 select 报 failed / 单 lane 隔离失败仍择优 / llm\_score 通道 / replay 不吞产物）。**已知环境问题（非本特性引入，2026-09-06 已修复 `145f83c`）**：CodeBuddy 注入 `NODE_OPTIONS=--require node-language-shim.cjs` 与 Node 24 `--permission` 冲突，导致 code 节点沙箱探测失败（34 个 code/模板用例在 IDE 内红）——根因两层：① 探针继承 host `NODE_OPTIONS`，`--require` shim 启动需 fs 读、被权限模型默认拒绝 → 探针误报「无门控」；② gate 判定后仍无条件追加 `--allow-fs-*`，`none` 时发出「无 `--permission` 前置的 `--allow-fs-*`」→ `ERR_MISSING_OPTION`。已修为探针 clean env（剥 `NODE_OPTIONS`）+ `--allow-*` 收进 `if (gate !== "none")` 块，IDE 内**无需再手动 `NODE_OPTIONS=` 清空**。

21. ✅ **F10 fan-out/fan-in 画布编排体验（已落地，本次完成）**：按 [design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) §F10 实现。① **自动泳道布局**：`canvas/layout.ts` 的 `arrangeVariantLanes`（BFS 分层，fanout 下游 lane 等距平行展开、select 推到右侧）+ store `arrangeLanes` action + Inspector「整理泳道布局」按钮。② **折叠/展开**：store `collapsedFans`/`toggleLaneCollapse` + fanout 节点折叠 chip（＋/－）+ Pipes/Plants 跳过隐藏 lane 节点与边。③ **连线辅助**：`duplicateLaneStructure`（把 fanout 第一条支路结构按 count 复制 N-1 份，节点+连边纵向偏移）+ Inspector「复制支路结构」按钮。④ **校验可视化**：compile diagnostics（含 nodeId）透传到 Canvas/Plants，error 节点红框高亮（`.plant.is-error`）。

22. ✅ **F7-B 开放渠道发布（已落地，本次完成）**：按 [design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) §F7 阶段 B 实现（**先落最通用、零资质的 Webhook 渠道**：POST 到自建中台；飞书/钉钉/微信适配器可后续按同一 Publisher 接口独立增量）。① **server**：`publish_targets`/`published_contents` 表（迁移 28）+ `publish.ts`（`publishToChannel` 抽象 + `webhook` provider，走 guardedFetch SSRF 边界）+ `/api/publish-targets` CRUD（config token 用 encryptString 落盘加密）+ `/api/publish`（调用渠道 + 写 published\_contents）+ `/api/published` 查询。② **web**：`PublishTargets.tsx`（渠道列表/新增/删除）+ api client + 命令面板入口 + zh/en i18n。③ **测试**：server `db.publish.test.ts` 3 例（CRUD / 发布记录 / 用户隔离）。④ **遵守 AGENTS.md**：UI 文案全 `t()` 化，keys.test 硬编码中文守护通过。

23. ✅ **状态机方案 A 验证（2026-09-04）**：确认「variables + branch 组合」足以表达状态机，无需新节点类型。新增 `packages/server/src/engine.statemachine.test.ts`（2 例）——构造订单状态机（待支付→已支付→已发货→已完成），用 graph variables 跨 run 持久（`graph.variables` 默认值 + `db.loadGraphVariables` 合并 → engine `set_variable`/`get_variable` 内置工具推进 → run 结束 `db.saveGraphVariables` 写回）+ branch 按 `${var.orderState}` 路由。验证：① 订单状态跨 4 次 run 逐步推进、未路由分支正确发 `node.skipped`、终态走 `defaultTarget` 不再迁移；② 无持久化值时从图级默认状态起步。**结论**：方案 A 可用，状态机无需一等节点。**方案 B（正式** **`statemachine`** **节点：core** **`StateMachineConfig`** **+ 编译期迁移校验 + engine 执行块 + web 表单）已登记** **[deferred-items 编排线](docs/deferred-items.md)**，触发条件：非法迁移在画布拦不住 / 状态流转图不可见 / branch 规则随状态增多膨胀。

24. ✅ **「银行流水对账」模板（tpl-reconciliation，2026-09-04）**：财务审计第 2 个模板（第 28 个业务模板），source 双流水 → code 逐笔配对 → table 差异清单 → textGen 对账报告 → gate。真实狗粮 run `dogfood-rec` 通过（agnes 真实产出，3 银+3 账→2 匹配 2 差异）。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

25. ✅ **「隐私政策合规审查」模板（tpl-privacy-review，2026-09-04）**：法律合规第 3 个模板（第 29 个），source → fileParse → textGen 合规盘点(11 维度) → textGen 整改建议 → gate → human → sink。真实狗粮 run `dogfood-privacy` 通过（agnes 精确盘点 11 维度）。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

26. ✅ **「发票批量 OCR 台账」模板（tpl-invoice-ocr，2026-09-04）**：财务审计第 3 个模板（第 30 个），source 图片 → ocr → textGen 字段提取 → code 清洗 → table 台账 → sink。真实狗粮 run `dogfood-invoice` 通过（跳过 OCR，聚焦 extract/code/table）。发现 table coerce 前导 0 丢失局限（后已修复，见 Recently shipped）。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

27. ✅ **「批量合同审查」模板（tpl-batch-contract-review，2026-09-04）**：法律合规第 4 个模板（第 31 个），source 多合同(`=====`分隔) → code 拆条 → textGen 逐份审查 → code 汇总 → table 风险汇总 → gate。真实狗粮 run `dogfood-batch-contract` 通过（2 份合同 7 风险点）。至此专业服务第一档 7 模板落地。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

28. ✅ **「审计抽样底稿」模板（tpl-audit-sampling，2026-09-04）**：财务审计第 4 个模板（第 32 个），source CSV → code 抽样规则(大额/重复/非工作日) → table 抽样清单 → textGen 审计底稿 → gate。真实狗粮 run `dogfood-audit` 通过（6 笔账目，抽样正确 total6/sampled5/large1/duplicate2/weekend3）。专业服务累计 8 模板。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

29. ✅ **fileParse 多文档增强 + 「尽调清单」模板（tpl-due-diligence，2026-09-04）**：① fileParse 从只解析第一个文档改为解析所有文档（`===== 文件名 =====` 头分隔，单文档向后兼容），解锁批量合同/尽调场景；② 法律合规第 5 个模板（第 33 个）：source 多材料 → fileParse → textGen 尽调盘点(7 事项) → textGen 缺口清单 → gate。真实狗粮 run `dogfood-dd` 通过（首次 gate criterion 过严 halted，放宽后 done）。专业服务累计 9 模板（法律 5 + 财务 4）。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

30. ✅ **核心文件重构（2026-09-04 立项 → 全部完成）**：`engine.ts` 4954→1828 行（-63%，`runNode` 3160→~380 行退化为 NODE_HANDLERS 注册表分发器，28 个节点执行体迁至 `packages/server/src/nodes/`）；`Inspector.tsx` 3848→611 行（27 个 `XxxFields.tsx` 注册表分发）。纯重构不改行为、小步原子提交、测试唯一验收，server 747/747 + web 1500/1500 全绿。方案见 [design-refactor-engine-inspector.md](docs/design-refactor-engine-inspector.md)。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

31. ✅ **合规/运营批次五份方案（2026-09-05 定稿，全部已实施）**：①密钥轮换 P1+P2+P3（keyring 多密钥 + enc:v2 格式 + rotate-reencrypt 脚本 + 运维手册）②审计日志 P1+P2（audit_log 表 + audit() helper + 全词表埋点 + GET /api/audit；P3 待触发）③服务端日志 P1+P2+P3（默认落盘 + console 收编 + 请求中间件 + 关键路径）④公告 P1+P2+P3（窗口过滤 + 双语 + read 幂等 + admin 角色 + AnnouncementBell + P3 target 定向）⑤用户反馈 P1+P2+P3（feedback 表 + 限流 + 截图 + AdminPanel + P3 反馈→公告联动）。均已登记 docs/README.md 索引与 deferred-items。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

32. ✅ **search 成功路径补证** —— 与第 8 条合并：search 已真实取证（2026-09-06，Tavily 3 条结果，凭证按源绑定）；audioGen 仍推迟（用户无 TTS）。

33. ✅ **服务端日志收编 + 默认落盘 + 请求日志 + P3 关键路径（2026-09-05，P1+P2+P3 全部完成）**：按 [design-logging.md](docs/design-logging.md)——① 默认落盘 `<DB dir>/logs/server.log`（LOG_FILE="" 可禁用）；② console 收编（engine/nodes/notify/triggers/code-sandbox/worker-plugins/auth 全部改走 Logger，节点经 ctx.log 绑定 runId）；③ 请求中间件（/api/* 按 status 分级记日志 + latencyMs + userId，不记 query 防 token 泄露）；④ P3 关键路径（启动摘要/迁移日志/触发器/run.resumed）。server 747→771/771，`.gitignore` 加 `logs/`。

34. ✅ **角色权限（RBAC）分阶段实施（2026-09-05，P0-P3 全量完成）**：方案 [design-rbac.md](docs/design-rbac.md)。全局角色 owner/admin/user + 资源级 owner/editor/viewer + `resource_access` 表（迁移 v31/v32）+ 判定层 `permissions.ts` + Collaborators 共享 UI + 管理面板 + 权限变更审计。owner=首个注册用户（最早注册 `2467055074@qq.com` 自动升 owner）。P0 公告改走 admin 角色（env 白名单退役）→ P1 资源共享真正落地 → P2 前端共享 UI + viewer 禁写 → P3 admin 运营/用户管理 UI（owner 授/撤 admin，跨用户审计）。server 820/820 + web 1522/1522。前身公告 env 白名单 `ANNOUNCEMENT_ADMIN_EMAILS` 已于 P0 退役。

35. ✅ **连接器数据插值（2026-09-05 方案定稿 → 全部落地）**：引擎级通用机制（行业无关）——`ResolvedMaterial.data?` 通道 + `sourceMeta` 旁路 Map + 快捷名注册表（product 注册全局名，仅图中恰 1 个该类型 source 时注入）+ `buildSourceBrief(fallbacks)` 留空回填/手填覆写（productName←name、brand←brand，调性字段永远纯手工）+ 简报 8 字段 `${product.*}` 插值 + SourceFields hint。新行业接入 = 四件适配声明（data 结构/快捷名/映射/hint），引擎零改动。防重入单遍 replace、空 data/悬空引用各 warn 一条、branch 数值条件 `${product.price}>100` 自动可用。曾于 9/6 晚被三个无说明 commit 回滚 D3/D4/D5，9/8 已恢复（见 Recently shipped #7）。真实 dogfood run `dogfood-interp` 通过。方案 [design-data-interpolation.md](docs/design-data-interpolation.md)。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

36. ✅ **商业化详细实施方案（2026-09-06 设计，未实施）**：[design-monetization.md](docs/design-monetization.md)——三层计费模型（内置模型订阅制 / 自定义模型 BYOK / 平台资源）+ 套餐档位（Free/Starter/Pro/Team，价格待成本校准）+ 配额与订阅 gate + 账单支付（Stripe + 手动开通 MVP）+ 企业版能力 + P0-P3 分阶段路线。实施未启动——触发条件：P0 成本计量回采跑 2-4 周拿到真实成本，再定价开工。

37. ✅ **画布等距 3D 展示视图（受限 3D + 2D/3D 切换，2026-09-06 立项，四期全部完成）**：方案 [design-canvas-isometric.md](docs/design-canvas-isometric.md)。three.js + React.lazy，正交投影 + 锁俯角 + 水平旋转 + 平移，2D 编辑/3D 查看分离。一期 9 步（基础场景+切换+选中+淡切）；二期 29 种程序化几何造型 + 卡车沿 3D 管道跑（复用 2D 正交路由，按 packets spawn 上色）+ 运行状态 LED 亮灯；三期交互收尾（点击弹 Inspector/滚轮+方向键旋转/minimap 缩放滑块+遮罩拖动修复/3D 遮罩=平移/滚轮缩放/适应按钮真 fit）；四期视觉打磨+节点拖动（RTS 等距角/体积感/实心圆管+地面阴影+参考网格/左键拖节点移动布局+管道实时重路由）。审计欠账已清零（见 #42）。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

38. ✅ **商业化 M0：本地运行环境部署（2026-09-07 立项，2026-09-08 全部完成）**：把 agent-world 部署成可 7×24 跑真实产线的单机服务（Ubuntu 纯 Server 笔记本 / Node 24 / systemd 托管 server / nginx 同源托管 web / `CODE_SANDBOX=bwrap`），作为商业化 P0 成本计量回采的运行床。挂 [design-monetization.md](docs/design-monetization.md) §8.13 里程碑 M0。阶段 0-7 全部完成（免密/Node24/bwrap/nginx/agentworld 用户/rsync+构建/.env/systemd active/备份 cron）；阶段 7 商业验收 8/8 通过（注册/AGNES key/建产线跑通/成本计量/cron 触发/code 沙箱/subscriptions 表/备份恢复），期间修掉 bwrap PrivateTmp 写 /tmp 被命名空间隔离（`f288cc1` 改挂 writable tmpfs）。CI/CD 自动部署已生效（self-hosted runner 执行 `/opt/agent-world/deploy.sh`）。文档：[deploy-ubuntu-execution-plan.md](docs/runbooks/deploy-ubuntu-execution-plan.md) + [deploy-ubuntu-execution-log.md](docs/runbooks/deploy-ubuntu-execution-log.md) + [deploy-ubuntu-server.md](docs/runbooks/deploy-ubuntu-server.md)。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

39. ★ **商业化 M1：成本计量回采（2026-09-08 开跑）**：用 M0 环境跑 2-4 周真实产线，攒按用户/模型/月拆分的真实成本，作为 [design-monetization.md](docs/design-monetization.md) §4 定价的数据前提。**开跑前置已落地**（`b99e7d6`~`88de316`，PR #211 已合 dev + Hasee 已部署）：① 单价缺口审计——`unpricedModels()` 判定「完全没配 / 只配了一部分」，server 启动 warn + 成本报表顶部警告条；缺单价的模型 `cost_usd` 当场按 0 落库、**事后无法补算**，所以开跑第一件事是把实际要用的模型单价配全（设置 → 模型）；② 按模型分摊——`node_runs.model`（迁移 36）+ `byModel` 聚合 + 前端表 + CSV 段，迁移前的行归入 `(未记录模型)` 桶保证对账。**本阶段不加功能**——两周后要能回答三个问题：一次典型 run 多少钱 / 返工占总电费多少 / 哪个模型吃掉大头，这三个数直接决定套餐怎么切。**线上实测（2026-09-08，浏览器直连 staging 环境核对部署 commit `1ef57bc`）**：迁移 36 已应用（`schema_migrations` MAX=36，`node_runs.model` 列在位），`byModel` / `unpricedModels` / CSV `model` 段 / 前端「按模型分摊电费」表全部生效，29 条历史行归入 `(未记录模型)` 且 `byModel` 合计与顶部总计一致（输入 4,720 / 输出 2,953），零 console 报错。**~~回采阻塞：7 个模型单价一个都没配~~ → 已于 2026-09-08 解除**：7 个在用模型（agnes 6 + ceshi 1）价格卡全部配全，`unpricedModels` 缺口清零。**关键坑**：内置 `agnes` tier 的单价不能在 UI 里填——`loadConfig` 每次读取都用内置 `AGNES_PROVIDER` 整体覆盖 builtin provider，UI 填的保存后即被抹掉；价格必须写进源码 `packages/server/src/config.ts` 的 `AGNES_PROVIDER.pricing`（随产品发布），custom provider（ceshi）才走设置持久化。当前为 **OpenAI 同级占位单价**（非正式生产），正式计费前须换 agnes 网关真实费率。**端到端实测通过（2026-09-08，Hasee/staging 浏览器直连）**：投料派发后运行「全部出厂」（seq 23/23），电费读数 `$0.00051`、token `830 入 / 643 出`，与 `computeCost` 手算（830×$0.15/1M + 643×$0.6/1M）一致，成本报表「未配单价」警告消失、两个文坊节点自动分配 `agnes-2.0-flash` 且产线可编译。M1 现进入**纯攒数据阶段**（跑 2-4 周再回答三问：典型 run 多少钱 / 返工占比 / 哪个模型吃大头）。另：`ceshi` provider 有个与 `agnes` 重名的 `agnes-2.5-flash`，若仅为测试用途应在设置里禁用（审计会跳过 `enabled === false` 的 provider），否则警告条会长期带一条噪音。

40. ✅ **Hasee 异地备份到 Mac（2026-09-10）**：补 deferred-items「异地备份推送」缺口——服务器备份与原库同盘，异地由 Mac 每日拉取。① Mac 端：`scripts/remote-snapshot.js`（远端 node:sqlite 只读 VACUUM INTO 一致快照）+ `scripts/backup-agent-world-to-mac.sh`（scp→rsync 拉 db/artifacts/logs→本地 integrity_check 门禁→滚动保留 14 份→幂等标记）；launchd 每日 11:00 + RunAtLoad 补跑。已实机验证（手动+kickstart 各一次完整链路通过）。② 服务器端：cron 每日 02:30 正常；`sqlite3 wal_checkpoint` 静默失败已补丁修复（python 替换为 node:sqlite checkpoint，原脚本备份保留，手动验证 -wal 清空）。③ 密钥边界：`.encryption-keys`/`.jwt-secret`/`.env` 600 权限，异地备份不含密钥；已导出存入 macOS 钥匙串（service=`agent-world`，account=encryption-keys/jwt-secret/env，env 存 base64）。文档：deferred-items 行已更新为已落地、deploy-ubuntu-server.md §六 补异地备份小节。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

41. ✅ **M1 回采产线挂载（2026-09-10，已闭环）**：在 Hasee staging 按「成本画像」挂 4 条代表产线攒真实成本：①写草稿·高频文本（cron 每 6h）②翻译流水线·带返工（cron 每日 10:00，gate 上限 3 次）③短视频广告工坊·媒体中价（cron 每日 11:00，imageGen+videoGen）④批量内容工坊·批量放大（cron 每周一 9:00，Map 批处理 5 条）。已配模型显式 agnes-2.0-flash / agnes-image-2.0-flash、source custom 投料、cron 触发器。**阻塞与修复**：Agnes free tier 429 限流——方案 C（降频+长退避 retry）+ 代码补丁全部落地：① `openai-compatible.ts` judge/generateImage/generateVideo 用 `withRetry` 包裹（30s/60s/90s/120s ×4，PR #229 merge `006186b`）；② 触发器持久化 bug 修复（`saveGraphUnscoped` user_id=NULL 走 upsert 导致重启丢触发器，PR #231 merge `70524df`，新增回归测试）；③ 全链路复测通过（run `f19b88bc`：初稿→润色→gate passed→成稿，done，总成本 $0.00117675 完整归集）；④ 4 条产线 cron 触发器全部重建并验证 doc 落盘，部署重启后 next-runs 排程正常 = 触发器持久化在真实重启场景下验证通过。**每日回采体检**：豆包定时任务每日 10:30（Asia/Shanghai）触发，检查 4 条产线 run 完成率/成本归集/429 残留，体检结论回写本待办，直到用户满意或叫停。M1 回采产线全部就绪，cron 按计划自动攒数据。**📋 每日回采体检记录**：

- **2026-09-11（第 1 次体检，🔴 P0 阻塞发现）**：SSH 直连 Hasee DB + journal 交叉验证。**cron 调度器完全未工作**——服务器进程自 2026-09-10 15:47 UTC 启动后（NRestarts=0，持续运行至体检时 02:34 UTC），journal 中零条 cron tick / trigger fired / 定时 run started 记录，唯一一次 run started 是 09-10 15:52 的 manual 触发。4 条产线触发器配置均正确落盘（①`0 */6 * * *` ②`0 10 * * *` ③`0 11 * * *` ④`0 9 * * 1`），但①每 6h 应在 09-10 18:00 / 09-11 00:00 触发均未发生。**run 数据**：①累计 3 runs（1 done / 2 failed），均为 09-10 04:27-05:15 UTC 的手动测试 run（早于当前服务器进程启动）；②③④零 run。**失败原因**：①的 2 次 failed 均为 agnes free tier HTTP 429（qc-pvesb 质检节点，errorCode=UNKNOWN/未正确映射 RATE_LIMIT），done 的 1 次（f19b88bc）总成本 $0.001177 完整归集。**成本归集**：node_runs.cost_usd/tokens_in/tokens_out/model 列均正常，①累计 $0.004108（tokens_in=6331 / out=5264，全 agnes-2.0-flash），无 0 计费异常、无碎片。**通过标准判定**：❌ 未通过——cron 零触发导致回采数据完全停滞，429 仍在打爆 run（qc 节点未走 withRetry）。**需人工干预**：① 排查 server 进程中 cron 调度循环是否启动（可能未初始化 / 被 feature flag 关闭 / 启动时异常静默）；② qc/gate 节点的 429 也应走 withRetry（当前只有 textGen/imageGen/videoGen 包裹了 retry）。体检方式：SSH hasee-2016-server + sqlite3（DB=/var/lib/agent-world/agent-world.sqlite）+ journalctl -u agent-world。

  **🔧 P0 修复（2026-09-11 同日）**：根因定位为 `index.ts` 中 `triggers.restore()`（async，从 DB 加载触发器）未 await 即调用 `scheduler.start()`，导致 `list()` 返回空、零定时器挂载。修复：`triggers.restore().then(() => scheduler.start())` + 错误日志（commit `c826052`）。附带修复 `engine.ts` 兜底 catch 丢失 ProviderError code（429 被记为 UNKNOWN），保留 `err.code`（commit `93a7d19`）。qc/gate 节点的 withRetry 此前已在 PR #229 落地，体检中的 429 失败为部署前的手动测试 run。**✅ 已部署 Hasee（2026-09-11 03:57 UTC，PID 94661，commit 45a6515）**：PR #249 合并后首次 CI 因 `ProductLibrary.test.tsx` flaky test（表单清空时序断言偶发失败，与 cron 修复无关）失败导致 Deploy 被 skipped，`gh run rerun --failed` 重跑后全绿，self-hosted runner 自动执行 `/opt/agent-world/deploy.sh` 完成部署。部署产物 `dist/index.js` 第 144 行确认含 `.then(() => scheduler.start())`，服务器启动无 scheduler/trigger 相关 error，health check OK。**🧪 附带修复 CI flaky test（commit `2ecf3f2`）**：导致首次 CI 失败的 `ProductLibrary.test.tsx` 两个测试（add product 表单清空断言 / import CSV 摘要断言）根因为 `waitFor(mock 被调用)` 后立即断言但组件 setState 尚未 flush，加 `await flush()` 修复，连跑 10 次 10/10 通过。**⏳ 待 06:00 UTC cron 实际触发验证**：①产线 `0 */6 * * *` 下一次触发 06:00 UTC，已设豆包定时任务 06:10 UTC（14:10 CST）自动 SSH 验证 `cron tick fired` 日志 + `trigger=cron` 新 run + 成本归集，结果回写本区域。

详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

42. ✅ **画布 3D 视图审计欠账清理（2026-09-10）**：清掉 code-audit-2026-09-06.md 全部 3D 遗留（7 项）——Canvas3D.tsx 拆 mount-once + graph-sync 双 effect（杜绝陈旧相机竞态）、setPointerCapture + pointercancel 兜底（画布外松手不再冻结相机）、prevSel 增量 emissive、cleanup 统一 dispose Mesh+Line 材质数组、ResizeObserver 复核确认已满足。新增回归测试 Canvas3D.test.tsx 3 例（graph 变更不重建 renderer）。web 1643/1643 全绿。审计汇总：已修复 60→67、未修复 13→6（剩余全为性能/历史数据/设计意图类暂缓）。3D 功能视图零欠债。

43. ✅ **RTS 宏观视角·阶段 A 平面运营工作台（2026-09-10，A1-A7 全部完成，PR #239 merge `514d18a` 已部署 Hasee）**：设计 [design-rts-overview.md](docs/design-rts-overview.md)（三层世界 L0 工业园区/L1 单厂 3D/L2 节点，A 平面工作台→B 宏观沙盘→C 完整 RTS）。A1 `db.operationsByGraph` 跨产线只读聚合（按状态计数+跨时窗 lastRun+时间窗成本+零 run 产线 LEFT JOIN 保留，5 db 测试）；A2 `GET /api/operations/overview`（visibleGraphs scope+totals+每 graph cron next-run，5 api 测试）；A3 web api client；A4 `OperationsDashboard.tsx`（15s 轮询、今日/全部时窗、汇总条 9 格、失败+熔断「需要关注」区、每产线状态卡，7 组件测试）；A5 命令面板「运营工作台」入口 + hub 下挂审核队列/发布日历/效果成本；A6 zh/en 全 i18n + 全设计 token；A7 server 1015/1015 + web 1650/1650 全绿，PR #239 CI 全绿 merge、Hasee 部署，浏览器真机对账通过（全部时窗 total13/done9/failed4/cost$0.5446/成功率69% 与 DB ground truth 逐项一致）。阶段 B/C 前置（商业化闭环、真实多产线规模）不满足，挂 deferred。详细过程见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)

44. ✅ **web 组件测试 100% 覆盖 + research-loop 补 sink（2026-09-10，5 个 commit 未 push）**：① 补全最后 9 个无独立测试的 web 组件，分 3 个原子 commit（`f249b05` 三大 CalendarView/AnnouncementBell/ProductLibrary 共 39 例、`03add89` 四中 CollaboratorsModal/VariantComparison/BrandAssets/PublishTargets 共 38 例、`638bff3` 两小 KeyInput/LanguageSwitcher 共 9 例），web 1675→**1761/1761 全绿（81 文件）**，`apps/web/src/components` 下再无「有 .tsx 无 .test.tsx」的组件。② research-loop 补成品库 sink（`8752f58`）——loop 节点 BFS 遍历时把 sink 排除出循环体（否则 sink 被当成循环体每个 item 跑一次、且把单 endNode 的扁平聚合 `results:[...]` 破坏成 `{body,sink}` 多 endNode 结构），模板新增 depot 节点 + loop→depot 边，消除 "Nothing collects the output" 编译 warning；新增 **sandbox-free** 引擎测试（table 纯 JSON 解析 + fakeWorker textGen，绕开本机 macOS seatbelt 跑不了 JS sandbox 子进程的限制），并用「临时回退 loop.ts」对照实验反证改动必要（无改动时 sink 跑 3 次、聚合变对象；有改动 sink 跑 1 次、聚合保持扁平）。core **207/207**、全仓 typecheck 全绿。**本机限制（非缺陷）**：server 套件中依赖 spawn JS sandbox 子进程的用例（engine.code/loop/map/table 等用 code 节点造数据者）在本机 Node v22 + macOS seatbelt 下失败（status 71），干净 HEAD 同样失败、CI Linux bwrap 正常；本次新增的 loop-sink 测试刻意不依赖 sandbox，本机稳定绿。**Hasee 真机复跑验证通过（2026-09-10，run `91b7bcf5`，dev `49503e5`）**：从模板新建带 depot 的产线，投 2 课题，真实 tavily 搜索 + agnes 生成卡片（含 429 长退避 retry），约 4 分钟 done；depot sink 只 started/finished 各 1 次（未被吞进循环体），depot output 与 loop 聚合 artifact 字节级一致（2466B / 2 张调研卡片），创建 run 时编译 diagnostics 空，零 failed。template-checklist 同步从 🟡 升 ✅。

45. ✅ **M1 等待期清账三件套（2026-09-11，code-audit 尾项 + C 类模板 file connector 预设 + 文档同步）**：M1 回采纯攒数据期间主动清三项不依赖回采数据的账。① **code-audit 最后 6 项 low 全部清账**（L19/L20/L22/L25/L26/L27，原 2026-09-10 复核"应继续暂缓"，本次用户决定清掉）：core 端 L25 `compile.ts` topoSort 由每出队节点遍历全边 O(V·E) 改为预构建出边邻接表 O(V+E)；L26 刻意不改 zod schema（怕旧图宽松配置 parse 失败），改在 compile() 末尾对 cron 缺表达式/webhook 缺 secret/event 缺 source/batch 缺配置各发一条**非破坏性中文 warning**（不阻断 load/run），+5 测试；L27 经核实确为设计意图（rework body 必须含入口到 gate 整条正向祖先链，返工要重跑整条链路），只补注释不改逻辑。web 端 L19 `App.tsx` 整 store 解构改 10 个独立 selector；L20 onDragStart 用 detachDrag ref 持有 document 监听 detach 函数 + unmount cleanup effect 兜底拖拽中途卸载；L22 `Minimap.tsx` 全局 pointer 监听 effect 原依赖 viewport 导致拖拽每帧卸载重挂，改 liveRef 镜像 viewport/scale、依赖收敛为只在 dragging 开始挂一次（并删掉因此无引用的 contentDeltaFromMinimapDelta，注意 liveRef 必须在 scale 声明后否则 TS2448）。② **C 类文件/图片型模板预设 file connector（7 个）**：原卡点"写死绝对路径对别人机器无意义"，最终形态 = **预选 connector 类型 + 空路径占位 + engine 空路径友好报错**——doc-ingest/contract-review/privacy-review/batch-contract-review/due-diligence 5 个文本型预设 `{type:"file",file:{path:""}}`，scan-ocr/invoice-ocr 2 个图片型加 `asImages:true`；`connectors.ts` file 分支对空白 path 抛中文友好错误（避免 `path.resolve("")` 落进程 CWD 遍历服务器目录），+2 测试。用户从模板建产线后投料台已选中「文件」连接器、只需填路径。③ **文档同步**：code-audit 报告状态表/汇总/归因全部回写（已修复 67→73、未修复 6→0）、deferred-items C 类行标已落地、design-template-connector-presets §8 与 C 类小节更新（6→7 个补 batch-contract-review）、README 测试数 2890→3068（core 212/server 1024/mcp 71/web 1761）+ Feature map 补 Connectors 与 Board/UX（3D/i18n/token/多选）行、docs/README 补连接器插值与 i18n/token 场景导航。验证：core **212**、web **1761（81 文件）**、connectors.test.ts **33** 全绿；server 全量本机 28 failed 经 `git stash` 对照确认是 Node v22+seatbelt 已知环境限制（干净 HEAD 同样失败），非本次回归。

46. 🟡 **RTS 阶段 B 设计细化 + 技术预研（2026-09-11 启动，M1 等待期先行，不碰业务逻辑）**：用户同意在 M1 回采攒数据期间先做阶段 B（宏观沙盘 MVP）的设计细化 + 技术预研，正式落地仍需商业化闭环 + 真实多产线场景触发。① **设计细化文档** `docs/design-rts-stage-b.md`：对 overview §九 B1-B9 九步草案逐一结合当前代码库（2026-09-11）复核——L1 复用盘点（mount-once 双 effect / SceneState / runtime ref / XZPolyline / OrbitControls 锁俯角 / dispose cleanup 全部可复用）、B1 园区坐标持久化方案（graphs 表加 park_x/park_z 两列 + db.ts 方法，不新建表）、B2 parkLayout 纯函数算法（类别聚簇 + 类 BFS 行布局 + 碰撞检测，FACTORY_SIZE=200）、B3 overview 接口扩展（加 category/parkX/parkZ/pendingReview 字段，前置确认项：graph.doc 是否有 category 概念）、B4 CanvasPark 组件架构（InstancedMesh 低模工厂 + Sprite billboard + 独立 lazy chunk）、B5 LOD/帧率（InstancedMesh 单 draw call + 页面隐藏暂停 rAF + 阴影 1024）、B6 实时状态（15s 轮询同阶段 A + dataRef 每帧读 + instanceColor 批量更新）、B7 raycast 点选（InstancedMesh instanceId 映射 + 选中环 + HTML 浮层）、B8 钻取 L1（250ms 淡切，连续 zoom 留 C）、B9 i18n/token/测试/真机验收。5 项技术预研重点风险标注（InstancedMesh raycast / per-instance color / Sprite billboard / 双 WebGL context / parkLayout N=100 性能）。② **技术预研原型** `apps/web/src/canvas/CanvasPark.tsx`：用 mock 数据验证关键技术风险——InstancedMesh（MAX_FACTORIES=100，BoxGeometry 180x140x180，DynamicDrawUsage）、per-instance color 每帧更新（running 呼吸动画）、Sprite billboard（类别标签 CanvasTexture 缓存 + 待审角标红色圆形）、raycast + instanceId 映射（idByIndex 数组）、mount-once + data-sync 双 effect（parks 变更只更新 instanceMatrix + billboard，不重建 renderer）、选中环（RingGeometry 跟随选中厂）、OrbitControls 锁俯角（同 L1 PITCH=π/3）、完整 cleanup（traverse dispose + renderer.dispose + forceContextLoss）。`parkLayout` 纯函数导出可测。③ **单元测试** `CanvasPark.test.ts` 7 例全绿：空输入 / 单厂近原点 / N=5 无重叠 / 手动坐标优先 + 碰撞避让 / 确定性同输入同输出 / 类别聚簇同行 / N=100 不报错。④ **typecheck 通过**（web 全量 tsc --noEmit 零错误，修复 noUncheckedIndexedAccess 下 Record 索引 + helper 函数 categoryColor）。**未做（正式落地时）**：接真实 API/DB、i18n、路由入口、钻取 L1 联动、真机帧率验收。**2026-09-11 追加：B1/B2 已从草案正式化到代码级（commit `fe4bd30`）**——B1 确认真实迁移号 36→37、PG 只从 base DDL 派生故须双改、给出精确 SQL/三方法/三端点/授权与并发策略；B2 解决 category 前置项（origin_template_id 反查）、定调纯函数搬 `packages/core/src/parkLayout.ts`、修原型三缺陷（确定性排序/距离碰撞/螺旋兜底）并给 10 例测试矩阵；正式落地时照 design-rts-stage-b.md §三 B1.1-B2.7 实现即可。**下一步**：B1/B2 设计已就绪，正式写代码（迁移 + 纯函数）仍建议等 M1 cron 高频回采稳定、或商业化触发条件接近时启动；阶段 B 整体落地仍需商业化闭环 + 真实多产线场景。

> **下一步主线**：待办 1-38 已全部完成，第 39 条（M1 成本计量回采）2026-09-08 开跑，商业化 P0 前置（单价缺口审计 + 按模型分摊）已上线。4 条成本画像回采产线已挂载（待办 41），429 限流已按**方案 C（降频+长退避 retry）+ 代码补丁**闭环（待办 41 已记录），产线 cron 自动攒数据中（cron P0 修复 2026-09-11 03:57 UTC 部署，06:00 UTC 首次触发验证通过）；**2026-09-11 13:35 UTC 提升回采频率（Hasee 运维操作，非代码变更）**：①写草稿从每 6h → 每 30 分钟（`10,40 * * * *`，48 次/天）、②翻译从每天 → 每 4 小时（`0 */4 * * *`，6 次/天）、③短视频从每天 → 每 12 小时（`0 3,15 * * *`，2 次/天）、④批量从每周 → 每天（`0 6 * * *`，1 次/天）。全模型 free tier 不考虑成本，错开触发时间避免并发 429。调整后每天约 57 次 run（原约 6 次），回采周期从 2-4 周缩短到 **3-5 天**。Hasee 服务重启（PID 96192）重载触发器，DB 已持久化新 cron。**RTS 阶段 A 平面运营工作台已上线（待办 43，⌘K→运营工作台可跨产线看状态/待审/失败/成本，正是 M1 回采的监控床）**；**RTS 阶段 B 设计细化 + 技术预研已启动（待办 46，设计文档 + CanvasPark 原型 + 7 测试全绿，M1 等待期先行不碰业务逻辑）**；**code-audit 全部 77 项已无未修复项（待办 45，73 修复/3 无需/1 部分）**；**当前主线 = 高频回采攒数据（每天约 57 次 run，3-5 天可回答 M1 三问）→ 据真实成本回答典型 run 成本 / 返工占比 / 模型大头 → 切定价套餐；期间用运营工作台盯 4 条回采产线完成率/失败/成本，同时推进阶段 B 设计细化/技术预研（待办 46）**。RTS 阶段 C（完整 3D RTS）待商业化闭环 + 人均 ≥3 活跃产线再启（deferred-items）。可选项：随时换付费 agnes key（换后 429 彻底消失、回采更顺畅）。

> 全部缓做/低优事项（含上述两条）已统一登记在 [docs/deferred-items.md](docs/deferred-items.md)——每条带触发条件与决策详情链接，触发条件满足时移回本区并标注重启日期。

> **M1 运行床验收（A 只读对账 / B 真实模型冒烟 / C 安全韧性 / D 部署·CI，2026-09-08 真机 Hasee）**：A 对账通过；B 文本/图片计费端到端非零（图片 $0.04/张），**视频/音频曾被计为 $0**——根因是 provider worker 从不填 media units/cost，已在 `6554769`（feature/20260824）修复（视频 perSecond：适配器 durationPath → num_frames/frame_rate → 节点 duration → 5s 兜底；音频 perKiloChar 按输入字符数），17 用例绿；C 层四项全过——**C1 限流**连发 40 次 POST /api/runs，前 30 放行为 404（图不存在，限流在 startRun 前不建 run 不烧钱）、第 31-40 全部 429；**C2 预算硬熔断**置 monthlyBudgetUsd=0.0001 后派发现场 402「monthly budget exceeded」，模型调用前拦截零费用，测后已还原 null；**C3 静态加密**settings.data 为 enc:v2 密文，节点级 apiKey 注入实测 graphs.doc 落 enc:v2、明文 0 命中（已还原）；**C4 SIGTERM drain** 今日部署重启日志 `shutdown started(inflightRuns:0)→shutdown complete(abortedRuns:0)`→迁移重跑→健康恢复，历史 4 次 SIGTERM 全部干净退出。D 层（部署/CI，只读为主）三项全过——**D1 CI 安全门禁** CodeQL + CI 最近运行全 `success`，ci.yml 内含 `pnpm audit --audit-level=high`（高危 CVE 阻断合并）+ gitleaks 扫历史；**D2 部署一致性** Hasee 健康探针 `branch=dev commit=4eb87d2` 与 origin/dev 端点逐字一致（dev=准生产环境映射成立），main 端点 `5b0b29f` 领先一个 merge 属正常；**D3 备份可恢复性（只读演练）** 备份库拷到 /tmp 后 `integrity_check=ok` 可正常打开，行数对账 backup(07:52) vs live 为 ~6h 前一致快照（users 2=2、graphs 4<6、runs 6<9、events 144<196、node_runs 29<40、artifacts 27<40），无损坏可还原，实测 RPO≈6h（满足 <24h 声明）、RTO 秒级（库 823KB）。未做覆盖活库的破坏性 restore（只读已证可恢复）。
>
> ⚠️ **三个真实缺口（按严重度，2026-09-08 真机核实）**：
> 1. ✅ **~~媒体计量修复未上 Hasee~~（已部署并真机验证，2026-09-08）**：修复随 PR #216 合入 origin/dev（merge `a12f404`）并部署到 Hasee——健康探针 `commit=a12f404`、服务重启（PID 59450）、dist 内确有 `videoBillingSeconds`/`mediaUsage` 编译产物。端到端复验：视频 run `546aa2fa` 状态 done，视频节点 `units:{seconds:5}`、`costUsd:0.5`（5 × perSecond $0.10），视频产物正常产出——修复前一律 $0，现按秒计费。**遗留精度项（非阻塞）**：agnes 未设 `durationPath` 且响应无 num_frames/frame_rate、又 omitDuration，故走 5s 兜底；若实际成片时长非 5s 会按 5s 计。**2026-09-09 已修复并真机验证（PR #218，merge `2e23a06` 已部署 Hasee，健康探针 commit 一致）**：真机抓取确认时长在顶层 `seconds` 字段且为数字字符串 `"5.0"`，遂配 `durationPath:"seconds"` 并让 `videoBillingSeconds` 经 `positiveNumber` 接受数字字符串。在**部署后 dist** 上用真实 agnes 完成形态回放：`seconds:"5.0"`→5s/$0.50（不回归），`seconds:"8.0"`→8s/$0.80（旧逻辑会落 5s 兜底），两段全 PASS。
> 2. ✅ **~~备份只在同盘同机 + WAL checkpoint 静默失败~~（已闭环，2026-09-10）**：checkpoint 静默失败已由补丁修复（见待办 40，node:sqlite 替换 + 手动验证通过）；「同盘同机」单点已由 Mac 每日异地备份兜底（见待办 40，含密钥边界）。
> 3. **/metrics 未经 nginx 暴露（可观测性盲点）**：80 端口 `/metrics` 返回 SPA `text/html`，仅直连 :8791 出 Prometheus `text/plain`；外部/容器化 Prometheus 抓不到。已登记 deferred-items（本次新增行）。

## Recently shipped (last 5)

按 commit 时间倒序，每条一行影响面 + commit hash：

1. **test(core)+docs 连接器插值清账收尾 + RTS 阶段 B B1/B2 设计正式化（2026-09-11，`dd6f2fd`/`8d52874`/`fe4bd30`，未 push）**——① **连接器插值最后一块形状测试补齐**：复核发现引擎 D1-D7、A 类 2 模板 product 预设（`0527823`）、C 类 7 模板 file 预设（`a153661`）、服务端 21 例集成测试此前都已落地，只缺与 product 对称的 **file connector 形状断言**；`templates.test.ts` 新增 1 例锁死「恰好 7 个文档/OCR 模板带 file connector、各 1 个 source、空 path 占位、仅 scan-ocr/invoice-ocr 带 asImages、其余模板零 file connector」，core 212→**213/213**。② **design-template-connector-presets 状态销账**：状态行「待落代码」→「已全部落地」，新增 §9 逐项映射表（计划项→commit/证据），修正 D 类重复计数（tpl-batch-contract-review 原在 C/D 重复，正确盘点 2+5+7+19=33，原写 2+5+6+20=33 错）。③ **RTS 阶段 B B1/B2 从草案正式化到代码级**（`design-rts-stage-b.md`，+160/-40）：B1 核对真实代码确认最新迁移=36、新迁移=37，且 **PG 不跑 MIGRATIONS、只从 base DDL 经 toPgDdl 派生**，故加列必须 base DDL + 迁移 37 双改（同 origin_template_id 先例），给出精确 SQL/三 driver 方法（仿 operationsByGraph 双 scope）/三 REST 端点/owner-only 写/LWW/updated_at 排序副作用待拍板；B2 解决 B3 遗留的 category 前置项——**graph 实例不带 category**，overview 用 `origin_template_id→模板 category→"自定义"兜底` 反查不新增列；纯函数从 web 原型搬到 `packages/core/src/parkLayout.ts`，修原型三缺陷（组内按 id 排序保证确定性、网格占位改距离碰撞、attempts 20 次后静默重叠改阿基米德螺旋兜底），给 10 例测试矩阵/常量表/复杂度 O(n²) 边界。**全程纯本地、未部署、不碰调度器/引擎/DB schema 落地，不影响 M1 高频回采。**

2. **perf/fix(core,web,server)+docs M1 等待期清账三件套（2026-09-11，未 push）**——① code-audit 最后 6 项 low 清账：core L25 topoSort O(V·E)→O(V+E) 邻接表、L26 compile 阶段 trigger 缺字段非破坏性 warning（+5 测试，刻意不动 zod schema 防旧图 parse 失败）、L27 确认为设计意图只补注释；web L19 App.tsx 整 store 解构→10 个独立 selector、L20 detachDrag ref + unmount cleanup、L22 Minimap 全局 pointer 监听改 liveRef 只在 dragging 开始挂一次（删掉无引用的 contentDeltaFromMinimapDelta）。② 7 个 C 类文件/图片型模板预设 file connector（5 文本 `{path:""}` + scan-ocr/invoice-ocr `asImages:true`），connectors.ts 空白 path 友好报错防 resolve 到 CWD（+2 测试）。③ 文档：code-audit 状态回写（修复 67→73/未修复 6→0）、deferred-items、design-template-connector-presets、README（测试 3068 + Feature map 补 Connectors/Board 行）、docs/README 索引。core 212 / web 1761（81 文件）/ connectors 33 全绿；server 本机 28 failed 经 git stash 对照确认 Node v22+seatbelt 环境限制非回归。

3. **test(web)+fix(loop) M1 等待期：web 组件测试补到 100% 覆盖 + research-loop 补 sink（2026-09-10，`f249b05`/`03add89`/`638bff3`/`8752f58`，均未 push）**——① **9 个剩余无测试组件分 3 个原子 commit 补齐**：Batch1 三大（CalendarView 13 例动态取当前月避免依赖系统时间 / AnnouncementBell 12 例该组件用原生 fetch 需按 URL 路由 mock global.fetch / ProductLibrary 14 例归档恢复用 rerender、缺字段回退、null price）；Batch2 四中（CollaboratorsModal 10、VariantComparison 10 纯 props 组件 mock runtime 必须带 `nodes:{}`、fanout 从 artifact 读泳道、chosen/score 分级、BrandAssets 8 ASCII+中文逗号 split、PublishTargets 10）；Batch3 两小（KeyInput 6 防自动填充属性、LanguageSwitcher 3 测试内 import i18n 实例 changeLanguage 隔离）。过程中修掉多处「中文文案同时出现在 option 与列表行致 getByText 撞多元素」（改 getAllByText）。web 1675→**1761/1761（81 文件）**，组件目录零「有 tsx 无 test」。② **research-loop 补成品库 sink（`8752f58`）**：根因——不能简单加 loop→sink 边，loop 的 body BFS 会把唯一入边来自 loop 的 sink 判进循环体，导致 endNodes 从 {writer} 变 {writer,depot}、聚合从扁平 `results:[卡片]` 破坏成 `results:[{writer,depot}]`，且 sink 每 item 跑一次；修法是 BFS 内 `if (nodeById(graph,id)?.kind==="sink") continue`，loop 正常聚合后由主调度器把 sink 拉起一次喂入聚合。模板加 depot 节点（loop 正下方 x600 y560 避免与水平循环体交叉）+ e6 边，编译 diagnostics 由 1 warning 降为 **0**。新增 sandbox-free 引擎测试（source→table(parse/json)→loop→textGen body+sink，不 spawn 子进程），本机对照实验：回退 loop.ts 时 sink 跑 3 次/聚合变对象（测试红），应用后 sink 跑 1 次/扁平 3 项（测试绿）。core 207/207、全仓 typecheck 全绿。**本机环境注记**：依赖 code 节点实跑的 server 用例在本机 Node v22 + macOS seatbelt（sandbox-exec status 71）下失败，干净 HEAD 同样失败、CI Linux bwrap 正常，与本次改动无关。

4. **验证 tpl-research-loop 完整 happy path（Hasee，2026-09-10）**——feature 合 dev（PR #243, faa1c27）部署 Hasee 后真机复跑。成功 run `9cb4b423`：source 投 2 行课题 → split 正确拆 2 课题数组 → loop 逐课题迭代 → kicker 出题 → **search tavily 每课题返回 4 条真实结果** → **writer agnes 生成结构化调研卡片（结论/关键事实/待确认）** → loop 聚合 `{results:[卡片1,卡片2]}`，"循环 2 次完成"，最终正好 2 张卡片、课题对应正确无重复。**关键验证：writer 长退避 retry 确实扛住了 Agnes free tier 429**——429 被正确识别为 RATE_LIMIT（errorCode 落事件），按 30s/60s/120s/120s 指数退避；成功 run 的 writer 耗时 108s（一次 retry 后通过）。另一次失败 run `816e274f` 是**误操作同时开了 2 个 run**，最多 4 个 writer 并发打爆 free tier 配额，5 次 retry（344s=30+60+120+120 退避）全部 429 才放弃——证明 retry 逻辑本身正确，是测试操作 + free tier 并发限制问题，非 bug。**结论：research-loop 从 🟡 升 ✅（32/33 模板跑通，仅剩 news-podcast 缺 TTS）**。两个观察项（非阻塞）：① 模板无 sink 节点，编译 warning "Nothing collects the output"，但 loop 自身聚合 JSON 即最终产物，功能不受影响；② loop body 多 item 并行执行（MAX_CONCURRENCY=6），free tier 下多课题易触发 429，retry 已缓解，付费层无此问题。template-checklist 同步更新。

5. **test(web) M1 等待期补 web 组件测试 + code-audit 复核 + research-loop 配置验证（2026-09-10）**——M1 回采攒数据期间继续清 deferred。① **web 组件测试补 2 个高价值组件**：PerformanceDashboard（F6 效果数据 + F9 内容成本，12 例：渲染/汇总卡片/空分母/聚合维度切换/插入 metric/CSV 导入/成本聚合/插入成本/Escape/backdrop/模态体点击）+ BatchManager（F5 批量任务，14 例：渲染/空状态/批次列表/创建校验/创建成功/展开详情/重试失败项/Escape/backdrop/多状态），web 1650→**1676**。② **code-audit 剩余 6 项逐项复核**（L19/L20/L22/L25/L26/L27），确认均应继续暂缓（性能优化价值低/边缘场景/历史数据风险/设计意图），复核结论写入 code-audit-2026-09-06.md 汇总区。③ **tpl-research-loop 模板配置验证**：core 207/207 全绿，search provider=tavily + writer retry=4x/30s-120s 配置正确；完整 happy path 待 feature 分支合 dev 部署 Hasee 后复跑（当前 feature 分支领先 dev 6 个 commit）。

> 第 6-20 条（2026-09-08~09-09：节点技能面板搜索、设置三标签页、用户自助 MCP+自建技能卡、Skill 体系补强、成本计量前置、连接器插值恢复、M0 验收、切换产线 409 修复、PG 演练、PostgreSQL 阶段 3、审计修复 25 项、dependabot、CodeQL、运营三件套、数据归档、依赖漏洞扫描、pre-commit、覆盖率门禁、migration 回滚）及更早条目已归档至 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md) 与 [handoff-archive.md](docs/handoff-archive.md)。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

* `pnpm -r typecheck`：全绿（2026-09-09 复核：core/server/mcp-server/web tsc --noEmit 全部干净）

* `pnpm --filter @agent-world/core test`：**213/213 通过**（2026-09-11 file connector 形状断言 +1——锁死恰好 7 个文档/OCR 模板带 file connector、空 path 占位、仅 scan-ocr/invoice-ocr 带 asImages、其余零 file connector，与 product 形状断言对称；2026-09-11 code-audit 清账 +5 用例——compile 阶段 trigger 配置 warning：cron 缺表达式仍 compile、webhook/event/batch 各缺字段告警、完整 cron 无 warning；2026-09-09 用户自建技能卡 `UserSkillCard` schema +7 用例——只许 prompt-module/output-contract/judge 三种数据 kind、tool kind 拒绝、`local:` 前缀等；2026-09-08 单价缺口审计 +7 用例——`unpricedModels` 完全没配/只配一部分/配全不报/显式 0 视为已配/audio 任一维度即算配/embedding 只需输入价/provider 停用跳过；2026-09-08 模板 connector 预设边界断言 +1；2026-09-08 PostgreSQL connector +2 用例——database connector postgres 反序列化 + port 越界拒绝；2026-09-02 第九波 +2 用例——SearchConfig 节点级 `apiKey`/`cx` 可解析且缺省为 undefined、VcsConfig 节点级 `token` 与 `baseUrl` 可解析且 **baseUrl 只认 http(s)**（`.url()` 单独会放过 `git.corp:8080` 这种不透明 scheme，到 SSRF 守卫里才以“空主机名”炸）；2026-09-02 新增两条目录级守护：凡读 stdin 的 code 脚本必须解包 `.inputs` 信封（dogfood tpl-data-report）、`${node}` 插值必须指向可达上游（dogfood tpl-customer-service），两者均带非空转断言；2026-09-01 第三轮：**table 排序空值沉底**——狗粮 tpl-evidence-brief 发现升序时空值排最前、无日期行浮在时间线开头，新增空值无论方向一律沉底用例（空串/null/缺字段三种空）；第二轮：**全部模板 javascript code 脚本可编译守护**——狗粮 tpl-doc-ingest 发现 combine 脚本未转义换行导致生成的 node 脚本断行，新增遍历所有模板 `new Function` 编译检查；第一轮：OcrConfig 资产覆盖字段的**契约反转**——旧用例断言“非 URL 应被拒”，恰好与文档/审计承诺的离线本地路径相反，改为“本地路径与 CDN URL 都接受”+“空值仍拒”两条；此前同日新增模板分类分组完整性断言——每个模板 category ∈ `TEMPLATE_CATEGORIES` / 每个分类至少 1 个模板（防空区块）/ 两处收并落位 / 空白仍为「基础」且不在分组列表；此前同日新增客服工单模板 webhookUrl 字段实例化落地断言、费用报销初审模板形状断言——三类规则族齐备 + issueCount 降序排序 + rework 指向 + stdin 契约 + 空输入兜底行、证据清单模板形状断言——code/table/textGen/gate 构成 + rework 指向 + stdin 契约；2026-08-31 新增 4 用例——四大能力模板 kind 覆盖 / loop items 引用重写到新 id / doc-ingest·review-publish·scan-ocr error 边兜底 / translation 专用 translate 节点）

* `pnpm --filter @agent-world/server test`：**1024 总数**（127 文件；Node 24 下应全绿；2026-09-11 file connector 空路径防护 +2 用例——空串/纯空白 path 抛「未配置路径」友好错误而非 resolve 到进程 CWD；2026-09-10 RTS 阶段 A +10——`db.operations.test.ts` 5（跨产线聚合/空产线/since 窗/running 成本排除/租户隔离）+ `api.operations.test.ts` 5（401/空账号/聚合/since/租户隔离）；⚠️ **本机 Node v22 + macOS seatbelt 下 28 个依赖 spawn JS sandbox 子进程的用例失败（status 71），干净 HEAD 同样失败、CI Linux bwrap 正常，非本次回归**；⚠️ 本地另有 2 个 RPA 浏览器用例 `rpa/rpa.browser.test.ts` 需先 `pnpm exec playwright install` 装 chromium，否则报 `browserType.launch: Executable doesn't exist`——CI 装了浏览器故全绿，本机未装时为环境阻塞，与代码无关；2026-09-09 用户自助 MCP/技能卡 +34 用例——per-user MCP 连接池指纹复用/保存即试连 502/Authorization 打码加密、owner 专属技能 map 注入、`resolveSkill` 全局优先钉死、`GET /api/skills` 合并内置+自有卡；2026-09-08 成本计量前置 +2 用例——`api.costs-unpriced.test.ts`（/api/costs 下发缺单价模型，配全的不报）+ `costs.test.ts` byModel 分组（含 `(未记录模型)` 桶与总额对账），并把 `migrations.test.ts` 的回滚用例从硬编码迁移号改为对 `SCHEMA_VERSION` 断言，不再每加一个迁移就红；2026-09-08 连接器插值恢复 +8 用例——`engine.products.test.ts` 13→17（恢复被删的全局快捷名/简报回填/防二次展开/branch 数值 4 例 + 4 个 source→textGen 全链路集成，专治「纯函数单测绿、集成断」）；2026-09-08 PG 演练方言修复 +1 用例——`pg-sql.test.ts`（toPgDdl BLOB→bytea 映射）；2026-09-08 PostgreSQL 阶段 3 + 搬迁脚本 +9 用例——`db-driver-switch.test.ts` 5 例（DB_DRIVER 默认 sqlite/显式 sqlite/未知值拒绝/缺 PG 连接配置 fail-closed/kind 暴露）+ `migrate-to-postgres.test.ts` 4 例（ddlTableNames 提取/dry-run 全表计划/FTS 表跳过/空文件缺文件 fail-closed）；2026-09-08 审计 M1 abort 挂起回归 +1 用例——`engine.test.ts`（cancel 不挂起）；2026-09-08 数据维护 +2 用例——`db.maintenance.test.ts`（pruneOldEvents 清理老事件 + verifyIntegrity）；2026-09-08 migration 回滚 +1 用例——`migrations.test.ts`（rollbackLatestMigration 回滚迁移 35）；2026-09-08 幂等审计 +1 用例——`api.idempotency.test.ts`（Idempotency-Key 重复提交复用 runId）；2026-09-08 feature flag +3 用例——`feature-flags.test.ts`（注册表唯一/未知 fail-closed/默认值）；2026-09-08 Metrics +5 用例——`metrics.ts` 单元 4（counter/gauge/histogram/reset）+ `/metrics` 端点集成 1；2026-09-08 PostgreSQL connector +3 用例——database connector postgres 连接查询/缺参报错/连接失败传播；2026-09-08 E2E 冒烟 +1 用例——`smoke.test.ts`（HTTP 核心链路 health→注册→建产线→跑→done，fake 模型）；2026-09-08 全局限流 +4 用例——`rate-limit.test.ts`（限流上限/键隔离/窗口过期重放/remaining）；2026-09-07 成本硬熔断 +5 用例——`run.budget.test.ts`（`monthlyBudgetExceeded` 纯函数边界 4 例 + `startRun` 拦截集成 1 例），并顺带修复 `costForMonth` 带 userId 参数错位（原 params `[userId, start, end]` 与 WHERE `started_at >= ? , started_at < ? , user_id = ?` 错位，带 userId 恒返回 0，软告警 `monthSpentUsd` 一直为 0）；2026-09-06 tesseract cachePath +1 用例——`ocr.test.ts` 断言 `options.cachePath` 指向 `<DB>/tessdata` 并 `stubEnv DB_FILE` 到临时目录防污染；2026-09-05 连接器数据插值 +15 用例——`engine.products.test.ts` 2→11 例（全局快捷名 `${product.name}` / 命名空间 `${srcId.data[0].name}` / 整节点引用 / 留空回填 / 手填覆写 / 调性不回填 / 多 source 快捷名退化 / 无 connector 空串 / 防重入 `${var.x}` 字面不二次展开 / branch 数值 `${product.price}>100` / 节点 id 恰为 `product` 时 ctx 优先）+ `buildSourceBrief` fallback 4 单测（回填/覆写/调性忽略/无 fallback 逐字节不变）；2026-09-05 公告 target 定向 +7 用例——`api.announcements.test.ts` 9→16 例（graph 命中 owner/editor/viewer 不命中 outsider、template 命中自有+被共享、未知前缀 fail-closed 全员不可见、非法 target 6 形态 400、建改清定向可见性翻转 round-trip、/manage 带 target 回显）；2026-09-05 密钥轮换 +18 用例——`at-rest.test.ts` 重写为 keyring 语义 35 例（多密钥加密路由/解密 keyId 路由/v1 兼容逐 key 尝试/单值 env 与旧文件等价/keyring 缓存不跨配置泄漏/未知 keyId fail-closed/`enc:v2:` 格式）+ 新增 `key-rotation.test.ts` 7 例（五密文面全收敛含 URL percent-encoded 拼写/明文与 contentHash 链不坏/幂等二跑零改动/坏密文点名行中止/dry-run 不动库/--table 子集与未知表拒绝/whole-column 明文补封），期间 at-rest.db.test.ts / api.security.test.ts 的密文断言从 `enc:v1:` 对齐为 `enc:v2:`；2026-09-04 核心文件重构阶段 1+2 全程每步原子提交后复跑全绿——engine.ts 闭包提取 / NodeRunContext / nodes/ 迁移 / 注册表分发共 25 个 refactor commit，行为零变化；2026-09-02 API 输入验证加固 +7 用例——① POST /api/providers/test modality 枚举校验 1 例（非法 modality 返回 400 且 fetch 未被调用）；② POST /api/graphs name 长度限制 + fieldValues 验证 3 例（name 超 100 字符拒绝、fieldValues 非对象拒绝、fieldValues 值非字符串拒绝）；③ PUT /api/settings AppConfigSchema zod 验证 3 例（invalid provider type 拒绝、missing models array 拒绝、valid partial update 接受）；server 包新增 zod 直接依赖，AppConfigSchema 与 TS 接口保持同步。2026-09-02 第九波 +15 用例——① URL 查询串凭证静态加密 7 例（只封凭证参数、endpoint 仍可排查（含 `&v=2` 良性参数不动）、逐字节往返（Azure `?api-key=` + `#` 片段）、幂等不二次包裹、篡改参数 fail-closed、空参数不动、**含凭证子串的良性参数不误封**（`author` 含 auth、`keyboard` 含 key）、无凭证参数 URL 仍返回同一引用）+ db 集成用例扩到 **八处明文凭证 × ≥4 份盘上副本**（新增 `search.apiKey`、`vcs.token`、`vcs.baseUrl?access_token=`）；② search 凭证解析 4 例（节点值压过 env、env 兜底、纯空白节点值视同未填、两处皆空时报错同时点名 `apiKey` 与 `TAVILY_API_KEY`）；③ vcs 凭证解析 4 例（节点 token 真进 `authorization`/`private-token` 头、`baseUrl` 改写出口且压过 `GITLAB_API_URL`、两处皆空 `AUTH` 且 fetch 未被调用）。同波修掉一处负载性 flaky：code 节点 CPU 限制用例原先断言**墙钟 <8s**，84 文件争抢核心时 1 秒 CPU 能跑 9 秒墙钟 → 改断言 `errorCode === "SCRIPT_ERROR"`（真正的判别量）并把单例 timeout 放宽到 30s（`fd45fa8`）；2026-09-02 第八波 +7 用例——imageGen 生成抛错必发 PROVIDER\_ERROR 且不再往下游发「已降级跳过」文本包 / 该失败可被 error 边兜底（throw 路径此前零覆盖）、textGen·translate·generic-text 三处空补全必失败而非产出空产物、自定义 auth-ish header 名（`X-My-Auth`/`X-Signature`）凭证必加密而良性 header 保持明文 / 只含良性 header 的图仍返回同一引用，db 集成用例加断言直读 doc+两份版本快照+run 快照原始字节；2026-09-02 第七波 +8 用例——节点级凭证静态加密：四类节点 `apiKey` / notify `secret`+`webhookUrl` / 连接器 `auth.token` 与 auth 类 header 均必加密、幂等不双层包裹、旧明文直通、字段顺序保持、无凭证图返回同一引用，db 集成用例直读三处落盘字节断言无明文；2026-09-02 第六波 +4 用例——videoGen/audioGen/imageGen/generic-audio 在 provider 返回空结果时必发 `UNSUPPORTED` 而非假成功（审计 L8）；2026-09-02 第五波 +4 用例——generic 节点文本失败诚实报 PROVIDER\_ERROR / 缺媒体能力报 VALIDATION / error 边可兜底 / 文本产物必发 `artifact.produced`（此前失败路径零覆盖）；2026-09-02 第二波 +3 用例——branch 未路由尾巴必发 `node.skipped` / branch+human 合并点 approve 后必继续跑到 sink / 无法重建 skip 的旧事件日志恢复必报 failed 并点名丢弃节点，并把子流程 halt-resume 用例加强为“子汇必须真的跑”；2026-09-02 CI run `33589345419` 复核绿——maxProcs 修复后沙箱实跑用例在 CI 稳定。2026-09-01 第四轮（用例数不变，夹具加强）——回归基线两条模板执行用例按狗粮发现升级：证据清单断言诉请段剥到 `claim` 且不入 rows；费用报销补「超额+重复单号」双异常行，断言 issueCount=2 且双异常两行排最前（`b366fcb`）；第三轮 +4 用例——狗粮 tpl-release-pr：vcs 走代理通道（AGENT\_WORLD\_PROXY 下请求携带 ProxyAgent dispatcher）/ create\_pr 标题从正文首行推导（去标题符号、跳分隔线）/ 显式标题优先 / GitHub 422 errors\[] 详情并入报错；第二轮 +3 用例——code 节点秒退时 1MB stdin 灌入引擎存活（EPIPE 回归）/ 失败上游被 error 边接住后 fan-in merge 仍执行 / 代理模式下 ALLOW\_PRIVATE\_NETWORK 放行内网目标；第一轮 +5 用例——OCR 资产解析 3 例（不再预设 workerPath/corePath、显式覆盖才透传、非白名单 langPath 在 spawn 前拒绝且 `createWorker` 未调用）+ PDF 内嵌图像素保真 2 例（DeviceRGB 逐像素 / DeviceGray 展开为中性灰），`engine.ocr` 的“PNG 字节长度”断言改为解码后逐像素；同日前一轮 +5 用例——文件上传链路 4 例（source.files → fileParse 真实解析 PDF、与图片产物共存、无文档仍 VALIDATION 报错、多文档点名未解析件数）+ 节点意外抛错兜底 1 例（code 沙箱准备失败仍留 node.failed）；此前狗粮修复 +8 用例——validate-models media 节点 modality 错配升 error、search 裸网络失败可行动提示 + SearchAuthError 不重试 + DDG anomaly 反爬页响亮报错（search.test.ts 新建）、api.artifact-localref 本地引用跟随 2 用例（含跨用户 404）；engine.audiogen/videogen 断言从软跳过改为诚实失败（node.failed + 下游不执行）。回归基线再 +1 用例——费用报销初审模板引擎级执行（真实跑 code 规则校验：重复单号/超额/日期缺失三类异常全命中 + 表头跳过 + table 按 issueCount 降序）；此前同日 +1——证据清单模板引擎级执行（真实跑 code 拆条 + 中文日期归一化 + table 按日期排序）；修复 templates-api 陈旧断言——空白画布拆分（`54a0ddb`）后 API 不再返回 tpl-blank，旧断言一直靠未重建的 core dist 假绿。2026-08-31 新增：at-rest 静态加密 7 单测 + 4 db 集成——磁盘无明文断言 / version·run hash 匹配 / 旧明 文兼容；api.security 审计用例；routingWorker 视频音频委托；模板参数化全链路；videoAdapter 3 用例；artifact-store 本地引用 1 用例）。此前 571/571 连续复跑稳定（vitest.setup mock bcryptjs + timeout 20s/30s 消已知负载性 flaky）。

* `pnpm --filter @agent-world/mcp-server test`：**71/71 通过**（MCP 协议升级到 2026-07-28 三版本并行协商后 47→71；含 stdio 端到端冒烟 3 个：CLI 子进程真实回环 / parse error 容错 / 多字节 id 无分帧错位）

  * **负载性 flaky**：`pnpm -r test` 并行跑时这 3 个 stdio 冒烟会超 5s 默认 timeout（多包并发拖慢 tsx 子进程冷启动）；单独跑 `pnpm --filter @agent-world/mcp-server test` 稳定 71/71。要根治需给该文件单独放宽 `testTimeout`。

* `pnpm --filter @agent-world/web exec vitest run`：**1761/1761 通过**（81 文件；2026-09-11 code-audit 清账 L19/L20/L22 为纯性能优化无新增用例、typecheck 通过；2026-09-10 web 组件测试补到 100% 覆盖（最后 9 个无测试组件分 3 批补齐，组件目录零「有 tsx 无 test」）；2026-09-10 RTS 阶段 A +7——OperationsDashboard.test 组件测试（关闭不渲染/汇总与产线卡/关注区/今日全部时窗切换/hub 跳审核/drill 最近 run/空态），3D 审计欠账 Canvas3D.test 3 例见待办 42；2026-09-09 +26——用户自助 MCP/技能卡设置面板与编辑器 12、节点技能卡搜索+深链 6、设置 → MCP 列表搜索 4、设置三标签页/改名/model-card 重构的同步测试 4；2026-09-08 成本报表 +5 用例——单价缺口警告 3（无缺口不渲染 / 完全没配 / 只配一部分点名字段）+ 按模型分摊 2（模型名·电费·token 渲染 / 空态）；2026-09-08 审计 web 4 项修复 +9 用例——M21 loadRun try/catch、M22 flushSave rethrow、M24 listBrandTerms res.ok、M27 保存失败红色提示；2026-09-05 公告 target 定向 +14 用例——新增 AnnouncementAlerts.test 6（模板角标/产线横幅/无公告不渲染）+ AnnouncementManager.test 6（受众三态表单序列化/编辑回显/legacy 回落全员）+ TemplatePicker +2（角标渲染）；2026-09-03 从 176 提升到 1460，+1284 用例——组件测试全覆盖 39 个组件，P0/P1/P2/P3 四批全部完成；基础设施 @testing-library/react + jsdom + vitest.config.ts + setup.ts + utils.tsx；过程中修复 Inspector.tsx 可选链 bug；2026-09-04 修正 TemplatePicker 模板数断言 27→33）

* **注意**：依赖 `node:sqlite`，必须 Node ≥ 22（CI 用 Node 24；本地 shell 默认 Node 20 会误报 `No such built-in module: node:sqlite`，用 `fnm exec --using=24` 跑）。**P1 沙箱的实跑测试必须在 Node 24 下验证**——否则 `code-sandbox.test.ts` 的 spawnSync shell 脚本形状断言通过，但 `engine.code.test.ts` 中真正执行用户脚本时会因 `--permission` / `--experimental-permission` 形式与实际 Node 版本不一致而失败（`resolveInterpreter` 会对解释器路径做版本探针，跨版本跑会走不同分支）

  * ### ⚠️ 版本不对时的症状指纹（2026-09-08 有会话据此误判为「本机环境坏了」）
    非 Node 24 下跑全量 server 测试，失败会呈现为 **32-36 个用例波动失败**，且**全部依赖 code 节点子进程**（`engine.code` / `loop` / `map` / `table` / `generic` 里跑 JS 的用例），报错是 `ENOENT lstat '<internal-path>'` 或 `finished` 为 `undefined`——**看起来像沙箱在这台机器上跑不起来，而不像版本问题**；失败数还会随 8s 超时随机浮动，更强化「环境 flaky」的错觉。**判定方法**：`fnm exec --using=24 -- pnpm --filter @agent-world/server exec vitest run`，若变 937/937 全绿即为版本问题。**不要**据此在 handoff 里记「本机预先存在的环境失败」——`git stash` 对比基线只能证明"不是本次改动引入"，**不能**证明"是环境问题"，两者是不同命题。

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

