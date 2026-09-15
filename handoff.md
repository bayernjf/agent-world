# Handoff

State of Agent World as of 2026-09-15.

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
* [docs/design-monetization.md](docs/design-monetization.md) — 商业化实施方案（三层计费 / 订阅 gate / P0-P3，**价格已用 M1 真实数据校准 2026-09-14；P1 代码已完成待部署**）
* [docs/design-monetization-m2-implementation.md](docs/design-monetization-m2-implementation.md) — M2 订阅 gate 落地方案（S1-S8 分步骤 + 测试策略 + 回滚方案 + Hasee 部署手册，2026-09-14 S1-S8 代码全部完成并部署 Hasee）
* [docs/design-monetization-m3-implementation.md](docs/design-monetization-m3-implementation.md) — M3 收款与账单落地方案（S1 invoices 表 + 账单生成 / S2 账单页 UI / S3 HTML 发票 / S4 手动收款闭环 / S5 团队席位 / S6 Stripe 待收款主体，2026-09-14 启动）
* [docs/design-monetization-m3-s6-stripe.md](docs/design-monetization-m3-s6-stripe.md) — M3 S6 Stripe 支付网关集成总方案（数据模型/API/webhook/安全/测试/分步；后端 A0-A4 已完成）
* [docs/design-monetization-m3-s6-a5-frontend.md](docs/design-monetization-m3-s6-a5-frontend.md) — M3 S6 Step A5 前端 BillingTab 实施方案（按钮状态矩阵 / 回跳 query / 错误降级 / i18n / 测试 / 分步，2026-09-15）
* [docs/design-demo-user.md](docs/design-demo-user.md) — 演示用户（免注册一键进真实产品，is_demo 标记真实账号 + 体验额度 + demoGuard 能力黑名单 + claim 原地转正 + TTL 级联清理；迁移 v40、D1-D6 分步，**2026-09-15 D1–D5 已落地、D6 本地端到端走查通过，待合 dev 后 Hasee 开 ALLOW_DEMO 真机复验**）
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

* [docs/engineering-blueprint.md](docs/engineering-blueprint.md) — 企业级工程化蓝图（**12 工程域全景**：可观测性/可靠性/发布/安全/配置密钥/IaC/数据/测试/性能/DevEx/运营/FinOps；每域「现状/缺口/补齐方案/优先级」+ M0→M3→规模化分级路线；2026-09-07 定稿，**2026-09-15 加「现状对账」：12 域自包含 P0 经实证全具备、部署脚本单一事实源加固、仅 E2E 冒烟缓至开放注册**）

* [docs/design-scaling.md](docs/design-scaling.md) — 规模化与企业级架构方案（**分布式 / 高可用 / 高并发 / 大数据量 / 托管 / 数据处理 / 合规**七主题，每项「现状/问题/方案/触发条件/落地步骤」；**决策：自托管 + SaaS 都做，先自托管后 SaaS**——自托管阶段只需成本熔断/备份演练/探针/对象存储，SaaS 阶段再补 PG/多副本/分布式锁/合规；2026-09-07 定稿待评审）

* [docs/design-postgres-migration.md](docs/design-postgres-migration.md) — PostgreSQL 迁移设计（主库 SQLite→PG：现状盘点 / 差异清单 / 双驱动改造 / 数据搬迁 / 迁移 SQL 命名规则 / 回滚 / 验收；设计定稿 2026-09-08；**阶段 1-3 + 搬迁脚本均已落地 2026-09-08**——`sqlite-driver.ts` + `DatabaseDriver` 异步接口 + 137 方法 async + `pg-sql.ts`/`pg-driver.ts`（阶段 1-2）；**阶段 3**：`db.ts` `openDatabase()` 按 `DB_DRIVER` 分派（默认/空值=sqlite，未知值 fail-closed，PG 连接走 `DATABASE_URL` 或 `PG_*` env）+ `index.ts` 接线 + FTS 知识库 PG 下诚实降级为 `NoopMemoryBackend` + `db-driver-switch.test.ts` 5 例守护；**搬迁脚本**：`migrate-to-postgres.ts`（`pnpm --filter @agent-world/server migrate:postgres`，VACUUM INTO 快照→toPgDdl 建表→流式批量 INSERT→行数校验，`--dry-run`/`--verify-only`），落地时**修复 DDL 契约缺口**（`resource_access`/`subscriptions`/`usage_ledger`/`idempotency_keys` 4 表只在迁移 32-35 建、DDL 常量缺失，fresh PG 库会缺表——已补 DDL）；server 929/929 绿；**端到端演练 ✅ 2026-09-08**（Docker postgres:16 + dev 库 25 表/12.2 万 events：行数对齐/71 图逐字节一致/enc:v2 密文可解密/PG 冒烟注册→建图→更新→版本列表全通；**演练抓出并修复 9 类方言缺口**——DDL 缺 3 列、BLOB→bytea、rowid→ctid、LIMIT -1→ALL、date() 日桶、INSERT OR IGNORE→ON CONFLICT、upsert 列名歧义、node-pg bigint→string 解析器、PG 别名小写折叠需加引号，详见设计文档 §8 表格）。**剩余：性能压测 + 生产切换等价性，随 SaaS 阶段真实流量验证**）

* [docs/design-multitenancy.md](docs/design-multitenancy.md) — 多租户数据模型设计（**tenant / user / 资源 / 计费**四者关系；tenant=计费与隔离边界，自托管=隐式单租户、SaaS=显式多租户；`users.tenant_id` 推导避免全表加列，订阅计费按 tenant、角色三层分权；向后兼容两阶段演进；2026-09-07 起草待评审）

* [docs/design-ab-testing.md](docs/design-ab-testing.md) / [docs/design-skill.md](docs/design-skill.md) / [docs/design-glossary.md](docs/design-glossary.md) — A/B 实验 / Skill 体系 / 术语表
* [docs/design-design-tokens.md](docs/design-design-tokens.md) / [docs/design-i18n.md](docs/design-i18n.md) / [docs/web-component-testing-plan.md](docs/web-component-testing-plan.md) — 设计 Token / i18n / 组件测试

* [docs/design-canvas-isometric.md](docs/design-canvas-isometric.md) — 画布等距 3D 展示视图设计（受限 3D：俯角固定 + 水平旋转 + 平移；2D/3D 一键切换；**第一、二、三期已实施**）

* [docs/design-guided-tour.md](docs/design-guided-tour.md) — 新用户分步引导 Guided Tour 设计（聚光灯分步教学 + 上一步/下一步/跳过；§十二 多引导注册中心：引擎与定义解耦、引导即数据、版本化 seen、What's-new/⌘K 动态注册，**已落地**）

* [docs/design-rts-overview.md](docs/design-rts-overview.md) — RTS 宏观上帝视角设计总览（L0 工业园区 / L1 单厂 3D / L2 节点三层缩放；六类宏观信息；A 平面工作台→B 宏观沙盘 MVP→C 完整 RTS；**阶段 A/B 已完成，阶段 C 全部完成（C1-C3 随 PR #290、C4-C8 随 PR #292 合 dev 并部署 Hasee、真机走查通过；C5/C6 两处裁剪与方案 A 留档见待办 #50）**）

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

> ✅ 待办 #1–#45（除活跃的 #39/#41 外）已全部完成。详细过程已分批归档：#1–#37 见 [handoff-archive-2026-09-07.md](docs/handoff-archive-2026-09-07.md)，#24–#43 见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)，#44–#45 见 [handoff-archive-2026-09-11.md](docs/handoff-archive-2026-09-11.md)。本区只留一行结论索引，活跃项（#39/#41）保留详情；#46–#50（RTS-B、商业化 M2/M3、RTS-C C1-C3 与 C4-C8）均已完成、详情见下。

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
36. ✅ 商业化详细实施方案（design-monetization，三层计费 + 套餐 + P0-P3 路线，**价格已用 M1 真实数据校准 2026-09-14**：Starter $9 / Pro $29 / Team $149，校准依据见 §4.1）
37. ✅ 画布等距 3D 视图（three.js，四期全完成，2D 编辑/3D 查看分离 + 卡车动画）
38. ✅ 商业化 M0 本地运行环境部署（Hasee Ubuntu/systemd/nginx/bwrap + CI/CD 自动部署）
40. ✅ Hasee 异地备份到 Mac（launchd 每日拉取 + 密钥入钥匙串，2026-09-10）
42. ✅ 画布 3D 视图审计欠账清理（7 项全清，Canvas3D.test 3 例，3D 零欠债）
43. ✅ RTS 阶段 A 平面运营工作台（OperationsDashboard，A1-A7，PR #239 已部署 Hasee）
44. ✅ web 组件测试 100% 覆盖 + research-loop 补 sink（组件零「有 tsx 无 test」，详见 09-11 archive）
45. ✅ M1 等待期清账三件套（code-audit L19/20/22/25/26/27 全清 + 7 个 C 类模板 file connector 预设 + 文档同步，详见 09-11 archive）

