# Handoff

State of Agent World as of 2026-09-24.

> **历史内容已归档**：2026-08-27 之前的全部变更记录、各阶段详细描述、质量门与已知 gap，已整体搬到 [docs/handoff-archive.md](docs/handoff-archive.md)。本文件只保留"项目当前状态 + 活跃任务 + 最近 6 个变更"。

## Project documents

📚 **文档地图（按场景怎么读 + 状态约定）**：[docs/README.md](docs/README.md)。以下为全部文档直达（本区是完整清单的单一事实源，README 只做场景导航、不重复清单）：

* [docs/PRD.md](docs/PRD.md) — phased roadmap and architectural guardrails
* [README.md](README.md) — two core design decisions, layout, running instructions
* [BENCHMARK.md](BENCHMARK.md) — 性能基准测试：运行方式、范围、结果记录表

* [docs/technical-design.md](docs/technical-design.md) — architecture, data models, API

* [docs/roadmap-generalization.md](docs/roadmap-generalization.md) — 通用化路线图（当前主线，5 阶段）

* [docs/deferred-items.md](docs/deferred-items.md) — 缓做/低优事项登记表（挂起项 + 触发条件的单一事实源）

* [docs/competitor-painpoints.md](docs/competitor-painpoints.md) — 竞品痛点调研（Dify/Coze/n8n 等 6 类共性痛点 + 现状对账 + G1-G7 增强建议，P0=步级 trace/上游数据契约护栏）

* [docs/design-step-trace-and-robustness.md](docs/design-step-trace-and-robustness.md) — 竞品 P0/P1 落地方案（G1 步级 run 时间线+从节点 fork 重跑 / G2 上游数据契约空值护栏 / G4 长任务超时降级续跑 / G3-G5 补充决策）；**G1 只读链路 + G2.1/G4.1 纯函数随 PR #319 合 dev（2026-09-16）；G1.2 fork、G2.2 engine 契约接线、G3 重试下放、G4.4 本次运行内视频轮询已于 2026-09-17 在 feature/20260824 落地并随 PR #325 合 dev（merge `fb00657`，见 Active work #55 续）；G4 步骤 1/2 纯增量地基（node.degraded 事件 + REMOTE_JOB_LOST + migration 41 remote_jobs 表/driver CRUD）已于 2026-09-23 在 feature/20260824 落地（`299b38d`/`de3eba6`/`070240e`，三 commit 均已 push 并合入 origin/dev）；G4 步骤 ③ reconstructState 投影 degraded（`4eef8d8`）与步骤 ④⑤⑥（videogen degraded/halt+remote_jobs 落库幂等、resume reattach/accept-degraded、web 橙色标识+三按钮，7 原子 commit `3434e79`/`34a6a5e`/`2b58092`/`7d7a08f`/`fce8324`/`8169794`/`fe80ed4`）均已于 2026-09-24 在 feature/20260824 落地，随 PR #408 合 dev（merge `a557d8b`）、PR #409 合 main（merge `c1d55ff`），Hasee 已自动部署 `a557d8b`、health ok=true、部署零打断、日志零 error（见 Active work #41 体检续）；G2.4 仍留待；G5 已于 2026-09-18 落地并随 PR #331 合 dev（merge `26ec4a5`，已部署 Hasee、health 探针 commit 一致，见 Active work #55 续二）**

* [docs/security-audit-2026-08-31.md](docs/security-audit-2026-08-31.md) — 安全审计报告 + 修复方案（3 Critical / 10 High / 8 Medium / 8 Low，**29 项全部修复**；含两条旧"已解决"结论的更正）★

* [docs/code-audit-2026-09-06.md](docs/code-audit-2026-09-06.md) — 全项目代码审计报告（77 项：high 8 / medium 38 / low 31；「六、修复状态」截至 2026-09-11 **已全部清账：已修复 73 / 无需修复 3（M4、L7、L24 复核后果不成立）/ 部分修复 1（M38 FanoutConfig 已修，ConnectorConfig/GraphNode 因怕破坏历史数据加载有意暂缓，归配套迁移类）/ 未修复 0**）★

* [docs/mvp-readiness-review-2026-09-22.md](docs/mvp-readiness-review-2026-09-22.md) — 项目级 MVP 上线就绪评审（最新版，2026-09-22；结论：自托管 MVP ✅ 达到且超出（367 runs/3631 测试/备份恢复演练通过/两次断电自愈），对外商业 SaaS ❌ 功能 Ready、收款/运维 Not Ready；含上线阻断项 P0/P1/P2 与 go-live 清单）+ [09-21 版](docs/mvp-readiness-review-2026-09-21.md)（历史基线）★

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

* [docs/handoff-archive.md](docs/handoff-archive.md) — historical changes (pre-2026-08-27)；后续滚动归档 [handoff-archive-2026-09-07.md](docs/handoff-archive-2026-09-07.md)（#1–#37）、[handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)（#24–#43）、[handoff-archive-2026-09-11.md](docs/handoff-archive-2026-09-11.md)（#44–#45）、[handoff-archive-2026-09-18.md](docs/handoff-archive-2026-09-18.md)（#39、#46–#56、M1 验收、#41 历史体检）、[handoff-archive-2026-09-22.md](docs/handoff-archive-2026-09-22.md)（2026-09-19~22 shipped 条目 + Active work：#52 P0 事故、#41 历史体检）

* [docs/PRODUCT\_STRATEGY.md](docs/PRODUCT_STRATEGY.md) — 产品策略汇总（成本/部署/定价/商业化决策基线）

* [docs/project-progress.md](docs/project-progress.md) — 整体进度基线（模块完成度 + 待启动管线 + 迭代规则）

* [docs/design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) — 自媒体电商方向 F1-F10（run 内多变体/审核队列/合规/商品库/批量/效果回流/发布，已全部落地）
* [docs/design-monetization.md](docs/design-monetization.md) — 商业化实施方案（三层计费 / 订阅 gate / P0-P3，**价格已用 M1 真实数据校准 2026-09-14；M2 订阅 gate S1-S8 已落地并部署 Hasee（见 #47），Stripe 真机 Step6 待 key（见 #48）**）
* [docs/design-monetization-m2-implementation.md](docs/design-monetization-m2-implementation.md) — M2 订阅 gate 落地方案（S1-S8 分步骤 + 测试策略 + 回滚方案 + Hasee 部署手册，2026-09-14 S1-S8 代码全部完成并部署 Hasee）
* [docs/design-monetization-m3-implementation.md](docs/design-monetization-m3-implementation.md) — M3 收款与账单落地方案（S1 invoices 表 + 账单生成 / S2 账单页 UI / S3 HTML 发票 / S4 手动收款闭环 / S5 团队席位 / S6 Stripe 待收款主体，2026-09-14 启动）
* [docs/design-monetization-m3-s6-stripe.md](docs/design-monetization-m3-s6-stripe.md) — M3 S6 Stripe 支付网关集成总方案（数据模型/API/webhook/安全/测试/分步；后端 A0-A4 + 前端 A5 均已完成并部署 Hasee（见 #48），仅剩真机 Step6 卡收款主体 + key）
* [docs/design-monetization-m3-s6-a5-frontend.md](docs/design-monetization-m3-s6-a5-frontend.md) — M3 S6 Step A5 前端 BillingTab 实施方案（按钮状态矩阵 / 回跳 query / 错误降级 / i18n / 测试 / 分步，2026-09-15）
* [docs/design-demo-user.md](docs/design-demo-user.md) — 演示用户（免注册一键进真实产品，is_demo 标记真实账号 + 体验额度 + demoGuard 能力黑名单 + claim 原地转正 + TTL 级联清理；迁移 v40、D1-D6 分步。**D1–D6 已随 PR #302 合 dev 部署 Hasee 并真机走查；零配置首跑 422 经两轮修复（PR #305 `5812aca` + PR #307 `76dbd42`）已真机闭环、Hasee 已挂每小时 prune-demo cron（**2026-09-21 只读取证闭环**：`/var/lib/agent-world/logs/prune-demo.log` 严格每小时 :17 一条、mode=APPLY，与 cron `17 * * * *` 精确吻合；活库 5 用户 / 0 demo，故每轮 `expired 0 / deleted 0` 属正常空跑；cron 挂 agentworld 个人 crontab，静态行需 root 未直读，但连续运行日志即"在执行"的证据），详见 handoff #52/#53 与该文档 §十六**）
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

