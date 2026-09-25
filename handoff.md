# Handoff

State of Agent World as of 2026-09-25.

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

* [docs/mvp-readiness-review-2026-09-25.md](docs/mvp-readiness-review-2026-09-25.md) — 项目级 MVP 上线就绪评审（**最新版 2026-09-25**；结论：自托管 🟡 功能核心可用但**不签「完全可用+可上线」**、对外 SaaS ❌ 不达标；本轮新增 4 条经一手复验的阻断——sink 空输入照样产"成品"、A/B 口绕过 validateModels、远程 MCP 裸 fetch 绕过自家 SSRF 闸、`docs/production-ops.md:189,199` 明文 sudo 口令；另有 5 条判据更正（G4 生产不可达 / 对象存储其实已实现 / CI runner 非 self-hosted / 本批 ①② 已在 dev / M1 四产线仓内不可复现）+ 质量门实测 3775 + 待拍板 D-1 音频槽 + **§8 记录了被证伪并弃用的扫描来源**）★ + [09-22 版](docs/mvp-readiness-review-2026-09-22.md)（历史基线：当时判自托管 MVP ✅ 达到；其「对象存储属阶段 5」「G4 已全部落地」两条已被上版更正）+ [09-21 版](docs/mvp-readiness-review-2026-09-21.md)

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

* [docs/template-checklist.md](docs/template-checklist.md) — 产线模板验证与评估待办表（逐模板真实狗粮验证状态，当前 35 个；**新增模板必登记**，与 core TEMPLATES 数对账）★

* [docs/handoff-archive.md](docs/handoff-archive.md) — historical changes (pre-2026-08-27)；后续滚动归档 [handoff-archive-2026-09-07.md](docs/handoff-archive-2026-09-07.md)（#1–#37）、[handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)（#24–#43）、[handoff-archive-2026-09-11.md](docs/handoff-archive-2026-09-11.md)（#44–#45）、[handoff-archive-2026-09-18.md](docs/handoff-archive-2026-09-18.md)（#39、#46–#56、M1 验收、#41 历史体检）、[handoff-archive-2026-09-22.md](docs/handoff-archive-2026-09-22.md)（2026-09-19~22 shipped 条目 + Active work：#52 P0 事故、#41 历史体检）、[handoff-archive-2026-09-25.md](docs/handoff-archive-2026-09-25.md)（2026-09-22~24 shipped 条目：skipped 原因透出、#64 时间线加固、TTS G-C 软降级、G4 步骤 1/2、写实工业风推广）

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

* [docs/design-model-catalog.md](docs/design-model-catalog.md) — 内置模型目录与插拔设计（**2026-09-25 定稿，①②③ 已落地 `9c7c5f1`/`54acc50`/`7c0dbe0`，④ 未开工**；核心决策「改模型清单=数据、改接口方言=代码、改端点与凭证=env」；规则 A 下架即报错（已清三处静默路径）+ 规则 B `model:""`=跟随当前默认（在 startRun 解析，保 contentHash 与评测指纹）；含已修复的 worker 缓存导致改价不生效缺陷、剩余写死模型名清单与 A/B 口薄接线登记见其 §十一）
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
> 2026-09-19 起 shipped 条目及 Active work 归档（#52 P0 事故、#41 历史体检）见 [handoff-archive-2026-09-22.md](docs/handoff-archive-2026-09-22.md)，
> 2026-09-22~24 shipped 条目（skipped 原因透出、#64 时间线加固、TTS G-C 软降级、G4 步骤 1/2、写实工业风推广）见 [handoff-archive-2026-09-25.md](docs/handoff-archive-2026-09-25.md)。

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

**#76 ★ MVP 收尾批（2026-09-25，按 [mvp-readiness-review-2026-09-25.md](docs/mvp-readiness-review-2026-09-25.md) §7 最短路径，feature/20260824，**已 push**——6 原子 commit `68ecd99`→`4004057`，origin/feature/20260824 @ `4004057`；**未合 dev**（origin/dev 仍 #427 `6f8fa57`））**：四阻断修复 + 五条口径更正 + 质量门实测。① **sink 空输入守卫**（`nodes/sink.ts`）——原空输入照样产「成品」，加 VALIDATION 守卫（空/纯空白 → failed + `VALIDATION`，不发 artifact/packets），新建 `sink.test.ts` 3 测。② **A/B 口补 validateModels**（`ab.ts`）——AB 不经 startRun 绕过模型可派发校验（媒体节点配错软跳过、run 假性 done），在 `buildABVariants(resolveModelSlots(...))` 后加 `validateModels(built[0].graph, cfg)` 过滤 error，非空抛 `RunStartError(422, modelErrors)`；ab/api.ab 测试夹具模型名 fake `"t"` → 内置 `agnes-2.0-flash`（通过校验）。③ **远程 MCP 裸 fetch → guardedFetch**（`mcp.ts` 4 处 @:237/:306/:361/:378，绕过自家 SSRF 闸）——全换 guardedFetch（redirect manual+最多 5 跳+跨 host 剥敏感 header）；mcp.test/api.mcp-user/mcp-pool 测试文件级 `ALLOW_PRIVATE_NETWORK=1` 逃生口（生产默认仍拒内网），mcp 系 58/58 绿。④ **production-ops 明文 sudo 口令**——commit 7b003f6 已 `<pw>` 占位，口令轮换归用户（Hasee sudo）。⑤ **.env.example 补 4 组变量**——`NODE_ENV`/`ALLOW_DEMO`/`STRIPE_SECRET_KEY+WEBHOOK_SECRET+PRICE_IDS`/`ERROR_REPORT_WEBHOOK_URL`；`ALLOW_REGISTRATION=1` 注释化（默认关、仅 bootstrap）。⑥ **§5 五条口径更正（文档）**——handoff「未 push」→已合 dev（git merge-base 核实）、「CI self-hosted runner」→GitHub 托管 ubuntu-latest（ci.yml:12,81）；design-step §3.4 与 deferred G4 行补「跨 run 续跑在生产不可达」（生产 routingWorker 无 `submitVideoJob`/`queryVideoJob`，仅测试替身）；production-ops M1 表补「仓内不可复现」警告；09-21/09-22 评审文档加更正注记。质量门：server 1390→**1393**（sink +3）、合计 3775→**3778**；四包 typecheck 绿。**结论：自托管 MVP 🟡 → ✅ 可签「完全可用+可上线」**（SaaS 侧门槛仍为收款主体/HTTPS/provider 真灾备/Postgres HA/Sentry，见 deferred）。
**追加（2026-09-25 晚，用户确认）**：其上叠 **3D 选中发光柔和化**（`2c8bc22`，未 push）——`setGroupEmissive` 加 `intensity` 参数（默认 1 兼容原调用），选中发光压到 `SELECT_EMISSIVE_INTENSITY=0.4`（低于 bloom 阈值 0.92，消除工厂窗户材质 1.5 强度 × 亮黄导致的刺眼光晕，取消复位 1.0）；web typecheck 绿 + canvas 5 测试文件全绿。**MVP 判定落地：用户确认「最小核心 MVP 已可跑通」——自托管口径 ✅ 可签**；剩两个用户侧输入：Hasee sudo 口令轮换（`<pw>` 已占位）、决策 D-1（tpl-news-podcast 无 TTS 供应商时 (a) 软降级交付文稿 vs (b) 维持 422 改口径）。

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