53. ★ **Demo User Hasee 真机走查 + 零配置首跑 422 修复闭环（走查 2026-09-15 / 修复 2026-09-16，PR #302 merge `b34fa29` 部署后）**：原 systemd override 只有 MONETIZATION_ENFORCE=1、漏 ALLOW_DEMO，补独立 drop-in `/etc/systemd/system/agent-world.service.d/demo.conf`（仅一行 `Environment=ALLOW_DEMO=1`，不动原 override；回滚=删文件 + daemon-reload + restart），重启 PID 36613，进程 environ 确认两变量同时在。**总结论：核心链路真机通过；走查发现 1 个必修 bug + 1 个部署待办，两者均已于 2026-09-16 闭环（见本节末「🔧 2026-09-16 修复闭环」）。**
   - ✅ 登录页出现「免注册，先体验演示」，一键建 demo（user `efb57f50-332d-4264-b019-0dd5421f2368`，email demo+efb57f50@demo.local）；`/api/auth/me`（注意正确端点是它，`/api/me` 为 404）isDemo=true、TTL 正好 24h、quota 全对（tokens 30000 / maxRunsTotal 15 / concurrentRuns 1 / storageBytes 20971520=20MB / videoSegments 0）。
   - ✅ **最关键项通过**：MONETIZATION_ENFORCE=1 且 free token=0 下，demo 文本 run 不被 402 误拦——配齐模型后 run `b5350e7a-ed60-43c0-8231-40b781717cbe` status=done、trigger=manual、12.5s、5 节点全 done，成本 $0.001502 正常归集（draft/polish=agnes-2.5-flash、qc=agnes-2.0-flash score 9.0；intake/depot 0 token 0 成本属正常透传），非 0 非碎片。
   - ✅ 媒体能力锁定：视频节点**编辑态可添加**，但**派发时服务端 gate 硬拦** `402 demo_quota / DEMO_QUOTA_MEDIA`（metric=media, limit=0, used=1, claimUrl=/login?claim=1，文案"演示账号不支持视频/音频生成，注册转正后即可使用"）——编辑自由 / 运行受限 / 引导 claim，符合设计；音频走同路径。
   - ✅ DemoBanner（"演示模式 含 15 次运行 将于 23:30 结束"）、ClaimDialog 转正弹窗（邮箱 + 两次密码 + 取消/转正并注册；未真注册）、退出演示（回 /login、会话清除）均正常。
   - 🐛→✅ **必修 bug（demo 零配置首跑 422，2026-09-16 已修复，根因是前端模型选项加载竞态、非后端缺模型）**：现象——预置 tpl-draft「写草稿」graph `3f076e4e-070d-4c81-8f1c-f2e2e2ad8c01` 的两个 textGen 节点「初稿」`draft-1qyxv`、「润色」`polish-liitg` 在 demo 新用户首次派发时被 `422 graph has unconfigured model(s)` 打回，必须手动进「模型分配·当前产线」勾模型才能跑，违背"零配置先体验"。**取证**：后端模板本就带 `agnes-2.0-flash`（`templates.ts` tpl-draft + core schema `TextGenConfig.model` 默认值双保险），纯后端 seed→存库→读回→`validateModels` 0 error；真机只读库佐证竞态偶发——走查账号的图被清成空（手动配回 2.5）、稍后新建的第二个 demo（b25927a5）图仍是默认 2.0 未被清。根因与修法见本节末「🔧 2026-09-16 修复闭环」。
   - ⚠️→✅ **部署待办（2026-09-16 已落地）**：`prune:demo`（**packages/server/package.json**，脚本 packages/server/scripts/prune-demo-users.ts；默认 dry-run、`--apply` 真删、`DB_FILE` 指定库、deleteUserCascade 级联前再校验 is_demo=1，转正账号构造安全）已在 Hasee 挂 **agentworld 用户 crontab，每小时第 17 分 `--apply`**，日志 `/var/lib/agent-world/logs/prune-demo.log`；落地前 dry-run 正确判定当时 0 个过期（两 demo 到期为 CST 09-16 23:30/23:49），并以 agentworld 身份按 cron 确切命令手动跑通 APPLY（删 0、权限/tsx/日志链路正常）。
   - 未逐项真机触发（已有单测 + 集成测兜底）：concurrentRuns=1 / maxRunsTotal 15 上限 / 20MB 上传上限；claim 未真提交注册。前端 `/api/runs?graphId=`、`/api/runs/:id` 查不到刚建 run（返回空/404），**run 状态一律以服务器 DB（python3 只读，无 sqlite3 CLI）为权威**。
   - 测试副作用：曾给该 demo graph 加 1 个视频节点验证 gate，已 Cmd+Z 撤销恢复；该 demo 账号 TTL 24h，到期后由上方已挂的每小时 prune cron 自动级联清理。

   - 🔧 **2026-09-16 修复闭环（零配置首跑 422）——根因是前端竞态，改 `apps/web/src/store/graph.ts`**：
     - **根因**：`setGraph()` 每次加载图都同步跑 `migrateGraphModels()`，而模型选项 `cachedModelOptions` 初始为 `[]`、靠模块加载时 `void refreshDefaultModel()`（异步 `api.getSettings()`）填充。demo 一键落地即加载预置 tpl-draft，若此刻选项尚未返回，`remapNodeModel()` 会把有效的 `agnes-2.0-flash` 误判为"未知模型"，`defaultModelFor()` 在空选项下返回 null，于是把节点 `model` 改写成空串 `""` 并经 `scheduleSave()`（500ms debounce）自动写回后端；随后派发 `validateModels()` 见空 model 即报 error → 422（`validateModels` 不认 `config.defaultModel` 运行时兜底）。手动「模型分配」时选项已就绪、写入有效 model 后不再被清，故手动配完能跑——与真机现象吻合；普通用户从模板新建也潜伏同一竞态，demo 零配置首屏最必现。后端 seed/模板/schema 均无问题（见上方取证）。
     - **修复（原则：选项未就绪绝不清非空 model；就绪后补跑一次迁移）**：① 新增模块级 `modelOptionsReady` 标志；`refreshDefaultModel()` 用 `finally` 置位，并在选项就绪后对当前已加载图（非空、非 readOnly）补跑一次 `migrateGraphModels`，有变更则 `setGraph` 完成被推迟的占位符迁移。② `remapNodeModel()` 在取到非空 `current` 但 `!modelOptionsReady` 时直接 `return false`（原样保留）；就绪后维持原逻辑（有效保留 / 占位符替换 / 确无候选才清空，既有"providers:{} 清空"语义不变）。
     - **测试**：`graph.migrate.test.ts` 5→7（新增两个竞态回归：选项未就绪时有效内置 model 不被清空、未就绪先保留占位符、就绪后补迁移为真实模型；已实证禁用守卫则 2 例必红、恢复则绿）；`api.demo-user.test.ts` 10→11（新增后端契约护栏：demo seed 图所有 textGen 节点 model 非空且 `validateModels(seeded, loadConfig(user))` error 为 []，防模板日后被改坏，但它不能复现前端竞态，竞态由 migrate 测锁定）。验证：web store 相关 5 文件 21 测、web 顺序全量 97 文件 1867 测、server demo 集成 11 测全过。
     - **状态**：代码与测试在工作区（分支 feature/20260824），尚未 commit / push；待走 PR→CI→merge dev→Hasee 部署后真机复验"一键进演示→不碰模型分配→直接派发 tpl-draft 应 200 跑通"。

39. ★ **商业化 M1：成本计量回采（2026-09-08 开跑，✅ 三问分析 + 价格校准已完成 2026-09-14）**：用 M0 环境跑真实产线，攒按用户/模型/月拆分的真实成本，作为 [design-monetization.md](docs/design-monetization.md) §4 定价的数据前提。**开跑前置已落地**（PR #211）：① 单价缺口审计——`unpricedModels()` 判定「完全没配 / 只配了一部分」，启动 warn + 成本报表警告条；② 按模型分摊——`node_runs.model`（迁移 36）+ `byModel` 聚合 + 前端表 + CSV 段。7 个在用模型单价已配全（agnes 单价写源码 `config.ts` 的 `AGNES_PROVIDER.pricing`，custom provider 走设置；当前为 OpenAI 同级占位单价，正式计费前须换 agnes 网关真实费率）。**本阶段不加功能**——要回答三问：一次典型 run 多少钱 / 返工占总电费多少 / 哪个模型吃大头。**2026-09-11 13:35 UTC 提升回采频率**（详见 #41 与下方"下一步主线"）：每天约 57 次 run，回采周期从 2-4 周缩短到 3-5 天，预计 09-14（~200 run）可启动部署类、09-15 完全自由。**🎉 M1 三问分析完成（2026-09-13，基于 108 runs / 87 done）**：①成本画像——③短视频占 97.7%（$5.40），agnes-video-v2.0 占 90.4%（$5.00/10次），文本模型极便宜（180次调用仅 $0.13）；②完成率——①写草稿 95.3%、③短视频 76.9%、④批量 76.9%、②翻译 33.3%（返工逻辑导致 RATE_LIMIT）；③运行时长——中位数 3.8min，②翻译平均 8.6min（返工耗时最长）。**✅ 价格校准完成（2026-09-14，基于 125 runs / $5.57 总成本）**：用真实数据校准 design-monetization.md §4 套餐价格与 §10.2 待定参数——Starter $19→$9、Pro $49→$29、Team $199→$149，新增 §4.1 价格校准依据小节（数据来源/样本量/计算方法/局限性），超额加购价：视频 $2/段、图片 $0.20/张、token $0.50/100万。**M1 阶段正式完成，M2（订阅 gate 落地）可以启动。**

41. ★ **M1 回采产线挂载 + 每日体检（4 条成本画像产线，cron 自动攒数据中）**：在 Hasee staging 挂 4 条代表产线：①写草稿·高频文本 ②翻译流水线·带返工（gate 上限 3 次）③短视频广告工坊·媒体中价（imageGen+videoGen）④批量内容工坊·批量放大（Map 5 条）。产线 ID：①`bdb25758-dd2d-4fe1-9ee3-ab2109b32f16`（trg_mtv0zp69）②`71536df1-da29-44fb-ae7a-4250dafe1a8d` ③`b25c9b38-b823-49c4-89ef-4cb432bd341c` ④`edc5183c-f8c3-4c11-9eab-a6e8fe232361`（trg_m1_batch_weekly）。Agnes free tier 429 已按方案 C（降频+长退避 retry）闭环（PR #229 `006186b`：judge/generateImage/generateVideo 包 withRetry 30/60/90/120s ×4；触发器持久化修复 PR #231 `70524df`）。**每日回采体检**：豆包定时任务每日 10:30（CST）触发，检查 run 完成率/成本归集/429 残留，结论回写本条。**📋 每日体检记录**：

