# Handoff

State of Agent World as of 2026-09-18.

> **历史内容已归档**：2026-08-27 之前的全部变更记录、各阶段详细描述、质量门与已知 gap，已整体搬到 [docs/handoff-archive.md](docs/handoff-archive.md)。本文件只保留"项目当前状态 + 活跃任务 + 最近 5 个变更"。

## Project documents

📚 **文档地图（按场景怎么读 + 状态约定）**：[docs/README.md](docs/README.md)。以下为全部文档直达（本区是完整清单的单一事实源，README 只做场景导航、不重复清单）：

* [docs/PRD.md](docs/PRD.md) — phased roadmap and architectural guardrails
* [README.md](README.md) — two core design decisions, layout, running instructions
* [BENCHMARK.md](BENCHMARK.md) — 性能基准测试：运行方式、范围、结果记录表

* [docs/technical-design.md](docs/technical-design.md) — architecture, data models, API

* [docs/roadmap-generalization.md](docs/roadmap-generalization.md) — 通用化路线图（当前主线，5 阶段）

* [docs/deferred-items.md](docs/deferred-items.md) — 缓做/低优事项登记表（挂起项 + 触发条件的单一事实源）

* [docs/competitor-painpoints.md](docs/competitor-painpoints.md) — 竞品痛点调研（Dify/Coze/n8n 等 6 类共性痛点 + 现状对账 + G1-G7 增强建议，P0=步级 trace/上游数据契约护栏）

* [docs/design-step-trace-and-robustness.md](docs/design-step-trace-and-robustness.md) — 竞品 P0/P1 落地方案（G1 步级 run 时间线+从节点 fork 重跑 / G2 上游数据契约空值护栏 / G4 长任务超时降级续跑 / G3-G5 补充决策）；**G1 只读链路 + G2.1/G4.1 纯函数随 PR #319 合 dev（2026-09-16）；G1.2 fork、G2.2 engine 契约接线、G3 重试下放、G4.4 本次运行内视频轮询已于 2026-09-17 在 feature/20260824 落地并随 PR #325 合 dev（merge `fb00657`，见 Active work #55 续）；G2.4/G4.2/G4.3/G4.4 跨 run 续跑仍留待；G5 已于 2026-09-18 落地并随 PR #331 合 dev（merge `26ec4a5`，已部署 Hasee、health 探针 commit 一致，见 Active work #55 续二）**

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
* [docs/design-demo-user.md](docs/design-demo-user.md) — 演示用户（免注册一键进真实产品，is_demo 标记真实账号 + 体验额度 + demoGuard 能力黑名单 + claim 原地转正 + TTL 级联清理；迁移 v40、D1-D6 分步。**D1–D6 已随 PR #302 合 dev 部署 Hasee 并真机走查；零配置首跑 422 经两轮修复（PR #305 `5812aca` + PR #307 `76dbd42`）已真机闭环、Hasee 已挂每小时 prune-demo cron，详见 handoff #52/#53 与该文档 §十六**）
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

* [docs/design-canvas-isometric.md](docs/design-canvas-isometric.md) — 画布等距 3D 展示视图设计（受限 3D：俯角固定 + 水平旋转 + 平移；2D/3D 一键切换；**五期均已实施**——第五期（2026-09-17）为 3D 视觉打磨六项 + textGen 写实工业厂房原型，另含 jsdom 测试约束）

* [docs/design-guided-tour.md](docs/design-guided-tour.md) — 新用户分步引导 Guided Tour 设计（聚光灯分步教学 + 上一步/下一步/跳过；§十二 多引导注册中心：引擎与定义解耦、引导即数据、版本化 seen、What's-new/⌘K 动态注册，**已落地**）

* [docs/design-rts-overview.md](docs/design-rts-overview.md) — RTS 宏观上帝视角设计总览（L0 工业园区 / L1 单厂 3D / L2 节点三层缩放；六类宏观信息；A 平面工作台→B 宏观沙盘 MVP→C 完整 RTS；**阶段 A/B 已完成，阶段 C 全部完成（C1-C3 随 PR #290、C4-C8 随 PR #292 合 dev 并部署 Hasee、真机走查通过；C5/C6 两处裁剪与方案 A 留档见待办 #50）**）

* [docs/examples.md](docs/examples.md) / [docs/extending.md](docs/extending.md) / [docs/integrations-future.md](docs/integrations-future.md) — 模板示例 / 扩展指南 / 未来集成（Notion/Linear/邮件/内容平台）

* 历史（决策记录，勿据此实现）：[docs/product-vision-discussion.md](docs/product-vision-discussion.md) / [docs/tech-stack-assessment.md](docs/tech-stack-assessment.md) / [docs/roadmap-tasks.md](docs/roadmap-tasks.md)