* [docs/runbooks/error-reporting.md](docs/runbooks/error-reporting.md) — 错误追踪与告警运维手册
* [docs/runbooks/tts-provider-setup.md](docs/runbooks/tts-provider-setup.md) — TTS 供应商配置运维手册（SiliconFlow/OpenAI 两套 step-by-step、验证清单、故障排查；G-H，2026-09-22）
* [docs/runbooks/change-management.md](docs/runbooks/change-management.md) — 变更管理流程（变更分级/审批/窗口/回滚/记录模板）
* [docs/runbooks/postmortem-template.md](docs/runbooks/postmortem-template.md) — 事故复盘模板（时间线/根因/影响/改进项/无指责复盘）
* [docs/browser-verification.md](docs/browser-verification.md) — Claude Chrome DevTools MCP 自动开浏览器验收部署的配置与用法（ErrorRecord 数据形状/隐私边界；默认零配置查 `GET /api/admin/errors`；`ERROR_REPORT_WEBHOOK_URL` webhook sink 启用；Discord/Slack/飞书/Sentry/Loki 直连 vs 必须 relay 对照表 + 零依赖 relay 示例；`pnpm selftest:errorsink` 自检 CLI 退出码语义）

* [docs/environments.md](docs/environments.md) — 环境划分（M0 单机合一 → M3 三套 DEV/TEST/PROD → 未来规模化；环境→分支映射：`feature/*`=DEV / `dev`=Hasee 准生产 / `main`=PROD）

* [docs/production-ops.md](docs/production-ops.md) — 生产级运维与可观测性（环境状态检测 / 密钥注入 / k8s 选型判断 / 可观测性栈 / 日常运维·实时监测与拿日志；2026-09-07 定稿未实施）

* [docs/engineering-blueprint.md](docs/engineering-blueprint.md) — 企业级工程化蓝图（**12 工程域全景**：可观测性/可靠性/发布/安全/配置密钥/IaC/数据/测试/性能/DevEx/运营/FinOps；每域「现状/缺口/补齐方案/优先级」+ M0→M3→规模化分级路线；2026-09-07 定稿，**2026-09-15 加「现状对账」：12 域自包含 P0 经实证全具备、部署脚本单一事实源加固、Playwright E2E（smoke+flows 共 5 测）2026-09-24 已接入 CI**）

* [docs/design-scaling.md](docs/design-scaling.md) — 规模化与企业级架构方案（**分布式 / 高可用 / 高并发 / 大数据量 / 托管 / 数据处理 / 合规**七主题，每项「现状/问题/方案/触发条件/落地步骤」；**决策：自托管 + SaaS 都做，先自托管后 SaaS**——自托管阶段只需成本熔断/备份演练/探针/对象存储，SaaS 阶段再补 PG/多副本/分布式锁/合规；2026-09-07 定稿待评审）

* [docs/design-postgres-migration.md](docs/design-postgres-migration.md) — PostgreSQL 迁移设计（主库 SQLite→PG：现状盘点 / 差异清单 / 双驱动改造 / 数据搬迁 / 迁移 SQL 命名规则 / 回滚 / 验收；设计定稿 2026-09-08；**阶段 1-3 + 搬迁脚本均已落地 2026-09-08**——`sqlite-driver.ts` + `DatabaseDriver` 异步接口 + 137 方法 async + `pg-sql.ts`/`pg-driver.ts`（阶段 1-2）；**阶段 3**：`db.ts` `openDatabase()` 按 `DB_DRIVER` 分派（默认/空值=sqlite，未知值 fail-closed，PG 连接走 `DATABASE_URL` 或 `PG_*` env）+ `index.ts` 接线 + FTS 知识库 PG 下诚实降级为 `NoopMemoryBackend` + `db-driver-switch.test.ts` 5 例守护；**搬迁脚本**：`migrate-to-postgres.ts`（`pnpm --filter @agent-world/server migrate:postgres`，VACUUM INTO 快照→toPgDdl 建表→流式批量 INSERT→行数校验，`--dry-run`/`--verify-only`），落地时**修复 DDL 契约缺口**（`resource_access`/`subscriptions`/`usage_ledger`/`idempotency_keys` 4 表只在迁移 32-35 建、DDL 常量缺失，fresh PG 库会缺表——已补 DDL）；server 929/929 绿；**端到端演练 ✅ 2026-09-08**（Docker postgres:16 + dev 库 25 表/12.2 万 events：行数对齐/71 图逐字节一致/enc:v2 密文可解密/PG 冒烟注册→建图→更新→版本列表全通；**演练抓出并修复 9 类方言缺口**——DDL 缺 3 列、BLOB→bytea、rowid→ctid、LIMIT -1→ALL、date() 日桶、INSERT OR IGNORE→ON CONFLICT、upsert 列名歧义、node-pg bigint→string 解析器、PG 别名小写折叠需加引号，详见设计文档 §8 表格）。**剩余：性能压测 + 生产切换等价性，随 SaaS 阶段真实流量验证**）

* [docs/design-multitenancy.md](docs/design-multitenancy.md) — 多租户数据模型设计（**tenant / user / 资源 / 计费**四者关系；tenant=计费与隔离边界，自托管=隐式单租户、SaaS=显式多租户；`users.tenant_id` 推导避免全表加列，订阅计费按 tenant、角色三层分权；向后兼容两阶段演进；2026-09-07 起草待评审）

* [docs/design-ab-testing.md](docs/design-ab-testing.md) / [docs/design-skill.md](docs/design-skill.md) / [docs/design-glossary.md](docs/design-glossary.md) — A/B 实验 / Skill 体系 / 术语表
* [docs/design-design-tokens.md](docs/design-design-tokens.md) / [docs/design-i18n.md](docs/design-i18n.md) / [docs/web-component-testing-plan.md](docs/web-component-testing-plan.md) — 设计 Token / i18n / 组件测试

* [docs/design-canvas-isometric.md](docs/design-canvas-isometric.md) — 画布等距 3D 展示视图设计（受限 3D：俯角固定 + 水平旋转 + 平移；2D/3D 一键切换；**五期均已实施**——第五期（2026-09-17）为 3D 视觉打磨六项；**写实工业风已于 2026-09-22 推广全部 29 种节点**（可复用 PBR 部件库组合 + 每节点一处分区色饰件），另含 jsdom 测试约束）

* [docs/design-guided-tour.md](docs/design-guided-tour.md) — 新用户分步引导 Guided Tour 设计（聚光灯分步教学 + 上一步/下一步/跳过；§十二 多引导注册中心：引擎与定义解耦、引导即数据、版本化 seen、What's-new/⌘K 动态注册，**已落地**）

* [docs/design-rts-stage-b.md](docs/design-rts-stage-b.md) — RTS 阶段 B 宏观沙盘 MVP 落地级细化（B1-B9 全部完成，B5 帧率实测 100 厂=60FPS 达标）
* [docs/design-rts-overview.md](docs/design-rts-overview.md) — RTS 宏观上帝视角设计总览（L0 工业园区 / L1 单厂 3D / L2 节点三层缩放；六类宏观信息；A 平面工作台→B 宏观沙盘 MVP→C 完整 RTS；**阶段 A/B 已完成，阶段 C 全部完成（C1-C3 随 PR #290、C4-C8 随 PR #292 合 dev 并部署 Hasee、真机走查通过；C5/C6 两处裁剪与方案 A 留档见待办 #50）**）

* [docs/examples.md](docs/examples.md) / [docs/extending.md](docs/extending.md) / [docs/integrations-future.md](docs/integrations-future.md) — 模板示例 / 扩展指南 / 未来集成（Notion/Linear/邮件/内容平台）
* [docs/design-tts-provider.md](docs/design-tts-provider.md) — TTS Provider 接入设计（audioGen 配音链路；推荐 SiliconFlow 原生 OpenAI 兼容 `/audio/speech`，含 UTF-8 字节计费/音色命名/软降级口径与 P0 零代码验证、P1 产品化、P2 edge-tts 三档；2026-09-22 P1 产品化 G-A/G-B/G-D 已落地并部署 Hasee；G-C 无能力软降级已于 2026-09-24 落地（见 #63），剩 P0 真机（卡 SF/OpenAI key）+ G-F 是否点名内置供应商待拍板）