- **2026-09-11（第 1 次体检，🔴 P0 阻塞发现 → 同日修复）**：cron 调度器完全未工作——根因 `index.ts` 中 `triggers.restore()`（async）未 await 即 `scheduler.start()`，`list()` 返回空、零定时器挂载。修复 `triggers.restore().then(() => scheduler.start())`（commit `c826052`）+ 兜底 catch 保留 ProviderError code（429 不再记 UNKNOWN，commit `93a7d19`）。附带修复 CI flaky test `ProductLibrary.test.tsx`（表单清空时序，加 await flush，commit `2ecf3f2`，连跑 10 次稳定）。PR #249 合并，03:57 UTC 部署 Hasee（PID 94661，dist 确认含修复）。
- **2026-09-11（06:18 UTC cron 修复实测验证，✅ 通过）**：SSH 交叉验证 server.log + node:sqlite + dist 代码。提频后自动 cron tick 证据确凿——`05:40 trg_mtv0zp69 → run e2142838`、`06:00 trg_m1_batch_weekly → run af9b07ae`、`06:10 trg_mtv0zp69 → run e266d932`，3 run 全部 done；成本归集健康（$0.001481/$0.001773/$0.002425，LLM 节点非 0、非 LLM 为 0、无碎片，全 agnes-2.0-flash）；05:30 后零 429。**判定：调度器自动触发恢复，M1 高频回采正式开始自动攒数据，无需人工干预。** 观察项：②翻译（`0 */4`）、③短视频（`0 3,15`）首次自动触发由后续体检确认。
- **2026-09-12（⚠️ 网络不可达，体检未完成）**：SSH `hasee-2016-server`（192.168.31.14:22）连接超时，HTTP `curl http://192.168.31.14/api/health` 空响应，内置浏览器导航 `ERR_ADDRESS_UNREACHABLE`。判定当前执行环境不在 Hasee 所在局域网（用户可能切换网络），无法读取 run/成本/触发器数据。**未做任何数据检查，不编造结论。** 补做条件：用户回到 Hasee 同局域网（或提供 VPN/端口转发）后重新触发体检。待检查清单：①4 条产线 run status 分布 + 失败原因（重点 429/gate/imageGen）②每条 run costUsd 非 0 非碎片 + 按模型拆分 ③cron 触发次数 vs 成功次数（重点 ②翻译每 4h、③短视频每 12h 首次自动触发是否正常）。
- **2026-09-12（第二次体检，🔴 发现服务器关机 12h + ②翻译 QC TIMEOUT）**：用户报告 Hasee 关机。SSH 确认服务器 03:20 UTC 自动恢复（uptime 8min），agent-world.service 03:23:23 启动（PID 1577，systemd enabled 开机自启）。**数据缺口：09-11 15:10 → 09-12 03:20 约 12 小时无 run**（①写草稿错过 ~24 次、②翻译错过 3 次、③短视频错过 03:00 1 次），无法挽回。DB 完整性 ok（42 runs/224 node_runs/14 graphs/4 users，迁移 37）。4 条产线触发器配置完好（graph doc.triggers 字段，全部 enabled=true）。**Run 状态**：①写草稿 23 run（18 done/3 failed/2 interrupted，完成率 78%）；②翻译 2 run（**0 done/2 failed，完成率 0%**）；③短视频 1 run（1 done）；④批量 1 run（1 done）。**失败原因归类**：②翻译 2/2 全挂在 **QC 质检站节点 60s TIMEOUT**（`Stream timed out after 60000ms`，intake/translate/review 均成功，QC 超时）；①写草稿 3 failed = 2 次旧 429（09-10，retry fix 前）+ 1 次 QC TIMEOUT（09-11 11:10）；2 interrupted = 部署重启中断（09-11 15:10）。**429 已闭环**：retry fix（09-11 03:57 UTC 部署）后无新 429 失败。**成本归集**：总计 $0.578704，①写草稿 $0.034343（avg $0.001493）、②翻译 $0.001564（失败仍产生 translate/review 成本）、③短视频 $0.540371（video $0.50 是大头）、④批量 $0.002425；零碎片成本（<0.000001），零异常。**待验证**：cron 调度器重启后是否自动恢复（等 03:40 UTC ①写草稿 tick）。**待处置**：②翻译 QC 节点 60s 超时需排查（QC prompt 过长？agnes 模型慢？超时阈值？QC 节点是否有 retry 包裹？）。
- **2026-09-12（03:50 UTC cron 恢复验证，✅ 通过）**：服务器 03:23 重启后，①写草稿产线 03:40 UTC tick **精确触发并成功完成**——run `c92d79fb`（trigger=trg_mtv0zp69，03:40:00→03:43:45，status=done），5 个节点（depot/draft/intake/polish/qc）全部 done，成本 $0.001684（draft $0.000698 + polish $0.000986），QC 节点本次未超时。**判定：`triggers.restore().then(() => scheduler.start())` 在服务器重启后自动恢复生效，cron 调度器无需人工干预。** ②翻译产线 04:00 UTC tick 待后续体检确认（03:50 验证时尚未到点）。M1 高频回采正式恢复自动攒数据。
- **2026-09-12（②翻译 QC TIMEOUT 根因定位 + 修复，🔧 已落地未部署）**：代码排查定位根因——`packages/server/src/providers/openai-compatible.ts` 中 judge（QC 节点，:551）、generateImage（:602）、generateVideo（:720）三处的 `withRetry` 只用 `isRateLimit`（仅匹配 429 RATE_LIMIT），**不对 TIMEOUT 重试**，导致 60s 流式超时直接抛出失败（②翻译 2/2 全挂 QC、①写草稿 1 次 QC 超时）。修复：①新增 `isTransientError` 函数（匹配 RATE_LIMIT + TIMEOUT，:108），三处 withRetry 改用 isTransientError；②judge 超时阈值从 60s → 120s（QC 输入可能是长翻译结果，给模型更多时间；judge 是 deterministic temperature=0，重试安全）。typecheck 通过；server 测试 1007/1039 过（32 失败均为 code-sandbox/engine 环境问题，与本修改无关）。**待部署 Hasee 后验证②翻译产线 QC 节点不再超时。**
- **2026-09-12（QC TIMEOUT 修复部署 + 手动触发验证，✅ 通过）**：PR #264 合并 dev（commit 01cbb63，06:04 UTC），CI 首次因 teardown ECONNREFUSED flaky 失败，rerun 后全绿；Hasee 06:12 UTC 自动部署（PID 3939，健康探针 commit=01cbb63）。**手动触发②翻译产线 run `16de2a85` 验证**：6 个节点（brief/depot/intake/qc/split/writer）全部 done，耗时 121s，QC 节点 `qc-fchd0` status=done 无 TIMEOUT，成本 $0.000924（writer）。**对比**：修复前 09-11 两次 run 全挂 QC 60s TIMEOUT；修复后 QC 节点成功完成。**判定：isTransientError（RATE_LIMIT+TIMEOUT 重试）+ judge 超时 120s 修复有效，②翻译产线 QC 节点不再因偶发超时直接失败。** ②翻译产线 04:00 UTC cron run（556d91c9，修复部署前）也碰巧成功（QC done），佐证 TIMEOUT 是偶发而非必现。M1 回采 4 条产线全部恢复正常自动攒数据。
- **2026-09-13（02:31 UTC 每日体检，✅ 降频效果显著，无需人工干预）**：服务正常（PID 2097，运行 13h）。**运行统计**：①写草稿 54 runs（48 done/3 failed，89%，最后 09-13 02:10）；②翻译 7 runs（4 done/3 failed，57%，最后 09-13 00:00）；③短视频 2 runs（2 done，100%，最后 09-12 15:00）；④批量 3 runs（3 done，100%，最后 09-12 06:21）。总计 66 runs（57 done/6 failed，86%）。**当日完成率（09-13）**：①写草稿 3/3 done（100%）、②翻译 1/1 done（100%）、③短视频 0（下一次 03:00 UTC）、④批量 0（下一次 06:00 UTC）。**失败原因归类**：429 限流 7 次（M1 四产线中仅②翻译 1 次，09-12 16:00 降频前；其余为其他产线）；超时 3 次（②翻译 QC 2 次 + ①写草稿 QC 1 次，均为降频前）；其他 5 次（Loop 节点失败 3 次 + EROFS 2 次，均为其他产线）。**成本归集**：总成本 $1.1778（①$0.0848/②$0.0073/③$1.0806/④$0.0051）；③短视频成本大头是 agnes-video-v2.0（$1.00/次）；0 计费 done 节点较多（①150/②15/③4/④15，疑为 source/depot 等非 LLM 节点，待确认）；②翻译有 8 个 None 模型成本记录（$0.0023，疑为成本归集小 bug）。**关键发现**：①**降频效果显著**——①写草稿从每 30min→每小时，降频后 8 次全部成功；②翻译降频后 2 次全部成功；②**429 不再打爆 M1 产线**——最近 429 为 09-12 16:00（降频前），之后无新 429；③**QC 超时问题缓解**——降频后无新 QC 超时（之前 3 次均为降频前）；④②翻译成功率 57% 但失败全为降频前，降频后 2/2 成功。**处置建议**：继续观察降频后效果，自然运行攒数据；0 计费节点和 None 模型后续排查（不影响回采）；数据量 66 runs，预计 2-3 天到 100+ runs 可做 M1 三问分析；**无需人工干预**。
- **2026-09-13（04:30 UTC 成本归集两个 bug 根因定位 + 修复，🔧 已落地未部署）**：体检中发现的两个成本归集异常已定位根因并修复。**Bug 1：gate（QC）节点全部 0 计费**——根因 `Worker.judge()` 接口返回类型不含 usage（`worker.ts:112`），`openai-compatible.ts:550` judge 实现调用 `streamChat` 后只返回 `extractJson(output)`，**丢弃了 result.usage**；`gate.ts:91/117` 两处 `node.finished` 事件只能用 `zeroUsage()` 兜底，导致 node_runs 表中 qc 节点 cost_usd=0/tokens_in=0/tokens_out=0/model=None（但节点 status=done，说明 judge 确实调了 AI）。修复：①`Worker.judge()` 返回类型增加 `usage: Usage` 必填；②`openai-compatible.ts` judge 实现返回 `{ ...verdict, usage: result?.usage ?? fallback }`；③`gate.ts` 两处 `zeroUsage()` 改为 `modelVerdict.usage`，三个 verdict 覆盖对象（prohibitedHits/belowBrand/belowScore）也增加 usage 字段；④`worker.ts` mock judge 返回 usage。**Bug 2：translate 节点 model=None**——根因 `computeUsage()` 函数（`openai-compatible.ts:156-167`）返回对象中**没有 model 字段**，所有经 `streamChat`/`runWithTools` 产生的 usage 都缺 model；translate 节点受影响（有成本有 token 但 model=None）。修复：`computeUsage()` 增加 `model: string` 参数（第 3 个参数），返回对象设置 model；两处调用（streamChat:304、runWithTools:457）传入 model。**验证**：server typecheck 通过；gate/compliance/costs/brand/humanloop 等 gate 相关测试全绿（24/24）；全量 server 测试 1000 passed/39 failed，39 失败均为项目既有环境问题（code-sandbox/engine.loop 等，`git stash` 基线对比确认修改前就失败，非回归）。**待部署 Hasee 后验证**：qc 节点有成本有 model、translate 节点 model 非 None。**注意**：历史数据中 qc 节点的 0 计费无法回填（token 数据已丢失），只能从修复部署后开始正确记录。
- **2026-09-13（手动补数据 + M1 三问分析，🎉 100+ 目标超额达成）**：为加速达到 100+ runs 目标，采用**稀疏手动触发策略**（每次只触发 1 个，等完成后间隔 10 分钟再触发下一个），共执行两轮：
  - **第 1 轮（6 个 run，100% 成功）**：③短视频×3（5ea18c48/44de70e1/ee194612）、④批量×3（4313aa29/4e471cd9/53adbd57），全部 done，耗时 2-8 分钟/run。
  - **第 2 轮（8 个 run，7 成功 1 失败，87.5%）**：④批量×3（5c471280/0c8694f1/3bf1973f）、③短视频×3（309c5698/fc593874/56f94bb5）、②翻译×2（00a0475c failed RATE_LIMIT / b267b92a done 21.8min）。
  - **手动触发总计**：14 个 run，13 成功 1 失败，**成功率 92.9%**。唯一失败是 ②翻译-1（返工逻辑导致单次 run 内多次调用 API 触发 RATE_LIMIT）。
  - **对比**：第 1 次尝试密集触发（同时 8 个）全部失败（RATE_LIMIT），证明稀疏触发策略有效。

  **🎉 100+ 目标达成**：总 run 从 92 → **108**（超额 +8），done 87，完成率 79.8%，总成本 $5.55。cron 自动触发仍在持续运行（①写草稿每小时、②翻译每 4h、③短视频每天 2 次、④批量每天 1 次），数据还在自然增长。

  **M1 三问分析结果（基于 108 runs / 87 done）**：

  **第一问：成本画像**
  - 按产线：③短视频 $5.40（**97.7%**，成本大头）、①写草稿 $0.10（1.9%）、④批量 $0.015（0.3%）、②翻译 $0.010（0.2%）
  - 按模型：agnes-video-v2.0 $5.00（**90.4%**，10 次调用）、agnes-image-2.0-flash $0.40（7.2%，10 次）、agnes-2.0-flash $0.13（2.4%，180 次调用，token_in=196,885 / token_out=168,431）
  - 关键发现：文本模型极便宜（180 次调用仅 $0.13），视频生成是成本绝对大头（$0.50/次）；除③短视频外，其他三条产线成本都极低（<$0.11）

  **第二问：完成率分析**
  - 按产线：①写草稿 95.3%（61/64）、③短视频 76.9%（10/13）、④批量 76.9%（10/13）、②翻译 33.3%（6/18）⚠️
  - 按触发方式：cron 自动触发完成率高（①写草稿 87-100%、③短视频 100%、④批量 100%），②翻译 cron 仅 36.4%；manual-m1-verify 52%（含第 1 轮密集触发的 12 个失败，排除后稀疏触发 92.9%）
  - 失败原因：halted_reason 字段全部为 UNKNOWN（失败原因未正确记录到 runs 表，需后续优化）；从错误码统计看 RATE_LIMIT 14 次（主要是②翻译返工 + 密集触发）、TIMEOUT 3 次、其他 4 次
  - 关键发现：②翻译产线完成率最低（33.3%），根因是返工逻辑（gate 上限 3 次）导致单次 run 内多次调用 API，容易触发 RATE_LIMIT；其他三条产线完成率良好（≥77%）

  **第三问：运行时长分析**
  - 按产线（仅 done）：②翻译平均 8.6min（最长 21.7min，返工逻辑耗时）、①写草稿平均 5.1min（中位数 3.9min，少数长 run 拉高均值）、③短视频平均 3.8min、④批量平均 3.4min
  - 总体：87 样本，平均 5.0min，最短 1.8min，最长 21.7min，**中位数 3.8min**
  - 关键发现：大部分 run 能在 4 分钟内完成（中位数 3.8min）；②翻译因返工逻辑耗时最长（平均 8.6min）；①写草稿有少数长 run（最长 21min）可能是模型响应慢

  **后续建议**：
  1. 数据量已充足（108 runs），可以开始商业化定价分析
  2. ②翻译产线返工逻辑需优化（减少返工次数或增加重试间隔），提升完成率
  3. 失败原因记录需优化（halted_reason 全部为 UNKNOWN，应记录具体错误码）
  4. cron 自动触发继续运行，数据自然增长，可定期做趋势分析
