# Handoff

State of Agent World as of 2026-09-20.

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

* [docs/handoff-archive.md](docs/handoff-archive.md) — historical changes (pre-2026-08-27)；后续滚动归档 [handoff-archive-2026-09-07.md](docs/handoff-archive-2026-09-07.md)（#1–#37）、[handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)（#24–#43）、[handoff-archive-2026-09-11.md](docs/handoff-archive-2026-09-11.md)（#44–#45）、[handoff-archive-2026-09-18.md](docs/handoff-archive-2026-09-18.md)（#39、#46–#56、M1 验收、#41 历史体检）

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

* [docs/mvp-readiness-review-2026-09-21.md](docs/mvp-readiness-review-2026-09-21.md) — MVP 上线就绪评审（判定：个人/小团队自托管 MVP ✅ 达到；对外商业 SaaS ❌ 功能 Ready、收款/生产运维 Not Ready，含分口径硬阻断项与 go-live 清单）

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

**#44 Provider Failover（模型源灾备；v1 文本链路已落地 + 真机切换实测打通 2026-09-21，真灾备仍卡第二 provider key）**

路由层在主源首字节前死掉时自动把同一请求改投备份源等价模型。**v1 仅文本**（`runTextGen` + gate `judge`）。机制：`config.ts` 新增默认关闭的通用 OpenAI 兼容内置槽（`BACKUP_BASE_URL`/`BACKUP_API_KEY`/`BACKUP_MODELS`，填齐启用）+ `failoverCandidates()` 纯函数与可选 `failover.chains`；`providers/index.ts` 在首字节前探第一块，仅对 `PROVIDER_ERROR`/`TIMEOUT` 切换（`RATE_LIMIT`/`AUTH`/首块后错误不切），切换打 warn。测试：`routing.test.ts` 8 例 + `config.test.ts` 4 例全绿，四包 typecheck 绿。文档见 [production-ops.md](docs/production-ops.md) §9、env 占位见 `.env.example`。**2026-09-21 真机验证（零影响：独立临时进程注入 BACKUP_*，不碰服务/.env/重启）发现并修复两处问题**：①内置 backup 槽硬编码 `enabled:false`，而 `parseRaw` 只回填 `enabled===undefined` 的 provider，builtin 槽永不被翻为 true——env 填齐、key 在位，`failoverCandidates` 仍只有主源，灾备实际永不启用。PR #364 修复（merge `2c92a92` 已部署 Hasee）：enabled 按 BACKUP_BASE_URL+BACKUP_API_KEY 填齐动态开启 + 2 个 env 路径回归测（fresh module graph，变异验证旧代码即红）。②修复部署后复测：`candidates = agnes -> backup`，主源临时指向不可达（SSRF guard 在首字节前抛 PROVIDER_ERROR）时日志实测打出 `failing over text model to backup provider`、backup 端真实收到请求——**切换代码链路端到端打通**；唯 backup 临时同源 agnes（同一 free key）时撞 free tier 429，恰好证明同源备份不构成灾备（同一配额池）。**真灾备仍需用户提供第二个 OpenAI 兼容源的 BACKUP_BASE_URL/BACKUP_API_KEY/BACKUP_MODELS（卡用户）**；图片/视频灾备缓做。

**#52 ⚠️ P0 生产事故止血：undici 8 × Node 24 内置 undici 7 不兼容致全部 M1 run failed（2026-09-21 修复部署）**

- **现象与时间线**：09-20 13:28 UTC 部署 PR #349（commit `13626a6`，含 undici 7.29→8.10）后，首条自然 cron run（14:10 UTC 写草稿）起四产线 run 持续 `failed`，halted_reason 均为 `[PROVIDER_ERROR] <节点>: fetch failed`，每条约 5.5min；截至 09-21 07:10 UTC 共 22 条（部署 SIGTERM 打断的 interrupted 不计质量）。02:39 UTC 体检曾误判为"agnes 出站中断、已恢复、下个 tick 自愈"（误诊订正见 #41）。
- **根因（代码事故，非上游故障）**：Node 24.20 内置 global fetch 自带 undici 7.29；`ssrf.ts` 把 npm-undici **8** 的 pinned `Agent`（dispatcher）传给内置 fetch，dispatcher 跨大版本协议不兼容，每个 pinned 请求抛 `InvalidArgumentError: invalid onRequestStart method`——所有走 SSRF guard 的 provider 出站必挂。curl/裸 TCP 全程正常（带 key GET /models、POST /chat/completions 均 200），故与 agnes 无关。CI 全绿是因为 ssrf 测试 `vi.stubGlobal("fetch", fetchMock)` 把 fetch 全 mock，从不构造真实请求。叠加隐患：Hasee 无 IPv6 路由，pinned Agent 自定义 lookup 只 pin 单个 IP，pin 到 AAAA 记录会硬失败且不回退。
- **修复（PR #362，merge `758a30d`，09-21 07:35 UTC 部署，5 files +119/-17）**：①undici 锁回 `^7.29.0`（大版本只能随 Node 运行时一起升；dependabot.yml 已加 undici semver-major ignore 并注明）；②新增导出纯函数 `selectPinRecord()`（双栈优先 IPv4，纯 AAAA 才用 v6）并接线 `resolveGuarded()`；③新增真实 loopback http server + npm-undici pinned Agent × 内置 global fetch 兼容性回归测（undici 8 下实测精确报 invalid onRequestStart 失败、7 下通过），补上 CI 不构造真实请求的盲区；④ssrf.ts 版本契约注释记录该禁忌与事故。
- **验证**：server 154 文件 1278 测全过、typecheck 干净；部署后零影响真机探测（独立临时进程 import 生产 dist，不碰服务/库/重启）：健康主源 runTextGen 1.6~2.1s 真实返回文本，出站恢复。**08:10 UTC 写草稿自然 cron run 已 done（08:10:00→08:17:09，7.2min，5 节点全 done、无 error_code、成本正常归集约 $0.002）；08:00 UTC 翻译自然 run 同 done；07:35 UTC 止血部署后四产线 0 failed / 0 halted——止血在生产自然流量闭环（2026-09-21 08:19 UTC 只读查库确认）。**
- **教训**：①npm undici 大版本必须与 Node 内置 undici 对齐，pinned dispatcher 跨大版本不兼容；②把 global fetch 全 mock 等于放过 dispatcher 真实兼容性，关键网络路径必须保留一条真实 loopback 回归；③"curl 正常但 Node fetch 失败"优先怀疑运行时版本/dispatcher，而非上游可用性。

**#41 ★ M1 回采产线挂载 + 每日体检（4 条成本画像产线，cron 自动攒数据中）**