* [docs/mvp-readiness-review-2026-09-21.md](docs/mvp-readiness-review-2026-09-21.md) — MVP 上线就绪评审（判定：个人/小团队自托管 MVP ✅ 达到；对外商业 SaaS ❌ 功能 Ready、收款/生产运维 Not Ready，含分口径硬阻断项与 go-live 清单）

* 历史（决策记录，勿据此实现）：[docs/product-vision-discussion.md](docs/product-vision-discussion.md) / [docs/tech-stack-assessment.md](docs/tech-stack-assessment.md) / [docs/roadmap-tasks.md](docs/roadmap-tasks.md)

* 根目录元文档：[CHANGELOG.md](CHANGELOG.md)（变更日志） / [CONTRIBUTING.md](CONTRIBUTING.md)（贡献指南） / [AGENTS.md](AGENTS.md)（AI 行为规范：commit / i18n / UI 文案约定，**新会话必读**） / [git-commit-message.md](git-commit-message.md)（commit message 详细规范）

## Current state

* **Monorepo**：`packages/core` / `packages/server` (Node + sqlite, 端口 8791) / `apps/web` (Vite, 端口 5173)

* **核心能力**：5 类 AI 生成节点（textGen / imageGen / videoGen / audioGen / generic）+ **通用节点（HTTP 请求 / 代码执行 / 条件分支 / 映射 / 循环 / 并行聚合 / 表格处理 / 数据库查询 / 文件解析 / 翻译 / OCR / 文件转换 / 搜索 / 通知 / 人工审批 / 子流程 / 合规 / 发布 / 扇出 / 择优）**，节点类型共 29 种（`NodeKind`，按 `NODE_CATEGORIES` 五组：AI 加工 5 / 车间调度 9 / 物料处理 7 / 外接设备 6 / 投料出料 2），**Phase 4 编排能力全部落地（2026-08-30 复核）：人工审批 human 节点 / subprocess 子流程调用 / graph 变量跨 run 持久化 / error 边 + catch 容错路径 / 失败级联 skip / 节点级重试基建（search/http/code/translate）/ 失败告警 + rerun；状态机按决策缓做**，**MCP Server（stdio + HTTP/SSE 双传输，15 工具 + resources + prompts + 实时 notifications 桥接 + Authorization Bearer 认证，P0-P2 全部落地）**，多产线管理，Inspector 模型下拉严格按 modality 过滤，多模态产出（Artifact 分层），流式 + SSE + 断线重连 + halt/resume，成本电表（token + 单价两种模式），评估体系雏形，产物落库归属流水线（artifacts 的 graph\_id/role），**版本管理补强（2026-08-30）**：保存前自动快照（节流 + 每图滚动保留 30 条）+ 版本与最近 run 的 content hash 关联标记 + 只读恢复预览（结构摘要 + SVG 缩略图），**模板参数化全链路（2026-08-30）**：TemplateField 实例化应用（core）+ fieldValues API（server）+ TemplateFieldDialog 参数表单（web 双入口，4 个 HTTP 模板声明 URL 字段），**术语表弹窗（2026-08-30）**：GlossaryModal 标准术语 ⇄ Agent World 游戏化用词对照（design-glossary.md 单一事实源），**Inspector 交互修复（2026-08-30）**：面板改为显式**点击**节点才展开、拖拽节点不再误弹（store.inspectorOpen 信号驱动），**模板能力释放（2026-08-31）**：18 个实用模板覆盖主要节点能力（含 loop 批处理 / vcs / convert+ocr / search+TTS），现有模板容错加固（error 边兜底），routingWorker 补视频音频路由（此前 videoGen/audioGen 生产被静默跳过），**模板分类展示（2026-09-01）**：业务模板增至 27 个（覆盖 25 种节点类型中的 23 种），分类收口为 core `TEMPLATE_CATEGORIES` 有序 11 类，TemplatePicker 改为按分类分组滚动、空白画布钉在最前（design-templates §6）；**专业服务方向（2026-09-04）**：业务模板增至 **33 个**（法律合规 5 + 财务审计 4，新增银行对账/隐私合规/发票 OCR/批量合同审查/审计抽样/尽调清单，全部零新节点 + 逐一真实狗粮），**fileParse 支持多文档解析**（`===== 文件名 =====` 分隔），**Skill 体系用户化（2026-09-09）**：内置卡 5→11 覆盖全部四种 kind，`judge` 卡接进 gate 节点、权限强制改声明驱动、6 张卡预挂 4 模板；**用户可自助接入远端 MCP 服务（http/sse，per-user 连接池 + 保存即试连，stdio 仍只走运维 env）并自建三种数据技能卡（prompt-module / output-contract / judge，强制 `local:` 前缀，不进全局 registry、盖不住内置同名）**；设置弹窗重构为**模型 / 集成 / 技能**三标签页，MCP 服务列表与节点技能面板均支持搜索，技能面板可深链到「设置 → 技能」；**3D 视觉打磨（2026-09-17，PR #327）**：L1 单厂 3D 加 ACES 色调映射 + 线性雾 + 环境反射 + Bloom 泛光 + 暗角 + 地台/描边 + 选中光环与 running 呼吸脉冲；✅ **写实工业风已推广全部 29 种节点（2026-09-22）**——`industrial-kit.ts`（可复用 PBR 部件库：钢架/控制柜/压力容器/料仓/管段/阀门/汇流排/电机/传送带/漏斗/镜头/天线/号筒/门架/文件架）+ `industrial-recipes.ts`（每 kind 组合配方，textGen 沿用 `industrial-shapes.ts`），共享模块级材质不销毁，每节点带一处按 `categoryColor(kind)` 着色的分区色饰件保持五厂区可读；原 iso3d-shapes 风格化方块路径已删除

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
> #44–#45 见 [handoff-archive-2026-09-11.md](docs/handoff-archive-2026-09-11.md)，
> #39/#46–#56 见 [handoff-archive-2026-09-18.md](docs/handoff-archive-2026-09-18.md)，
> 2026-09-19 起 shipped 条目及 Active work 归档（#52 P0 事故、#41 历史体检）见 [handoff-archive-2026-09-22.md](docs/handoff-archive-2026-09-22.md)。

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
- ✅ **#57 上线就绪加固（错误追踪适配层 + code CPU flaky 稳定化 + 依赖 patch/minor，2026-09-21）**：零依赖 `errors.ts` 进程/请求错误环形缓冲（默认 100 条、stack 截 4000 字）+ `installProcessGuards`（幂等；uncaughtException 记录后走既有 shutdown 由 systemd 重启、unhandledRejection 只记录不退出）+ owner/admin 只读 `GET /api/admin/errors?limit=`（对齐 /api/audit 可见性，401/403/owner 200 倒序三测）+ 可插拔 `ErrorSink`/`createWebhookErrorSink`（`ERROR_REPORT_WEBHOOK_URL` 在非 test 启用、fire-and-forget、失败只 log 防递归、fetchImpl 可注入、**零 SDK**）；Hono `app.onError` 仅对 status≥500 记录 method/path 并回通用 500（不泄内部细节）。另把 `engine.code` 的 CODE_LIMIT_CPU_SEC 用例 wall 余量 12s→30s、vitest 槽 30s→45s，治文件并行 oversubscribe 下烧满 1s CPU 前先撞 wall timeout 的 TIMEOUT flaky（断言仍 SCRIPT_ERROR，不削弱 CPU 时限语义）。依赖 minor/patch：react/react-dom 19.0→19.3、three 0.185→0.186、hono 4.13.7→4.13.8、undici 7.29.0→7.29.1（**仍 7.x，守 #52 止血**）、@types/node 24.0→24.13 等。三原子 commit `f1161f4`(deps)/`0b76fb7`(feat errors)/`f35da0f`(test cpu flake) + 先行的 setup.ts createObjectURL 桩 `278c8e1` 已随 PR #373 合 dev（merge `5c9b7a4`，2026-09-21 下午）、#374 合 main，**Hasee 已自动部署 `5c9b7a4`、health ok**（providers agnes configured）；四包 typecheck 干净、web 1947、新增 15 测（12 单测+3 API）、ssrf guarded-fetch 27 全过。本轮另定位 DoubaoWork 沙箱内 macOS rlimit `ulimit -f` 误伤大体积 node 二进制的平台基线（见 Known issues，非回归）。
- ✅ **#52 undici8 P0 事故止血（2026-09-21）**：undici 8 pinned Agent 与 Node 24 内置 undici 7 fetch 跨版本不兼容致四产线 22 条 run failed；PR #362 锁回 7.x + IPv4 优先 pin + 真实 loopback 兼容回归（merge `758a30d` 部署），自然 cron 流量已闭环。事故时间线/根因/教训见 [handoff-archive-2026-09-22.md](docs/handoff-archive-2026-09-22.md)。
- ✅ **#58 README 演示 GIF**：`docs/assets/demo.gif`（5.41MB，README:24 引用），工厂皮肤+一键 demo+建产线+节点运行+园区总览+成本报表 ~56s；#62 复核存在且被引用、无需重做。
- ✅ **#59 补全 CHANGELOG**（`024f4d1`，已合 dev/main）：[Unreleased] 补齐 09-09～09-23（Added ~17 / Changed 4 / Fixed ~16；docs-only/handoff/ops 提交按 Keep a Changelog 未入）。
- ✅ **#60 handoff 过期清理 + shipped last-6 对账**（本提交）：日期刷 09-24、口径统一为 6；G4 三 commit（`299b38d`/`de3eba6`/`070240e`）经 git 核实已合 origin/dev，订正「未 push」；monetization/Stripe 索引订正为 M2 已部署、A0-A5 已部署；TTS G-C 标已落地；最旧 shipped 条目滚入 09-22 归档续四；质量门 server 1307→1308、合计 3659→3660。
- ✅ **#61 模板清单对账**（`e9c692a`，已合 dev/main）：core TEMPLATES 实测 33 个业务模板（空白产线 tpl-blank/BLANK_TEMPLATE 单独导出不计），与 template-checklist 33 行一一对应（32 ✅ + 1 🟡 news-podcast）；订正冒烟 27/27→33/33 与 core 注释。
- ✅ **#62 内部任务状态清理**：#21 Stripe A5（`6f78cb6`/`4f09220`）、#24 RTS C3（`4a526ff`）交付物早已合入却挂 pending，git 核实后补标 completed。
- ✅ **#63 TTS G-C 无能力软降级**（`a867425`，已随 PR #394/#395 合 dev/main 并部署）：见上方 Recently shipped 2026-09-24 条——voice 无能力 failed→skipped + podcast 补 script→depot 旁路，零配置稿件仍交付，三类真错误仍 failed。
- ✅ **#64 时间线 skipReason + E2E flows + E2E 接入 CI**（`3e6547f`/`fd255e9`/`6c7bfe2`/`93b3a52`/`1591b7a`，已随 PR #396/#397 合 dev/main）：core/web 时间线透出 skipped 节点原因（core trace.skipReason +2、web RunTimelineView +1）；CHANGELOG 补 TTS G-C；Playwright E2E 新增注册/建空白产线/设置/登出再登录 3 条不跑 AI 流程并改独立端口 8792/5174 + ALLOW_REGISTRATION（共 5 测）；E2E 接入 CI build job。