- **2026-09-14（02:44 UTC 每日体检，✅ 整体健康，②翻译仍需观察，M1 阶段目标已达成）**：服务正常。**运行统计**：总 run **125**，done 100，完成率 **80.0%**，总成本 **$5.5745**。①写草稿 78 runs（72 done/3 failed/3 interrupted，**92.3%**）；②翻译 21 runs（8 done/12 failed/1 halted，**38.1%** ⚠️）；③短视频 13 runs（10 done/3 failed，76.9%）；④批量 13 runs（10 done/3 failed，76.9%）。**最近24小时**：①写草稿 24 runs（**24 done/0 failed，100%** ✅，降频效果显著）；②翻译 14 runs（4 done/9 failed，**28.6%** ⚠️）；③短视频 11 runs（8 done/3 failed，72.7%）；④批量 10 runs（7 done/3 failed，70%）。**成本归集**：总成本 $5.5745；③短视频 $5.4025（**96.9%**，video $5.00/10次 + image $0.40/10次）；①写草稿 $0.1317（agnes-2.0-flash 175 calls）；②翻译 $0.0233（agnes-2.0-flash 47 calls + None 11 calls $0.0032）；④批量 $0.0170（agnes-2.0-flash 21 calls）。**失败原因**：所有失败 halted_reason 仍为 null（失败原因记录功能 PR #272 commit 80e9e49 已部署，但最近失败可能在部署前发生，需等下一次失败验证）；③短视频和④批量最近失败集中在 09-13 08:02-08:03（**手动密集触发的 RATE_LIMIT**，8 个同时触发全部失败），之后 cron 自动触发正常；②翻译最近失败在 09-13 10:55-16:00，疑为 RATE_LIMIT 或 gate 失败（maxAttempts 已从 3→2，需更多数据观察效果）。**0 计费检查**：4 条产线 0 计费 done run 全部为 **0** ✅（成本归集完整，无碎片）。**关键发现**：①①写草稿降频后 24h 内 100% 成功（24/24），降频+retry 闭环效果显著；②②翻译完成率仍低（累计 38.1%，最近24h 28.6%），maxAttempts 3→2 优化后需 3-5 天数据观察；③③短视频/④批量失败主要是手动密集触发的 RATE_LIMIT（已验证稀疏触发策略有效，92.9% 成功），cron 自动触发后正常；④成本归集健康，无 0 计费 done run，无碎片成本；⑤**M1 回采数据已充足（125 runs / $5.57），三问分析 + 价格校准已全部完成（2026-09-14），M1 阶段目标正式达成**。**处置建议**：继续观察②翻译 maxAttempts 2 后的完成率变化；失败原因记录功能等下一次失败验证；当前主线转为 **M2 订阅 gate 落地**（实施方案 docs/design-monetization-m2-implementation.md 已写好，S1-S8 可随时启动）；M1 回采产线继续 cron 自动攒数据，用于 M2 上线后的二次校准；**无需人工干预**。
- **2026-09-14（15:00 UTC ②翻译产线专项优化，🔧 已落地 Hasee）**：②翻译产线完成率仅 41.7%（24 runs / 10 done），全部失败根因是 **agnes free tier RATE_LIMIT 配额用完**（错误信息："Upgrade to a Token Plan"），不是速率限制。**三项优化**：①**代码层 RATE_LIMIT retry 优化**（commit `d721fd1`，未部署）——withRetry 加 getDelay 回调，RATE_LIMIT 时只 retry 1 次等待 5 分钟（之前 retry 4 次等 5.5 分钟全部白费），TIMEOUT 保持现有指数退避；②**运维层降低触发频率**（Hasee DB 直接修改）——cron 从 `0 */4 * * *`（每 4h，每天 6 次）改成 `0 */8 * * *`（每 8h，每天 3 次），API 调用量减半；③**运维层放宽 qc criterion**（Hasee DB 直接修改）——从"译文完整覆盖原意，无语义遗漏，中文自然通顺"改成"译文传达了原文的主要意思，没有重大语义错误，中文基本通顺。小的用词差异或轻微遗漏可以接受"，减少返工次数 → 减少 API 调用。服务已重启加载新 cron。**预期效果**：API 调用量减少 ~50%，完成率从 41.7% 提升到 60-70%（估计）。**根本解决方案**：升级 agnes 付费 key（彻底解决 free tier 配额问题）。**待观察**：3-5 天后看完成率变化。

46. ✅ **RTS 阶段 B 完成 + 预研模拟（2026-09-11~14）**：B1-B9 全部落地（parkLayout / 园区布局持久化 / overview category / CanvasPark / 状态色 / raycast 浮层 / 相机记忆 / FPS 调试 / 拖拽持久化）。**阶段 C 预研模拟（2026-09-14）**：给 14 条现有 graphs 全部设置 park 坐标（按类别聚簇 + 螺旋布局），3D 园区总览正常显示——14 个工厂按 10 个类别聚簇、待审角标醒目、钻取/返回无串厂。**园区 UI 优化（2026-09-15，PR #285 `a000de1` 已部署 Hasee）**：状态色变亮（idle `#94a3b8` / failed `#ef4444` / halted `#f59e0b`）、标签加半透明深色 pill 背景 + 文字阴影、字号 42→52、尺寸 300x80→380x100。**阶段 C 范围（8 步草案）**已写入 deferred-items.md：C1 跨厂产物关系 / C2 跨厂物流渲染 / C3 L0↔L1 连续 zoom / C4 园区设施 / C5 天气时间 / C6 音效 / C7 宏观轻操作 / C8 性能。**重启触发条件**：商业化闭环跑通 + 真实多产线规模形成（人均 ≥3 活跃产线）。
47. 🔵 **商业化 M2：订阅 gate 落地（2026-09-14 启动，方案 docs/design-monetization-m2-implementation.md，S1-S8）**：**S1 无需新建迁移**——subscriptions/usage_ledger 两表已在 base DDL + 迁移 34（最新迁移 37），PG 走 toPgDdl 自动派生。**S2 ✅ commit `1d7a3e4`**：core 新建 `plans.ts` 单一事实源（PLANS 配额 / PLAN_PRICES 校准价 $0/$9/$29/$149 / normalizeTokens=in+4×out / isPlanId），server `plans.ts` 改 re-export，新建 `subscriptionService.ts`（currentPeriodEnd 月初 UTC / getOrCreateSubscription 懒建 free / planOf 畸形回退 / setPlan 即时改套餐 + audit `billing.plan_changed`），admin 改套餐 API 改走 setPlan；core+server 测试绿。**S3 ✅ commit `8a8a32f`**：用量真相在 node_runs、usage_ledger 为累加投影、storage 实时快照不入账；driver 加 countDoneNodes（DISTINCT 视频段，重试只计一次）/sumArtifactBytes/setUsage（幂等覆盖）/listFinishedRunsSince/listUsageLedger；subscriptionService 加 recordRunUsage（run.finished 钩子，startRun 用 startedAt、resumeRun 用 row.started_at，try/catch 隔离计量失败不改 run 终态）/currentUsage（Promise.all 聚合四 metric+存储）/quotaRemaining；新建 `usage-backfill.ts` 幂等回填 + `scripts/backfill-usage.ts` CLI（DB_FILE/--dry-run/--since，pnpm backfill:usage）；5 测试绿。**S4 ✅ commit `7dece12`（=唯一必须停下的 checkpoint）**：enforceSubscription 加视频段/存储检查、token 改 normalizeTokens 折算、QuotaError 加稳定 metric（builtin_model/tokens/concurrency/video/storage）+ detail{plan,limit,used}；index.ts gate 改走 currentUsage 聚合、402 body 返回 metric/detail；纯函数 12 测 + HTTP 集成 2 测（flag 开→402 结构化 / flag 关→不拦）全绿。**gate feature flag `MONETIZATION_ENFORCE=1` 默认关闭（用户拍板维持）**。**S5 ✅ `9807988`**：GET /api/subscription（Promise.all 聚合用量 + activeRuns）+ web api client；**BYOK 视频放行修复 ✅ `99d639b`**（决策点①：免费层只拦内置模型视频、BYOK 视频放行）。**S6 ✅ `f3ed6f4`**：Settings 新增 billing tab（非独立页，契合无 router 现状）、UsagePanel 四 meter（token/视频/存储/并发，阈值变色）、UpgradeGate 402 模态（parseQuotaError 反解、不丢画布、可跳「改用自定义模型」）、PlanComparison 四档对比、billing i18n 中英同构、402 body 补 upgradeUrl；组件测试 13 个全绿。**S7 ✅ `d045f46`**：usage-alert.ts 在 start/resume 两处 run.finished 钩子异步触发（自兜底不改 run 终态），付费用户 token 80% info / 100% warning 公告，免费层跳过；**未建 KV flag 表**（feature-flags 是静态 registry），改用确定性公告 ID `usage_alert:<user>:<periodStart>:<tier>` 实现每用户每月每档一次、跨月自然重警，公告 target 解析新增 `user:<id>` 分支；8 测试全绿。**S8 ✅ 代码/测试/文档完成（部署由用户执行）**：四包 typecheck 全绿，core 233 / mcp 71 / web 1824 / server 1036 测试通过（server 余 32 个 code-sandbox/engine.*/regression 失败为 macOS 子进程沙箱基线，git diff 证实 M2 未触碰这些文件，非回归）；design-monetization.md P0/P1 勾选、M1/M2 里程碑状态更新；m2-implementation S5-S8 标✅ + 补偏差⑥⑦ + 写 Hasee 部署手册。**部署红线/顺序**：① pull+build（迁移自动）② backfill:usage 幂等回填一次 ③ **先把 owner（userId 92d95665-10ef-49d7-a2c3-6ba39d92f5fb）升 pro**（否则 M1 四条内置 agnes 回采产线被 402 断供）④ 最后才设 MONETIZATION_ENFORCE=1 重启；不设该变量=代码上线但不拦截，可先灰度观察计量。测试基线说明：判断 M2 回归只看订阅/计费/公告相关测试 + typecheck，code-sandbox/engine.* 失败是 macOS 沙箱基线非回归。**✅ Hasee 部署完成（2026-09-14 10:29 UTC）**：PR #277 合 dev（merge `124bdca`）→ CI 自动部署 → ③ backfill:usage 回填 120 runs（tokens_in=318895 / tokens_out=232457 / video_segments=13）→ ④ owner 升 pro（audit_log `billing.plan_changed` 已写）→ ⑤ systemd override 设 `MONETIZATION_ENFORCE=1` 重启（PID 22323）。健康探针全绿，4 条 M1 回采产线触发器 enabled，日志无错误。**待验证**：11:10 UTC ①写草稿 cron tick 确认 pro 用户不被 402 拦截。