* 根目录元文档：[CHANGELOG.md](CHANGELOG.md)（变更日志） / [CONTRIBUTING.md](CONTRIBUTING.md)（贡献指南） / [AGENTS.md](AGENTS.md)（AI 行为规范：commit / i18n / UI 文案约定，**新会话必读**） / [git-commit-message.md](git-commit-message.md)（commit message 详细规范）

## Current state

* **Monorepo**：`packages/core` / `packages/server` (Node + sqlite, 端口 8791) / `apps/web` (Vite, 端口 5173)

* **核心能力**：5 类 AI 生成节点（textGen / imageGen / videoGen / audioGen / generic）+ **通用节点（HTTP 请求 / 代码执行 / 条件分支 / 映射 / 循环 / 并行聚合 / 表格处理 / 数据库查询 / 文件解析 / 翻译 / OCR / 文件转换 / 搜索 / 通知 / 人工审批 / 子流程 / 合规 / 发布 / 扇出 / 择优）**，节点类型共 29 种（`NodeKind`，按 `NODE_CATEGORIES` 五组：AI 加工 5 / 车间调度 9 / 物料处理 7 / 外接设备 6 / 投料出料 2），**Phase 4 编排能力全部落地（2026-08-30 复核）：人工审批 human 节点 / subprocess 子流程调用 / graph 变量跨 run 持久化 / error 边 + catch 容错路径 / 失败级联 skip / 节点级重试基建（search/http/code/translate）/ 失败告警 + rerun；状态机按决策缓做**，**MCP Server（stdio + HTTP/SSE 双传输，15 工具 + resources + prompts + 实时 notifications 桥接 + Authorization Bearer 认证，P0-P2 全部落地）**，多产线管理，Inspector 模型下拉严格按 modality 过滤，多模态产出（Artifact 分层），流式 + SSE + 断线重连 + halt/resume，成本电表（token + 单价两种模式），评估体系雏形，产物落库归属流水线（artifacts 的 graph\_id/role），**版本管理补强（2026-08-30）**：保存前自动快照（节流 + 每图滚动保留 30 条）+ 版本与最近 run 的 content hash 关联标记 + 只读恢复预览（结构摘要 + SVG 缩略图），**模板参数化全链路（2026-08-30）**：TemplateField 实例化应用（core）+ fieldValues API（server）+ TemplateFieldDialog 参数表单（web 双入口，4 个 HTTP 模板声明 URL 字段），**术语表弹窗（2026-08-30）**：GlossaryModal 标准术语 ⇄ Agent World 游戏化用词对照（design-glossary.md 单一事实源），**Inspector 交互修复（2026-08-30）**：面板改为显式**点击**节点才展开、拖拽节点不再误弹（store.inspectorOpen 信号驱动），**模板能力释放（2026-08-31）**：18 个实用模板覆盖主要节点能力（含 loop 批处理 / vcs / convert+ocr / search+TTS），现有模板容错加固（error 边兜底），routingWorker 补视频音频路由（此前 videoGen/audioGen 生产被静默跳过），**模板分类展示（2026-09-01）**：业务模板增至 27 个（覆盖 25 种节点类型中的 23 种），分类收口为 core `TEMPLATE_CATEGORIES` 有序 11 类，TemplatePicker 改为按分类分组滚动、空白画布钉在最前（design-templates §6）；**专业服务方向（2026-09-04）**：业务模板增至 **33 个**（法律合规 5 + 财务审计 4，新增银行对账/隐私合规/发票 OCR/批量合同审查/审计抽样/尽调清单，全部零新节点 + 逐一真实狗粮），**fileParse 支持多文档解析**（`===== 文件名 =====` 分隔），**Skill 体系用户化（2026-09-09）**：内置卡 5→11 覆盖全部四种 kind，`judge` 卡接进 gate 节点、权限强制改声明驱动、6 张卡预挂 4 模板；**用户可自助接入远端 MCP 服务（http/sse，per-user 连接池 + 保存即试连，stdio 仍只走运维 env）并自建三种数据技能卡（prompt-module / output-contract / judge，强制 `local:` 前缀，不进全局 registry、盖不住内置同名）**；设置弹窗重构为**模型 / 集成 / 技能**三标签页，MCP 服务列表与节点技能面板均支持搜索，技能面板可深链到「设置 → 技能」；**3D 视觉打磨（2026-09-17，PR #327）**：L1 单厂 3D 加 ACES 色调映射 + 线性雾 + 环境反射 + Bloom 泛光 + 暗角 + 地台/描边 + 选中光环与 running 呼吸脉冲，`textGen` 改为程序化写实工业厂房（零外部素材，其余 28 种 kind 仍走风格化方块）

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

按优先级降序，标 `★` 的是当下要推的。

> **归档说明（2026-09-18）**：Active work 区已完成的历史编号项详细过程全部滚入
> [handoff-archive-2026-09-18.md](docs/handoff-archive-2026-09-18.md)，本区只留当前状态 + 活跃任务 + 一行结论。
> 更早归档：#1–#37 见 [handoff-archive-2026-09-07.md](docs/handoff-archive-2026-09-07.md)，
> #24–#43 见 [handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)，
> #44–#45 见 [handoff-archive-2026-09-11.md](docs/handoff-archive-2026-09-11.md)。