### 活跃任务

**#44 Provider Failover（模型源灾备；v1 文本链路已落地 + 真机切换实测打通 2026-09-21，真灾备仍卡第二 provider key）**

路由层在主源首字节前死掉时自动把同一请求改投备份源等价模型。**v1 仅文本**（`runTextGen` + gate `judge`）。机制：`config.ts` 新增默认关闭的通用 OpenAI 兼容内置槽（`BACKUP_BASE_URL`/`BACKUP_API_KEY`/`BACKUP_MODELS`，填齐启用）+ `failoverCandidates()` 纯函数与可选 `failover.chains`；`providers/index.ts` 在首字节前探第一块，仅对 `PROVIDER_ERROR`/`TIMEOUT` 切换（`RATE_LIMIT`/`AUTH`/首块后错误不切），切换打 warn。测试：`routing.test.ts` 8 例 + `config.test.ts` 4 例全绿，四包 typecheck 绿。文档见 [production-ops.md](docs/production-ops.md) §9、env 占位见 `.env.example`。**2026-09-21 真机验证（零影响：独立临时进程注入 BACKUP_*，不碰服务/.env/重启）发现并修复两处问题**：①内置 backup 槽硬编码 `enabled:false`，而 `parseRaw` 只回填 `enabled===undefined` 的 provider，builtin 槽永不被翻为 true——env 填齐、key 在位，`failoverCandidates` 仍只有主源，灾备实际永不启用。PR #364 修复（merge `2c92a92` 已部署 Hasee）：enabled 按 BACKUP_BASE_URL+BACKUP_API_KEY 填齐动态开启 + 2 个 env 路径回归测（fresh module graph，变异验证旧代码即红）。②修复部署后复测：`candidates = agnes -> backup`，主源临时指向不可达（SSRF guard 在首字节前抛 PROVIDER_ERROR）时日志实测打出 `failing over text model to backup provider`、backup 端真实收到请求——**切换代码链路端到端打通**；唯 backup 临时同源 agnes（同一 free key）时撞 free tier 429，恰好证明同源备份不构成灾备（同一配额池）。**真灾备仍需用户提供第二个 OpenAI 兼容源的 BACKUP_BASE_URL/BACKUP_API_KEY/BACKUP_MODELS（卡用户）**；图片/视频灾备缓做。

**#41 ★ M1 回采产线挂载 + 每日体检（4 条成本画像产线，cron 自动攒数据中）**

在 Hasee staging 挂 4 条代表产线：①写草稿·高频文本 ②翻译流水线·带返工（gate 上限 3 次）③短视频广告工坊·媒体中价（imageGen+videoGen）④批量内容工坊·批量放大（Map 5 条）。产线 ID：
①`bdb25758-dd2d-4fe1-9ee3-ab2109b32f16`（trg_mtv0zp69）②`71536df1-da29-44fb-ae7a-4250dafe1a8d` ③`b25c9b38-b823-49c4-89ef-4cb432bd341c` ④`edc5183c-f8c3-4c11-9eab-a6e8fe232361`（trg_m1_batch_weekly）。
Agnes free tier 429 已按方案 C（降频+长退避 retry）闭环（PR #229 `006186b`；触发器持久化修复 PR #231 `70524df`）。②翻译 cron 已从每 4h 降为每 8h、QC criterion 放宽。每日回采体检由豆包定时任务每日 10:30（CST）触发。

**最新体检（2026-09-24 06:31 UTC / 14:31 CST，部署 a68d1c0 后首检；上一检 13:00 CST 在部署前，运行 commit `32fe8f8`）**：✅ 四产线持续稳定，止血锚点后零 failed/halted。**最近 24h**（自 09-23 05:00 UTC）：①写草稿 **24 done** ②翻译 **3 done** ③短视频 **2 done** ④批量 **1 done**——合计 **30 done / 0 failed / 0 halted / 0 interrupted**。**累计 430 runs**：①320=286 done/23 failed/11 interrupted（完成率 89.4%，去中断 92.9%）②53=32/15 failed/5 halted/1 interrupted（60.4%）③34=29/5（85.3%）④23=19/4（82.6%）；合计 366 done，完成率 85.1%（去 12 interrupted 为 87.6%）。**锚点（09-21 07:35 UTC）后近 70h 四产线 0 failed/halted**；node_runs 非 done 终态 5 例且无 error_code（均为部署重启 interrupted 节点，非失败），无任何具名错误码新增。**成本对账**：四产线累计 **$16.34**（①$0.57 / ②$0.07 / ③$15.67 / ④$0.03），③短视频占 95.9%；全库 node_runs 累计 $16.89。**cron 调度器**：PID 105937 active，`cron tick fired` 持续至 04:10 UTC 无误；09-24 部署后日志零 error。**结论：通过标准全部满足——完成率稳步抬升、成本归集完整、止血后零失败，无需人工干预。** **a68d1c0 部署后首检（2026-09-24 05:31 UTC 重启、schemaVersion 41）**：部署后自然 cron 已跑 2 条——批量 `5a0a9c65`（06:00 UTC，319s）done、写草稿 `466b107a`（06:10 UTC，418s）done；部署后 failed/halted = 0、node_runs 无异常终态、journalctl 05:30 UTC 后零 error/ECONN/RATE_LIMIT。新引擎（#69/#70，canvas skipReason + G4 步骤③投影）在生产零影响。
**a557d8b 部署验证（2026-09-24 07:44:54 UTC 重启，G4 步骤④⑤⑥）**：health ok=true、commit `a557d8b`、schemaVersion 41；优雅关停 inflightRuns=0 / abortedRuns=0（**部署零打断**）；部署后 journalctl 零 error/exception/ECONN/RATE_LIMIT；最近 runs（07:10 写草稿等）全 done、无 halted；下条自然 cron 翻译 08:00 / 写草稿 08:10 UTC。degraded 新路径由 server 8 单测 + core 2 投影测 + CI E2E 覆盖，生产视频 run 通常 3 分钟内成功、无自然超时触发条件。