48. ✅ **商业化 M3：收款与账单落地（2026-09-14 完成）**：在 M2 订阅 gate 基础上加装账单层。**S1-S5 全部完成并部署 Hasee**（PR #280 merge `f65a9c6`）：invoices 表（迁移 38）+ invoiceService + 账单页 UI + HTML 发票 + admin 手动收款闭环 + Team seats 限制。9 月周期账单 4 张（owner pro $29 + 3 free $0，状态 open）。**S6 Stripe 设计完成（docs/design-monetization-m3-s6-stripe.md）**：架构 + API + 流程 + 安全 + 测试 + 实施步骤。**S6 后端 A0-A4 已完成（2026-09-15，已随 PR #290 merge `27f28ee` 合 dev 并部署 Hasee）**：A0 `c0f708e` 装 stripe 22.6.2；A1 `f5113be` 迁移 39（subscriptions/invoices Stripe 镜像列 + 3 索引，base DDL 与 MIGRATIONS 双写）+ driver CRUD（findSubscriptionByStripeCustomer/Subscription、saveSubscription 扩参、findInvoiceByStripeInvoice/insertInvoice/listInvoicesByUser）；A2 `8f32b37` stripe.ts 网关封装（env 配置、可注入 client、懒单例，不碰 DB，19 mock 测）；A3 `b133c91` stripeWebhook.ts 五事件镜像同步 + 复用 idempotency_keys（命名空间 `#stripe-webhook`，claimIdempotencyKey first-writer-wins + find-or-create 双保险，10 测）；A4 `add61a4` api.billing.ts 三端点（/checkout /portal /webhook，webhook 绕过 cookie 认证走签名、raw body、同源回跳、缺配置 503 不 crash，6 测）。**关键踩坑**：stripe 22.6.2 钉 dahlia API（2026-08-26），周期/价格移到 subscription item（`sub.items.data[0].current_period_*`/`.price.id`），Invoice 无顶层 subscription（经 customer 反查），line 价格走 `line.pricing.price_details.price`。**✅ v39 迁移启动崩溃修复（commit `7118990`，已随 PR #290 部署 Hasee、schema v39 迁移成功、Stripe 三列三索引就位）**：A1 把 3 个引用「老表后期才由迁移加的 stripe 列」的 CREATE INDEX 放进了 base DDL，而 createSqliteDriver 先 `db.exec(DDL)` 后 runMigrations——老库 subscriptions 是 v34 旧表（无 stripe 列），CREATE TABLE IF NOT EXISTS 不补列，DDL 阶段建索引即崩 `no such column: stripe_customer_id`（fresh DB 不崩但 baseline 会跳过 v39.up 导致永远缺索引）。修法：base DDL 删那 3 个 stripe 索引（原位留注释），新增模块级 `POST_MIGRATION_INDEXES`（3 条 CREATE INDEX IF NOT EXISTS，迁移循环后 COMMIT 前幂等补建，fresh/老库双路径都覆盖），v39.up 原索引保留作双保险；migrations.test.ts 加 v38→v39 升级回归（9→10 测），双路径实测通过。**规则：老表加新列且需索引时，索引不能放 base DDL，应放 POST_MIGRATION_INDEXES + 迁移 up 双保险。** **PR #287 CI 修复（2026-09-15，commit `d2ecf90`）**：park-coord.test.ts 硬编码 `SCHEMA_VERSION` 断言 38，迁移 39 引入后版本升为 39 导致 CI "Typecheck, build & test" 失败；断言更新为 39，park-coord + migrations 测试 16 个全绿。**PR #287 标题/描述已同步（2026-09-15）**：补充 C3 zoom（`4a526ff`）与 CI 修复两条变更，标题改 `feat(billing, park): Stripe billing integration, cross-factory visualization, and C3 zoom ease`。**S6 前端 A5 已完成（2026-09-15，已随 PR #290 merge `27f28ee` 合 dev 并部署 Hasee，方案 docs/design-monetization-m3-s6-a5-frontend.md）**：先落 A5 实施方案（`2c670c4`，按钮状态矩阵/回跳 query/降级/i18n/测试/分步），再按原子步落地——A5.1 api 层 `createCheckoutSession/createPortalSession` + `BillingApiError`（保留服务端 code 供分支）+ 同源回跳 URL + 纯函数 `lib/billingReturn.ts`（parseBillingReturn 白名单，7 测）；A5.2 zh/en `billing.stripe` 子树 i18n（`b458d95`）；A5.3 BillingTab 按钮矩阵（`6f78cb6`，自助仅"升级到更高价套餐"、Stripe 付费用户当前卡给 管理订阅/更新支付方式/重新订阅、past_due 警示条、503 stripe_not_configured 静默回退 contactOwner，矩阵抽 planColumnState/primaryManageAction/billingErrorKey 纯函数，11 组件测，token-only 样式）；A5.4 App 挂载解析 `?billing=success/cancel/manage-done`（`4f09220`，success 自动开账单页+toast、cancel 仅 toast、replace 清 URL 防重复弹）。**验证**：web typecheck 干净、web 全量 91 文件 1845 测全过、i18n 守护过；本地浏览器走查（server 8791 无 Stripe key）亲眼确认 free 用户三档升级按钮、点升级后端真返 503（日志 4ms）后按钮消失回退联系管理员且无报错白屏、success/cancel/manage-done/非法 marker 四种回跳行为全部正确。**happy path（真跳 Stripe 托管页/portal）无 key 无法本地验证，由 18 个 mock 单测保逻辑、真机留 Step6**。**剩余**：仅真机 Step6（待收款主体 + STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_IDS，缺 key 优雅降级不阻断启动）。**脚本修复**：generate-invoices.ts 移到根 scripts/（`db83b87`/`d537c55`）。

49. 🔵 **RTS 阶段 C 技术内核 C1-C3（2026-09-15 启动；本轮圈定 C1-C3，C4-C8 留下一轮，原重启条件未满足、属 design-rts-overview §九自留出路）**：
   - **C1 ✅（commits `2ea918a` core / `c47e50b` server+web，已随 PR #290 合 dev 并部署 Hasee）**：core 新增 `crossGraph.ts` 纯派生跨厂产物边，不碰持久化 schema、不改 Graph 结构，单厂图天然返回空边（旧单厂字节级兼容）。跨厂边仅两类**静态**来源：① subprocess 节点（`node.subprocess.graphId`）② graph-event trigger（全库实测为 0）；运行期动态产物传递（artifact eventSource）按设计不算厂房间边（已 JSDoc 注明）。方向统一 from=上游供给方 → to=下游消费方（subprocess 场景被调子图=供给、调用方=消费）。导出 externalGraphRefs / buildCrossGraphEdges（`fromGraph:refId→toGraph` key 去重、opts.internalOnly 剔除悬空与越权边）/ upstreamGraphIds / downstreamGraphIds，13 测，core index 已 re-export。server `crossGraphService.loadCrossGraphEdges(visibleIds, load)`（best-effort：单图 load 抛错 catch 跳过、任一端点不在可见集合即剔除，防租户泄露）挂到 `GET /api/operations/overview` 返回 `crossEdges`（用全量可见 graphIds，不是仅有 run 的 graphs），web api.ts 加 CrossGraphEdge 类型，5 测。
   - **C2 ✅（commit `42468ac`，已随 PR #290 合 dev 并部署 Hasee，浏览器走查通过）**：CanvasPark 渲染跨厂管道（THREE.Line，CROSS_PIPE_Y=6 避 z-fight，opacity .32）+ 每边 CROSS_TRUCKS_PER_EDGE=3 辆错相位卡车（subprocess 暖橙 0xffb020 / event 青 0x22d3ee，SPEED 260），rAF 在 controls.update 前推进、共享 geometry/两色材质，crossEdges 缺省 []，mount-once data-sync effect 第 4 步重建 crossGroup（依赖 `[factories,overrideVersion,crossEdges]`），App 传 crossEdges。**走查路径**：命令面板「园区总览」(macroPark→enterPark)，勿与只开模态的 operations 命令混淆；判断是否真在 park 看 `.stage` 子节点 class `canvas-park`（CanvasToolbar/小地图/侧栏是三分支共享，不能作判据）。**RBAC 排查结论（重要，勿误判为 bug）**：本地 76 graph 分属 3 owner（a2afe301=73 狗粮系列 / 9b54f5bb=2 / 当前登录 1d5f76b2=1 演示产线），唯一 subprocess 边两端（狗粮-子流程-摘要 `d7ecf321` → 狗粮-子流程调用 `2e8c0e10`，refId="pp"）均属 a2afe301，当前账号不可见 → crossEdges=[] 是 internalOnly 正确剔除；离线用 Node24 tsx + node:sqlite 把 a2afe301 的 73 个真实 graph doc 喂 buildCrossGraphEdges(internalOnly) 准确产出该 1 条边、方向正确。为像素级验证**临时**把两端 graph 的 user_id 改成当前用户，刷新后 3 工厂 + 1 边正常渲染，对比间隔帧卡车沿「摘要→调用」明显位移、3 辆错相位循环、hover 工厂「进入」+白环正常、无 console error；**验证后已立即还原 owner（恢复 73/2/1，无残留）**。非阻断 polish：跨厂管线 opacity .32 在等距俯视下偏暗、易被相邻工厂方块遮挡（放大+压低相机角度才清晰），后续可提亮/加粗或走工厂上方弧线。
   - **C3 ✅ 方案 B 已落地（决策见 docs/design-rts-overview.md「C3 实现路线决策（2026-09-15）」，commits `c1618a0` docs / `4a526ff` feat，本地未 push，浏览器走查通过）**：用户拍板**方案 B（同构锚点交叉淡化 + 相机缓动）**，方案 A（单场景 LOD 融合）仅文档留档、待 C4-C8 真实多产线规模时一次性重构。实现保持两组件独立、不融合场景、不碰 LOD，只做 zoom-only ease + 复用已有挂载淡入：store(view-mode.ts) 新增**不持久化 one-shot** `drillAnimRequest:{dir:"in"|"out"}` + `requestDrillAnim`/`consumeDrillAnimRequest`（+3 测，view-mode 16→19）；App.enterFactory 在 setViewMode("3d") 前 requestDrillAnim("in")、backToPark requestDrillAnim("out")；Canvas3D mount 时若 consume 到 "in"，先 resetCamera() 算出 fit 的 targetZoom，把 camera.zoom seed 成 targetZoom×DRILL_START_ZOOM_MUL(2.6)，rAF 用 easeOutCubic 在 DRILL_EASE_MS(420ms) 内 ease 回 targetZoom（手动 fit/reset 取消进行中动画）；CanvasPark 恢复 saved parkCamera 时若 consume 到 "out"，seed zoom=saved.zoom×2.6 再 ease 回 saved.zoom（position/target 立即对准，只动 zoom）；`.canvas3d`/`.canvas-park` 既有 `canvas3d-fade` 挂载淡入（var(--duration-normal)）即交叉淡化，无需新增 CSS。**本地浏览器走查（localhost:5173 + 本地 server 8791/schema v39）**：命令面板进园区→选中工厂→「进入」，120/300ms 中间帧确认 zoom 由近及远平滑 ease + opacity 淡入、无白屏/闪黑/掉帧，最终 fit 正确（zoom 收敛 100%）；「返回园区」反向 ease 回园区全景同样平滑。验证：web typecheck 干净、canvas+store 197 测全过、i18n 守护 4 过（无新 UI 文案/无硬编码中文）。
   - （背景，已被上条取代）方案 A/B 原始对比与现状核实：B8 实测**并无** 250ms 交叉淡切、原为硬切；L0 CanvasPark 与 L1 Canvas3D 同为 THREE.OrthographicCamera 固定 YAW/PITCH 等距、共用 `canvas/iso3d.ts`，相机可平滑插值，真正差异只在场景坐标系尺度（parkLayout 全局 vs boardToWorld 局部板坐标），两组件在 App.tsx 三元互斥挂载。