### 已完成待办一行结论（详情见 archive）

- ✅ **#1–#45**（除活跃的 #39/#41）：Connector/触发、狗粮 27/27、组件测试、设计 token、i18n、F1–F10 自媒体电商、模板 33 个、核心重构、RBAC、连接器插值、3D 视图、M0 Hasee 部署、web 组件测试、M1 清账三件套等——详见 09-07/09-10/09-11 archive。
- ✅ **#39 M1 成本计量回采**：三问分析（108 runs）+ 价格校准（Starter $9/Pro $29/Team $149，基于 125 runs/$5.57）——详见 09-18 archive。
- ✅ **#46 RTS 阶段 B**：B1–B9 全落地（parkLayout/持久化/CanvasPark/raycast/相机记忆/FPS/拖拽）。
- ✅ **#47 商业化 M2 订阅 gate**：S1–S8 全完成并部署 Hasee（PR #277，merge `124bdca`）；owner 已升 pro，MONETIZATION_ENFORCE=1。
- ✅ **#48 商业化 M3 收款账单**：S1–S5 + Stripe 全栈 A0–A5 已部署（PR #280/#290）；schema v39 迁移成功；剩真机 Step6（待收款主体 + Stripe key）。
- ✅ **#49 RTS 阶段 C C1–C3**：跨厂产物边/跨厂管道渲染/C3 方案 B 交叉淡化（PR #290，merge `27f28ee`）。
- ✅ **#50 RTS 阶段 C C4–C8**：经济栏/排期空间化/效果热度/宏观轻操作（PR #292，merge `1f5da5e`）。
- ✅ **#51 RTS polish + 运维对账**：跨厂抛物线拱/C6 ROI/部署脚本单一事实源/蓝图 P0/P1 对账（PR #296，merge `4b1cd90`）。
- ✅ **#52 Demo User D1–D6**：免注册一键进真实产品（PR #302，merge `b34fa29`）。
- ✅ **#53 Demo 真机走查 + 零配置首跑 422 修复**：前端模型选项加载竞态两轮修复（PR #305 `5812aca` + PR #307 `76dbd42`）。
- ✅ **#54 窄视口 HUD/工具条竖折修复**：纯 CSS flex-wrap（PR #319，merge `4163efb`）。
- ✅ **#55 竞品痛点 G1–G5**：步级时间线/契约引擎接线/节点 fork/重试下放/视频轮询/prompt 热迭代（PR #319 `4163efb` / #325 `fb00657` / #331 `26ec4a5`）。
- ✅ **#56 gate 禁用词反馈 + handoff 对账 + Windows 基线**：prohibitedHitsWithContext 逐处定位（`703c47d`）。
- ✅ **M1 运行床验收**：A/B/C/D 四层全过，三个真实缺口（媒体计量/备份/metrics 暴露）均已闭环。

### 活跃任务

**#41 ★ M1 回采产线挂载 + 每日体检（4 条成本画像产线，cron 自动攒数据中）**

在 Hasee staging 挂 4 条代表产线：①写草稿·高频文本 ②翻译流水线·带返工（gate 上限 3 次）③短视频广告工坊·媒体中价（imageGen+videoGen）④批量内容工坊·批量放大（Map 5 条）。产线 ID：
①`bdb25758-dd2d-4fe1-9ee3-ab2109b32f16`（trg_mtv0zp69）②`71536df1-da29-44fb-ae7a-4250dafe1a8d` ③`b25c9b38-b823-49c4-89ef-4cb432bd341c` ④`edc5183c-f8c3-4c11-9eab-a6e8fe232361`（trg_m1_batch_weekly）。
Agnes free tier 429 已按方案 C（降频+长退避 retry）闭环（PR #229 `006186b`；触发器持久化修复 PR #231 `70524df`）。②翻译 cron 已从每 4h 降为每 8h、QC criterion 放宽。每日回采体检由豆包定时任务每日 10:30（CST）触发。

**最新体检（2026-09-18 11:19 UTC）**：四产线全绿。累计完成率 ①93% / ②53% / ③86% / ④83%；成本合计约 $10.68（③短视频占 96%，agnes-video-v2.0 为绝对大头）。cron 触发器全部在、今日均正常触发。
- ⚠️ **新观察（首次出现，需观察是否复现）**：①写草稿 10:10 UTC run `a07c75eb` failed，`halted_reason=[PROVIDER_ERROR] 质检: 拒绝访问内网或私网地址（SSRF 防护）: apihub.agnes-ai.com`——gate/质检节点调模型域名被 SSRF 防护误判为私网；textGen 同域名调用未受影响。若复现，查 gate/质检节点模型调用为何走 SSRF 防护路径（模型网关加白名单，或核查 apihub.agnes-ai.com 在 Hasee 的 DNS 解析）。
- ②翻译"未翻译反问"质量问题自 09-16 起连续 8 个 cron run done、未复现（间歇性根因未修，被 8h 降频节奏压住）。
- 历史体检记录（2026-09-11 ~ 2026-09-18 07:52）→ [handoff-archive-2026-09-18.md](docs/handoff-archive-2026-09-18.md)。