在 Hasee staging 挂 4 条代表产线：①写草稿·高频文本 ②翻译流水线·带返工（gate 上限 3 次）③短视频广告工坊·媒体中价（imageGen+videoGen）④批量内容工坊·批量放大（Map 5 条）。产线 ID：
①`bdb25758-dd2d-4fe1-9ee3-ab2109b32f16`（trg_mtv0zp69）②`71536df1-da29-44fb-ae7a-4250dafe1a8d` ③`b25c9b38-b823-49c4-89ef-4cb432bd341c` ④`edc5183c-f8c3-4c11-9eab-a6e8fe232361`（trg_m1_batch_weekly）。
Agnes free tier 429 已按方案 C（降频+长退避 retry）闭环（PR #229 `006186b`；触发器持久化修复 PR #231 `70524df`）。②翻译 cron 已从每 4h 降为每 8h、QC criterion 放宽。每日回采体检由豆包定时任务每日 10:30（CST）触发。

- 🚀 **2026-09-20 13:28 UTC 大版本部署（PR #349 合集，Hasee `13626a6`）**：本批四项工作合入 dev/main——状态机方案 A 增强（`208683b`/`2c56e48`，编译期 branch 非法迁移/未声明变量校验 + Inspector/2D 卡片状态流转可视化）、构建工具链五项 major（`96b3b1e`/`6990ac4`/`a299eeb`/`6c47b00`：vitest5、vite8 rolldown、TS7、undici8）、G2.4-A 数组输出契约（`978ab56`/`2fbcbe1`/`36135e8`/`33dcc91`）、ReDoS 线性扫描根治（`01f8868`/`8c95dfd`，CodeQL HIGH 清零）。合并链路：PR #349→dev（merge `894eca3`，pr-helper app 在检查全绿后自动合并）→ #350→main；docs 续随 #352→dev（`13626a6`）/#353→main（`fcb677b`）。Hasee Deploy workflow 13:28 success：health `{ok:true,env:staging,branch:dev,commit:13626a6,schemaVersion:40}`、优雅重启（SIGTERM inflightRuns:0）、启动日志零 error；13:10 UTC 一条写草稿 run 被首次部署重启打断（interrupted，部署重启不计质量），13:28 二次重启时无在途 run。四 cron 触发器配置 enabled 核对无误（①`10 * * * *` ②`0 */8 * * *` ③`0 3,15 * * *` ④`0 6 * * *`）。**⚠️ 部署后首跑记录订正（2026-09-21 深查）**：本次部署所含 undici 7→8 升级与 Node 24 内置 undici 7 不兼容（见下方事故记录 #52），部署后首条自然 run（09-20 14:10 UTC）起四产线 run 持续 failed，并非"预期不受影响"；当日 22:22 CST 一次性体检任务因额度门控未实际执行，未及时发现。事故已由 PR #362（merge `758a30d`，09-21 07:35 UTC 部署）止血。数组契约默认 root=对象、无模板声明数组契约=零行为变更，本身与事故无关。**后续推进（2026-09-20 复核）**：PR #354（`e6107f5`）/ #356（`833d867`）纯文档归档（handoff + handoff-archive，无代码改动），#357（`ed02ceb`）main←dev；Hasee Deploy workflow 已推进到 `833d867`（health 探针实测 `{ok:true,branch:dev,commit:833d867,schemaVersion:40}`），与 `13626a6` 代码零差异。

**最新体检（2026-09-21 02:39 UTC）**：⚠️ **本条归因已被 07:30 UTC 深查推翻，保留原文仅作时间线**——当时判"前约 12 小时 provider 出站中断、curl 401 说明已恢复、下个 tick 自愈"系误诊：curl 不带 key 返回 401 只证明 TCP/TLS 通，带 key GET/POST 全程 200；run 持续 failed 的真因是 undici 8 Agent 传给内置 undici 7 fetch 不兼容（代码事故，见 #52），02:39 之后 03:10~07:10 UTC 各 tick 实际仍全部 failed，并未自愈。原文如下：前约 12 小时 provider 出站中断导致一波 failed，现已恢复、无需人工干预。累计 run：①246（done220/failed18/interrupted8=89.4%）②44（done23/failed15/halted5/interrupted1=52.3%）③27（done23/failed4=85.2%）④20（done17/failed3=85%）。**异常**：①最近连续 12 个、②最近 2 个、③最近 1 个 run 报 `[PROVIDER_ERROR] 初稿/初译/脚本撰写: fetch failed`（约 13:40 UTC 9-20 至 00:50 UTC 9-21），**非 429**；02:39 UTC 实测 `curl https://apihub.agnes-ai.com/v1/models` 返回 401（未带 key=正常），DNS 0.012s/connect 0.37s/total 1.34s，出站已恢复，下个 cron tick 应自愈。**成本对账**：总额 $12.94（①$0.43 / ②$0.06 / ③$12.43 / ④$0.03），③视频占 96%（agnes-video-v2.0 23 次 $11.50 + image 23 次 $0.92），文本三厂全 agnes-2.0-flash 极便宜；成功节点 cost_usd 无 0/碎片（model=NULL 的非 LLM 节点 cost=0 属正常）。**429**：仅②历史 1 条 RATE_LIMIT（9cd1c819），降频后无新增。服务器 up 8 天 13h 未重启，中断更像上游 agnes/网络抖动而非本机问题；下次体检盯恢复后首跑是否转 done。