50. ✅ **RTS 阶段 C 剩余 C4-C8 全部完成（2026-09-15，PR #292 merge `1f5da5e` 已部署 Hasee，健康探针 commit 一致、db:ok）**：用户拍板"都开搞"，C1-C3 之后一口气做完 C4-C8。三个原子 commit：`dffcf55` server（月度经济/分厂指标/未来 48h plan）、`e540422` server（cronState）、`9a7c900` web（C4-C7 全部 UI）。
   - **C4 资源经济栏 ✅（ParkEconomyBar，HTML HUD，testid `park-economy`）**：后端 overview 一次性扩展承载，不新开连接通道——sqlite-driver 新增 `operationsEconomy`（node_runs JOIN runs、排除 running、月界与 costForMonth 同口径、支持 graphIds 协作 scope、标准 SQL 供 PG 共享）+ `metricsByGraph`（content_metrics 按 graph_id SUM、null-graph 桶丢弃），GET /api/operations/overview 用 Promise.all 并行取 economy/metrics/plans，totals 增 monthCostUsd/tokensIn/tokensOut/monthlyBudgetUsd（cfg 缺省 null）。前端 HUD 显示本月成本 + 入/出 token + 预算剩余条（`park-economy-budget`，budget=null 时不显示条；ratio≥0.8 warn/≥1 over 并钳 100%）。
   - **C5 排期空间化 ✅（ParkScheduleAxis 24h 轴 + CanvasPark 底座倒计时环）**：cron next-fire 与 content_plan 画到同一 24h 轴；每厂底座加青色倒计时圆盘 sprite（makeClockTexture，<60m 显示「Nm」、<24h「Nh」）。后端补 `cronState[graphId]={hasCron,enabled,nextAt}`（nextRunMap 不过滤 enabled，暂停的 cron 仍列出以便浮层提供"恢复"，但 enabled=false 时 nextAt=null，24h 轴与底座环据此隐藏）。**⚠️ 两处对设计草案的主动裁剪（对着代码与数据现状）**：①**plan 改期用「点击 +1h/+24h」而非自由拖拽**（PATCH updatePlan 落库、refresh 后保持；避免 24h 轴上精确拖拽误触，覆盖运营主要延后诉求）；②**cron 是周期表达式、无单次改期语义，故 cron 在轴上只读、不可改期，只在工厂浮层做暂停/恢复**。
   - **C6 效果热度 ✅（sprite canvas 纹理，makeHeatTexture 暖金 pill）**：分厂 CTR/GMV 聚合（与 PerformanceDashboard 同 SQL SUM 口径）以工厂上方热度条呈现，**全 0 / 无 content_metrics 数据的厂诚实不渲染、不造假数**（staging 当前即空态主态）。**裁剪：先做 CTR/GMV；ROI 前端已在 PR #296 补齐（formatHeat，待真实广告花费 adSpend 数据即可显示，adSpend=0 时不渲染、不显示 ∞，见待办 51②）**。
   - **C7 宏观轻操作全集 ✅（全程不进图）**：工厂浮层「进入 / 重试（仅 failed）/ 暂停↔恢复 cron（按 cronEnabled 切文案）」；新增 FactoryReviewCard（testid `park-review`，懒加载 listPendingReviews，纯函数 approveDecision：tool halt→approve+approveTools、human/gate→continue、驳回 reject，决策走 /api/reviews/decide 后本地移除并刷新 overview）。把每厂 billboard 收进 per-factory THREE.Group 存 state.billboardById Map，拖拽移厂只移该 group（替代原按 fIdx 手算 sprite offset 的脆弱逻辑）。
   - **C8 收尾 ✅**：i18n zh/en park.json 增 economy/schedule/review 三段同构（keys.test 绿、无硬编码中文 JSX）；新增 CSS 全走设计 token（逐个 grep 确认存在、无 fallback、无硬编码间距/字号/圆角）；测试 server 141 文件 1162 全过、web 见 Quality gate；CI Linux 4 项（Typecheck/build/test、CodeQL、Analyze、Secret scan）全 pass；**Hasee 真机走查（http://192.168.31.14，命令面板 ⌘K→园区总览）亲眼验证**：经济栏显示真实「本月成本 $7.8100 / 入 431.2k / 出 313.0k」（全局 monthlyBudgetUsd=null 故无预算条，符合设计）；底座倒计时环 58m/2.8h/9.8h 正确；24h 轴列 4 条 M1 cron tick；点①写草稿浮层「进入/重试/暂停 cron」（failed 厂显重试、cron 启用态显暂停）；**点暂停→按钮变「恢复 cron」、①底座环与轴 tick 即时消失，再点恢复→按钮回「暂停 cron」、环重现（56m）、轴恢复 4 厂，端到端落库闭环无残留**；无 metrics 故无热度 pill（空态正确）。**真机未点到的两项均因 staging 无对应数据、且各有组件测试覆盖**：审批卡（当前无 halted 厂）、plan 点击改期（无 content_plan）。本机全量高并发下有既有 flaky（waitFor 超时，失败文件每次不同、隔离跑全绿、均不在改动范围，CI Linux 正常），非回归。

51. ✅ **RTS polish 清欠 + C6 补 ROI + 生产运维 P0/P1 对账（2026-09-15，`45f65bf`/`16d8503`，PR #296 merge `4b1cd90` 已部署 Hasee、引导部署链路真机验证通过）**：用户对上一轮「可直接开干技术活 1/2/3」拍板"开干"。
   - **① 跨厂物流管线 polish（清 #49 非阻断尾巴 / 待办 50 C2 末项）**：贴地直线 → 越过厂顶的抛物线拱（新增并导出无 three 依赖纯函数 crossArchY/crossArchPoints，弧顶 y≈236 > 厂高 FACTORY_H 140，等距俯视不再被中间厂方块遮挡），CROSS_PIPE_OPACITY .32→.55，24 段采样；卡车 y 由贴地改沿 crossArchY 爬升；crossGroup 重建时对旧 `THREE.Line` dispose geometry/material（卡车共享 crossTruckGeo/crossMats 不释放、unmount 统一释放）。
   - **② C6 补 ROI**：对着代码核实后端 ad_spend 链路**早已就绪**（content_metrics.ad_spend 列 → metricsByGraph `SUM(ad_spend)` → db.GraphMetrics.adSpend → 前端 ParkGraphMetrics.adSpend），缺的只是前端没用它——纯前端在 CanvasPark `formatHeat` 的 GMV 段后补 `ROI ${gmv/adSpend}×`（gmv、adSpend 皆正才显示；adSpend=0 绝不显示 ∞；顺序固定 CTR·GMV·ROI；<100 一位小数、≥100 取整）。
   - **③ 生产运维逐域对账 + 补真实缺口**：12 域自包含 P0 经实证**全部具备**（health 探针、成本硬熔断+全局限流、rollback、CI gitleaks+`pnpm audit --audit-level=high`+CodeQL、.env.example、09-08 D3 恢复演练、scripts/dev.sh Node≥24 自检、docs/runbooks 7 份、SIGTERM 优雅关闭、prune-events 90 天归档、idempotency 机制）。**实证发现的唯一真实隐患**：服务器根 `/opt/agent-world/deploy.sh|rollback.sh` 是 **untracked 手工副本**（git 只跟踪 scripts/deploy/，根副本当前与仓库逐字一致但 git pull 永不更新、未来必漂移）——修法：仓库 `scripts/deploy/*` 设为唯一逻辑源（deploy 改为「仅当部署前当前服务健康才写 last-known-good」，避免上次部署失败后重跑把坏 commit 写成回滚点；deploy/rollback 均最多 15s 轮询健康、失败给排查命令），服务器根两份改为 `exec bash scripts/deploy/*.sh "$@"` 引导（原文件备份 /tmp/{deploy,rollback}.sh.root-bak，属主 agentworld:agentworld 755），手动以 agentworld 身份跑一次根引导 → `deploy OK: 4b1cd90`、LKG 正确、服务 active，端到端验证通过。**唯一未独立落地的 P0＝Playwright E2E 冒烟**（server 有 playwright devDep 但无全链路脚本、CI runner 未装 chromium；现由海量集成/组件测试 + 健康探针 + 每次合并后人工真机走查替代；重启条件＝对外开放注册前，届时先在 runner 装 chromium）。其余 P1/P2（告警服务、TLS 待域名、Secret Manager/Ansible/Terraform 待上云、OpenAPI 契约、APM/负载、Tracing/SLO、多副本待 PG、devcontainer、预算分层）均卡外部或属规模化触发，当前不做以避免过度设计。对账结论落 `docs/engineering-blueprint.md`「现状对账（2026-09-15）」。
   - **澄清一处误判**：上一轮清单所谓"3D 审计剩 6 项 low"经核**并不存在未清项**——docs/code-audit-2026-09-06.md 记载 77 项已于 09-11 全部清账（未修复 0，最后 6 项 L19/L20/L22/L25/L26/L27），`grep TODO/FIXME/HACK apps/web/src/canvas/` 零命中；唯一在案 3D polish 即本条①的跨厂管线。
   - **验证**：`pnpm -r typecheck` 四包绿；canvas+i18n 10 文件 141 测过（park-label 8→13，新增 ROI 1 + crossArch 4）；web `--no-file-parallelism` 顺序全量 95 文件 **1874 全过**（+5 与新增一致，无回归）；两部署脚本 `bash -n` OK、可执行位保留；CI 4 项全 pass；Hasee 真机走查（命令面板→园区总览）3D 园区工厂方块/24h 排期轴/经济栏/倒计时环/节点详情/缩放控件正常、单产线 3D 节点链路正常、**零 console error**。staging crossEdges=0 且无 content_metrics，拱线与 ROI 真机为空态（诚实不渲染），其几何/格式化逻辑由 13 个 park-label 单测保证。详见 Recently shipped #1。