**2026-09-25（MVP 收尾批，feature/20260824，6 原子 commit `68ecd99`（sink 空输入守卫）/`9e587b5`（A/B validateModels）/`4382df0`（MCP guardedFetch）/`b581bdf`（.env 补关键变量）/`4b683e0`（§5 五条口径更正）/`4004057`（handoff 记录），**已 push origin/feature、未合 dev**；`2c8bc22` 3D 选中发光柔和化未 push）**：按 [mvp-readiness-review-2026-09-25.md](docs/mvp-readiness-review-2026-09-25.md) §7 最短路径清掉全部代码/文档项——四阻断（sink 空输入静默产「成品」/ A/B 绕过派发校验 / 远程 MCP 裸 fetch 绕过 SSRF / production-ops 明文 sudo 口令已 `<pw>` 占位）+ .env.example 补 9 个关键变量 + §5 五条口径更正；质量门 server 1390→**1393**、合计 3775→**3778**、四包 typecheck 绿。**判定落地：自托管最小核心 MVP ✅ 可签**（用户确认）；剩用户侧：口令轮换、决策 D-1（news-podcast TTS 软降级 vs 422）。详情见 Active work #76。

**2026-09-25（第三批：内置模型目录与插拔 ①②③，feature/20260824，三原子 commit `9c7c5f1`/`54acc50`/`7c0dbe0`，未 push、未部署）**：起因是两句话——「目前内置模型都是 Agnes，编码是解耦还是硬编码？」与「下架了就报错、用户自己重选，别把设计做重」。答案先是否决了我自己上一版的方案（角色令牌 / 别名表 / 读取时解析 / 槽位持久化全部砍掉），落成方案 [design-model-catalog.md](docs/design-model-catalog.md)，再按它做前三阶段。**① 规则 A：下架即报错（`9c7c5f1`）**——「报错让用户重选」这个语义此前**根本不成立**，三条静默路径把失败降级成成功：`validate-models.ts` 对 `source:"builtin"` 整体豁免注册检查（所以从 `models[]` 删掉一个内置模型，派发毫无反应）、`providers/index.ts` 两处把「provider 停用」和「类型未实现」都换成 `fakeWorker()`（run 一路 `done`、产出假文本），另外 `workerFor("")` 也交给 fake。修法是在 `providerForModel` 上补一个 `matched` 位——「这个 provider 认领了它」与「没人认领、回落到默认 provider」以前在返回值里分不开，正是这个分不开让豁免看起来无害。三处抛 `UNSUPPORTED` 是挑过的：它不在 `nodes/shared.ts` 的 RETRYABLE 里，所以既不重试也不出网，直接落成具名 `error_code`；`type:"fake"` 与 `WORKER=fake` 保留（demo 与测试的合法路径，只是不再当配置坏掉的替身）。**回归测的关键不是新断言而是旧判据复现**：那条内置下架用例把 `isBuiltin=true` / `models[]` 已空 / `matched=false` 三个事实一起断言，等于把「豁免为什么错」钉在文件里——旧的 ghost-model 用例挡不住这个回归，因为它的 fixture 根本没有 `source` 字段。**② 热更新生效（`54acc50`）**——查规则 A 时顺手核出的**现存缺陷**：成本是在 worker 内部按「建 worker 那一刻」的 provider 闭包算的（`openai-compatible.ts:231` 的 `pricingFor`），而 `index.ts:143` 的 routingWorker 是**进程级单例**、缓存 key 只拼 `name::baseUrl::apiKey` → 在界面上改单价只要没动连接信息，跑着的进程继续按旧价记账，报表与日志都不说话。改成整份 provider 作 key（`providerCacheKey`），理由写在注释里：**字段清单式的 key 就是这个缺陷的成因**，加字段的人不会想起来补一行。验收是同进程内 5e-6 → 5e-3 两次计量 + 3 条 key 性质测。**③ 规则 B：`model:""` = 跟随当前默认（`7c0dbe0`）**——替代整套角色令牌的约定，只有一个约定值。解析点选在 `startRun` 里 `loadConfig` 之后、`validateModels` 之前，三条理由都有具体出处：持久化文档字节不变（`contentHash` 驱动版本快照节流与「与运行版本一致」标记）、`validateModels` 拿到的是真名所以规则 A 不必为 `""` 开分支、**run 快照存真名**（评测 byPrompt 版本指纹在 `sqlite-driver.ts:2387` 按快照里的 `${model}\0${prompt}` 做 sha256——若在读取时解析，快照永远是空串，换内置默认前后的两代 run 会被悄悄并成一个版本，属本项目反复清扫的「把两次实验当一次」那一类）。重跑/fork 走快照，因此新 run 不会被二次解析、老快照里的下架名照样命中规则 A。落地面：core 五处 schema 放开空串（文本本来就允许，image/video/audio 的 `min(1)` 是禁止「跟随默认」的真凶）、`templates.ts` 59 处模型字面量换成槽位并加**逐模板守护测**（带正对照，防止守护自己写瞎）、`model-slots.ts` 新模块同时收编 `NODE_KIND_MODALITY` 与 validate-models 里手写的取配置三元组（单一事实源）。**顺带查出并修的**：`ab.ts` 不经 `startRun`、也从不传 `defaultModel`，所以 A/B 实验**永远落在 `engine.ts:1653` 那个写死的 `?? "agnes-2.0-flash"` 上**，与用户配的默认无关——实验和正式 run 本来就不可比。已补解析 + `defaultModel`；它剩下的薄接线（不经 `runAsUser`、无 bannedTerms/userSkills/storeBinary/月度预算/用量归集）**登记成 deferred 而没有半补**，因为半补会得到「实验结果不可比」这种比缺口更糟的中间态。**web 端**：`store/graph.ts` 删除了「打开产线时自动重写模型并自动存盘」的迁移——它是 #53 零配置首跑 422 的根因，而在规则 A/B 之下它错得双向（把用户留开的槽位钉死、又把该报错的下架名悄悄改绑），现在打开一张图永远不改它的模型字段；新建节点也不再盖章具体模型。Inspector 里五份复制的模型 `<select>` 收成一个共用 `ModelSelect`（新文案不可能五处漂移）：空槽显示「跟随默认 · <实际模型>」而不是长得像必填项没填，钉着下架名标「已下架，请重选」，而「跟随默认」本身是一个可选项＝一键回去。**质量门（本机 Node 24 实跑，非估算）**：core **346/346**（24 文件，新增 `graph.test.ts` 3 测 + 模板守护 2 测）、server **1390 = 1386 通过 + 2 本机环境红 + 2 DOGFOOD 跳过**（164 文件，本批新增 `model-slots.test.ts` 10 测与派发口端到端 1 测）、web **1968/1968**（105 文件，**单跑全绿**；三包串跑时出现过 2 例 CostReport/ProductGallery 抖动、隔离重跑即绿——与前几批同一环境现象，判定红的之前先隔离重跑）、`pnpm typecheck`（含 scripts）绿、`i18n:check` 与 `i18n:prune --check` 均 0 未引用（本批移除 4 个死 key、新增 4 个）。**未验证 / 别当已完成**：① **Inspector 的新界面没有做过视觉走查**（本机起不了 vite + 浏览器操作被拦），逻辑有组件测兜、文案与布局未用眼看过；② 没部署、没 SSH、没 push，Hasee 上仍是旧行为；③ **真机端到端未跑**：本批三条产线的实际派发要等 Token Plan（agnes 免费档一次 run 只放行约 1 次 completion，见 Known issues）；④ ④ 阶段（admin 可维护的内置目录）未开工，方案里含一个已改的选型结论——原倾向「数据目录放 JSON 文件」，核过 `settings.user_id` 是无外键的 PK 且加解密已在 store 边界之后，改成**平台保留行、零迁移**；⑤ 我自己 `7c0dbe0` 的 commit message 里 core/server 两个测试计数是推算的（写的是 344/1389，实测 346/1390），当时未实跑就落笔，本节数字为实测。⑥ 存量数据影响面：**未改任何已存产线文档**，模板改动只影响此后新建的产线；存量图若钉着仍存在的内置模型行为完全不变，若钉着被删模型则从「静默假成功」变成「422 报错」——这是本批的目的，也是上线后可能第一次被人看见的行为变化。
**2026-09-25（第二批：技术债清账 + 订阅 gate 覆盖面收口，feature/20260824，未 push）**：这一批的主线是**量化并推翻我自己上一轮的判断**。① **events + audit_log 统一维护循环**（`e6e0ca5`）——design-audit-log §5 记下的「仅启动时 prune 一次，进程长期不重启就什么都不回收」这个代价，按它当初写下的处方收口：`pruneRetention()` 一轮成对处理 events(90d) + audit_log(180d)，`MaintenanceLoop` 启动即清 + 每 6h 续清，单轮失败只 warn（表继续长是可恢复运维问题，中断 run 服务不是）；仍不复用 `TriggerScheduler`——用户 cron 语义混淆的理由成立。② **订阅 gate 覆盖面：先度量再动手**（`048c393` 度量 → `242b04f` 收口 → `3eaf6eb` 文档）——**上一轮回复里「开关在你手上」这句是错的**：四处文档 + 09-18 走查记录直接读到过 prod systemd override 内容，`MONETIZATION_ENFORCE=1` 自 2026-09-14/15 就开着、owner 已升 pro。真问题是逐调用点核实出来的 **5 个 `startRun` 派发点只有 1 个被拦**，另有 AB 与 fork **直连 `db.createRun`**（连那个计数都不算进去）；prod 一直开着就意味着这不是「没拦」而是**计量长期偏低**——而文档留开它的理由恰恰是「先灰度观察计量是否准确」。修法走仓内自己的先例：`run.ts` 的月度预算硬熔断就放在 `startRun()` 且注释明写「覆盖 manual/trigger/batch 全部入口」，于是判定收进新的 `dispatch-gate.ts`、在 `createRun` **之前**调用（被拦的派发不留 `running` 行，也就不会自己占死并发槽）；AB 按「一次实验」判一次（放进循环会让 A 组自己的活跃 run 把 B 组按并发超额拦掉）；各 HTTP 口统一回同一个 402 体，其中**批量重试此前连 try 都没有，配额拦截会回 500**（覆盖面之外的既有缺陷，一并修）。新增 `observe` 档做真灰度：照常评估、打 `would block dispatch` 点名派发口与 metric，但不拦。`=== "1"` 的静默失效也改掉：认 `1/true/yes`，其它非空值打日志把你写的值点出来再按关处理。**回头自查发现自己引入了热路径回退**：`dispatchGate` 在判模式之前就取了用量，等于「gate 关着 + 正式用户」每次派发白扫 4 张用量表 + 一次存储求和（被它替代的内联代码只在分支内取）；已改成先分人再取数，并把那条 off 测试从「不读 subscription」加强为「连用量表都不碰」（`172c4a6`）——原断言只盯一半，正是它漏掉这次回退的原因。防复发用源码扫描守护「调 `db.createRun(` 必须引用 `dispatchGate`」，**植入 rogue 文件验证过能红**；`resumeRun()`（审批后续跑）**有意不拦**。③ **欠费判定落地**（`bb50612`）——`enforceSubscription` 收了 `status` 却从不读，欠费账号保留全额付费额度；按 §6.4 实现「past_due 即断内置模型、BYOK 不受影响」，`canceled` 到 `current_period_end` 才断（Stripe 期末取消会先写 `canceled`，那时访问权还在已付费期内，只看状态会提前收走）。**「宽限期 3-7 天」没做**：`subscriptions` 没有「状态何时变更」的列，`updated_at` 被 checkout 镜像与 `setPlan` 等无关写入顶掉，拿它算宽限＝一个会说谎的窗口，登记 deferred 等加列。顺带修掉一个**足以让③白做的洞**：`setPlan` 无条件写 `status:"active"`，owner 改一次套餐就把欠费标记抹掉；admin 路由还解析 `body.status` 却从不使用（传了、拿 200、操作者以为改了）。④ **首次真供应商狗粮跑出 core 一个用户可见真缺陷**（`cd6371f`）——`tpl-compliance-precheck` 的确定性预检节点把「最好的」+ 追加词「最」洗成 **「（已删除）秀的」**：`checkCompliance` 的 autoFix 按原串算命中区间、却逐个往已被前一次替换改变长度的结果串上套。**不需要任何自定义配置就会中**——广告法词表自带的 `第一`/`第一品牌` 就是嵌套对（那条恰好输出「领先品牌」、读着没问题，所以一直没被发现）。全仓所有 compliance 模板受影响。顺带查出我自己模板的 `extraBanned` 八条里**六条是词表重复**、裸字「最」还会误伤「最近」「最多」（`78e7811`，附「每条必须真咬得住 / 不能是重复 / 不能是裸字」守护，两个分支各种回旧值验证过能红）。⑤ **狗粮 harness 入库**（`e6d293f`）——此前 checklist 每个 ✅ 行都是一次性进程内调用、无人能复跑；新增 `dogfood-templates.test.ts`（`DOGFOOD=1` 才跑、默认 skip，「默认跳过」与「真能跑」两个方向都实测过）：`variant-copy` **真出过一条 90 字可用文案**（$0.000399；痛点→方案→行动结构对、命中投料要求的钩子、在 120 字上限内、无绝对化用语），随后 provider 429 打断 v2/v3 与评委。checklist 两行 ⬜→🟡 并写清还缺哪半；顺带修掉 harness 自己的一个读数缺陷（产物按 `<node>.txt` 命名会让一个节点的第二条产物覆盖第一条，合规节点正是「命中报告 + 净化稿」两条）。**卡点（非代码问题）**：`.env` 的 `AGNES_API_KEY` 是 agnes **免费档**，一次 run 只放行约 1 次 completion 后全部 429，而这两条产线每轮都需 ≥2 次模型调用——**买到 Token Plan 之前结构上跑不完**，已存项目记忆。⑥ **文档更正**：回滚章节写的 `ENABLE_SUBSCRIPTION_GATE` **代码里从来没有这个变量**（事故时照它 unset 会以为关了而其实还在拦，已就地更正并点名错名）；m2 第 5 步「否则 M1 会 402 断供」的因果当时不发生（触发器绕开 gate），按「当时不成立 / `242b04f` 起才成立」两段记；runbook 新增 §四之二（当前状态、紧急关闭 + **验证真的生效**、修复后的覆盖面表含 MCP 与 resumeRun 例外、observe 两步灰度、行号引用一律换成符号名）；三处 retention 记录同步维护循环；deferred 新登记 `scripts/prune-events.ts` 裸 SQL 那条（全仓扫下来运维脚本里只剩它一处，driver 里 `pruneOldEvents` 本来就在）。**质量门（本机 Node 24 实跑）**：core **341**（23 文件）、server **1366**（162 文件：1362 绿 + 2 红为本机 Xcode CLT python shim 已知基线 + 2 skip 即狗粮门控）、web **1964**（105 文件全绿；与 server 并发跑时出现过 19 个 `Test timed out`，单独重跑全绿，属资源争用非回归）、四包 + `tsconfig.scripts.json` typecheck 全绿。本批新增 **25 测**（逐文件对 `df19689` 实测：dispatch-gate +8、subscription-gate +5、maintenance +4、dogfood +2、platforms +2、subscription +2、subscriptionService +1、templates +1）。**未验证 / 别当已完成**：**没部署任何东西、没 SSH 服务器、没 push**——prod 的新覆盖面要等下次发布才生效，而**那次发布会让 M1 四条回采产线第一次受 token 配额约束**（此前它们完全绕过 gate），runbook 已写明先 observe ≥24h 看有没有 `metric:"tokens"` 再改硬拦；亮色主题仍无视觉走查（本机起不了 vite）；两条新模板的 select / 合规改写 / 门禁四半仍未真机验证（缺 Token Plan）；`SUBSCRIPTION_INACTIVE` 在前端仍显示通用「升级套餐」文案（`UpgradeGate` 按 `metric` 分支、不看 `code`），欠费用户会看到错误的引导。**同日稍后已闭合**：服务端拆成 `PAYMENT_REQUIRED` / `SUBSCRIPTION_ENDED` 两个码，`UpgradeGate` 改按 `code` 分支、复用 `BillingTab` 既有文案键（仅新增 `stripe.endedTitle`/`endedBody` 一对），欠费用户不再被引导去「升级套餐」。