**历史体检（2026-09-18 11:19 UTC）**：四产线全绿。累计完成率 ①93% / ②53% / ③86% / ④83%；成本合计约 $10.68（③短视频占 96%，agnes-video-v2.0 为绝对大头）。cron 触发器全部在、今日均正常触发。
- ✅ **SSRF 误拦模型域名（已定位 + 修复 + 已部署，`9f8a67e` 随 PR #341 merge `9a12d64` 部署 Hasee；09-19 取数确认窗口内仅 09-18 run `a07c75eb` 那 1 次）**：09-18 ①写草稿 10:10 UTC run `a07c75eb` 的 gate/质检节点报 `拒绝访问内网或私网地址（SSRF 防护）: apihub.agnes-ai.com`。根因并非真内网——Hasee 实测该域名 30 次 DNS 全部解析为干净的 Cloudflare 公网 IP，而是 `ssrf.ts` 对域名做 `dns.lookup({all:true})` 时，DNS 查询本身瞬时 throw / 返回空答案，catch 分支也按 null 处理（fail-closed），对外文案与命中真内网完全相同，造成偶发误拦；textGen 同域名调用未受影响是时序侥幸。修复：新增 `resolveDnsRecords`/`dnsSettle`/`DnsResolutionError`，**仅当 DNS 查询本身临时失败**时做有限退避重试（3 次、120/240ms 抖动）；一旦解析出内网/保留 IP 一次即拒、绝不重试，耗尽仍 fail-closed，DNS-rebinding 防护（check-then-fetch 双解析）不削弱；`guardedFetch` direct 分支失败统一转 `GuardedFetchError("internal-target")`，`code-proxy.ts` 复用同一守卫。ssrf + code-proxy 共 37 测过。
- 🔎 **②翻译“未翻译反问”根因更正（2026-09-19 SSH 取 node_runs 实证，推翻此前“intake 空输入”推测）**：以 09-18 halted run `2a265a2c` 为例——intake 节点正常注入英文原文（“Weekly digital marketing report…”），transl 翻译节点也产出合格中文译文；**问题在 review 审校节点**：gate 退回重跑的多 attempt 中 review 丢失英文原文上下文，把中文初译误当成“中文原文”，两个 attempt 都反问“初译/英文原文在哪”，QC（qc-8s98z）据此判 VALIDATION halt。即不是投料为空，而是**重跑循环里 review 节点输入映射未同时保住「英文原文 + 中文初译」两版**。窗口后翻译 3 次 halted 全因此（修复后翻译完成率可从 75%→约 94%=15/16）；09-16/17 连续 done 只是降频节奏下的间歇幸免、非根因消失。**已修复并落地（2026-09-19，`16db0a5` 已 push、PR #343 合 dev / PR #344 合 main，Hasee 已部署到 `da07741`）**：翻译模板补一条 intake→review 的 flow 边（排在 translate→review 之前），review 直接前驱变为 intake+translate，inputFor 按 [原文, 初译] 顺序聚合；gate 退回重译只重置 translate 及其下游，intake 不重跑、产物保留，重跑后的 review 仍拿得到英文原文。同时强化 review prompt：显式区分【原文】/【初译】两段、要求直接输出定稿译文、严禁以缺原文/初译为由反问索材。新增 core 模板拓扑测试 + server 端到端 rework 回归测试（跑真实 tpl-translation 经一次 gate 退回，断言 review 每个 attempt 的输入都含原文+初译；删边变异验证即红）。core 286 / server 1253 测全过、四包 typecheck 绿。✅**实例补边已完成（2026-09-19 11:29 UTC）**：Hasee M1 翻译产线 graphId `71536df1` 的 `graphs.doc` 已直接补写——新增 flow 边 `intake-uqo4s→review-02dfy`（插在 `transl-oct5g→review-02dfy` 之前），并把 review 节点 prompt 换成新版（旧 36 字→新 141 字）；写库前已备份原 doc 到 `/tmp/m1-translation-before-fix.json`，写后读回验证边顺序与 prompt 均正确。✅**2026-09-20 04:35 UTC 只读复测已证实修复生效（Mac 经 hasee-2016-server SSH 活库 mode=ro）**：补边后翻译 cron 已跑 2 次——09-19 16:00 run `3853f18c`、09-20 00:00 run `0c580e64`，**两次全部 done、零 halted、review 节点无「缺原文/初译」反问**（修复前该节奏每轮必因缺英文原文对照 halt）；09-14 降频窗口完成率由 13/18=72% 升到 **15/20=75%**（窗口终态 done15/failed1/halted4/interrupted1，interrupted 不计；新增补边前 08:00 halted×1 + 补边后 done×2，分母仍被历史 halted 拉低，**补边后样本 2/2=100%**，随后续 run 继续 done 窗口完成率将向预估 ~94% 收敛）。根因（gate 退回重译循环里 review 输入映射丢英文原文）确认消除；「75%→94%」方向已被补边后 2/2 实证，绝对完成率待更多 run 在分母上体现。
- 📊 **2026-09-19 降频窗口专项小结（Mac 经 `hasee-2016-server` 免密 SSH 只读生产库 python3 sqlite3；窗口=09-14 降频起；完成率口径=done/(done+failed+halted)，interrupted 属部署重启不计入）**：

  | 产线 | 窗口前完成率 | 窗口后完成率 | 窗口后 run 数 | 窗口后成本 |
  | --- | --- | --- | --- | --- |
  | ①写草稿 | 96%（69/72） | **98%**（107/109） | 114 | $0.22 |
  | ②翻译 | 35%（7/20） | **75%**（12/16） | 17 | $0.03 |
  | ③短视频 | 77%（10/13） | **100%**（10/10） | 10 | $5.40 |
  | ④批量 | 77%（10/13） | **100%**（5/5） | 5 | $0.01 |

  累计 all-time 翻译 19/36=53%，与 09-18 体检 53% 口径吻合。**结论：方案 C（翻译 cron 4h→8h + QC criterion 放宽 + RATE_LIMIT 长退避 retry）对 free tier 429 完全有效**——节点级 RATE_LIMIT 由窗口前 16 次（集中 09-13：翻译 8/短视频 3/批量 3）降到窗口后 2 次且都在 09-14，**09-15 起连续 5 天零 429**；四产线完成率全抬升，短视频/批量窗口后满分。成本结构稳定：窗口后合计 $5.66，③短视频占 95.4%（agnes-video-v2.0 10×$0.5=$5.00 + agnes-image 10×$0.04=$0.40），文本三厂合计仅 $0.26（全 agnes-2.0-flash）。done run 时长中位数：写草稿 7.0min / 翻译 15.1min（降频+retry+gate 重跑，单次更久但完成率翻倍，旧基线 8.6min）/ 短视频 3.4min / 批量 5.4min。cron 节奏正常（写草稿约 24/天、翻译 3/天、短视频 2/天、批量 1/天）。窗口后残留非 done 终态：②翻译 halted×3（09-14/15/18，全是 QC 判“未翻译反问”，根因见上条）+ failed×1（09-14 RATE_LIMIT）；①写草稿 failed×2（09-14 RATE_LIMIT×1、09-18 SSRF 误拦×1，后者已修已部署）、interrupted×4（部署重启，非质量）。

- 历史体检记录（2026-09-11 ~ 2026-09-18 07:52）→ [handoff-archive-2026-09-18.md](docs/handoff-archive-2026-09-18.md)。

> **下一步主线**：商业化 M1→M2→M3 全部完成并部署 Hasee；M3 S6 Stripe 只剩真机 Step6（待收款主体 + STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_IDS）。RTS 阶段 A+B+C 全部完成并真机走查通过。M1 回采 4 条产线继续 cron 自动攒数据 + 每日 10:30 体检。
> **下一步可选方向**：①真机 Stripe Step6（商业化临门一脚）②升级 agnes 付费 key（彻底解决 free tier 429）③~~翻译 review 重跑丢原文~~ **已闭环并经复测证实**（`16db0a5` 已部署 + Hasee `71536df1` 实例已补边；09-20 04:35 UTC 复测补边后 2 个 cron run 全 done、零反问，窗口完成率 15/20=75% 且补边后样本 2/2，随新 run 向 ~94% 收敛） ④RTS 方案 A 单场景 LOD 融合（留档待真实多产线规模再评估）。