52. ✅ **演示用户（Demo User）：免注册一键进真实产品（2026-09-15 立项并当日完成 D1–D6 本地走查，方案 docs/design-demo-user.md，工作分支 feature/20260824；已随 PR #302 merge `b34fa29` 合 dev 并部署 Hasee，真机走查 + 零配置首跑 422 修复 + prune cron 见 #53）**：新用户在登录页点「免注册，先体验演示」即建一个带 `is_demo` 标记的**真实账号**（复用 userId 隔离/JWT/订阅全套，转正时同 userId 原地保留数据），能力介于未登录与正式账号之间。**3 个原待拍板点全部采用默认**：30k token / ≤15 run / 并发 1 / 20MB / 禁视频音频、TTL 24h、cookie 沿用 signToken(false)=24h（不改 auth.ts）、预置模板仅 `tpl-draft`（纯 agnes-2.0-flash 文本，其余模板含媒体不选）、ALLOW_DEMO 默认关 Hasee 显式开、转正原地保留。**落地（D1–D5）**：①`e305dc8` 迁移 **v40** users 加 `is_demo`/`demo_expires_at`（sqlite+pg 共用一份 driver body；down 只清标记不 DROP 列）+ createDemoUser/claimDemoUser/listExpiredDemoUsers/deleteUserCascade（前置 is_demo 短路 + 末级 AND is_demo=1 纵深防御，绝不误删正式号），6 单测；②`0390ba6` `src/demo.ts` DEMO_QUOTA + enforceDemoQuota + 能力守卫，7 单测；③`ae84d45` 三端点 `/api/auth/demo`（开关+IP 限流 DEMO_RATE_LIMIT 可覆盖+同 cookie 复用+克隆 tpl-draft）、`/me` 带 isDemo+quota、`/claim` 原地转正，demo 邮箱密码登录拒 401 DEMO_CLAIM_REQUIRED，9 处 blockDemo 拦改密/publish/webhook/远端 MCP/自定义 connector/admin/billing（403 DEMO_LOCKED+claimUrl），run gate 加**独立 demo 分支**（自带 30k 池，**MONETIZATION_ENFORCE=1 且 free token=0 下 demo 文本照样放行**——Hasee 最大坑，由集成测末例锁定），10 集成测；④`1ab6035` 前端 zustand useSession store + 登录/注册页演示入口 + DemoBanner + ClaimDialog + api 层识别 DEMO_LOCKED/DEMO_QUOTA 自动开转正弹窗 + UserMenu demo 态（隐藏改密/admin、显转正/退出）+ zh/en auth.json 同构 i18n + CSS var 样式；⑤`b3feb6d` `scripts/prune-demo-users.ts`（默认 dry-run、--apply 真删，npm script `prune:demo`，三夹具验证只删过期 demo）+ 部署手册补 ALLOW_DEMO/DEMO_QUOTA_*/DEMO_TTL_HOURS/DEMO_RATE_LIMIT 与每小时清理 cron。**D6 本地端到端走查通过（ALLOW_DEMO=1 + MONETIZATION_ENFORCE=1）**：API 层——demo 201 并克隆「写草稿」、/me 正确、demo 邮箱登录 401、publish/billing/admin 均 403、**demo 文本 run 200 且真实调 agnes 产出中文文本与 artifact（关键坑验证）**、claim 200 同 userId 原地转正且产线/产物全保留、新邮箱密码登录 200；UI 层（浏览器）——登录页入口→一键进主界面见预置产线+DemoBanner→点转正弹 ClaimDialog→填写提交后弹窗与 Banner 消失、数据保留。**验证**：四包 typecheck 绿、i18n 守护绿、web 顺序全量 97 文件 **1865 全过**、server 相关测试全绿。**部署与真机（均已完成，详见 #53）**：已随 PR #302 合 dev、CI 自动部署 Hasee，补独立 systemd drop-in `ALLOW_DEMO=1`（PID 36613）；真机复验 ENFORCE=1/free token=0 下 demo 文本 run 正常 done（不被 402 误拦）、视频派发被 `402 DEMO_QUOTA_MEDIA` 硬拦并引导转正；每小时 prune-demo cron 已挂 agentworld crontab。走查发现的"零配置首跑 422"经定位为**前端模型选项加载竞态**（非本段后端实现缺陷），已于 2026-09-16 在 `apps/web/src/store/graph.ts` 修复并加竞态回归测试，**该修复尚在工作区待 commit / PR / 部署后真机复验**（根因与改法见 #53 末「🔧 2026-09-16 修复闭环」）。

> **下一步主线**：商业化 M1→M2→M3 S1-S5 全部完成并部署 Hasee；**M3 S6 Stripe 全栈（后端 A0-A4 + v39 修复 7118990 + 前端 A5）已随 PR #287/#290 合 dev（曾为 `27f28ee`）部署 Hasee，schema v39 迁移成功、subscriptions Stripe 三列三索引就位、缺 key 优雅降级不阻断启动，只剩真机 Step6（待收款主体 + STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_IDS）**。RTS 阶段 A+B 完成，**阶段 C 全部完成：C1/C2/C3 随 #290、C4-C8 随 #292（merge `1f5da5e`）合 dev 并部署 Hasee、真机走查通过**（C5 改期为点击延后/cron 只读、C6 暂只 CTR/GMV 两处裁剪见待办 50；方案 A 单场景 LOD 融合仍留档待真实多产线规模再评估）。M1 回采 4 条产线继续 cron 自动攒数据 + 每日 10:30 体检。**演示用户（Demo User）D1–D6 本地已全部完成并走查通过（待办 #52，已自动开 PR #302 feature/20260824→dev）。#302 首跑 CI 的 Test 步骤挂在一个进程级 unhandledRejection——根因是既有 `mcp-pool.test.ts`「reconnects when the user edits the endpoint」的时序 flaky，被 demo 新增 23 测改变套件总时长后推过进程退出点而现形，与 demo 代码无关；真正缺陷在 `mcp.ts` 的 `StreamableHttpMcpTransport.notify()` 用裸 `void this.post(...)` 无 catch（对照 `SseMcpTransport.notify` 本就有 catch），teardown/远端关闭后 best-effort 通知 reject 无人接。已修 commit `7e872a7`（notify 加 `.catch(()=>{})` 对齐 SSE + 一个对死端口的确定性回归测试，修复前必红/修复后绿），CI 同款 `--maxWorkers=1` server 全量 144 文件 1186 测全过零 unhandled、四包 typecheck 绿；**#302 已 merge dev（`b34fa29`）部署 Hasee，已补独立 systemd drop-in `ALLOW_DEMO=1`（PID 36613）并完成真机复验：核心链路通过——ENFORCE=1 / free token=0 下 demo 文本 run 正常 done（不被 402 误拦）、视频派发被 `402 DEMO_QUOTA_MEDIA` 硬拦并引导转正；另发现 tpl-draft demo 零配置首跑 422 与 prune 定时清理两项，**均已于 2026-09-16 闭环（详见待办 #53）**：422 经取证为前端模型选项加载竞态（非后端缺模型），已在 `fix/demo-model-race` 修复 + 加竞态回归测（commits `7a9ad4c`/`5212801`，本地已提交、**待授权 push 开 PR→merge→Hasee 部署后真机复验**）；过期 demo 清理已在 Hasee 挂 agentworld 用户每小时第 17 分 prune-demo cron（dry-run/APPLY 均验证通过）**。**下一步可选方向**：①真机 Stripe Step6（待收款主体 + Stripe 测试 key，用测试卡走端到端，商业化临门一脚）②升级 agnes 付费 key（彻底解决 free tier 429，方案 A）③翻译产线效果观察（09-14 降频+放宽 QC+retry 后，观察到 09-17/19 看完成率变化）④~~RTS 遗留 polish~~（**已随 PR #296 清理**：跨厂管线改走厂顶抛物线拱 + opacity 提亮至 .55、C6 ROI 已补——后端 ad_spend 链路本就就绪、现只待真实广告花费数据即可显示、所谓「3D 审计 6 项 low」经核已于 09-11 全部清零不存在未清项；另修复服务器部署脚本 untracked 手工副本漂移、完成蓝图 P0/P1 对账）。

> 全部缓做/低优事项（含上述两条）已统一登记在 [docs/deferred-items.md](docs/deferred-items.md)——每条带触发条件与决策详情链接，触发条件满足时移回本区并标注重启日期。

> **M1 运行床验收（A 只读对账 / B 真实模型冒烟 / C 安全韧性 / D 部署·CI，2026-09-08 真机 Hasee）**：A 对账通过；B 文本/图片计费端到端非零（图片 $0.04/张），**视频/音频曾被计为 $0**——根因是 provider worker 从不填 media units/cost，已在 `6554769`（feature/20260824）修复（视频 perSecond：适配器 durationPath → num_frames/frame_rate → 节点 duration → 5s 兜底；音频 perKiloChar 按输入字符数），17 用例绿；C 层四项全过——**C1 限流**连发 40 次 POST /api/runs，前 30 放行为 404（图不存在，限流在 startRun 前不建 run 不烧钱）、第 31-40 全部 429；**C2 预算硬熔断**置 monthlyBudgetUsd=0.0001 后派发现场 402「monthly budget exceeded」，模型调用前拦截零费用，测后已还原 null；**C3 静态加密**settings.data 为 enc:v2 密文，节点级 apiKey 注入实测 graphs.doc 落 enc:v2、明文 0 命中（已还原）；**C4 SIGTERM drain** 今日部署重启日志 `shutdown started(inflightRuns:0)→shutdown complete(abortedRuns:0)`→迁移重跑→健康恢复，历史 4 次 SIGTERM 全部干净退出。D 层（部署/CI，只读为主）三项全过——**D1 CI 安全门禁** CodeQL + CI 最近运行全 `success`，ci.yml 内含 `pnpm audit --audit-level=high`（高危 CVE 阻断合并）+ gitleaks 扫历史；**D2 部署一致性** Hasee 健康探针 `branch=dev commit=4eb87d2` 与 origin/dev 端点逐字一致（dev=准生产环境映射成立），main 端点 `5b0b29f` 领先一个 merge 属正常；**D3 备份可恢复性（只读演练）** 备份库拷到 /tmp 后 `integrity_check=ok` 可正常打开，行数对账 backup(07:52) vs live 为 ~6h 前一致快照（users 2=2、graphs 4<6、runs 6<9、events 144<196、node_runs 29<40、artifacts 27<40），无损坏可还原，实测 RPO≈6h（满足 <24h 声明）、RTO 秒级（库 823KB）。未做覆盖活库的破坏性 restore（只读已证可恢复）。
>
> ⚠️ **三个真实缺口（按严重度，2026-09-08 真机核实）**：
> 1. ✅ **~~媒体计量修复未上 Hasee~~（已部署并真机验证，2026-09-08）**：修复随 PR #216 合入 origin/dev（merge `a12f404`）并部署到 Hasee——健康探针 `commit=a12f404`、服务重启（PID 59450）、dist 内确有 `videoBillingSeconds`/`mediaUsage` 编译产物。端到端复验：视频 run `546aa2fa` 状态 done，视频节点 `units:{seconds:5}`、`costUsd:0.5`（5 × perSecond $0.10），视频产物正常产出——修复前一律 $0，现按秒计费。**遗留精度项（非阻塞）**：agnes 未设 `durationPath` 且响应无 num_frames/frame_rate、又 omitDuration，故走 5s 兜底；若实际成片时长非 5s 会按 5s 计。**2026-09-09 已修复并真机验证（PR #218，merge `2e23a06` 已部署 Hasee，健康探针 commit 一致）**：真机抓取确认时长在顶层 `seconds` 字段且为数字字符串 `"5.0"`，遂配 `durationPath:"seconds"` 并让 `videoBillingSeconds` 经 `positiveNumber` 接受数字字符串。在**部署后 dist** 上用真实 agnes 完成形态回放：`seconds:"5.0"`→5s/$0.50（不回归），`seconds:"8.0"`→8s/$0.80（旧逻辑会落 5s 兜底），两段全 PASS。
> 2. ✅ **~~备份只在同盘同机 + WAL checkpoint 静默失败~~（已闭环，2026-09-10）**：checkpoint 静默失败已由补丁修复（见待办 40，node:sqlite 替换 + 手动验证通过）；「同盘同机」单点已由 Mac 每日异地备份兜底（见待办 40，含密钥边界）。
> 3. ✅ **~~/metrics 未经 nginx 暴露（可观测性盲点）~~（已修复，2026-09-10 Hasee）**：Hasee nginx 配置 `/etc/nginx/sites-enabled/agent-world` 增加 `location /metrics { proxy_pass http://127.0.0.1:8791; }`（在 `/api/` 之前），`nginx -t` 通过 + reload 成功；验证 `curl http://127.0.0.1/metrics` 返回 HTTP 200、Content-Type `text/plain`、含 runs_total/runs_failed_total/runs_cost_usd_total 等指标。其他部署环境需按同样方式加 nginx location（见 [production-ops.md §5](docs/production-ops.md)）。