> **MVP 上线就绪评审（2026-09-21，[docs/mvp-readiness-review-2026-09-21.md](docs/mvp-readiness-review-2026-09-21.md)）双口径结论**：个人/小团队**自托管 MVP ✅ GO**（核心编排链路、29 类节点、33 模板、账号隔离、静态加密、备份、成本电表、RTS、demo 一键体验均可用）；**对外商业 SaaS ❌ NO-GO**（功能 Ready、收款/生产运维 Not Ready）。硬阻断五项：Stripe 真机收款（待收款主体 + STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_IDS）、HTTPS/域名证书、provider 真灾备（待第二个 OpenAI 兼容源 key，#44 链路已通）、Postgres HA、Sentry/告警（#57 sink 已就绪、待 DSN，加 ErrorSink adapter 或 webhook relay、无需引 SDK）。~~另有 G4 长任务跨 run 续跑~~ **G4 已全部落地（步骤 ①–⑥，2026-09-24 部署 `a557d8b`，真机零影响）。**
>
> **下一步主线**：商业化 M1→M2→M3 全部完成并部署 Hasee；M3 S6 Stripe 只剩真机 Step6（待收款主体 + STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_IDS）。RTS 阶段 A+B+C 全部完成并真机走查通过。M1 回采 4 条产线继续 cron 自动攒数据 + 每日 10:30 体检。
> **下一步可选方向**：①真机 Stripe Step6（商业化临门一脚）②升级 agnes 付费 key（彻底解决 free tier 429）③~~翻译 review 重跑丢原文~~ **已闭环并经复测证实**（`16db0a5` 已部署 + Hasee `71536df1` 实例已补边；09-20 04:35 UTC 复测补边后 2 个 cron run 全 done、零反问，窗口完成率 15/20=75% 且补边后样本 2/2，随新 run 向 ~94% 收敛） ④RTS 方案 A 单场景 LOD 融合（留档待真实多产线规模再评估）。

> 全部缓做/低优事项（含上述）已统一登记在 [docs/deferred-items.md](docs/deferred-items.md)——每条带触发条件与决策详情链接，触发条件满足时移回本区并标注重启日期。

## Recently shipped (last 6)

按 commit 时间倒序，每条一行影响面 + commit hash：

**2026-09-24（feat：G4 长任务续跑步骤 ④⑤⑥ 跨 run 续跑闭环，feature/20260824，7 原子 commit `3434e79`/`34a6a5e`/`2b58092`/`7d7a08f`/`fce8324`/`8169794`/`fe80ed4`，已随 PR #408 合 dev（merge `a557d8b`）、PR #409 合 main（merge `c1d55ff`），Hasee 已部署）**：长视频渲染不再因轮询超时而 failed，改为 degraded+halt、落库 remote_jobs，由操作员 reattach / accept-degraded / 重新提交。落地 [design-step-trace-and-robustness.md](docs/design-step-trace-and-robustness.md) §3.4–3.10。① **core（`3434e79`）**：新增 `node.degradedAccepted` 事件（显式接受降级、weld 下游但节点永留降级角标）；trace 时间线投影加 `degraded` 状态（degradedReason/remoteJob/degradedAccepted 三字段 + totals.degraded），+2 测。② **server（`34a6a5e`/`2b58092`/`7d7a08f`/`fce8324`）**：db.ts 新增 `RemoteJobStore` 接缝（HTTP 层注入，handler 不导入整个 Db、不感知 SQL 方言），worker VideoJobPoll 加 `unknown`；videogen 幂等 submit+poll——reattach 复用 open job 不重复计费、超时/中止变 degraded（row 留 open）、远端查无变 `REMOTE_JOB_LOST`；engine resume 加 `reattach`（同 attempt 继续轮询）/`accept-degraded`（weld 下游、保留角标），resetFrom 清 degraded，approveGate 在 resetFrom 时跳过；execute/resume/fork 三路径注入 store；reviews 识别 `degraded:` 进新 degraded 类。③ **web（`fe80ed4`）**：RunTimelineView degraded 节点橙色 + reattach / accept-degraded（二次确认）/ resubmit（lost、将计费）按钮；ReviewQueue 加 degraded 分组；zh/en i18n。④ **测试**：engine.videogen.async 完整重写 8 测（reattach/accept-degraded/lost-resubmit，含 in-memory store + virtual clock）；core 334→**336**、server 1311→**1314**、web 1952 全绿、四包 typecheck 干净、i18n 守护绿。**Hasee 部署 `a557d8b` 零打断、日志零 error（见 #41 体检续）。**

**2026-09-24（feat：G4 长任务续跑步骤 ③ reconstructState 投影 degraded，feature/20260824，commit `4eef8d8`）**：落地 [design-step-trace-and-robustness.md](docs/design-step-trace-and-robustness.md) §3.9 八步计划第三步（纯投影、不触执行核心）。① **server `engine.ts`**——新增 `DegradedNode` 类型（reason + 可选 errorCode + 可选 remoteJob 句柄）；`ResumeState` 加 `degraded: Map<string,DegradedNode>`；`reconstructState` 加 `node.degraded`/`node.failed` case 与终态 seq 记录，合成时**仅保留 degraded 之后无 node.finished/node.failed 的节点**（重跑成功即剔除），并在日志未记录其他 halt 点时把最新 degraded 节点恢复为 haltedNodeId/haltedReason（run.finished/gate.exhausted halt 优先）；remoteJob 句柄一并投影，为步骤 ⑤ reattach 备料。② **测试**：engine.reliability +3（degraded 投影+halt 落点恢复；重跑 finished 后剔除；不覆盖 run.finished 已记 halt），server 1308→**1311** 全绿、typecheck 干净。**未做（步骤 ④ 起触 run 执行核心，须避开 M1 回采窗口，待拍板）**：④ videogen degraded/halt+落库、⑤ resume reattach/accept-degraded、⑥ web 橙色标识+三按钮。 **本批已随 PR #400 合 dev（merge `a68d1c0`）、PR #401 合 main（merge `659759b`），Hasee 已自动部署 `a68d1c0`、health ok=true、05:31 UTC 重启日志零 error（schemaVersion 41）。**

**2026-09-24（feat：画布节点透出 skipped 原因，feature/20260824，commit `6a55d43`，#63 TTS G-C 留尾闭环）**：把 node.skipped 的 reason 从「仅入事件/trace/运行时间线」补到**画布节点 tooltip**，软降级对操作者可见。① **core `runtime.ts`**——`NodeRuntime` 加 `skipReason:string|null`（nodeOf 默认 null、`node.started` 重跑清空、`node.skipped` 投影 `event.reason ?? null`），+2 测（存原因；默认 null 且重跑清空）。② **web `Plants.tsx`**——节点 tooltip 在状态行后，skipped 且有 reason 时追加一行「跳过原因/Skip reason」；zh/en `nodes:tip.skipReason`。③ 至此 skipReason 全链路（事件→core reduce live 投影→画布 tooltip；trace→运行时间线）闭环。core 332→**334**、web 1952 全绿、i18n 守护绿、四包 typecheck 干净。

**2026-09-24（#64 纯增量质量加固：时间线 skipReason + E2E flows + E2E 接入 CI，feature/20260824，5 原子 commit `3e6547f`/`fd255e9`/`6c7bfe2`/`93b3a52`/`1591b7a`，已随 PR #396/#397 合 dev/main）**：① **时间线透出 skipped 节点 skipReason（TTS G-C 留尾）**——core `trace.ts` 的 `TimelineAttempt` 加 `skipReason:string|null`（ensureAttempt 初始化 null、`node.skipped` 投影 `e.reason ?? null`）+2 测；web `RunTimelineView` 渲染 skipped 原因块（全 token 样式 + zh/en `run:timeline.skipReason`）+1 测。② **CHANGELOG 补 TTS G-C 软降级 + skipReason 条目**（G-C 本体 `a867425` 此前漏记一并补）。③ **Playwright E2E 从 2 条冒烟扩到 5 测**——新增 `e2e/flows.spec.ts` 3 条不跑 AI 流程（注册落地 Onboarding、建空白产线进画布并切设置 4 tab、登出再登录产线仍在）；为避开在跑的 8791 dev server 与「首账号后自助注册关闭」，E2E 改走完全独立端口 server **8792**/web **5174** + 临时库 + `ALLOW_REGISTRATION=1`/`ALLOW_DEMO=1` + `reuseExistingServer:false`（ESM 用 `process.cwd()`），vite proxy target 改读 `VITE_API_PROXY_TARGET`；`pnpm e2e` 5 测全绿（23.5s），e2e/README 重写。④ **E2E 接入 CI**：`.github/workflows/ci.yml` build job 单测后加 `e2e:install` 与 `pnpm e2e` 两步。全量 core **332**/web **1952** 实测全绿、四包 typecheck 干净；**CI 已实证 E2E 5/5 全绿（PR #397，10.2s：flows 3 + smoke 2），Hasee 已部署 `32fe8f8`、09-24 体检确认运行正常。**