**2026-09-25（i18n 收尾 / 模板运行时门禁 / 运维脚本可执行性，feature/20260824，未 push）**：主轴是把「文档说已有」的东西逐个变成「机器可证」。① **i18n 语言包收口**——组件迁移已在 HEAD（`136b1ba`/`0013c1b`），本轮只剩 `App.tsx` 一处中文，核证它是 CanvasPark 的**配色哈希种子**而非文案（走 `t()` 会让产线颜色随语言变化），改注释说明而非改代码（`e299fe5`）；死 key 三轮清理共删 **836**（2818→1982→现 2001 含新增：`e989ef5` 817 个、`dff738f` 19 个），清理前先修好扫描器本身（`16b2561`：此前不解析 `defaultNS`、看不见查表里的 key、命名空间硬编码漏了 `billing` 使该包从未被检查），判定规则收进 `apps/web/scripts/i18n-scan.cjs` 供 check 与 prune 共用；新增 `i18n:prune -- --check` 与**值层面漂移检查**（`400b773`：en 仍是中文 / 空值 / key 单边；防误报靠 `(Zh|En)` 结尾的正文豁免 + CJK 占比 ≥30%），两者一并进 CI 且根 `typecheck` 扩到 `scripts/`（`b82a066`）。实测：当前包 0 个真未翻译；canary 验证两类缺陷各自 exit 1。② **审计日志 180 天保留清理（P3 前半）**——driver `pruneAuditOlder` + server 启动时惰性 prune、失败仅 warn（`8fd4c5f`），并更正 `audit.ts` 与 design-audit-log §4「代码无 DELETE 路径」的过期断言（`85bf18d`）；剩 hash chain 仍按触发条件缓做。③ **模板运行时门禁（本轮核心增量）**——此前 35 个模板只有 `compile()` 保底，而 fanout 缺下游 select **编译干净、运行期才炸**。新增 `packages/server/src/templates-runtime.test.ts`：tier 1 全表扫运行期不变量，tier 2 用 fake worker **真执行 17/35**（上传类喂真 docx fixture、审批类改断言「停在 gate、上游全完成、下游未启动」而非跳过），18 个外部依赖项逐条登记原因且必须与推导集相等（`7eaca28`/`ebc0c95`）。④ **补两个零凭证节点承载模板**——`tpl-variant-copy`（首个 fanout+select，`fa78c33`，首版 prompt 写错为「只描述角度」，实则变体 prompt 会**覆盖** lane prompt，`b7bf603` 修正并加断言）与 `tpl-compliance-precheck`（首个 compliance，`51d92fd`）；节点类型覆盖 **23/29 → 26/29**，且「还剩哪些没承载」从文档手抄改为 core 断言（文档此前写 2 类、实际 6 类）。⑤ **设计 token 再清 19 处**（`3aade4a`/`745af38`）：4 处 `var(--token, 硬编码)` 死 fallback、时间线家族语义色；**过程中我自己把 `--power/--accent` 的琥珀误映射到 `--warning`，实测 token 值后回正**，并把「115 处非豁免」的粗口径改成渐变/阴影/合规 rgba 三类实数。⑥ **运维脚本可执行性**（`ab4269d`）：`scripts/migrate-down.ts` 被 runbook 当作 DB 回滚手段却导入不存在的 `../src/db.js`（**从未跑得起来**），`prune-events.ts` 在文件缺失时会**静默建空库并报成功**；统一 fail-closed（PG 直接退出、DB_FILE 必须存在、默认指向真实库），根因是 `scripts/` 不在任何 tsconfig 覆盖内，故补 `tsconfig.scripts.json`；实测真回滚 41→40 两步、两类缺陷路径各 exit 1。⑦ **文档对账三批**（`e5ecb93`/`3850ddb`/`cfd8477`/`7b26b97` + 本轮 5 篇勘误说明）：project-progress 里密钥轮换/审计清理/构建工具链三项「未做」实为已落地、undici 8 是**升上去又回退**而非待办、PRODUCT_STRATEGY §四/§七 标注为决策记录非待办；另有 11 处文档引用的文件路径不存在，逐条定位真名后加「文件名勘误」。**质量门（本机 Node 24 实跑）**：core **338**（23 文件）、server **1344**（159 文件；2 红为本机 Xcode CLT python shim 的已知环境基线，非回归）、web **1964**（105 文件全绿）、四包 + 新增 scripts 类型检查干净。**未验证项（别当已完成）**：亮色主题未做视觉走查（本机起不了 vite，含 ⑤ 的文字色轻微变化）；`tpl-variant-copy` 与 `tpl-compliance-precheck` **未做真实狗粮**（checklist 标 ⬜，产物质量无人看过）；`pnpm i18n:prune -- --check` 进 CI 后若并行会话先提交了新 key 可能首跑即红（属预期，按提示 `--apply` 清理即可）。注：本条曾使 shipped 达到 7 条（当时并行会话在编辑 handoff，未代删）；同日第二批条目入库后按约定滚动——最旧 5 条（2026-09-22~24 批次）搬到 docs/handoff-archive-2026-09-25.md，本文件恢复为只留最近 6 条。
**2026-09-24（style/docs：M1 等待窗口清账批，feature/20260824，未 push）**：不触执行核心、对 M1 回采零影响的技术债清账，按原子提交。① **run-status 状态徽章迁移设计 token（`cd7f926`，style）**——styles.css 8 个 run-status 徽章 + `.run-timeline-halt` 从写死暗色 rgba/hex 迁到语义 token（running/halted→warning、done→success、failed/tripped→error、cancelled/interrupted/default→中性 bg-tertiary/border/text-secondary），亮色主题对比度修正，对齐 `.run-status--degraded` 范例，deferred L143 历史债闭环；同族 run-timeline-attempt/gate 时间线状态色仍硬编码，留待未来亮色走查。② **deferred-items 对账（docs）**——逐项核对 11 条线、更新 3 处过期：商业化 P0-P3 改为「M1 回采/价格校准 ✅、M2 订阅 gate S1-S8 ✅ 已部署 #47、M3 账单+Stripe A0-A5 ✅ #48，仅剩真机 Step6」；run-status 徽章债标 ✅（`cd7f926`）；tpl-news-podcast G-C 软降级标已落地（`a867425`）、G-E/G-H 已落地（PR #384/#385），剩余仅 P0 真机 key + G-F 拍板。@types/node 经代码核实仍锁 ^24.13.5，deferred 原记录准确不改。③ **硬编码 locale 格式化收口到 i18n/utils（refactor，web）**——全仓非测试代码仅剩 2 处裸 locale 调用：DemoBanner 的 `toLocaleTimeString` 改用 `formatTime`（保留非法日期返回空串兜底）、FormConnectorModal 的 `new Intl.ListFormat(i18n.language)` 改用 utils 新增的 `formatList` helper（i18n/utils 现导出 10 个格式化函数）；脚本扫描确认 apps/web/src 非测试代码已无任何裸 `toLocale*`/`new Intl`（仅 utils helper 内部使用）。web typecheck 干净、DemoBanner 5 + FormConnectorModal 28 共 33 测全绿（commit `eeb51ac`）。④ **Inspector i18n 复核（无代码改动）**——核实 Inspector.tsx 已 0 个 CJK 硬编码、47 处 t()，历史 #48 早已全量完成 29 种节点配置字段 i18n，本轮不重复实现。⑤ **文档索引与模板状态核对（docs）**——docs/README 场景导航补 6 个现行文档入口（产物渲染/成品库 artifact-display + artifact-attribution-repo、服务端日志 design-logging、知识记忆 knowledge-memory、电商 F1-F10 ecommerce-roadmap、RPA 回读 rpa-readback、历史技术栈 tech-stack-assessment）；脚本机械比对确认完整清单单一事实源 handoff「Project documents」区已登记全部 docs/runbook、**清单无欠账**，README 按其「只做场景导航、不重复清单」定位，对 feedback-workflow（handoff Feedback 区已直链）、refactor-engine-inspector（L20 design-* 通配已覆盖）、两个 Ubuntu 一次性部署执行 plan/log（正式手册 deploy-ubuntu-server 已挂）不单列；改后全链接脚本校验零死链。Known issues 三条（DoubaoWork 沙箱限制含 SIGXFSZ 已证伪、Xcode CLT python shim、Linux RLIMIT_NPROC）逐条核对仍为准确的长期开发/测试环境基线、无过期，不改。template-checklist 的 tpl-news-podcast 行评估发现与 L61 进度总结对齐 G-C 软降级现状（零配置/纯文本供应商下 voice 置 skipped+warn、稿件经 script→depot 旁路 e5 完整交付、run 不失败），状态保持 🟡（✅ 口径=端到端含音频产物，唯一缺配好 TTS 供应商真机出音频的证据，卡 P0 key）。