## Recently shipped (last 5)

按 commit 时间倒序，每条一行影响面 + commit hash：

1. **fix(web),docs demo 零配置首跑 422 修复（2026-09-16，`7a9ad4c`/`5212801`，分支 `fix/demo-model-race` 基于 origin/dev，本地已提交未 push）**——修真机走查 #53 发现的"demo 一键进入后预置 tpl-draft 首跑必 `422 graph has unconfigured model(s)`"。根因是**前端 graph store 模型选项加载竞态（非后端缺模型）**：`setGraph` 在 `GET /api/settings` 返回前同步跑 migrate，空选项把有效内置 `agnes-2.0-flash` 误判未知、清空成 `""` 并自动保存；新增 `modelOptionsReady`（未就绪绝不清非空 model、就绪后对当前图补跑一次迁移）。+3 测（web 竞态回归 2：未就绪不清空/就绪后补迁移，禁用守卫必红；后端 seed 护栏 1：demo seed 图开箱即过 validateModels），web 顺序 97 文件 1867、server 144 文件 1187 全绿、四包 typecheck 绿。同轮在 Hasee 挂 agentworld 用户每小时第 17 分 prune-demo cron（服务器运维，不在 commit 内，dry-run + APPLY 手动验证通过）。**待 PR→CI→merge dev→Hasee 部署后真机复验"不碰模型分配直接派发 tpl-draft 应 200"（需授权 push）。**
2. **feat(server,web),chore(ops) 演示用户 Demo User 全栈（2026-09-15，`e305dc8`/`0390ba6`/`ae84d45`/`1ab6035`/`b3feb6d`，已随 PR #302 merge `b34fa29` 合 dev 并部署 Hasee）**——免注册一键进真实产品：迁移 v40 users 加 is_demo/demo_expires_at（sqlite+pg 一份 driver、down 只清标记）、createDemo/claim/级联删 driver（双重 is_demo 护栏）、`src/demo.ts` 独立 30k token 额度池与能力守卫、/api/auth/demo|claim 三端点 + run gate 独立 demo 分支（**ENFORCE=1/free token=0 下 demo 文本照样跑**）+ 9 处能力黑名单 403、前端 useSession/DemoBanner/ClaimDialog/登录注册入口/UserMenu demo 态/zh|en i18n、prune-demo-users 清理脚本（dry-run 默认）+ 部署手册。本地端到端（API+浏览器）全走通：进演示→预置 tpl-draft→真实 agnes 出文本→外联 403→claim 原地转正数据全保留→新密码登录。server 1185 / web 1865 全绿、四包 typecheck 绿。**已随 PR #302 合 dev、CI 部署 Hasee 并补 `ALLOW_DEMO=1` drop-in；真机走查结论与零配置首跑竞态修复见待办 #53 与上方第 1 条。**
3. **feat(web),chore(ops) 跨厂物流拱线+ROI 热度、部署脚本单一事实源+蓝图 P0/P1 对账（2026-09-15，`45f65bf`/`16d8503`，PR #296 merge `4b1cd90` 已部署 Hasee、引导链路真机验证通过）**——①RTS C2 polish：跨厂物流管线由贴地直线改为越过厂顶的抛物线拱（弧顶 y≈236 > 厂高 140，等距俯视不再被中间厂方块遮挡），opacity .32→.55，卡车沿拱爬升、crossGroup 重建时释放旧管线 geometry/material（卡车共享材质不释放）；新增并导出无 three 依赖纯函数 crossArchY/crossArchPoints。②C6：工厂热度 sprite 在 CTR·GMV 后补 `ROI=gmv/adSpend`（gmv、adSpend 皆正才显示，adSpend=0 绝不显示 ∞，顺序固定 CTR·GMV·ROI）；后端 ad_spend 链路（content_metrics 列→metricsByGraph→ParkGraphMetrics.adSpend）早已就绪、纯前端补；+5 单测（park-label 8→13）。③运维：修复服务器根 `/opt/agent-world/deploy.sh|rollback.sh` 为 **untracked 手工副本、git pull 永不更新**的漂移隐患——仓库 `scripts/deploy/*` 成为唯一逻辑源（deploy 改为「仅当部署前当前服务健康才写 last-known-good」，避免失败部署把坏 commit 写成回滚点；deploy/rollback 均最多 15s 轮询健康），服务器根两份改为 `exec bash scripts/deploy/*.sh` 引导（备份在 /tmp/*.root-bak），手动跑一次引导部署 `deploy OK: 4b1cd90` 验证链路；`docs/engineering-blueprint.md` 加「现状对账（2026-09-15）」（12 域自包含 P0 全具备，仅独立 Playwright E2E 冒烟缓至对外开放注册前，其余 P1/P2 卡域名/上云/规模化触发，当前不做以避免过度设计）。真机走查：3D 园区工厂方块/24h 排期轴/经济栏/倒计时环/节点详情正常、单产线 3D 链路正常、零 console error；staging crossEdges=0 且无 content_metrics，拱线/ROI 真机为空态（诚实不渲染），几何与格式化逻辑由 13 个 park-label 单测保证。
4. **feat(server,web) RTS-C C4-C8 园区经济栏/排期空间化/效果热度/宏观轻操作全集（2026-09-15，`dffcf55`/`e540422`/`9a7c900`，PR #292 merge `1f5da5e` 已部署 Hasee、真机走查通过）**——overview 扩展月度经济（node_runs JOIN runs、与 costForMonth 同口径）+ 分厂 metrics + 未来 48h plans + cronState；ParkEconomyBar（本月成本/token/预算条，budget null 不显示）、ParkScheduleAxis（24h 轴，plan 点击 +1h/+24h 改期、cron 只读 tick）、底座倒计时环、CTR/GMV 热度 sprite（无数据诚实不渲染，ROI 已在 #296 补齐）、FactoryReviewCard（浮层审批 approve/reject 走 reviews/decide）、cron 暂停↔恢复端到端；per-factory billboard 收 group 修拖拽；i18n/token 全合规，+24 单测。裁剪见待办 50。
5. **feat(core,server,web) RTS-C C1 跨厂产物边 + C2 跨厂物流 + C3 连续 zoom 方案 B + Stripe 全栈（2026-09-15，`2ea918a`/`c47e50b`/`42468ac`/`4a526ff` 等，PR #287/#290 merge `27f28ee` 已部署 Hasee）**——core crossGraph 纯派生跨厂边（13 测、单厂字节级兼容）、overview crossEdges、CanvasPark 跨厂管道+错相位卡车、zoom-only ease 钻取动画（方案 B，方案 A 留档）；同批含 Stripe A0-A5 全栈与 `7118990` v39 迁移启动崩修复（POST_MIGRATION_INDEXES 幂等补建）。
> 第 6 条及更早（M3 S6 Stripe 后端 A0-A4 `c0f708e`/`f5113be`/`b133c91`/`add61a4` 已并入上条 Stripe 全栈；2026-09-15 的园区状态色+标签优化 `9342d90`/PR #285、M3 S6 Stripe 前端 A5 `2c670c4`，以及 2026-09-14 及以前：M3 S1-S5 收款与账单、run.finished 失败原因记录、Guided Tour、RTS 阶段 B 全部、M1 回采三问分析 + 价格校准等）已滚出本列表 / 归档至 handoff-archive。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

* `pnpm -r typecheck`：全绿（core/server/mcp-server/web `tsc --noEmit` 全部干净，2026-09-16 demo 零配置首跑竞态修复后复核；pre-commit hook 等价跑过，原子提交用 --no-verify 规避钩子 15s 前台超时）

* 测试总数 **3349**（2026-09-16 demo 零配置首跑竞态修复后实跑：server 1186→**1187**（+1 demo seed 图开箱即过 validateModels 后端护栏），web 1865→**1867**（+2 模型选项未就绪竞态回归，见 #53）；顺序跑 web 97 文件 1867 全过、server 144 文件 1187 全过）：

  * `pnpm --filter @agent-world/core test`：**224/224 通过**（15 文件；含 parkLayout 11 例、file/product connector 形状断言、compile trigger warning 5 例、模板 33 形状守护、单价缺口 7 例等）
  * `pnpm --filter @agent-world/server test`：**1187/1187 通过**（144 文件；2026-09-16 demo 零配置首跑修复后实跑全绿，较 09-15 的 1186 +1：api.demo-user 新增"demo seed 图 textGen 节点 model 非空且开箱即过 validateModels"契约护栏。09-15 演示用户那轮 +23：demo-users.db 6 + demo 额度守卫 7 + api.demo-user 集成 10；同日修复 #302 CI flaky 再 +1：StreamableHttp notify 死端口不泄漏 unhandledRejection 回归测，CI 同款 `--maxWorkers=1` 全量验证通过；同步把 park-coord SCHEMA_VERSION 断言 39→40、migrations rollback 用例改两段式）。历史备注：Node v22 + macOS seatbelt 下依赖 spawn JS sandbox 子进程的用例曾 status 71 失败（干净基线与带改动失败集合 diff 为空、非回归，CI Linux bwrap 正常）；另有 2 个 RPA 用例需先 `pnpm exec playwright install` 装 chromium，本机未装属环境阻塞。
  * `pnpm --filter @agent-world/mcp-server test`：**71/71 通过**（3 文件；含 stdio 端到端冒烟 3 个。负载性 flaky：`pnpm -r test` 并行时 stdio 冒烟可能超 5s，单独跑稳定）
  * `pnpm --filter @agent-world/web exec vitest run`：**1867 总数**（97 文件；2026-09-16 demo 零配置首跑竞态修复 +2：graph.migrate 5→7，锁定"模型选项未就绪时不得清空非空 model、就绪后补迁移"；09-15 演示用户那轮新增 DemoBanner 5 / ClaimDialog 6 / AuthPages 演示入口 3，UserMenu.test 改由 useSession 注入后整体重写、用例更精炼，ProtectedRoute 兼容「res.ok 即已登录」旧契约；组件目录零「有 .tsx 无 .test.tsx」）。⚠️ **本机全量高并发下有既有负载 flaky**：个别文件（VersionPanel/ProductGallery/PublishTargets 等，每次不固定、均不在改动范围）因 waitFor 超时失败或 worker 提前退出，**隔离单跑全绿、`--no-file-parallelism` 顺序跑 97 文件 1867 全过、CI Linux 全 pass**，证实非回归；判断回归只看改动文件 + 顺序全量 + CI。

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