> 全部缓做/低优事项（含上述）已统一登记在 [docs/deferred-items.md](docs/deferred-items.md)——每条带触发条件与决策详情链接，触发条件满足时移回本区并标注重启日期。

## Recently shipped (last 6)

按 commit 时间倒序，每条一行影响面 + commit hash：

1. **fix(server) failover 内置 backup 槽 env 启用修复（2026-09-21，工作分支 feature/20260824，`e5c6d4e`，PR #364 merge `2c92a92` 已部署 Hasee）**——#44 failover v1 真机零影响探测（独立进程临时注入 BACKUP_*，不碰服务/.env/重启）发现：`BACKUP_PROVIDER` 硬编码 `enabled:false`，而 `parseRaw` 只对 `enabled===undefined` 的 provider 回填 true，builtin 槽永不被翻为 true——env 填齐、key 在位时 `failoverCandidates` 仍只有主源，灾备实际永不启用（真机实测确认）。改为按 BACKUP_BASE_URL+BACKUP_API_KEY 填齐动态计算 enabled；新增 2 个 env 路径回归测（vi.resetModules 新鲜模块图：填齐→enabled 且进入 candidates、缺 key→保持 disabled），变异验证旧硬编码 false 下新测精确变红。修复部署后真机复测：`candidates=agnes -> backup`，主源临时不可达（SSRF guard 首字节前抛 PROVIDER_ERROR）时日志实测打出 `failing over text model to backup provider`、backup 端真实收到请求，**切换链路端到端打通**；backup 临时同源 agnes 撞 free tier 429，恰好印证真灾备仍需第二个 OpenAI 兼容 provider（卡用户）。server 154 文件 1278 测全过、typecheck 干净。

2. **fix(server) P0 止血：undici 锁回 7.x 对齐 Node 24 内置 fetch + SSRF pin IPv4 优先（2026-09-21，工作分支 feature/20260824，`5036e3c`，PR #362 merge `758a30d`，07:35 UTC 部署 Hasee）**——PR #349 的 undici 7→8 升级导致部署后四产线 22 条 run 全 failed（09-20 14:10 UTC 起，`[PROVIDER_ERROR] fetch failed`，每条 ~5.5min）：ssrf.ts 把 npm-undici **8** 的 pinned Agent（dispatcher）传给 Node 24 内置 undici **7.29** 的 global fetch，跨大版本协议不兼容，每个 pinned 请求抛 `InvalidArgumentError: invalid onRequestStart method`，所有走 SSRF guard 的出站必挂；curl/裸 TCP 全程正常（带 key GET/POST 均 200），一度误诊为"agnes 出站中断"；CI 因 ssrf 测试 stub 掉 global fetch 从未构造真实请求而全绿。修复：undici 锁 `^7.29.0`（大版本只能随 Node 运行时升，dependabot 加 major ignore）、新增导出纯函数 `selectPinRecord()` 双栈 IPv4 优先（Hasee 无 IPv6 路由，pin AAAA 硬失败不回退）、新增真实 loopback http server + pinned Agent × 内置 fetch 兼容性回归测（undici 8 下实测精确失败、7 下通过）补 CI 盲区、ssrf.ts 版本契约注释记录事故。部署后真机独立进程探测健康主源 1.6~2.1s 真实返回文本。事故时间线/根因/教训详见 Active work #52。

3. **fix(core) 模板插值正则 ReDoS 根治：手写线性扫描替换正则（2026-09-20，feature/20260824，`01f8868`/`8c95dfd`，PR #349 CodeQL 阻断项，已合 dev/main 部署）**——PR #349 的 CodeQL PR 检查报 2 个 HIGH（`js/polynomial-redos`），均在 `packages/core/src/variables.ts`：状态机方案 A 新增/沿用的 `${...}` 占位符正则 `/\$\{\s*[^}]+\s*\}/` 里 `\s*` 与 `[^}]+` 在空白字符上重叠，对 `${{` + 长空格（无闭合 `}`）O(n²) 回溯（5 万空格实测卡死 >15s）；第一次改写 `/\$\{[^}]+\}/` 仍被 CodeQL 报——`${{|` 重复串在每个 `$` 位置重启一次 O(n) 扫描（实测 8000 组 100ms，仍二次方）。根治：`evaluateTemplate`（用户 prompt 模板，攻击面最大）/`evaluateCondition`/`validateConditionSyntax` 三处替换统一改用 `indexOf` 手写的 `scanPlaceholders()` 单遍扫描，严格 O(n)、零回溯，空 `${}` 与未闭合语义保持；12 组边界样本（空格包裹/空占位/未闭合/链式插值）与旧正则逐字等价，25.6 万字符毒化输入 0.03ms；回归测覆盖两种攻击形态 + evaluateCondition。core 320 / server 1261 全绿、三包 typecheck Done，CodeQL 与 CI 全 pass；**已随 PR #349 合 dev（merge `894eca3`）、#350 合 main，docs 续随 #352（dev `13626a6`）/#353（main `fcb677b`）合入；Hasee 13:28 UTC 自动部署到 `13626a6`、health ok、重启零 error；**但该部署所含 undici 8 升级随即造成全部 run failed（事故与订正见第 2 条 / Active work #52），当日 22:22 一次性体检任务因额度门控未执行，所谓「首跑闭环」记录作废**。

4. **feat(core/server/web) G2.4 前置 (A) 数组输出契约能力落地（2026-09-20，工作分支 feature/20260824，`978ab56` core / `2fbcbe1` engine / `36135e8` schema / `33dcc91` Inspector，已随 PR #349 合 dev/main、Hasee 部署 `13626a6`）**——deferred G2.4（模板数据源批量预置输出契约）的推荐重启前置 (A)：core `ContractSpec` 扩 `root:"array"` + `items:{requiredFields,types}` + `minItems`（默认要求非空），`validateContract` 校验数组根非空并逐元素断言、违例按 `[i].字段` 报告，新增 `coerceOutputArray`（接受数组或 JSON 数组串）；engine 契约闸门对 `root:"array"` 改读 connector 写入的 `sourceMeta.data`（Product[]/SQL rows，本不进 artifact），回退 `artifactValue` 覆盖未来数组型 http/function/code；Inspector 契约编辑器加「对象/数组」根形状切换，数组模式编辑每元素必填字段/类型（zh/en i18n、全 token 样式）。**默认 root=对象、且无任何内置模板声明数组契约 = 零行为变更，M1 在跑四产线不受影响**。测试：core 契约 32 测（新增 14）、engine 数组集成测 8（`engine.contract` +5 走 JSON 数组 artifact、`engine.products` +3 走 sourceMeta.data，覆盖合规/索引缺字段/空数组/错根形状）、Inspector 数组表单 +2；四包 typecheck Done、全量 3598 全绿、web 构建通过。**G2.4「批量预置到内置模板」仍缓做**——待抓到真实 Product[]/SQL rows 样本逐个核对字段名后再给 tpl-product/tpl-xiaohongshu 预置（见 deferred 模板/生态线）。