> **下一步主线**：商业化 M1→M2→M3 全部完成并部署 Hasee；M3 S6 Stripe 只剩真机 Step6（待收款主体 + STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_IDS）。RTS 阶段 A+B+C 全部完成并真机走查通过。M1 回采 4 条产线继续 cron 自动攒数据 + 每日 10:30 体检。
> **下一步可选方向**：①真机 Stripe Step6（商业化临门一脚）②升级 agnes 付费 key（彻底解决 free tier 429）③翻译产线效果持续观察 ④RTS 方案 A 单场景 LOD 融合（留档待真实多产线规模再评估）。

> 全部缓做/低优事项（含上述）已统一登记在 [docs/deferred-items.md](docs/deferred-items.md)——每条带触发条件与决策详情链接，触发条件满足时移回本区并标注重启日期。

## Recently shipped (last 6)

按 commit 时间倒序，每条一行影响面 + commit hash：

1. **feat(web) 版本对比长文本字段逐字高亮（2026-09-18，工作分支 feature/20260824，`0387f97`，未 push）**——治 deferred 版本线遗留：原版本 diff（`99d2cfd`）对 prompt 等长文本字段只整段截断显示 old→new，看不出具体改了哪几个字。`lib/graph-diff.ts` 新增纯函数 `diffText(before,after)` + `tokenizeText`（正则按英文词 / 中文单字 / 成串空白切词，token 级 LCS 动态规划 + 回溯，平局优先报 removed 保证确定性，相邻同类段合并，任一边 token>4000 回退整段增删）与导出阈值 `INLINE_DIFF_MIN_CHARS=40`；`VersionPanel.tsx` 在字段任一边为 ≥40 字字符串时改渲染内联 `InlineTextDiff`（红删 `--error-bg`+删除线 / 绿增 `--success-bg`，等宽 xs、限高可滚动），短字段仍走 `formatDiffValue` 整值 old→new；`styles.css` 增 `.version-diff__textdiff/__seg--del/__seg--ins` 三规则（全设计 token、无硬编码色 / 间距 / 圆角）。新增 6 纯函数测（全等 / 中文增删 / 英文按词不切碎字母 / 空串 / 超长回退）+ 1 组件测（长 prompt 逐字增删高亮），改动两文件 51 测全过、web `tsc` 绿、i18n 守护绿（本切片无新增可见文案）；web 顺序全量 100 文件 1929 测全过。
2. **feat(server) gate 禁用词重写反馈逐处定位 + 命中计数（2026-09-18，工作分支 feature/20260824，`703c47d`，未 push）**——治 deferred 编排线痛点：旧逻辑每个禁用词只报首处、固定 ±12 字窗口、强去空白，同词多处命中时模型改不全反复退回直到 halt 零产出（事故 qc-k7qhs「最」）。新增纯函数 `nodes/prohibited.ts` `prohibitedHitsWithContext`（句读边界取完整分句、同词多处全报、每词 2/总 6 封顶、去重、真实计数），gate reason 列出“共 N 处（词×n）+ 各命中分句 + 通读全文”提示；重写输入拼接链路与 onExhausted=halt 策略不变（纯增强、向后兼容），删 shared.ts 旧函数与 engine.ts 遗留 import。新增 7 纯函数测 + 1 集成测全绿、phase1 13 测无回归、server typecheck 绿；Windows 全量其余失败为平台基线（EPERM/无沙箱，见 Quality gate）非回归。
3. **feat(web) 画布 3D 视角美化六项 + textGen 写实工业厂房原型（2026-09-17，`9f9cad3f` + 文档 `8e33b2ba` + CI 修复 `5f31f7e`/`1844a1bc`/`7bb3861e`，已随 PR #327 merge `d651323b` 合 dev）**——L1 单厂 3D 从「扁平方块」升级为风格化 RTS 质感，并把 textGen 做成写实工业厂房原型（**全部程序化生成、零外部素材**），设计见 `docs/deferred-items.md` 画布/可视化线。**渲染与后处理**（`Canvas3D.tsx`）：ACES Filmic 色调映射 + 线性雾（美化①）、`PMREMGenerator` + `RoomEnvironment` 环境贴图让 PBR 金属/玻璃真反射（写实前提）、`EffectComposer` + `UnrealBloomPass`（strength 0.18 / radius 0.4 / threshold 0.92）让 LED/厂房窗口/选中光环发光（美化⑤）、选中光环呼吸脉冲（④）、running 节点呼吸脉冲（⑥）。**风格化方块**（`iso3d-shapes.ts`）：每节点加地台（美化②）、12 条硬边蓝图描边（`raycast` 置空、不抢节点拾取）。**工业原型**（新增 `industrial-shapes.ts` + `industrial-textures.ts`）：混凝土基座 / 锯齿屋顶主厂房 / 锈蚀烟囱 + 蒸汽 / 危险条纹基座钢储罐 / 拱形管线 / 发光高窗 + 正门，三张贴图走 canvas 程序化绘制（混凝土/波纹钢板/危险条纹），模块级单例、材质按节点持有并随既有 graph-sync 释放；**保持 ~150×92 足迹、地面旋转与 LED 契约不变**，管道锚点零改动；仅在 `buildNodeShape` 一处 gate 到 `textGen`，其余 28 种 kind 仍走风格化路径（推广 = 翻该 gate + 逐个补 topper）。**CSS**：`.canvas3d::after` 径向渐变暗角（美化③）。**CI 修复（首轮 Actions 红的根因是 jsdom 环境限制，非渲染逻辑）**：`5f31f7e` 给三处新贴图的 `getContext("2d")` 加判空兜底（jsdom 返回 null 直接抛，沿用 `CanvasPark.tsx:209` 既有兜底写法）；`1844a1bc` 在 `Canvas3D.test.tsx` 按既有 `OrbitControls` 同款风格 stub 掉 `PMREMGenerator` + 三个后处理模块（renderer stub 缺它们要用的 API），renderer 生命周期断言（audit M30）仍真实执行；`7bb3861e` 把「LED 在前脸顶边」断言改用风格化 kind，另补一条厂房 LED（门上方）用例。**验证**：四包 `pnpm -r typecheck` 绿；web 100 文件 **1911 测全过**（本次 +1）；CI（Typecheck/build/test + CodeQL + secret-leak scan）在 `7bb3861e` 全绿。**边界**：节点常显 3D 标签（美化⑦）仍缓做，触发条件登记在 `docs/deferred-items.md`。