**2026-09-24（feat：TTS G-C 无能力软降级 + podcast 旁路，feature/20260824，commit `a867425`，已随 PR #394/#395 合 dev/main 并部署 Hasee；同期清账 `024f4d1` CHANGELOG、`e9c692a` 模板计数）**：落实 [design-tts-provider.md](docs/design-tts-provider.md) G-C 推荐项（真软降级），消除「模板 voice 节点注释声称软跳过、代码却走 failed VALIDATION」的名实不符。① **server `audiogen.ts`**——cfg 校验与无能力分支前移到 `node.started` 之前；worker 无 `generateAudio` 能力时置节点 **skipped** + `ctx.log.warn` + emit `node.skipped`（reason `audio unsupported: worker has no generateAudio capability`）后直接 return（不发 started/artifact/packet）；**三类真错误仍 failed**：超长（TTS_MAX_INPUT_CHARS=4096，VALIDATION）、配了能力却返回空结果（UNSUPPORTED）、provider 异常（PROVIDER_ERROR）。② **core `templates.ts`**——tpl-news-podcast 补一条 bypass flow 边 `script→depot`（e5）：voice 被跳过时稿件全文经 script 直送成品台，避免严格线性链里 voice skip 致 depot 前驱永不 ready、级联无成品；happy path 下 depot 同时收稿件全文 + `[音频:…]` 占位（良性增强）。③ **影响面**：仅 tpl-news-podcast（全库唯一用 audioGen 的模板）；**M1 在跑四产线无 audioGen 节点 = 对回采零影响**；引擎调度核心 engine.ts 未改（只读确认 predecessorsReady 对 skipped 前驱 continue、sink 天然聚合多前驱）。④ **测试**：engine.audiogen 7→8（旧「fails 无静默跳过」用例改写为线性级联 skip/run done + podcast bypass depot 交付两条，保留空结果/超长/音频占位流入下游三失败用例），core templates 31、四包 typecheck 全绿。前端本批不消费 skipReason（节点显示通用「已跳过/Skipped」，reason 仅入事件/trace/日志，显式软降级提示列后续增强）。同期：#59 CHANGELOG 补全 09-09～09-23（`024f4d1`）、#61 模板计数对账（`e9c692a`，33 个业务模板、空白产线 tpl-blank 不计）、#62 内部任务状态清理（#21 Stripe A5、#24 RTS C3 补标 completed）。

**2026-09-23（feat：G4 长任务续跑步骤 1/2 纯增量地基，feature/20260824，两原子 commit `299b38d`/`de3eba6` + docs `070240e`，三 commit 均已 push 并合入 origin/dev）**：落地 [design-step-trace-and-robustness.md](docs/design-step-trace-and-robustness.md) §3.9 八步计划前两步（设计原话「纯增量、旧 run 无 node.degraded 事件时行为字节级不变、可先行合入」）。① **core `299b38d`**——`ErrorCode` 末尾加 `REMOTE_JOB_LOST`（重新附着时远端查无 job/TTL 过期，区别于本次轮询 `TIMEOUT`）；`RunEvent` union 在 `node.failed` 后加平行的 `node.degraded`（`...NodeRunKey`+`reason`+可选 `errorCode`+可选 `remoteJob{provider?,jobId,kind:'video'|'image'|'audio'}`；语义=结果未定/远端可能仍在渲染/节点暂停等人工决策/run 进 halted 而非 failed），`DraftEvent` 由 union 自动派生；新 `events.test.ts` 7 测。② **server `de3eba6`**——migration **41** 新表 `remote_jobs`（基础 DDL + 迁移 up/down；`UNIQUE(provider,remote_job_id)` 幂等、`idx_remote_jobs_open` 部分索引；NULL provider 不去重符合预期）；db.ts 加 `RemoteJob`/`NewRemoteJob`；共享 `createDriver`（sqlite/pg 两 driver 共有）加 `insertRemoteJob`（ON CONFLICT DO NOTHING）/`getOpenRemoteJob(runId,nodeId,attempt)`（走部分索引取最新一条）/`touchRemoteJob`/`finishRemoteJob`；表纳入 `DEMO_CASCADE_DIRECT_TABLES`。测试：新 `db.remote-jobs.test.ts` 8 测（camelCase 映射/meta round-trip/attempt 隔离/touch-finish 流转/lost+REMOTE_JOB_LOST/UNIQUE 幂等/NULL provider 不去重新旧排序）、`migrations.test.ts` 加 v41 fresh 断言并把 rollback 由 40→39 两步顺延为 **41→40→39 三步链**、park-coord 版本断言 40→41。core 22→23 文件 323→**330**、server 156→157 文件 1298→**1307** 全绿、四包 typecheck 干净。**未做（步骤 ③ 起触 run 执行核心，须避开 M1 回采窗口）**：③ reconstructState 投影 degraded、④ videogen degraded/halt+落库、⑤ resume reattach/accept-degraded、⑥ web 橙色标识+三按钮。

**2026-09-22（feat：写实工业风推广全部 29 种节点，feature/20260824，两原子 commit `ed7b43e`/`7f98340`）**：把此前仅 textGen 的写实 prototype 铺开为全部节点。① 新增 `industrial-kit.ts`——可复用 PBR 部件库（钢架/控制柜/压力容器/料仓/管段/阀门/汇流排/电机/传送带/漏斗/镜头/天线/号筒/门架/文件架 + 分区色饰件），材质/纹理为模块级单例共享、graph-sync teardown 只销毁每节点 geometry；`industrial-textures.ts` 补 `brushedSteelTexture`/`darkMetalTexture` 两个程序化纹理；抽 `category-colors.ts` 单一事实源。② 新增 `industrial-recipes.ts`——`buildIndustrialShape(kind)` 按 kind 用 kit 组合出独特剪影（每节点一处 `categoryColor` 分区色饰件保持五厂区可读），textGen 沿用现有 `industrial-shapes.ts`；`iso3d-shapes.ts` 删除硬编码 gate 与全部风格化方块代码（`addTopper`/`shadedMaterials`/`edgeColor` 等），统一委托配方。测试：新增 `industrial-kit.test.ts`（部件 role/不越界/共享材质），扩 `iso3d-shapes.test.ts` 遍历全部 29 kind（契约/旋转/LED/恰好一处 accent）；web 103→104 文件、1947→**1951** 测全绿、四包 typecheck 干净；浏览器 3D 真机走查（多节点产线：PBR 材质/分区色/选中发光/管道接驳正常）。**已随 PR #388 合 dev/main（merge `6fd8d2a`，另含 `cbecf87` 状态标注、`1a046e8` 原型范围澄清），Hasee 已部署 `6fd8d2a`，09-23 体检确认运行正常。**

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

* `pnpm -r typecheck`：全绿（core/server/mcp-server/web `tsc --noEmit` 全部干净；2026-09-18 版本逐字高亮与 docs 原子提交时 pre-commit hook 四包 typecheck 均复核全 Done（前台超时会自动转后台任务，无需 --no-verify））