5. **chore(deps) 构建工具链五项 major 升级（Dependabot group PR #289 收尾，2026-09-20，工作分支 feature/20260824，`96b3b1e` vitest5 / `6990ac4` vite8 / `a299eeb` TS7 / `6c47b00` undici8，已随 PR #349 合 dev/main、Hasee 部署 `13626a6`）**——#289 此前唯一硬失败是 server `connectors.test.ts` 在 describe 嵌套作用域调 `vi.hoisted`/`vi.mock`（vitest 5 判 Failed Suite），已由 `4e8ac88`（PR #341）把 pg mock 提到模块顶层铺路；本次按耦合度拆四个原子批次逐个升级 + 每步全量回归：①**vitest 4.1.11→5.0.1**（根）+ **@vitest/coverage-v8 4→5**（server），vitest5 peer 仍为 `vite ^6.4||^7||^8` 故先独立升；②**vite 6.4.3→8.3.0 + @vitejs/plugin-react 5.2.0→6.1.1**（plugin-react6 peer `vite^8` 捆绑，vite8 转 rolldown 引擎），并移除 dependabot.yml 里 plugin-react major 的过时 ignore（zod / @types/node major ignore 保留）；③**TypeScript 5.9.3→7.0.2**（根），四包 typecheck 零新增错误；④**undici 7.29→8.10.2**（server，仅 ssrf.ts 用 Agent/ProxyAgent/Dispatcher 稳定核心 API）——⚠️ 此项次日即被 PR #362 回滚（见第 2 条）：undici 8 Agent 与 Node 24 内置 undici 7 fetch 不兼容，属本次升级遗漏的运行时耦合，dependabot 现已锁 undici major。验证：四包 typecheck 全 Done，core 303 / mcp 71 / server 1253 / web 1945（`--no-file-parallelism`）全绿，web 生产构建（tsc + vite/rolldown，276 模块）通过，Playwright E2E 冒烟 2/2（vite8 dev server + plugin-react6 真实 dev 模式）。**zod 3→4（约 1.2k 类型错误，需专项迁移）与 @types/node 24→26（Buffer ArrayBufferLike 致 artifact-store BlobPart 失败，PR #186）仍按 dependabot ignore 缓做**，Node 运行时保持 24。

6. **feat(core/web) 状态机方案 A 增强：branch 非法迁移编译期校验 + 画布状态流转可视化（2026-09-20，工作分支 feature/20260824，`208683b` core + `2c56e48` web，已随 PR #349 合 dev/main、Hasee 部署 `13626a6`）**——deferred「状态机节点」方案 A（graph variables + branch，零新执行语义）的两项增强，正面回应原触发条件里的「非法迁移在画布上拦不住、状态流转图上不可见」：①**编译期校验**（core `compile()`）：branch 规则目标节点不存在、或目标存在但没有从该判断节点出发的正向连线（运行时会静默丢包的非法迁移）判 **error**；条件表达式语法错误（运行时 fail-closed 致该分支永不命中）、`${var.xxx}` 状态变量未在图变量声明初始值判 **warning**；新增纯函数 `validateConditionSyntax` / `extractVarReferences` / `deriveStateMachine`（从 `${var.x} == '状态'` 等值条件静态推导状态空间与迁移，支持正反序、字符串/数字/布尔，忽略不等与大小比较）。②**画布可视化**：branch Inspector 只读「状态流转」预览（状态变量、声明初始值/未声明警示、各状态值→目标节点、默认分支），2D 节点卡片显示 `var.x: 状态` 徽标；Inspector 三视图共用，3D/park 观感视图不深化。i18n zh/en 同步、全设计 token、无硬编码中文 JSX。测试：core +17（compile +7、variables +5、state-machine +5，含变异验证——跳过校验块使 5 测变红、语法校验恒 null 使 2 测变红，恢复后全绿）、web +3（BranchFields 状态预览）；core 303 / server 1253 / web 1945 全绿、四包 typecheck Done。方案 B（正式 `statemachine` 节点）仍留待触发，见 deferred-items 执行引擎线。

7. **test(web/e2e) 高并发 flaky 稳定化 + Playwright E2E 冒烟骨架（2026-09-20，工作分支 feature/20260824，`ee1d635`/`e2e022c`，已随 PR #347 合 dev（merge `310db63`）部署 Hasee、PR #348 合 main）**——两笔测试基建：①**A2 flaky 根治（`ee1d635`）**：testing-library 的 waitFor/findBy 默认 asyncUtilTimeout 仅 1s（vitest testTimeout 本已 10s），多 worker/高负载下 mock promise 与 React effect 偶尔超 1s 才 flush，VersionPanel/ProductGallery/PublishTargets 等偶发误报“停在加载中”/worker 提前退出（隔离、顺序、CI 原本全绿，判负载 flaky）；全局 `apps/web/src/test/setup.ts` 设 `configure({ asyncUtilTimeout: 5000 })`（与 ProductGallery 局部包装一致、仍低于 10s testTimeout，真死锁仍被 testTimeout 兜住），默认多 worker 全量 102 文件/1942 测实跑全绿（EXIT=0，81s）。②**B1 E2E 冒烟骨架（`e2e022c`）**：根 devDep 加 @playwright/test 1.63（复用 RPA 已装的 chromium），根 `playwright.config.ts` 用 webServer 自动起临时库 server（`ALLOW_DEMO=1`，DB/JWT/加密密钥/产物/日志全在 os.tmp 唯一目录、跑完即删，不碰真实数据）+ vite dev web；`e2e/smoke.spec.ts` 两条——guest 打开 /→重定向 /login、一键 demo（POST /api/auth/demo）→进真实产品 + demo 横幅可见 + 无未捕获异常/意外 console error；`pnpm e2e`（首次 `pnpm e2e:install`），本机两次连跑 2/2、RPA 浏览器用例回归 4/4；不跑 AI、无需 provider key。**CI 接入**（runner 装 chromium）与**完整全链路**（注册→配 provider→建产线→跑→出成品）缓至对外开放注册，见 `e2e/README.md`、engineering-blueprint §8。