4. **feat(core,server,web) 竞品痛点执行核心四项收口：G2.2 契约接线 / G1.2 节点 fork / G3 重试下放 / G4.4 视频轮询（2026-09-17，工作分支 feature/20260824，5 个原子 commit，已随 PR #325 合 dev，merge `fb00657`）**——把 #55「明确留待」里不卡外部、空契约/默认值向后兼容、对 M1 回采零影响的四项点亮，详见 Active work「#55 续」与设计文档实施进度表。**G2.2** `c7beaea`：core `ErrorCode` 扩 `SCHEMA_VIOLATION`，engine 在唯一发包出口 `sendPackets` 开头加 `enforceContract` 闸门（finally 兜底末端节点），违例删产物+failed+拦截 flow 包、确定性失败不重试、error 边可 catch，9 测；Inspector 契约 hint 改「已生效」。**G1.2** 后端 `3621db7` + 前端 `8dc75aa`：`engine.fork()` 复用 fork 点及全部上游（零成本 `reused:true` 合成事件、不计费）、只重跑其 flow 下游，新 run 继承 `budget_usd`、`trigger="fork"`，`POST /api/runs/:id/fork`，时间线成功节点加「从此处重跑」按钮 + reused「复用」角标，后端 8 测/前端 3 测。**G3** `ae31c38`：核查确认后端 retry 策略与 run 预算 UI 早已端到端，真正缺口是前端配置；新增共享 `RetryField` 挂到 7 类节点（textGen/http/code/translate/search/notify/vcs），clamp [0,10]、文案区分 infra 重试与质检返工，2 测。**G4.4** `dfebcca`：Worker 加可选 `submitVideoJob`/`queryVideoJob` 接缝，videoGen 支持「提交→指数退避轮询→5min 超时」，缺一方法字节级回退同步；**当前无 provider 实现、生产仍走同步，跨 run 断点续跑随 G4.2**，5 测。验证：四包 typecheck 绿，core 20 文件 275 / server 150 文件 1232 / web 100 文件 1910 / mcp 3 文件 71 = **273 文件 3488 测全过**，i18n 守护绿。
5. **feat(core,server,web) 竞品痛点 P0 安全子集：步级 run 时间线只读链路 + 契约/超时纯函数（2026-09-16，工作分支 feature/20260824，3 个原子 commit，已随 PR #319 合 dev，merge `4163efb`）**——竞品调研（Dify/Coze/n8n 等）头号痛点"不可观测、调试靠猜"的**只读侧**应对，详见待办 #55 与 `docs/design-step-trace-and-robustness.md`。core `04a1a55`：`buildTimeline(events)` 事件溯源投影（节点×attempt×variant 聚合状态/耗时/token/成本/score/gate 裁决/错误码/输出预览/工具产物，tokens/cost 只计每节点最后一次 attempt、重试不重复计费）+ `validateContract`/`coerceOutputObject`（G2.1，**纯函数未接线**）+ `isTimedOut`/`remainingMs`/`deadlineAt`（G4.1，**纯函数未接线**），共 24 单测。server `02f5b65`：只读 `GET /api/runs/:id/timeline`（viewer 授权、**无 DB 迁移**、从 run.snapshot best-effort 解析节点名/kind），3 HTTP 测（401/主投影/404 跨用户）。web `4aba58d`：运行历史每行"步骤/Steps"按钮内联只读时间线 `RunTimelineView`（每节点全部 attempt 含重试、状态徽章、耗时/model/token/成本/评分、gate ✓✕、错误码+信息、输出预览、工具/产物数、合计与预算熔断警告），zh/en i18n + 复用设计 token 的 CSS，组件 2 测、RunHistory 既有 40 测无回归。四包 `pnpm -r typecheck` 绿。**改 run 执行状态机的 G1.2 fork / G2.2 契约接线（待定是否扩 ErrorCode 加 SCHEMA_VIOLATION）/ G4.2 timeout+degraded 等高风险项明确留待，防打断 Hasee M1 回采。**
6. **feat(web,server) 五项产品体验补强一口气落地（2026-09-16，工作分支 feature/20260824，5 个原子 commit，已随 PR #319 合 dev，merge `4163efb`）**——从真实使用缺口 grep 出并补齐：①**版本 diff 视图**（`99d2cfd`）：新纯函数 `lib/graph-diff.ts`（`diffGraphs` 按节点 id/边 from-to-kind 比对，输出 nodesAdded/Removed/Changed 含叶子级 FieldChange[]、edgesAdded/Removed、triggers/variables 变更、identical；`formatDiffValue` 紧凑展示），VersionPanel 加 A/B 双槽"版本对比"模式 + 新增（绿）/删除（红）/修改（黄）分组 overlay，x/y 聚合为"画布位置"、边用 id→name 显示，8 单测 + 组件 4 测。②**产线列表搜索 + 收藏置顶**（`73d5db8`）：GraphSwitcher Popover 顶部名称大小写不敏感搜索 + 每行 ★ 收藏，收藏 id 存 localStorage `aw-pinned-graphs`（try/catch 容错），收藏按收藏顺序钉顶、非收藏保持原序（不破坏既有顺序断言），11 测。③**run 历史全文搜索**（`175abaf`）：listRuns 加 `q`（graph 名 OR node_runs.error/output，PG ILIKE / SQLite LIKE，COUNT 查询同步补 LEFT JOIN graphs 否则计数崩），/api/runs 透传，RunHistory 加 300ms debounce 搜索框，server +4 / web +3 测。④**失败 run 智能诊断**（`2afe69a`）：新 `packages/server/src/diagnose.ts`（`buildFailureInfo` 从事件 + snapshot 蒸馏失败节点/错误码/生命周期轨迹、`buildDiagnosisPrompt` 中文根因+修复步骤 prompt、`diagnoseRun` 在 runAsUser 上下文用用户 defaultModel 调 worker），`POST /api/runs/:id/diagnose`（requireRun viewer，provider/配额失败返 503 不 500），RunHistory failed 行加"智能诊断"按钮 + 内联结果面板（再次点击收起、失败显提示），server 6 测 + web 4 测。⑤**Excel .xlsx 读取**（`1bf45f9`）：parseDocument 加 xl/ 分流与 parseXlsx（fflate 解包；sharedStrings 含富文本 r/t 拼接、inlineStr、数字/布尔、A1 坐标空列补齐、CSV 转义；workbook.xml + rels 按工作簿顺序取 sheet 名，缺 rels 回退 sheetN 数字序；多 sheet 复用 `===== Sheet: 名 =====` 分隔，表格转 CSV 可直接喂 table 节点），SourceFiles accept/白名单加 .xlsx，格式文案 zh/en 同步，server 5 测 + web 2 测。**验证**：四包 typecheck 绿、i18n 守护绿、server 全量 145 文件 **1202 全过**、web `--no-file-parallelism` 顺序 98 文件 **1898 全过**。**已随 PR #319 合 dev（merge `4163efb`，2026-09-16 16:44 UTC），Hasee 由 self-hosted runner 自动部署。**