* 测试总数 **3673**（2026-09-24 快照：**core 23 文件 336（G4⑤ degraded 投影 +2）、server 157 文件 1314（G4④⑤ degraded recovery +3）、web 104 文件 1952（vitest 全量）、mcp 3 文件 71，共 287 文件**；上一版 3668（core 334 / server 1311）；G4 步骤 1/2 地基 core +7（新 events.test.ts）、server +9（新 db.remote-jobs.test.ts +8、migrations +1），core/server 各 +1 测试文件；上一版 2026-09-22 为 3643/285 文件（core 323、server 1298）；**权威全绿以 CI Linux（self-hosted runner）为准**）。写实工业风铺开 web +4 测/+1 文件（新增 industrial-kit.test.ts、扩 iso3d-shapes.test.ts，1947→1951）。相对 2026-09-21 的 3631，TTS P1（G-A/G-B/G-D）core +3（pricing +2、templates +1）、server +2（openai-compatible +1、engine.audiogen +1）；同日 G-E 补齐 audioGen 派发闸门测试 server 再 +3（validate-models，1295→1298）。相对上一版 3616/282 文件，#57 错误追踪适配层 server +15 测（errors 单测 12 + admin-errors API 3）/+2 测试文件（errors.test.ts、api.admin-errors.test.ts）；依赖升级见 Recently shipped #57。**本机 DoubaoWork 内置沙箱 shell 内跑 server 全量有 9 文件/36 测 code-spawn 失败（SIGXFSZ 平台基线，见 Known issues，非 #57 回归；CI Linux/Hasee 全绿），其余 1257 测过，新增 15 测在沙箱内亦全过。**ReDoS 根治（`01f8868`/`8c95dfd`，PR #349 CodeQL 阻断项）core +1（线性扫描回归测，覆盖两种攻击形态）；此前 G2.4-A 数组契约（`978ab56`/`2fbcbe1`/`36135e8`/`33dcc91`）core +16（contract 数组分支）、server +8（`engine.contract` +5 走 JSON 数组 artifact、`engine.products` +3 走 sourceMeta.data）、web +2（Inspector 数组表单）；此前状态机方案 A 增强（`208683b`/`2c56e48`）core +17（compile +7 / variables +5 / 新增 state-machine +5）、web +3（BranchFields 状态预览，新增测试文件）；此前 2026-09-18/19 基线为 3552 / 280 文件（core 286、server 1253、web 1942、mcp 71）。相对当日早前 snapshot（3532 / 277 文件）+20 测 / +3 文件：当日晚 #35 SSRF DNS 瞬时失败有限重试 server +5、#36 parkCoordScheduler web +6（新测试文件）、#37 nodeLabel web +7（新测试文件）；09-19 翻译 review 修复 `16db0a5` core 模板拓扑 +1（templates.test.ts）、server 端到端 rework 回归 +1（新文件 translation-review-rework.test.ts）；core/mcp 本轮零改动，沿用当日早前实跑值；数字一律以本次实跑为准）：

  * `pnpm --filter @agent-world/core test`：**336/336 通过**（23 文件；2026-09-24 Node 24 实跑，G4⑤ trace degraded 投影 +2；#69 runtime NodeRuntime.skipReason +2；#64 trace timeline skipReason +2；2026-09-23 Node 24 实跑；G4 步骤 1 新增 events.test.ts +7（node.degraded schema 全/最小字段、非法 kind、缺 reason、REMOTE_JOB_LOST 与既有错误码回归）；2026-09-22 为 323/22；TTS P1 pricing +2、templates +1；ReDoS 线性扫描回归 +1、G2.4-A 数组契约 contract +14、状态机方案 A compile/variables/state-machine +17；早前 2026-09-18/19 含翻译模板 review 有序双前驱拓扑测试 +1；parkLayout、file/product connector 形状断言、compile trigger warning、模板 33 形状守护、单价缺口、trace timeline、contract、deadline 等）
  * `pnpm --filter @agent-world/server test`：**1314/1314 通过**（157 文件；2026-09-24 Node 24 实跑，G4④⑤ engine.videogen.async degraded recovery 重写 +3；#70 engine.reliability reconstructState degraded 投影 +3；#63 engine.audiogen 7→8；全量权威以 CI Linux Node 24 为准；G4 步骤 2 新增 db.remote-jobs.test.ts +8、migrations.test.ts v41 fresh +1 且 rollback 顺延为 41→40→39、park-coord 版本断言→41、remote_jobs 入 demo 级联清单；2026-09-22 为 1298/156；TTS P1 openai-compatible +1、engine.audiogen +1；同日 G-E validate-models audioGen 派发闸门 +3；#57 errors 适配层 +15 测/+2 测试文件（errors.test.ts、api.admin-errors.test.ts）；failover v1（routing/config 新文件）、#52 undici pinned-Agent 真实 loopback 兼容回归 + selectPinRecord、#364 backup env 启用路径两批修复新增，一律以本次实跑为准；G2.4-A 数组契约 `engine.contract.test.ts` +5、`engine.products.test.ts` +3；早前 2026-09-18/19 09-19 翻译 review 重跑回归 `translation-review-rework.test.ts` +1（新文件，真实 tpl-translation 经 gate 退回断言 review 各 attempt 输入含原文+初译）；当日晚 #35 SSRF DNS 有限重试在 ssrf/code-proxy 既有文件再 +5；早前 09-18 gate 禁用词 `prohibited.ts` +8（7 纯函数 + 1 集成），09-17 四项收口新增：G2.2 `engine.contract.test.ts` 9、G1.2 `engine.fork.test.ts` 3 + `api.fork.test.ts` 5、G4.4 `engine.videogen.async.test.ts` 5；此前 09-16 五项补强 runs 全文搜索 4、diagnose 6、parse-file xlsx 5，demo 零配置首跑修复 +1、09-15 演示用户 +23、StreamableHttp notify flaky 修复 +1）。历史备注：Node v22 + macOS seatbelt 下依赖 spawn JS sandbox 子进程的用例曾 status 71 失败（干净基线与带改动失败集合 diff 为空、非回归，CI Linux bwrap 正常）；另有 2 个真实 chromium 的 RPA 浏览器用例需 `pnpm exec playwright install`——**2026-09-20 起本机 chromium 已装（随 E2E 落地），`rpa.browser.test.ts` 本机实跑 4/4 通过**；高并发全量偶发 `audit write failed: table locked`（SQLite 表锁竞争，重跑即过、非回归）。
  * `pnpm --filter @agent-world/mcp-server test`：**71/71 通过**（3 文件；含 stdio 端到端冒烟 3 个。负载性 flaky：`pnpm -r test` 并行时 stdio 冒烟可能超 5s，单独跑稳定）
  * `pnpm --filter @agent-world/web exec vitest run`：**1952 总数**（104 文件；2026-09-24 全量实跑，#64 RunTimelineView skipReason 渲染 +1；与总数行及写实工业风 shipped 条目对齐；2026-09-22 快照 1951/104，更早 2026-09-20 顺序实跑基线为 1947/103；G2.4-A Inspector 数组契约表单 +2、状态机 BranchFields +3；早前 2026-09-18 当日晚 #36 `parkCoordScheduler` +6（新文件）、#37 `nodeLabel` +7（新文件）；早前本轮版本逐字高亮 `graph-diff` +6 / `VersionPanel` +1；此前 09-17 3D 美化 + CI 修复新增 `iso3d-shapes.test.ts` 厂房 LED 用例 1、`Canvas3D.test.tsx` 补 PMREM/后处理 stub；此前 09-17 四项收口：RunTimelineView fork/reused +3、新 `InspectorFields/RetryField.test.tsx` 2；09-16 五项补强：lib/graph-diff.test.ts 8、VersionPanel 版本对比 +4、GraphSwitcher 搜索/收藏 +11、RunHistory 全文搜索 +3 与失败诊断 +4、SourceFiles xlsx +2；组件目录零「有 .tsx 无 .test.tsx」）。✅ **本机高并发负载 flaky 已于 2026-09-20 修复（A2，`ee1d635`）**：根因是 testing-library 的 waitFor/findBy 默认 asyncUtilTimeout 仅 1000ms（而 vitest testTimeout 本已 10s），多 worker/高负载下 mock promise 与 React effect 偶尔超 1s 才 flush，导致 VersionPanel/ProductGallery/PublishTargets 等（每次不固定、均不在改动范围）误报“停在加载中”或 worker 提前退出；在全局 `src/test/setup.ts` 设 `configure({ asyncUtilTimeout: 5000 })`（与 ProductGallery 局部包装一致、仍低于 10s testTimeout，真死锁仍被 testTimeout 兜住）后，**默认多 worker 全量 102 文件/1942 实跑全绿（EXIT=0，81s）**，隔离/顺序/CI 原本即全绿。判断回归仍看改动文件 + 全量 + CI。