> **style(web) 设计 token 历史债清理 + deferred RTS 阶段 C 对账（2026-09-19，工作分支 feature/20260824，`5db584f`/`0013c1b`/`6b3a4d2`，已随 PR #345 合 dev（merge `ee118ae`）/ PR #346 合 main，dev 已随 #347 部署 Hasee）**——清账三笔：①`styles.css` 去 21 处 var() fallback：8 处硬编码色 fallback（Tailwind 残留 `#4ade80/#3b82f6/#22c55e/#e5484d/#35e0f0/#0f1623/#1f2937`，对应 token 明暗两套均有定义，删除后 dark 用标准语义色，并修掉 light 主题这些元素不随主题切换的潜在 bug）+ 嵌套 var/值 fallback（含 0 定义假名 `--text-muted`、`--radius-sm,6px`、`--mono,monospace`、`--z-canvas-chrome,5`、`--shadow-lg` 等，外层 token 均有定义、去掉等价）；顺带修真 bug `.compare-table` 把 shorthand `--hair`（值本身是 `1px solid …`）当颜色再套进 `1px solid` 致整条 border 声明被丢弃，改 `--border-primary`；运行时变量 `--inspector-width`（App.tsx 拖拽 setProperty 注入、420px 为首帧默认，width 不在禁列）明确保留。②7 个组件 10 处内联裸 px（CostReport/EvalReport/ABReport/ProductGallery×3/VersionPanel×2/KnowledgePanel 空态 padding 40/20、Settings fontSize12/marginTop8）改 `--space-10/--space-5/--space-2/--text-sm`（已核对 token 实值：--text-sm=12px、--space-2=8、--space-5=20、--space-10=40）。③deferred 表 RTS L0 行从「阶段 C 草案 / 预研模拟造 5–10 条产线」对账为已完成（C1–C3 PR #290、C4–C8 PR #292、polish PR #296 均合 dev 部署真机走查通过；C5/C6 按方案 B 裁剪、方案 A 留档待办 #50）。验证：web 顺序全量 102 文件/1942 测全绿（高并发一次 VersionPanel 停在「加载中」waitFor 超时为已记录负载 flaky，隔离单跑该文件 37/37 绿）、pre-commit 四包 typecheck 全 Done；无新增可见文案。
>
> **fix(core) 翻译校对节点 gate 重跑丢英文原文（2026-09-19，`16db0a5`，PR #343 合 dev / #344 合 main，Hasee 部署 `da07741`）**——tpl-translation 的 review 仅 translate 一个 flow 前驱，gate 退回重译后 review 只见中文初译、误当「原文」反问致 VALIDATION halt；补 intake→review flow 边（inputFor 按 [原文, 初译] 聚合，rework 保留 intake 产物）+ review prompt 显式【原文】/【初译】两段并禁反问；core 拓扑测 + server 端到端 rework 回归测（删边变异即红）；Hasee 实例 `71536df1` 已直接补边换 prompt，补边后 cron run 2/2 done、零反问，窗口完成率向 ~94% 收敛。
>
> 第 7 条及更早（**feat(web) 单厂 3D 节点常显名称标签 + graph-sync 资源释放加固（2026-09-18，`be72c8b`，PR #341 合 dev（merge `9a12d64`）部署 Hasee）**——deferred 3D 美化⑦：新增 `canvas/nodeLabel.ts`，每个节点建筑上方浮常显、面向相机的 billboard 名称 pill（分类色 + 深底圆角、MAX_LABEL_CHARS=12 不拆 emoji、depthTest/depthWrite=false、renderOrder 10、`sprite.raycast=()=>{}` 不抢拾取、同名同 kind 复用 CanvasTexture、jsdom 无 2d context 也写缓存守契约）；顺带修真实泄漏——`disposeGroupChildren` 原浅层遍历只处理直接 isMesh 子节点、漏过 `shape.group` 嵌套，致 graph-sync 重建（重命名/拖动/增删）时旧厂房 geometry/material 不 dispose 不移除，改为 traverse 嵌套 Group/Line/Sprite 后统一 dispose+remove、共享 geometry/材质不 dispose；nodeLabel 7 + canvas 目录 11 文件 151 测过、四包 typecheck 绿。**feat(server) gate 禁用词重写反馈逐处定位 + 命中计数（2026-09-18，`703c47d`，已随 PR #341 合 dev 部署 Hasee）**——新增 `nodes/prohibited.ts` `prohibitedHitsWithContext`，同词多处全报、列命中分句与真实计数，治旧逻辑每词只报首处致模型改不全反复退回 halt；7 纯函数测 + 1 集成测。**画布 3D 视角美化六项 + textGen 写实工业厂房原型（2026-09-17，`9f9cad3` 等，PR #327 merge `d651323b` 合 dev；ACES 色调/线性雾/地台描边/暗角/选中环呼吸/Bloom + 程序化混凝土厂房，详见 deferred 画布/可视化线与 project-progress 快照）**；**demo 零配置首跑 422 两轮修复并闭环（2026-09-16，PR #305 `5812aca` + PR #307 `76dbd42`，均合 dev 部署 Hasee；根因为未登录时 `getSettings()` 401 竞态把 model 清空，改为仅 settings 成功才置 modelOptionsReady，真机首跑不再 422）**；**跨厂物流拱线 + ROI 热度、部署脚本单一事实源 + 蓝图 P0/P1 对账（2026-09-15，`45f65bf`/`16d8503`，PR #296 merge `4b1cd90` 已部署 Hasee、引导链路真机验证通过）**——①RTS C2 polish：跨厂物流管线由贴地直线改为越过厂顶的抛物线拱（弧顶 y≈236 > 厂高 140，等距俯视不再被中间厂方块遮挡），opacity .32→.55，卡车沿拱爬升、crossGroup 重建时释放旧管线 geometry/material（卡车共享材质不释放）；新增并导出无 three 依赖纯函数 crossArchY/crossArchPoints。②C6：工厂热度 sprite 在 CTR·GMV 后补 `ROI=gmv/adSpend`（gmv、adSpend 皆正才显示，adSpend=0 绝不显示 ∞，顺序固定 CTR·GMV·ROI）；后端 ad_spend 链路（content_metrics 列→metricsByGraph→ParkGraphMetrics.adSpend）早已就绪、纯前端补；+5 单测（park-label 8→13）。③运维：修复服务器根 `/opt/agent-world/deploy.sh|rollback.sh` 为 **untracked 手工副本、git pull 永不更新**的漂移隐患——仓库 `scripts/deploy/*` 成为唯一逻辑源（deploy 改为「仅当部署前当前服务健康才写 last-known-good」，避免失败部署把坏 commit 写成回滚点；deploy/rollback 均最多 15s 轮询健康），服务器根两份改为 `exec bash scripts/deploy/*.sh` 引导（备份在 /tmp/*.root-bak），手动跑一次引导部署 `deploy OK: 4b1cd90` 验证链路；`docs/engineering-blueprint.md` 加「现状对账（2026-09-15）」（12 域自包含 P0 全具备，仅独立 Playwright E2E 冒烟缓至对外开放注册前，其余 P1/P2 卡域名/上云/规模化触发，当前不做以避免过度设计）。真机走查：3D 园区工厂方块/24h 排期轴/经济栏/倒计时环/节点详情正常、单产线 3D 链路正常、零 console error；staging crossEdges=0 且无 content_metrics，拱线/ROI 真机为空态（诚实不渲染），几何与格式化逻辑由 13 个 park-label 单测保证。；**feat(web) 版本对比长文本字段逐字高亮（2026-09-18，`0387f97`，PR #341 合 dev）**——graph-diff 新增 diffText/tokenizeText（token 级 LCS 逐字高亮，超长回退整段）+ VersionPanel InlineTextDiff，6 纯函数测 + 1 组件测
> **RTS-C C4-C8 园区经济栏/排期空间化/效果热度/宏观轻操作全集** `dffcf55`/`e540422`/`9a7c900`，PR #292 merge `1f5da5e` 已部署 Hasee；RTS-C C1 跨厂产物边 + Stripe 全栈 `2ea918a`/`c47e50b`/`42468ac`/`4a526ff`，PR #287/#290 merge `27f28ee`；M3 S6 Stripe 后端 A0-A4 `c0f708e`/`f5113be`/`b133c91`/`add61a4` 已并入该条 Stripe 全栈；2026-09-15 的园区状态色+标签优化 `9342d90`/PR #285、M3 S6 Stripe 前端 A5 `2c670c4`，以及 2026-09-14 及以前：M3 S1-S5 收款与账单、run.finished 失败原因记录、Guided Tour、RTS 阶段 B 全部、M1 回采三问分析 + 价格校准等）已滚出本列表 / 归档至 handoff-archive。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