> 第 7 条及更早（**demo 零配置首跑 422 两轮修复并闭环（2026-09-16，PR #305 `5812aca` + PR #307 `76dbd42`，均合 dev 部署 Hasee；根因为未登录时 `getSettings()` 401 竞态把 model 清空，改为仅 settings 成功才置 modelOptionsReady，真机首跑不再 422）**；**跨厂物流拱线 + ROI 热度、部署脚本单一事实源 + 蓝图 P0/P1 对账（2026-09-15，`45f65bf`/`16d8503`，PR #296 merge `4b1cd90` 已部署 Hasee、引导链路真机验证通过）**——①RTS C2 polish：跨厂物流管线由贴地直线改为越过厂顶的抛物线拱（弧顶 y≈236 > 厂高 140，等距俯视不再被中间厂方块遮挡），opacity .32→.55，卡车沿拱爬升、crossGroup 重建时释放旧管线 geometry/material（卡车共享材质不释放）；新增并导出无 three 依赖纯函数 crossArchY/crossArchPoints。②C6：工厂热度 sprite 在 CTR·GMV 后补 `ROI=gmv/adSpend`（gmv、adSpend 皆正才显示，adSpend=0 绝不显示 ∞，顺序固定 CTR·GMV·ROI）；后端 ad_spend 链路（content_metrics 列→metricsByGraph→ParkGraphMetrics.adSpend）早已就绪、纯前端补；+5 单测（park-label 8→13）。③运维：修复服务器根 `/opt/agent-world/deploy.sh|rollback.sh` 为 **untracked 手工副本、git pull 永不更新**的漂移隐患——仓库 `scripts/deploy/*` 成为唯一逻辑源（deploy 改为「仅当部署前当前服务健康才写 last-known-good」，避免失败部署把坏 commit 写成回滚点；deploy/rollback 均最多 15s 轮询健康），服务器根两份改为 `exec bash scripts/deploy/*.sh` 引导（备份在 /tmp/*.root-bak），手动跑一次引导部署 `deploy OK: 4b1cd90` 验证链路；`docs/engineering-blueprint.md` 加「现状对账（2026-09-15）」（12 域自包含 P0 全具备，仅独立 Playwright E2E 冒烟缓至对外开放注册前，其余 P1/P2 卡域名/上云/规模化触发，当前不做以避免过度设计）。真机走查：3D 园区工厂方块/24h 排期轴/经济栏/倒计时环/节点详情正常、单产线 3D 链路正常、零 console error；staging crossEdges=0 且无 content_metrics，拱线/ROI 真机为空态（诚实不渲染），几何与格式化逻辑由 13 个 park-label 单测保证。
> **RTS-C C4-C8 园区经济栏/排期空间化/效果热度/宏观轻操作全集** `dffcf55`/`e540422`/`9a7c900`，PR #292 merge `1f5da5e` 已部署 Hasee；RTS-C C1 跨厂产物边 + Stripe 全栈 `2ea918a`/`c47e50b`/`42468ac`/`4a526ff`，PR #287/#290 merge `27f28ee`；M3 S6 Stripe 后端 A0-A4 `c0f708e`/`f5113be`/`b133c91`/`add61a4` 已并入该条 Stripe 全栈；2026-09-15 的园区状态色+标签优化 `9342d90`/PR #285、M3 S6 Stripe 前端 A5 `2c670c4`，以及 2026-09-14 及以前：M3 S1-S5 收款与账单、run.finished 失败原因记录、Guided Tour、RTS 阶段 B 全部、M1 回采三问分析 + 价格校准等）已滚出本列表 / 归档至 handoff-archive。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