## Quality gate (current snapshot)
> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。
* `pnpm -r typecheck`：全绿（core/server/mcp-server/web `tsc --noEmit` 全部干净；2026-09-18 版本逐字高亮与 docs 原子提交时 pre-commit hook 四包 typecheck 均复核全 Done（前台超时会自动转后台任务，无需 --no-verify））

* 测试总数 **3778**（2026-09-25 第三批快照 + MVP 收尾批：**core 24 文件 346、server 165 文件 1393、web 105 文件 1968、mcp 3 文件 71**；server 的 1366 含 2 条本机环境红（Xcode CLT python shim，见 Known issues，CI 绿）与 2 条 `DOGFOOD=1` 门控跳过（`dogfood-templates.test.ts`，CI 不花钱）。。本会话自己的增量为 server +27（maintenance 4、dispatch-gate 8、subscription-gate 路由覆盖 5、dogfood 门控 2、subscription 状态 2、subscriptionService 1）、core +5（platforms 嵌套命中 2、模板词表守护 1，另 2 归属待查）、web +2（UpgradeGate 欠费引导），其余差额来自并行会话在同一分支上的提交，未逐条归因——**总数是实跑的，分解只覆盖本会话**。上一版 3687（2026-09-24 快照：core 336、server 1322、web 1958、mcp 71，共 288 文件**；上一版 3668（core 334 / server 1311）；G4 步骤 1/2 地基 core +7（新 events.test.ts）、server +9（新 db.remote-jobs.test.ts +8、migrations +1），core/server 各 +1 测试文件；上一版 2026-09-22 为 3643/285 文件（core 323、server 1298）；**权威全绿以 CI Linux（GitHub 托管 ubuntu-latest，见 ci.yml:12,81）为准**）。写实工业风铺开 web +4 测/+1 文件（新增 industrial-kit.test.ts、扩 iso3d-shapes.test.ts，1947→1951）。相对 2026-09-21 的 3631，TTS P1（G-A/G-B/G-D）core +3（pricing +2、templates +1）、server +2（openai-compatible +1、engine.audiogen +1）；同日 G-E 补齐 audioGen 派发闸门测试 server 再 +3（validate-models，1295→1298）。相对上一版 3616/282 文件，#57 错误追踪适配层 server +15 测（errors 单测 12 + admin-errors API 3）/+2 测试文件（errors.test.ts、api.admin-errors.test.ts）；依赖升级见 Recently shipped #57。**本机 DoubaoWork 内置沙箱 shell 内跑 server 全量有 9 文件/36 测 code-spawn 失败（SIGXFSZ 平台基线，见 Known issues，非 #57 回归；CI Linux/Hasee 全绿），其余 1257 测过，新增 15 测在沙箱内亦全过。**ReDoS 根治（`01f8868`/`8c95dfd`，PR #349 CodeQL 阻断项）core +1（线性扫描回归测，覆盖两种攻击形态）；此前 G2.4-A 数组契约（`978ab56`/`2fbcbe1`/`36135e8`/`33dcc91`）core +16（contract 数组分支）、server +8（`engine.contract` +5 走 JSON 数组 artifact、`engine.products` +3 走 sourceMeta.data）、web +2（Inspector 数组表单）；此前状态机方案 A 增强（`208683b`/`2c56e48`）core +17（compile +7 / variables +5 / 新增 state-machine +5）、web +3（BranchFields 状态预览，新增测试文件）；此前 2026-09-18/19 基线为 3552 / 280 文件（core 286、server 1253、web 1942、mcp 71）。相对当日早前 snapshot（3532 / 277 文件）+20 测 / +3 文件：当日晚 #35 SSRF DNS 瞬时失败有限重试 server +5、#36 parkCoordScheduler web +6（新测试文件）、#37 nodeLabel web +7（新测试文件）；09-19 翻译 review 修复 `16db0a5` core 模板拓扑 +1（templates.test.ts）、server 端到端 rework 回归 +1（新文件 translation-review-rework.test.ts）；core/mcp 本轮零改动，沿用当日早前实跑值；数字一律以本次实跑为准）：

  * `pnpm --filter @agent-world/core test`：**346/346 通过**（24 文件；2026-09-25 Node 24 实跑，`platforms.test.ts` autoFix 嵌套命中 +2、`templates.test.ts` 模板补充违禁词守护 +1；上一版 336，其 2026-09-24 Node 24 实跑，G4⑤ trace degraded 投影 +2；#69 runtime NodeRuntime.skipReason +2；#64 trace timeline skipReason +2；2026-09-23 Node 24 实跑；G4 步骤 1 新增 events.test.ts +7（node.degraded schema 全/最小字段、非法 kind、缺 reason、REMOTE_JOB_LOST 与既有错误码回归）；2026-09-22 为 323/22；TTS P1 pricing +2、templates +1；ReDoS 线性扫描回归 +1、G2.4-A 数组契约 contract +14、状态机方案 A compile/variables/state-machine +17；早前 2026-09-18/19 含翻译模板 review 有序双前驱拓扑测试 +1；parkLayout、file/product connector 形状断言、compile trigger warning、模板 35 形状守护、单价缺口、trace timeline、contract、deadline 等）
  * `pnpm --filter @agent-world/server test`：**1393 总数 = 1389 通过 + 2 本机环境红 + 2 DOGFOOD 跳过**（165 文件；2026-09-25 Node 24 实跑，MVP 收尾批新增 `sink.test.ts` +3，本会话此前新增 `maintenance.test.ts` 4、`dispatch-gate.test.ts` 8、`api.subscription-gate.test.ts` 路由覆盖 +5、`dogfood-templates.test.ts` 2（默认 skip）、`subscription.test.ts` 状态判定 +2、`subscriptionService.test.ts` +1；那 2 条红是 `engine.code.test.ts` 的两个 python 网络白名单用例，成因见 Known issues 的 Xcode CLT python shim，**CI Linux 绿**；上一版 1322/158 文件，其 2026-09-24 Node 24 实跑，G4 运营台在途任务只读端点 db.remote-jobs list/clamp +3、新文件 api.admin-remote-jobs HTTP 401/403/200/all/limit +5（共 +8/+1 文件）；G4④⑤ engine.videogen.async degraded recovery 重写 +3；#70 engine.reliability reconstructState degraded 投影 +3；#63 engine.audiogen 7→8；全量权威以 CI Linux Node 24 为准；G4 步骤 2 新增 db.remote-jobs.test.ts +8、migrations.test.ts v41 fresh +1 且 rollback 顺延为 41→40→39、park-coord 版本断言→41、remote_jobs 入 demo 级联清单；2026-09-22 为 1298/156；TTS P1 openai-compatible +1、engine.audiogen +1；同日 G-E validate-models audioGen 派发闸门 +3；#57 errors 适配层 +15 测/+2 测试文件（errors.test.ts、api.admin-errors.test.ts）；failover v1（routing/config 新文件）、#52 undici pinned-Agent 真实 loopback 兼容回归 + selectPinRecord、#364 backup env 启用路径两批修复新增，一律以本次实跑为准；G2.4-A 数组契约 `engine.contract.test.ts` +5、`engine.products.test.ts` +3；早前 2026-09-18/19 09-19 翻译 review 重跑回归 `translation-review-rework.test.ts` +1（新文件，真实 tpl-translation 经 gate 退回断言 review 各 attempt 输入含原文+初译）；当日晚 #35 SSRF DNS 有限重试在 ssrf/code-proxy 既有文件再 +5；早前 09-18 gate 禁用词 `prohibited.ts` +8（7 纯函数 + 1 集成），09-17 四项收口新增：G2.2 `engine.contract.test.ts` 9、G1.2 `engine.fork.test.ts` 3 + `api.fork.test.ts` 5、G4.4 `engine.videogen.async.test.ts` 5；此前 09-16 五项补强 runs 全文搜索 4、diagnose 6、parse-file xlsx 5，demo 零配置首跑修复 +1、09-15 演示用户 +23、StreamableHttp notify flaky 修复 +1）。历史备注：Node v22 + macOS seatbelt 下依赖 spawn JS sandbox 子进程的用例曾 status 71 失败（干净基线与带改动失败集合 diff 为空、非回归，CI Linux bwrap 正常）；另有 2 个真实 chromium 的 RPA 浏览器用例需 `pnpm exec playwright install`——**2026-09-20 起本机 chromium 已装（随 E2E 落地），`rpa.browser.test.ts` 本机实跑 4/4 通过**；高并发全量偶发 `audit write failed: table locked`（SQLite 表锁竞争，重跑即过、非回归）。
  * `pnpm --filter @agent-world/mcp-server test`：**71/71 通过**（3 文件；含 stdio 端到端冒烟 3 个。负载性 flaky：`pnpm -r test` 并行时 stdio 冒烟可能超 5s，单独跑稳定）
  * `pnpm --filter @agent-world/web exec vitest run`：**1968/1968 通过**（105 文件；2026-09-25 单独实跑全绿，`UpgradeGate.test.tsx` 欠费/取消引导 +2；⚠️ **与 server 全量并发跑时会误报**：同日一次并发跑出现 18 文件失败、其中 18 条错误全是 `Test timed out`，单独重跑 105/1966 全绿——判红之前先隔离重跑并分类错误种类；上一版 1958 总数，104 文件；2026-09-24 全量实跑，G4 degraded 时间线决策 UI 组件测试 RunTimelineView 8→14（+6，T1）；#64 RunTimelineView skipReason 渲染 +1；与总数行及写实工业风 shipped 条目对齐；2026-09-22 快照 1951/104，更早 2026-09-20 顺序实跑基线为 1947/103；G2.4-A Inspector 数组契约表单 +2、状态机 BranchFields +3；早前 2026-09-18 当日晚 #36 `parkCoordScheduler` +6（新文件）、#37 `nodeLabel` +7（新文件）；早前本轮版本逐字高亮 `graph-diff` +6 / `VersionPanel` +1；此前 09-17 3D 美化 + CI 修复新增 `iso3d-shapes.test.ts` 厂房 LED 用例 1、`Canvas3D.test.tsx` 补 PMREM/后处理 stub；此前 09-17 四项收口：RunTimelineView fork/reused +3、新 `InspectorFields/RetryField.test.tsx` 2；09-16 五项补强：lib/graph-diff.test.ts 8、VersionPanel 版本对比 +4、GraphSwitcher 搜索/收藏 +11、RunHistory 全文搜索 +3 与失败诊断 +4、SourceFiles xlsx +2；组件目录零「有 .tsx 无 .test.tsx」）。✅ **本机高并发负载 flaky 已于 2026-09-20 修复（A2，`ee1d635`）**：根因是 testing-library 的 waitFor/findBy 默认 asyncUtilTimeout 仅 1000ms（而 vitest testTimeout 本已 10s），多 worker/高负载下 mock promise 与 React effect 偶尔超 1s 才 flush，导致 VersionPanel/ProductGallery/PublishTargets 等（每次不固定、均不在改动范围）误报“停在加载中”或 worker 提前退出；在全局 `src/test/setup.ts` 设 `configure({ asyncUtilTimeout: 5000 })`（与 ProductGallery 局部包装一致、仍低于 10s testTimeout，真死锁仍被 testTimeout 兜住）后，**默认多 worker 全量 102 文件/1942 实跑全绿（EXIT=0，81s）**，隔离/顺序/CI 原本即全绿。判断回归仍看改动文件 + 全量 + CI。

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

* **macOS python code 节点测试失败 → 查 Xcode 协议**：`/usr/bin/python3` 是 Xcode CLT 占位 shim，未接受协议时拒绝执行，子进程起不来报 `ENOENT lstat`。修复：`sudo xcodebuild -license accept` 或 `brew install python`。排查：`python3 --version` 若打印 license 提示即此问题。**症状不一定是 ENOENT**：2026-09-25 本机它表现为 `engine.code.test.ts` 两条 `net: allowlist` 用例红（断言拿不到 `node.finished`，`expected undefined to be truthy`），只有 `language: "python"` 的用例失败、同文件 16 条 JS 用例全过——这形状容易被误诊成「沙箱不让回环 listen」，先跑一个 `net.createServer().listen(0, "127.0.0.1")` 探针即可排除（本机返回 LISTEN_OK，随后 `python3 --version` 打出 license 提示才是真因）。Linux CI / Hasee 不受影响。

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