* `pnpm -r typecheck`：全绿（core/server/mcp-server/web `tsc --noEmit` 全部干净；2026-09-18 版本逐字高亮与 docs 原子提交时 pre-commit hook 四包 typecheck 均复核全 Done（前台超时会自动转后台任务，无需 --no-verify））

* 测试总数 **3616**（2026-09-21 Node 24 全量实跑全绿（EXIT=0）：**core 22 文件 320、server 154 文件 1278、web 103 文件 1947（vitest 全量；`--no-file-parallelism` 顺序 1947 全过）、mcp 3 文件 71，共 282 文件**。ReDoS 根治（`01f8868`/`8c95dfd`，PR #349 CodeQL 阻断项）core +1（线性扫描回归测，覆盖两种攻击形态）；此前 G2.4-A 数组契约（`978ab56`/`2fbcbe1`/`36135e8`/`33dcc91`）core +16（contract 数组分支）、server +8（`engine.contract` +5 走 JSON 数组 artifact、`engine.products` +3 走 sourceMeta.data）、web +2（Inspector 数组表单）；此前状态机方案 A 增强（`208683b`/`2c56e48`）core +17（compile +7 / variables +5 / 新增 state-machine +5）、web +3（BranchFields 状态预览，新增测试文件）；此前 2026-09-18/19 基线为 3552 / 280 文件（core 286、server 1253、web 1942、mcp 71）。相对当日早前 snapshot（3532 / 277 文件）+20 测 / +3 文件：当日晚 #35 SSRF DNS 瞬时失败有限重试 server +5、#36 parkCoordScheduler web +6（新测试文件）、#37 nodeLabel web +7（新测试文件）；09-19 翻译 review 修复 `16db0a5` core 模板拓扑 +1（templates.test.ts）、server 端到端 rework 回归 +1（新文件 translation-review-rework.test.ts）；core/mcp 本轮零改动，沿用当日早前实跑值；数字一律以本次实跑为准）：

  * `pnpm --filter @agent-world/core test`：**320/320 通过**（22 文件；2026-09-20 实跑；ReDoS 线性扫描回归 +1、G2.4-A 数组契约 contract +14、状态机方案 A compile/variables/state-machine +17；早前 2026-09-18/19 含翻译模板 review 有序双前驱拓扑测试 +1；parkLayout、file/product connector 形状断言、compile trigger warning、模板 33 形状守护、单价缺口、trace timeline、contract、deadline 等）
  * `pnpm --filter @agent-world/server test`：**1278/1278 通过**（154 文件；2026-09-21 Node 24 实跑；failover v1（routing/config 新文件）、#52 undici pinned-Agent 真实 loopback 兼容回归 + selectPinRecord、#364 backup env 启用路径两批修复新增，一律以本次实跑为准；G2.4-A 数组契约 `engine.contract.test.ts` +5、`engine.products.test.ts` +3；早前 2026-09-18/19 09-19 翻译 review 重跑回归 `translation-review-rework.test.ts` +1（新文件，真实 tpl-translation 经 gate 退回断言 review 各 attempt 输入含原文+初译）；当日晚 #35 SSRF DNS 有限重试在 ssrf/code-proxy 既有文件再 +5；早前 09-18 gate 禁用词 `prohibited.ts` +8（7 纯函数 + 1 集成），09-17 四项收口新增：G2.2 `engine.contract.test.ts` 9、G1.2 `engine.fork.test.ts` 3 + `api.fork.test.ts` 5、G4.4 `engine.videogen.async.test.ts` 5；此前 09-16 五项补强 runs 全文搜索 4、diagnose 6、parse-file xlsx 5，demo 零配置首跑修复 +1、09-15 演示用户 +23、StreamableHttp notify flaky 修复 +1）。历史备注：Node v22 + macOS seatbelt 下依赖 spawn JS sandbox 子进程的用例曾 status 71 失败（干净基线与带改动失败集合 diff 为空、非回归，CI Linux bwrap 正常）；另有 2 个真实 chromium 的 RPA 浏览器用例需 `pnpm exec playwright install`——**2026-09-20 起本机 chromium 已装（随 E2E 落地），`rpa.browser.test.ts` 本机实跑 4/4 通过**；高并发全量偶发 `audit write failed: table locked`（SQLite 表锁竞争，重跑即过、非回归）。
  * `pnpm --filter @agent-world/mcp-server test`：**71/71 通过**（3 文件；含 stdio 端到端冒烟 3 个。负载性 flaky：`pnpm -r test` 并行时 stdio 冒烟可能超 5s，单独跑稳定）
  * `pnpm --filter @agent-world/web exec vitest run`：**1947 总数**（103 文件；2026-09-20 `--no-file-parallelism` 顺序实跑；G2.4-A Inspector 数组契约表单 +2、状态机 BranchFields +3；早前 2026-09-18 当日晚 #36 `parkCoordScheduler` +6（新文件）、#37 `nodeLabel` +7（新文件）；早前本轮版本逐字高亮 `graph-diff` +6 / `VersionPanel` +1；此前 09-17 3D 美化 + CI 修复新增 `iso3d-shapes.test.ts` 厂房 LED 用例 1、`Canvas3D.test.tsx` 补 PMREM/后处理 stub；此前 09-17 四项收口：RunTimelineView fork/reused +3、新 `InspectorFields/RetryField.test.tsx` 2；09-16 五项补强：lib/graph-diff.test.ts 8、VersionPanel 版本对比 +4、GraphSwitcher 搜索/收藏 +11、RunHistory 全文搜索 +3 与失败诊断 +4、SourceFiles xlsx +2；组件目录零「有 .tsx 无 .test.tsx」）。✅ **本机高并发负载 flaky 已于 2026-09-20 修复（A2，`ee1d635`）**：根因是 testing-library 的 waitFor/findBy 默认 asyncUtilTimeout 仅 1000ms（而 vitest testTimeout 本已 10s），多 worker/高负载下 mock promise 与 React effect 偶尔超 1s 才 flush，导致 VersionPanel/ProductGallery/PublishTargets 等（每次不固定、均不在改动范围）误报“停在加载中”或 worker 提前退出；在全局 `src/test/setup.ts` 设 `configure({ asyncUtilTimeout: 5000 })`（与 ProductGallery 局部包装一致、仍低于 10s testTimeout，真死锁仍被 testTimeout 兜住）后，**默认多 worker 全量 102 文件/1942 实跑全绿（EXIT=0，81s）**，隔离/顺序/CI 原本即全绿。判断回归仍看改动文件 + 全量 + CI。