* `pnpm -r typecheck`：全绿（core/server/mcp-server/web `tsc --noEmit` 全部干净；2026-09-18 版本逐字高亮与 docs 原子提交时 pre-commit hook 四包 typecheck 均复核全 Done（前台超时会自动转后台任务，无需 --no-verify））

* 测试总数 **3532**（2026-09-18 Node 24 `pnpm -r test` 全量实跑全绿（EXIT=0）：**core 21 文件 285、server 153 文件 1247、web 100 文件 1929（vitest 全量；`--no-file-parallelism` 顺序同样 1929 全过）、mcp 3 文件 71，共 277 文件**。相对 09-17 snapshot（3489 / 273 文件）+43 测 / +4 文件：本轮版本逐字高亮 web +7（`graph-diff` 6、`VersionPanel` 1），其余为 09-17 snapshot 后已合入的 gate 禁用词修复（server `prohibited.ts` +8）等批次带来，数字一律以本次实跑为准）：

  * `pnpm --filter @agent-world/core test`：**285/285 通过**（21 文件；2026-09-18 实跑；含 parkLayout、file/product connector 形状断言、compile trigger warning、模板 33 形状守护、单价缺口、trace timeline、contract、deadline 等）
  * `pnpm --filter @agent-world/server test`：**1247/1247 通过**（153 文件；2026-09-18 实跑；09-18 gate 禁用词 `prohibited.ts` +8（7 纯函数 + 1 集成），09-17 四项收口新增：G2.2 `engine.contract.test.ts` 9、G1.2 `engine.fork.test.ts` 3 + `api.fork.test.ts` 5、G4.4 `engine.videogen.async.test.ts` 5；此前 09-16 五项补强 runs 全文搜索 4、diagnose 6、parse-file xlsx 5，demo 零配置首跑修复 +1、09-15 演示用户 +23、StreamableHttp notify flaky 修复 +1）。历史备注：Node v22 + macOS seatbelt 下依赖 spawn JS sandbox 子进程的用例曾 status 71 失败（干净基线与带改动失败集合 diff 为空、非回归，CI Linux bwrap 正常）；另有 2 个 RPA 用例需先 `pnpm exec playwright install` 装 chromium，本机未装属环境阻塞；高并发全量偶发 `audit write failed: table locked`（SQLite 表锁竞争，重跑即过、非回归）。
  * `pnpm --filter @agent-world/mcp-server test`：**71/71 通过**（3 文件；含 stdio 端到端冒烟 3 个。负载性 flaky：`pnpm -r test` 并行时 stdio 冒烟可能超 5s，单独跑稳定）
  * `pnpm --filter @agent-world/web exec vitest run`：**1929 总数**（100 文件；2026-09-18 实跑；本轮版本逐字高亮 `graph-diff` +6 / `VersionPanel` +1；此前 09-17 3D 美化 + CI 修复新增 `iso3d-shapes.test.ts` 厂房 LED 用例 1、`Canvas3D.test.tsx` 补 PMREM/后处理 stub；此前 09-17 四项收口：RunTimelineView fork/reused +3、新 `InspectorFields/RetryField.test.tsx` 2；09-16 五项补强：lib/graph-diff.test.ts 8、VersionPanel 版本对比 +4、GraphSwitcher 搜索/收藏 +11、RunHistory 全文搜索 +3 与失败诊断 +4、SourceFiles xlsx +2；组件目录零「有 .tsx 无 .test.tsx」）。⚠️ **本机全量高并发下有既有负载 flaky**：个别文件（VersionPanel/ProductGallery/PublishTargets 等，每次不固定、均不在改动范围）因 waitFor 超时失败或 worker 提前退出，**隔离单跑全绿、`--no-file-parallelism` 顺序跑 100 文件 1929 全过、CI Linux 全 pass**，证实非回归；判断回归只看改动文件 + 顺序全量 + CI。