* **E2E 浏览器端到端（2026-09-20 落地 B1 冒烟、2026-09-24 #64 扩 flows 并接入 CI；独立 @playwright/test runner、不计入上面单测数）**：根 `playwright.config.ts` + `e2e/smoke.spec.ts`（@playwright/test 1.63，命令 `pnpm e2e`，首次需 `pnpm e2e:install` 装 chromium）；webServer 自动起**完全独立**的临时栈（与在跑的 8791 dev server 隔离）：临时库 server 监听 **8792**（`ALLOW_DEMO=1`+`ALLOW_REGISTRATION=1`，DB/JWT/加密密钥/产物/日志全落 os.tmp 唯一临时目录、跑完即删）＋ vite dev web 监听 **5174**（`VITE_API_PROXY_TARGET` 指 8792），两个 webServer 均 `reuseExistingServer:false`、workers 1、retries 0（ESM 配置用 `process.cwd()`）。**共 5 测**：smoke 2（guest 打开 /→重定向 /login；一键 demo POST /api/auth/demo→进真实产品+横幅可见+无未捕获异常/意外 console error）；flows 3（`e2e/flows.spec.ts`：注册→落地 Onboarding；建空白产线→进画布→切设置 4 tab；登出→再登录→产线仍在；用 addInitScript 预置 tour-seen 压首启引导，每测唯一邮箱）。本机 `pnpm e2e` 5/5 全绿（23.5s）、RPA 浏览器用例回归 4/4。不跑 AI、无需 provider key。**已接入 CI**：`.github/workflows/ci.yml` build job 在单测与 `pnpm -r build` 后跑 `pnpm e2e:install` + `pnpm e2e`（**CI 已实证 5/5（PR #397，10.2s）**）；**完整全链路**（注册→配 provider→建产线→跑→出成品）仍缓至对外开放注册，运行说明见 `e2e/README.md`。

* 各用例逐波来源（单价审计/连接器插值/PG/加密/RBAC/公告/重构/狗粮九波等）已随对应待办归档到三份 handoff-archive，本 snapshot 只记当前数，不堆历史。

* **Node 版本硬要求**：依赖 `node:sqlite`，必须 Node ≥ 22（CI 用 Node 24；本地默认 Node 20 会误报 `No such built-in module: node:sqlite`，用 `fnm exec --using=24` 跑）。**P1 沙箱实跑测试必须在 Node 24 下验证**（否则 resolveInterpreter 版本探针走不同分支）。

  * ### ⚠️ 版本不对时的症状指纹
    非 Node 24 下跑全量 server 测试，失败会呈现为 **32-36 个用例波动失败**，且**全部依赖 code 节点子进程**（`engine.code`/`loop`/`map`/`table`/`generic`），报错 `ENOENT lstat '<internal-path>'` 或 `finished` 为 `undefined`——看起来像沙箱跑不起来而非版本问题，失败数随超时随机浮动。**判定**：`fnm exec --using=24 -- pnpm --filter @agent-world/server exec vitest run`，全绿即为版本问题。`git stash` 对比基线只能证明"不是本次改动引入"，**不能**证明"是环境问题"，两者是不同命题。

  * ### 🪟 Windows 本机测试基线（2026-09-18 实测，非权威平台）
    Windows 上 server 全量**不能全绿是平台基线、不代表回归**：153 文件 1247 测 1112 过 / 135 失败（56 文件），失败只有两类根因——① 用临时 sqlite 目录的测试 afterEach `rmSync(...,{recursive,force})` 抛 **EPERM**（Windows 文件句柄/WAL/索引器或杀软扫描未释放，db.* / costs / migrations / runs / graphs / events / invoice / subscription / usage-metering / isolation / graph-versions 整片）；② 代码沙箱后端缺失（Windows 无 bwrap/seatbelt/rlimit，code-sandbox 的 child_process 拒绝、RLIMIT_NPROC fork-bomb 2 测；engine.code/loop/table/map/parallel-join/generic、regression/core-path 连带）。**证明非回归**：`git stash -u` 干净 HEAD 重跑 db.operations 8/8、engine.loop 5/6 失败与带改动完全一致。Windows 判断回归只跑改动相关测试 + `pnpm -r typecheck`；权威全绿以 CI Linux（self-hosted runner）与 macOS 默认测试为准：macOS 默认 `CODE_SANDBOX` 走 rlimit 后端，Node 24 下 server 153 文件 / 1252 测全绿（2026-09-18 实跑）；仅当显式 `CODE_SANDBOX=sandbox-exec` 启用 macOS seatbelt 后端时，有 **37 测 / 7 文件基线失败**（engine.code、engine.loop、engine.map、engine.table、engine.parallel-join、engine.generic、regression/core-path；2026-09-18 Node 24 实跑，旧记「~32」随引擎用例增长而过时）——根因是 seatbelt 硬断网仅支持 `net:"none"`、内部路径 `lstat`、fs/子进程隔离语义与 bwrap 不同，属后端能力差异、非回归，CI Linux bwrap 正常。本机环境：便携 Node v24.11.0 在 `C:\Users\24670\node24`（PATH 上其余 node 是 DoubaoWork/TRAE/hermes 自带 v22，engines 要求 ≥24），pnpm 无 shim、走 `corepack.cmd pnpm`，装包加 `--registry=https://registry.npmmirror.com`，**改 core 后、或 pull 到含 core 改动的提交后，先 `pnpm --filter @agent-world/core build` 再跑 server typecheck/测试**，否则 server 读到过期 core/dist 的 .d.ts 会假报类型缺失（2026-09-21 实测：pull 后 `engine.ts:989 Property 'root' does not exist on type ...`，源码 contract.ts 已有 G2.4 array-root、rebuild core 即消除，CI 因先 build core 不受影响）；corepack/SQLite 的 ExperimentalWarning 走 stderr，PowerShell 会显示 NativeCommandError 并非零退出码，不代表命令失败，看 vitest 自身 passed 判定。

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

> 以下均为**开发/测试环境基线**，不是产品 bug；CI Linux（self-hosted runner）与 Hasee 部署不受影响。

* **DoubaoWork 内置沙箱限制**：① 不让 listen socket（起 server/vite 全部 EPERM）；② 不让写 `.git/index.lock`（git commit 需在沙箱外执行）；③ macOS rlimit 后端 code 节点稳定失败 9 文件/36 测（SIGXFSZ：沙箱外层 seatbelt 与 `ulimit -f 32MB` 叠加，fnm Node 24 二进制 116MB 超限；**2026-09-21 已在沙箱外真实 macOS 对照证伪——156 文件/1293 测全绿，普通 macOS 不复现，不改代码**；重启条件：真实 macOS 自托管用户报 code 节点「退出码 null/无 stderr」，届时 darwin wrapper 跳过 `ulimit -f`）。沙箱内判定回归一律以 CI Linux / 沙箱外真实 macOS 为准。

* **macOS python code 节点测试失败 → 查 Xcode 协议**：`/usr/bin/python3` 是 Xcode CLT 占位 shim，未接受协议时拒绝执行，子进程起不来报 `ENOENT lstat`。修复：`sudo xcodebuild -license accept` 或 `brew install python`。排查：`python3 --version` 若打印 license 提示即此问题。Linux CI / Hasee 不受影响。

* **Linux RLIMIT_NPROC 陷阱（CI）**：`ulimit -u` 限制整个 UID 的进程+线程总数（非单子进程），CI runner 多 worker 逼近默认 128 时代码节点 node 启动 EAGAIN → SIGABRT（`r.status === null`、~200ms 秒挂），症状随负载波动。教训：shell 行为测试不叠加 NPROC 小值，用 `maxProcs: 4096` 覆盖。另：开发机本地代理（`HTTP_PROXY`）会污染代理类手工验证，排查前 `env | grep -i proxy`。

## Conventions (carry over from archive)

* **commit 消息**：英文、`<type>(<scope>): <subject>` 格式；不加 `Co-Authored-By: ...`；不 `push`（除非用户明确说）

* **commit 颗粒度**：原子提交；一次 commit 解决一件事（bug 修复 / 单一 feature / 单一迁移）

* **UI 文案**：中文，遵循 `--steel-*` / `--power` / `--ink*` / `--alert` 等设计 token，**不改主题样式**

* **新增功能必加 handoff 章节**：本文件只记最近 6 个 + 待办；超过 6 个的全部进 archive

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