* **E2E 浏览器冒烟（2026-09-20 落地，B1，独立 @playwright/test runner、不计入上面 3598 单测数）**：根 `playwright.config.ts` + `e2e/smoke.spec.ts`（@playwright/test 1.63，命令 `pnpm e2e`，首次需 `pnpm e2e:install` 装 chromium）；webServer 自动起临时库 server（`ALLOW_DEMO=1`，DB/JWT 密钥/加密密钥/产物/日志全落在 os.tmp 唯一临时目录、跑完即删，不碰真实数据）＋ vite dev web（/api 代理 8791）。2 条冒烟：guest 打开 /→重定向 /login；一键 demo（POST /api/auth/demo）→进入真实产品 + demo 横幅可见 + 无未捕获异常/意外 console error。本机两次连跑 2/2 全绿、RPA 浏览器用例回归 4/4。不跑 AI、无需 provider key。**CI 接入**（runner 装 chromium）与**完整全链路**（注册→配 provider→建产线→跑→出成品）仍缓至对外开放注册，运行说明见 `e2e/README.md`。

* 各用例逐波来源（单价审计/连接器插值/PG/加密/RBAC/公告/重构/狗粮九波等）已随对应待办归档到三份 handoff-archive，本 snapshot 只记当前数，不堆历史。

* **Node 版本硬要求**：依赖 `node:sqlite`，必须 Node ≥ 22（CI 用 Node 24；本地默认 Node 20 会误报 `No such built-in module: node:sqlite`，用 `fnm exec --using=24` 跑）。**P1 沙箱实跑测试必须在 Node 24 下验证**（否则 resolveInterpreter 版本探针走不同分支）。

  * ### ⚠️ 版本不对时的症状指纹
    非 Node 24 下跑全量 server 测试，失败会呈现为 **32-36 个用例波动失败**，且**全部依赖 code 节点子进程**（`engine.code`/`loop`/`map`/`table`/`generic`），报错 `ENOENT lstat '<internal-path>'` 或 `finished` 为 `undefined`——看起来像沙箱跑不起来而非版本问题，失败数随超时随机浮动。**判定**：`fnm exec --using=24 -- pnpm --filter @agent-world/server exec vitest run`，全绿即为版本问题。`git stash` 对比基线只能证明"不是本次改动引入"，**不能**证明"是环境问题"，两者是不同命题。

  * ### 🪟 Windows 本机测试基线（2026-09-18 实测，非权威平台）
    Windows 上 server 全量**不能全绿是平台基线、不代表回归**：153 文件 1247 测 1112 过 / 135 失败（56 文件），失败只有两类根因——① 用临时 sqlite 目录的测试 afterEach `rmSync(...,{recursive,force})` 抛 **EPERM**（Windows 文件句柄/WAL/索引器或杀软扫描未释放，db.* / costs / migrations / runs / graphs / events / invoice / subscription / usage-metering / isolation / graph-versions 整片）；② 代码沙箱后端缺失（Windows 无 bwrap/seatbelt/rlimit，code-sandbox 的 child_process 拒绝、RLIMIT_NPROC fork-bomb 2 测；engine.code/loop/table/map/parallel-join/generic、regression/core-path 连带）。**证明非回归**：`git stash -u` 干净 HEAD 重跑 db.operations 8/8、engine.loop 5/6 失败与带改动完全一致。Windows 判断回归只跑改动相关测试 + `pnpm -r typecheck`；权威全绿以 CI Linux（self-hosted runner）与 macOS 默认测试为准：macOS 默认 `CODE_SANDBOX` 走 rlimit 后端，Node 24 下 server 153 文件 / 1252 测全绿（2026-09-18 实跑）；仅当显式 `CODE_SANDBOX=sandbox-exec` 启用 macOS seatbelt 后端时，有 **37 测 / 7 文件基线失败**（engine.code、engine.loop、engine.map、engine.table、engine.parallel-join、engine.generic、regression/core-path；2026-09-18 Node 24 实跑，旧记「~32」随引擎用例增长而过时）——根因是 seatbelt 硬断网仅支持 `net:"none"`、内部路径 `lstat`、fs/子进程隔离语义与 bwrap 不同，属后端能力差异、非回归，CI Linux bwrap 正常。本机环境：便携 Node v24.11.0 在 `C:\Users\24670\node24`（PATH 上其余 node 是 DoubaoWork/TRAE/hermes 自带 v22，engines 要求 ≥24），pnpm 无 shim、走 `corepack.cmd pnpm`，装包加 `--registry=https://registry.npmmirror.com`，改 core 后先 `pnpm --filter @agent-world/core build`；corepack/SQLite 的 ExperimentalWarning 走 stderr，PowerShell 会显示 NativeCommandError 并非零退出码，不代表命令失败，看 vitest 自身 passed 判定。

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

### ⚠️ macOS 上 python code 节点测试失败？先查 Xcode 协议（2026-09-21 定位）

`engine.code.test.ts` 里仅有的两个 **python** 用例（`…routes python egress…` / `…blocks hosts outside TOOL_NETWORK_ALLOW…`）在本机报 `ENOENT … lstat`、`node.finished` 不出现。根因不是代码：沙箱 `resolveInterpreter("python")` 跑 `which python3`（[code-sandbox.ts:36](packages/server/src/code-sandbox.ts:36)），本机落到 `/usr/bin/python3`——Xcode CLT 的占位 shim，未接受协议时拒绝执行（`You have not agreed to the Xcode license agreements`），子进程起不来。**Linux CI / Hasee 是真 python3，不受影响。**修复二选一：`sudo xcodebuild -license accept`，或 `brew install python` 让 `/opt/homebrew/bin/python3` 在 PATH 中先于 `/usr/bin`。排查手段：先 `python3 --version`，若打印 Xcode license 提示即此问题。

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