* 各用例逐波来源（单价审计/连接器插值/PG/加密/RBAC/公告/重构/狗粮九波等）已随对应待办归档到三份 handoff-archive，本 snapshot 只记当前数，不堆历史。

* **Node 版本硬要求**：依赖 `node:sqlite`，必须 Node ≥ 22（CI 用 Node 24；本地默认 Node 20 会误报 `No such built-in module: node:sqlite`，用 `fnm exec --using=24` 跑）。**P1 沙箱实跑测试必须在 Node 24 下验证**（否则 resolveInterpreter 版本探针走不同分支）。

  * ### ⚠️ 版本不对时的症状指纹
    非 Node 24 下跑全量 server 测试，失败会呈现为 **32-36 个用例波动失败**，且**全部依赖 code 节点子进程**（`engine.code`/`loop`/`map`/`table`/`generic`），报错 `ENOENT lstat '<internal-path>'` 或 `finished` 为 `undefined`——看起来像沙箱跑不起来而非版本问题，失败数随超时随机浮动。**判定**：`fnm exec --using=24 -- pnpm --filter @agent-world/server exec vitest run`，全绿即为版本问题。`git stash` 对比基线只能证明"不是本次改动引入"，**不能**证明"是环境问题"，两者是不同命题。

  * ### 🪟 Windows 本机测试基线（2026-09-18 实测，非权威平台）
    Windows 上 server 全量**不能全绿是平台基线、不代表回归**：153 文件 1247 测 1112 过 / 135 失败（56 文件），失败只有两类根因——① 用临时 sqlite 目录的测试 afterEach `rmSync(...,{recursive,force})` 抛 **EPERM**（Windows 文件句柄/WAL/索引器或杀软扫描未释放，db.* / costs / migrations / runs / graphs / events / invoice / subscription / usage-metering / isolation / graph-versions 整片）；② 代码沙箱后端缺失（Windows 无 bwrap/seatbelt/rlimit，code-sandbox 的 child_process 拒绝、RLIMIT_NPROC fork-bomb 2 测；engine.code/loop/table/map/parallel-join/generic、regression/core-path 连带）。**证明非回归**：`git stash -u` 干净 HEAD 重跑 db.operations 8/8、engine.loop 5/6 失败与带改动完全一致。Windows 判断回归只跑改动相关测试 + `pnpm -r typecheck`；权威全绿以 CI Linux（self-hosted runner）与 macOS 为准（macOS 仅 ~32 个 seatbelt 沙箱用例基线失败）。本机环境：便携 Node v24.11.0 在 `C:\Users\24670\node24`（PATH 上其余 node 是 DoubaoWork/TRAE/hermes 自带 v22，engines 要求 ≥24），pnpm 无 shim、走 `corepack.cmd pnpm`，装包加 `--registry=https://registry.npmmirror.com`，改 core 后先 `pnpm --filter @agent-world/core build`；corepack/SQLite 的 ExperimentalWarning 走 stderr，PowerShell 会显示 NativeCommandError 并非零退出码，不代表命令失败，看 vitest 自身 passed 判定。

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

