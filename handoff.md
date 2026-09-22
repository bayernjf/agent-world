# Handoff

State of Agent World as of 2026-09-21.

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

* [docs/handoff-archive.md](docs/handoff-archive.md) — historical changes (pre-2026-08-27)；后续滚动归档 [handoff-archive-2026-09-07.md](docs/handoff-archive-2026-09-07.md)（#1–#37）、[handoff-archive-2026-09-10.md](docs/handoff-archive-2026-09-10.md)（#24–#43）、[handoff-archive-2026-09-11.md](docs/handoff-archive-2026-09-11.md)（#44–#45）、[handoff-archive-2026-09-18.md](docs/handoff-archive-2026-09-18.md)（#39、#46–#56、M1 验收、#41 历史体检）、[handoff-archive-2026-09-22.md](docs/handoff-archive-2026-09-22.md)（2026-09-19~20 shipped 条目）

* [docs/PRODUCT\_STRATEGY.md](docs/PRODUCT_STRATEGY.md) — 产品策略汇总（成本/部署/定价/商业化决策基线）

* [docs/project-progress.md](docs/project-progress.md) — 整体进度基线（模块完成度 + 待启动管线 + 迭代规则）

* [docs/design-ecommerce-roadmap.md](docs/design-ecommerce-roadmap.md) — 自媒体电商方向 F1-F10（run 内多变体/审核队列/合规/商品库/批量/效果回流/发布，已全部落地）
* [docs/design-monetization.md](docs/design-monetization.md) — 商业化实施方案（三层计费 / 订阅 gate / P0-P3，**价格已用 M1 真实数据校准 2026-09-14；P1 代码已完成待部署**）
* [docs/design-monetization-m2-implementation.md](docs/design-monetization-m2-implementation.md) — M2 订阅 gate 落地方案（S1-S8 分步骤 + 测试策略 + 回滚方案 + Hasee 部署手册，2026-09-14 S1-S8 代码全部完成并部署 Hasee）
* [docs/design-monetization-m3-implementation.md](docs/design-monetization-m3-implementation.md) — M3 收款与账单落地方案（S1 invoices 表 + 账单生成 / S2 账单页 UI / S3 HTML 发票 / S4 手动收款闭环 / S5 团队席位 / S6 Stripe 待收款主体，2026-09-14 启动）
* [docs/design-monetization-m3-s6-stripe.md](docs/design-monetization-m3-s6-stripe.md) — M3 S6 Stripe 支付网关集成总方案（数据模型/API/webhook/安全/测试/分步；后端 A0-A4 已完成）
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

* [docs/engineering-blueprint.md](docs/engineering-blueprint.md) — 企业级工程化蓝图（**12 工程域全景**：可观测性/可靠性/发布/安全/配置密钥/IaC/数据/测试/性能/DevEx/运营/FinOps；每域「现状/缺口/补齐方案/优先级」+ M0→M3→规模化分级路线；2026-09-07 定稿，**2026-09-15 加「现状对账」：12 域自包含 P0 经实证全具备、部署脚本单一事实源加固、仅 E2E 冒烟缓至开放注册**）

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
* [docs/design-tts-provider.md](docs/design-tts-provider.md) — TTS Provider 接入设计（audioGen 配音链路；推荐 SiliconFlow 原生 OpenAI 兼容 `/audio/speech`，含 UTF-8 字节计费/音色命名/软降级口径与 P0 零代码验证、P1 产品化、P2 edge-tts 三档；2026-09-22 P1 产品化 G-A/G-B/G-D 已落地并部署 Hasee，剩 P0 真机（卡 SF/OpenAI key）+ G-C 产品决策）

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
> 2026-09-19~20 shipped 条目见 [handoff-archive-2026-09-22.md](docs/handoff-archive-2026-09-22.md)。

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

**最新体检（2026-09-22 10:39 CST / 02:39 UTC，#52 止血后第 19h + #57 部署后第 9h）**：✅ 四产线持续稳定，零新增失败。今日（09-22 UTC）已触发：①写草稿 00:10/01:10/02:10 **3 done**（cron `10 * * * *`，约 $0.007/run）；②翻译 00:00 **1 done**（cron `0 */8 * * *`）；③短视频/④批量今日尚未到触发时间（③下一次 03:00 UTC、④下一次 06:00 UTC）。累计 **367 runs**（①270=done237/failed23/interrupted10 ②47=done26/failed15/halted5/interrupted1 ③29=done24/failed5 ④21=done17/failed4）。**失败归因**（node_runs 非 done 终态 error_code 分布）：PROVIDER_ERROR 25（全部集中在 09-20 16:10~09-21 07:10 的 #52 undici8 事故期，止血后零新增）、RATE_LIMIT 17（全历史，09-15 降频起零新增，429 已闭环）、VALIDATION 5（翻译 QC 判未翻译反问，09-19 补边修复后零新增）、TIMEOUT 3、UNKNOWN 2。**成本对账**：node_runs cost_usd 累计 **$13.52**（①$0.47 / ②$0.06 / ③$12.97 / ④$0.03），③短视频占 95.9%（agnes-video-v2.0 为绝对大头）；29 个零成本 run 全部是 failed/halted 终态（节点未执行完无成本，正常），成功 run 成本归集完整无 0/碎片。**cron 调度器**：PID 88574 active，journal 从 09-21 20:10 起持续每小时 `cron tick fired`，四触发器 enabled 无误。**结论：通过标准全部满足——完成率正常（失败均有明确非限流原因且全在止血前）、成本归集完整无 0 计费、429 不再打爆 run。无需人工干预。**

**前次体检（2026-09-22 01:15 CST / 09-21 17:15 UTC，#52 止血后首轮完整 + #57 部署后观察）**：✅ 事故彻底闭环。止血部署（09-21 07:35 UTC，PR #362 merge `758a30d`）后约 9.5 小时窗口：①写草稿 **9 done + 1 interrupted**（interrupted 为 #57 部署 `5c9b7a4` 重启打断，不计质量），cost $0.0211，last done 17:10 UTC / 7.3min；②翻译 **2 done**（08:00、16:00 UTC，cron 8h），$0.0021，last 16:00 / 7.8min；③短视频 **1 done**（15:00 UTC），$0.5402 / 3.5min；④批量止血后无 cron 窗口（06:00 UTC 在止血前、属事故 22 条之一，下次 09-22 06:00 UTC）。**0 failed / 0 halted**，node_runs 非 done 仅 1 条且无 error_code（interrupted run 的在途节点）；journal 无新引擎报错。live 累计 runs=373（draft 261 / trans 46 / video 29 / batch 21）。**同日完成 Mac 异地备份首次恢复演练**（此前只验过"备份成功"）：09-21 与 09-15 两份快照 integrity_check 均 ok、时点行数对账吻合（差 1 run = VACUUM 瞬间 03:00:00.008 刚启动的短视频 running run，8ms 边界已坐实）、artifacts DB 行→磁盘 0 缺失、RTO<1min/RPO≤24h；演练另订正钥匙串记录（实际为 account=`agent-world`、service=`encryption-keys`/`jwt-secret`/`env` 三项，旧文档误记 service=agent-world），详见 deferred-items 异地备份行 2026-09-22 注记。

**前次体检（2026-09-21 02:39 UTC）**：⚠️ **本条归因已被 07:30 UTC 深查推翻，保留原文仅作时间线**——当时判"前约 12 小时 provider 出站中断、curl 401 说明已恢复、下个 tick 自愈"系误诊：curl 不带 key 返回 401 只证明 TCP/TLS 通，带 key GET/POST 全程 200；run 持续 failed 的真因是 undici 8 Agent 传给内置 undici 7 fetch 不兼容（代码事故，见 #52），02:39 之后 03:10~07:10 UTC 各 tick 实际仍全部 failed，并未自愈。原文如下：前约 12 小时 provider 出站中断导致一波 failed，现已恢复、无需人工干预。累计 run：①246（done220/failed18/interrupted8=89.4%）②44（done23/failed15/halted5/interrupted1=52.3%）③27（done23/failed4=85.2%）④20（done17/failed3=85%）。**异常**：①最近连续 12 个、②最近 2 个、③最近 1 个 run 报 `[PROVIDER_ERROR] 初稿/初译/脚本撰写: fetch failed`（约 13:40 UTC 9-20 至 00:50 UTC 9-21），**非 429**；02:39 UTC 实测 `curl https://apihub.agnes-ai.com/v1/models` 返回 401（未带 key=正常），DNS 0.012s/connect 0.37s/total 1.34s，出站已恢复，下个 cron tick 应自愈。**成本对账**：总额 $12.94（①$0.43 / ②$0.06 / ③$12.43 / ④$0.03），③视频占 96%（agnes-video-v2.0 23 次 $11.50 + image 23 次 $0.92），文本三厂全 agnes-2.0-flash 极便宜；成功节点 cost_usd 无 0/碎片（model=NULL 的非 LLM 节点 cost=0 属正常）。**429**：仅②历史 1 条 RATE_LIMIT（9cd1c819），降频后无新增。服务器 up 8 天 13h 未重启，中断更像上游 agnes/网络抖动而非本机问题；下次体检盯恢复后首跑是否转 done。

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

> **MVP 上线就绪评审（2026-09-21，[docs/mvp-readiness-review-2026-09-21.md](docs/mvp-readiness-review-2026-09-21.md)）双口径结论**：个人/小团队**自托管 MVP ✅ GO**（核心编排链路、29 类节点、33 模板、账号隔离、静态加密、备份、成本电表、RTS、demo 一键体验均可用）；**对外商业 SaaS ❌ NO-GO**（功能 Ready、收款/生产运维 Not Ready）。硬阻断五项：Stripe 真机收款（待收款主体 + STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_IDS）、HTTPS/域名证书、provider 真灾备（待第二个 OpenAI 兼容源 key，#44 链路已通）、Postgres HA、Sentry/告警（#57 sink 已就绪、待 DSN，加 ErrorSink adapter 或 webhook relay、无需引 SDK）；另有 G4 长任务跨 run 续跑。
>
> **下一步主线**：商业化 M1→M2→M3 全部完成并部署 Hasee；M3 S6 Stripe 只剩真机 Step6（待收款主体 + STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_IDS）。RTS 阶段 A+B+C 全部完成并真机走查通过。M1 回采 4 条产线继续 cron 自动攒数据 + 每日 10:30 体检。
> **下一步可选方向**：①真机 Stripe Step6（商业化临门一脚）②升级 agnes 付费 key（彻底解决 free tier 429）③~~翻译 review 重跑丢原文~~ **已闭环并经复测证实**（`16db0a5` 已部署 + Hasee `71536df1` 实例已补边；09-20 04:35 UTC 复测补边后 2 个 cron run 全 done、零反问，窗口完成率 15/20=75% 且补边后样本 2/2，随新 run 向 ~94% 收敛） ④RTS 方案 A 单场景 LOD 融合（留档待真实多产线规模再评估）。

> 全部缓做/低优事项（含上述）已统一登记在 [docs/deferred-items.md](docs/deferred-items.md)——每条带触发条件与决策详情链接，触发条件满足时移回本区并标注重启日期。

## Recently shipped (last 6)

按 commit 时间倒序，每条一行影响面 + commit hash：

**2026-09-22（feat：写实工业风推广全部 29 种节点，feature/20260824，两原子 commit `ed7b43e`/`7f98340`）**：把此前仅 textGen 的写实 prototype 铺开为全部节点。① 新增 `industrial-kit.ts`——可复用 PBR 部件库（钢架/控制柜/压力容器/料仓/管段/阀门/汇流排/电机/传送带/漏斗/镜头/天线/号筒/门架/文件架 + 分区色饰件），材质/纹理为模块级单例共享、graph-sync teardown 只销毁每节点 geometry；`industrial-textures.ts` 补 `brushedSteelTexture`/`darkMetalTexture` 两个程序化纹理；抽 `category-colors.ts` 单一事实源。② 新增 `industrial-recipes.ts`——`buildIndustrialShape(kind)` 按 kind 用 kit 组合出独特剪影（每节点一处 `categoryColor` 分区色饰件保持五厂区可读），textGen 沿用现有 `industrial-shapes.ts`；`iso3d-shapes.ts` 删除硬编码 gate 与全部风格化方块代码（`addTopper`/`shadedMaterials`/`edgeColor` 等），统一委托配方。测试：新增 `industrial-kit.test.ts`（部件 role/不越界/共享材质），扩 `iso3d-shapes.test.ts` 遍历全部 29 kind（契约/旋转/LED/恰好一处 accent）；web 103→104 文件、1947→**1951** 测全绿、四包 typecheck 干净；浏览器 3D 真机走查（多节点产线：PBR 材质/分区色/选中发光/管道接驳正常）。未合 dev、未部署、未 push。

**2026-09-22（test+docs：TTS G-E 测试补齐 + G-H 配置 runbook，feature/20260824，已随 PR #384（dev）/ #385（main）合入并部署 Hasee `0283974`，09-45:14 UTC 重启、health ok、重启后 0 error）**：① **G-E 复核结论**——audioGen 模态过滤在前端（Inspector `audioModelOptions` 按 `modalities[m]==='audio'` 过滤 + ModelAssignModal audio 分组）与服务端派发闸门（`validate-models.ts`：audioGen 错误模态=error 拒绝派发、可操作中文报错）**早已就绪**，唯一缺口是服务端测试未覆盖 audioGen；本次补 3 例（注册 audio 模型→无诊断、text 模型→error「文本无法产出音频」、空模型→error「音频模型」），`validate-models.test.ts` 9→12 测，server 1295→**1298**。② **G-H 新增 [docs/runbooks/tts-provider-setup.md](docs/runbooks/tts-provider-setup.md)**——SiliconFlow/OpenAI 两套 step-by-step（provider 字段、SF `模型名:音色名`、perMegaUtf8Byte 计费口径、测试连接）、5 项验证清单、7 行故障排查表；docs/README 场景导航 + handoff 索引 + design-tts-provider 状态同步（G-E/G-H 标落地）。③ E2E 冒烟 2/2（guest 重定向 476ms、一键 demo 1.2s，临时数据目录隔离）。**TTS 剩余**：P0 真机（卡 SF/OpenAI key）、G-C 软降级二选一（产品决策）、G-F 内置供应商骨架（待是否点名供应商）、P2 分片拼接/edge-tts。

**2026-09-22（feat：TTS Provider P1 产品化 G-A/G-B/G-D，feature/20260824，四原子 commit `1ea3c62`/`0a1ec39`/`93b3082`/`0cbf11e`，已随 PR #378（dev）/ #379（main）/ #380（dev）合入并部署 Hasee `c90c8d9`，09-22 09:16:56 UTC 重启生效）**：落地 [design-tts-provider.md](docs/design-tts-provider.md) §4 P1 三项纯增量、零外部依赖改动（不碰 M1 回采）。① **G-A UTF-8 字节计费**——core `pricing.ts` 音频计价加 `perMegaUtf8Byte`（USD/百万 UTF-8 字节）与 `utf8Bytes` 单位标签，computeCost 改用统一 `PRICE_DIVISOR`（perKiloChar÷1000、perMegaUtf8Byte÷1e6），audio 完整性仍 any（秒/千字符/百万字节三选一）；server `config.ts` ModelPricingSchema 放行该字段、`openai-compatible.ts` generateAudio 同时上报 `{characters, utf8Bytes}`（`Buffer.byteLength(input,"utf8")`），修掉中文 1 字≈3 字节被 perKiloChar 低估约 3× 的口径（SF $7.15/百万字节）。② **G-B 播客模板音色参数化**——`tpl-news-podcast` 新增 `ttsVoice` field（默认 alloy，applyTo `voice.audioGen.voice`；placeholder 写明 OpenAI 具名音色 vs SF「模型名:音色名」），与既有 ttsModel 并列。③ **G-D 超长输入明确报错**——`audiogen.ts` 导出 `TTS_MAX_INPUT_CHARS=4096`，发请求前 fail-fast（failed + VALIDATION + 可操作中文错误，提示拆分稿件/缩短口播稿；不发请求省成本、不静默截断；n 是同文本 N 变体只检一次）。测试：core pricing +2（perMegaUtf8Byte 计费、CJK 4 字符=12 字节，字节数用 Web 标准 TextEncoder 守 core 同构零 Buffer）、templates +1（音色落地 voice 节点 + 默认值回落 + SF 模型:音色形式）；server openai-compatible +1（CJK perMegaUtf8Byte 成本与 input 原文透传）、engine.audiogen +1（超长 VALIDATION、零 artifact、worker 零调用、sink 不 finished）。core 323 / server 1295 全过、四包 typecheck 干净。**未做（需拍板/外部输入）**：G-C/A4 无 TTS 能力软降级（现仍 failed VALIDATION，模板 voice 节点「软跳过」注释与代码不一致，须产品二选一）；P0 端到端与 P2 分片拼接仍卡 SF/OpenAI key（B4）。

**2026-09-22（docs：code 节点容器沙箱落地方案，#57，feature/20260824，仅文档未写码）**：扩写 [design-code-sandbox.md](docs/design-code-sandbox.md) §11.4–11.14，把 docker/podman 容器后端从「低优决策记录」补成可直接实施的方案——接口适配（`SandboxBackendName` 加 `docker`/`podman`、`resolveSandbox` 增 `docker info` daemon 可达探测、缺失降级 rlimit+warn）；两个容器特有硬点：①镜像内解释器路径必须与宿主 `resolveInterpreter()` 解耦（容器不共享宿主 fs，fnm/nvm 路径在镜像不存在，用镜像内 `/usr/local/bin/node|python3`、省略 Node `--permission` 保留 `--max-old-space-size`），②容器独立 loopback 到不了只 bind `127.0.0.1` 的宿主 code-proxy；镜像 digest pin/CVE rebuild/离线 load；冷启动（C0 每 run 全新 `--rm` 容器，warm pool 模式 B 留 C2）；cgroups flags ↔ `CodeSandboxLimits` 映射（memory/pids/cpus + 内层 ulimit 双道，墙钟仍靠 engine 超时）；`--read-only`+tmpfs+非 root+`--cap-drop ALL`+no-new-privileges+seccomp、禁挂 docker.sock 的安全清单；net allowlist 三路线（A 复用宿主 code-proxy 经 `host-gateway` 推荐、B per-run 防火墙、C egress sidecar，SSRF 校验不搬家）；rlimit/bwrap/seatbelt/docker/noop 五后端选择矩阵；`CODE_CONTAINER_*` 配置；C0–C3 分期验收（测试仿 bwrap：argv 纯函数单测 + 有 daemon live 测/无 daemon skip）；明确不做 K8s/gVisor/Kata/Firecracker/warm-pool 复用。deferred 沙箱线 + docs 索引同步（顺带修掉 §11 改标题后 deferred 旧子锚点死链）。**触发条件不变（多租户云托管 / 无 bwrap 且要求 Python 硬隔离），当前不实施。**

**2026-09-22（docs：两个落地方案设计，feature/20260824，仅文档未写码）**：① **G4 长任务跨 run 续跑落地级设计（#55，commit `eae4c3b`）**——[design-step-trace-and-robustness.md](docs/design-step-trace-and-robustness.md) §3.4–3.10：NodeState 加 `degraded`、`node.degraded` 事件、`REMOTE_JOB_LOST` 错误码、新表 `remote_jobs`（migration 41）、videogen 超时走 human 同构 halt、submit 前查 open job 幂等防重复计费、ResumeAction 加 `reattach`/`accept-degraded`（query 四分支）、重启默认只读刷新不自动重投、前端橙色 degraded 标识 + 三按钮 + i18n、8 步原子提交计划（1/2 纯增量可先行，4/5 触执行核心须避开 M1 回采期）。② **TTS Provider 接入方案（#56，新建 [design-tts-provider.md](docs/design-tts-provider.md)）**——经读码 + 联网核实确认 audioGen 节点 / Worker 接缝 / OpenAI 兼容 `generateAudio` 链路约 90% 就绪、`MODALITY_ENDPOINT.audio=/audio/speech` 与 SiliconFlow 完全一致，硬缺口仅「配一个真音频供应商 + key」，另有三处口径要补：SF 按 **UTF-8 字节**计费（中文 1 字≈3 字节，现有 perKiloChar 低估约 3×，需加 `perMegaUtf8Byte` 单位）、SF 音色须写 `模型名:音色名`（模板写死的 `alloy` 无效，需 `ttsVoice` field）、模板「无 TTS 软跳过」注释与代码实际 `failed VALIDATION` 不一致（需二选一消除）；给 P0 零代码验证（custom provider 配 SF）/ P1 产品化小改 / P2 edge-tts 免费但商用灰色备选三档，长文本分片拼接列 P2；docs/README 场景导航挂索引、deferred tpl-news-podcast 行更新。**P0 验证 / P1 写码均待用户提供 SF 或 OpenAI key（卡外部输入）。**

**2026-09-22（docs：MVP 评审更新版 + 文档索引同步，feature/20260824，`dd641a5`）**：① 产出 [docs/mvp-readiness-review-2026-09-22.md](docs/mvp-readiness-review-2026-09-22.md) 项目级 MVP 上线就绪评审更新版——基于 09-22 最新 M1 体检数据（367 runs/3.52、止血后 19h 零失败、备份恢复演练首次通过、错误追踪适配层已部署），核心判定与 09-21 版一致：自托管 MVP ✅ 达到且超出，对外商业 SaaS ❌ 功能 Ready/收款运维 Not Ready；更新四产线完成率表、成本构成、失败原因归类、Go/No-Go 判定矩阵、上线阻断项 P0/P1/P2 与 go-live 清单。② docs/README.md 场景导航第 27 行「判断产品是否达到可上线 MVP」更新为指向 09-22 最新版（09-21 版降为历史基线链接）。③ handoff.md Project documents 区补登 MVP 评审报告条目（此前遗漏）。

1. **feat(server) 进程/请求错误追踪适配层 + code CPU flaky 稳定化 + 依赖 patch/minor（2026-09-21，工作分支 feature/20260824，#57，三原子 commit `f1161f4` deps / `0b76fb7` feat errors / `f35da0f` test cpu flake + setup.ts 桩 `278c8e1`，已随 PR #373 合 dev（merge `5c9b7a4`）/#374 合 main，**Hasee 已部署 `5c9b7a4`**）**——上线就绪加固三件：①零依赖 `errors.ts`：有界内存环形缓冲（默认 100、stack 截 4000 字）+ recordError/addErrorSink（返回 unsubscribe、sink 异常隔离）/recentErrors/errorCount/clearErrors/setErrorCapacity；`installProcessGuards` 幂等挂 uncaughtException（记录后 onFatal 走既有 shutdown、由 systemd 重启）/unhandledRejection（只记录不退出）；`createWebhookErrorSink` fire-and-forget、失败只 log 防递归、fetchImpl 可注入、零 SDK，`ERROR_REPORT_WEBHOOK_URL` 在非 test 启用；Hono `app.onError` 仅对 status≥500 记录 method/path 并回通用 internal server error（不泄内部细节）；新增 owner/admin 只读 `GET /api/admin/errors?limit=`（镜像 /api/audit），12 个 errors 单测 + 3 个 API 测（401/403/owner 200 倒序）。②`engine.code` CODE_LIMIT_CPU_SEC=1 的 while(true) 用例原 wall 12s/槽 30s，文件并行 oversubscribe 时烧满 1s CPU 前先撞 wall timeout，把应得的 SCRIPT_ERROR 误判 TIMEOUT；wall→30s、槽→45s，断言仍 SCRIPT_ERROR，不削弱 CPU 时限语义。③依赖 minor/patch：react/react-dom 19.0→19.3、three 0.185→0.186、hono 4.13.7→4.13.8、undici 7.29.0→7.29.1（仍 7.x，守 #52 止血）、@types/node 24.0→24.13、@types/react·three、react-i18next、react-router-dom、@types/nodemailer 等。验证：四包 typecheck 干净、web 1947（顺序）、server 新增 15 测全过、ssrf guarded-fetch 27 全过。另在 DoubaoWork 沙箱内定位默认 rlimit 后端 code 节点 SIGXFSZ 平台基线（见 Known issues；CI Linux/Hasee 不受影响）。**2026-09-21 清账续记（同批三件）**：①错误追踪补齐**配置 runbook**（[docs/runbooks/error-reporting.md](docs/runbooks/error-reporting.md)，9 节：数据形状/隐私边界、零配置查、webhook 启用、Discord/Slack/飞书/Sentry/Loki 直连 vs 必须 relay 对照 + 零依赖 relay 示例、自检）与 **webhook sink 自检 CLI**（`pnpm --filter @agent-world/server run selftest:errorsink -- <url>`，退出码 0=投递 2xx / 1=不可达或非 2xx / 2=未配 URL，临时 relay 四态实测全过，commit `f16f6c3`）；②darwin rlimit `ulimit -f` SIGXFSZ 经沙箱外真实 macOS Node 24 全量 156 文件/1293 测全绿**对照证伪、决定不改代码**（darwin 保留 `ulimit -f`，见 Known issues 与 deferred 沙箱线，docs commit `18b7a93`）；③Hasee demo prune cron **只读取证闭环**（日志严格每小时 :17 APPLY、活库 5 用户/0 demo、deleted 0 属正常空跑，见 design-demo-user 索引）。**Sentry/告警仍卡真实 relay/DSN 部署（适配代码 + runbook + 自检 CLI 均已就绪）。**

2. **fix(server) failover 内置 backup 槽 env 启用修复（2026-09-21，工作分支 feature/20260824，`e5c6d4e`，PR #364 merge `2c92a92` 已部署 Hasee）**——#44 failover v1 真机零影响探测（独立进程临时注入 BACKUP_*，不碰服务/.env/重启）发现：`BACKUP_PROVIDER` 硬编码 `enabled:false`，而 `parseRaw` 只对 `enabled===undefined` 的 provider 回填 true，builtin 槽永不被翻为 true——env 填齐、key 在位时 `failoverCandidates` 仍只有主源，灾备实际永不启用（真机实测确认）。改为按 BACKUP_BASE_URL+BACKUP_API_KEY 填齐动态计算 enabled；新增 2 个 env 路径回归测（vi.resetModules 新鲜模块图：填齐→enabled 且进入 candidates、缺 key→保持 disabled），变异验证旧硬编码 false 下新测精确变红。修复部署后真机复测：`candidates=agnes -> backup`，主源临时不可达（SSRF guard 首字节前抛 PROVIDER_ERROR）时日志实测打出 `failing over text model to backup provider`、backup 端真实收到请求，**切换链路端到端打通**；backup 临时同源 agnes 撞 free tier 429，恰好印证真灾备仍需第二个 OpenAI 兼容 provider（卡用户）。server 154 文件 1278 测全过、typecheck 干净。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

* `pnpm -r typecheck`：全绿（core/server/mcp-server/web `tsc --noEmit` 全部干净；2026-09-18 版本逐字高亮与 docs 原子提交时 pre-commit hook 四包 typecheck 均复核全 Done（前台超时会自动转后台任务，无需 --no-verify））

* 测试总数 **3643**（2026-09-22 快照：**core 22 文件 323、server 156 文件 1298、web 104 文件 1951（vitest 全量）、mcp 3 文件 71，共 285 文件**；**权威全绿以 CI Linux（self-hosted runner）为准**）。写实工业风铺开 web +4 测/+1 文件（新增 industrial-kit.test.ts、扩 iso3d-shapes.test.ts，1947→1951）。相对 2026-09-21 的 3631，TTS P1（G-A/G-B/G-D）core +3（pricing +2、templates +1）、server +2（openai-compatible +1、engine.audiogen +1）；同日 G-E 补齐 audioGen 派发闸门测试 server 再 +3（validate-models，1295→1298）。相对上一版 3616/282 文件，#57 错误追踪适配层 server +15 测（errors 单测 12 + admin-errors API 3）/+2 测试文件（errors.test.ts、api.admin-errors.test.ts）；依赖升级见 Recently shipped #57。**本机 DoubaoWork 内置沙箱 shell 内跑 server 全量有 9 文件/36 测 code-spawn 失败（SIGXFSZ 平台基线，见 Known issues，非 #57 回归；CI Linux/Hasee 全绿），其余 1257 测过，新增 15 测在沙箱内亦全过。**ReDoS 根治（`01f8868`/`8c95dfd`，PR #349 CodeQL 阻断项）core +1（线性扫描回归测，覆盖两种攻击形态）；此前 G2.4-A 数组契约（`978ab56`/`2fbcbe1`/`36135e8`/`33dcc91`）core +16（contract 数组分支）、server +8（`engine.contract` +5 走 JSON 数组 artifact、`engine.products` +3 走 sourceMeta.data）、web +2（Inspector 数组表单）；此前状态机方案 A 增强（`208683b`/`2c56e48`）core +17（compile +7 / variables +5 / 新增 state-machine +5）、web +3（BranchFields 状态预览，新增测试文件）；此前 2026-09-18/19 基线为 3552 / 280 文件（core 286、server 1253、web 1942、mcp 71）。相对当日早前 snapshot（3532 / 277 文件）+20 测 / +3 文件：当日晚 #35 SSRF DNS 瞬时失败有限重试 server +5、#36 parkCoordScheduler web +6（新测试文件）、#37 nodeLabel web +7（新测试文件）；09-19 翻译 review 修复 `16db0a5` core 模板拓扑 +1（templates.test.ts）、server 端到端 rework 回归 +1（新文件 translation-review-rework.test.ts）；core/mcp 本轮零改动，沿用当日早前实跑值；数字一律以本次实跑为准）：

  * `pnpm --filter @agent-world/core test`：**323/323 通过**（22 文件；2026-09-22 Node 24 实跑；TTS P1 pricing +2、templates +1；ReDoS 线性扫描回归 +1、G2.4-A 数组契约 contract +14、状态机方案 A compile/variables/state-machine +17；早前 2026-09-18/19 含翻译模板 review 有序双前驱拓扑测试 +1；parkLayout、file/product connector 形状断言、compile trigger warning、模板 33 形状守护、单价缺口、trace timeline、contract、deadline 等）
  * `pnpm --filter @agent-world/server test`：**1298/1298 通过**（156 文件；2026-09-22 本机 Node 24 实跑、CI Linux 为权威口径；TTS P1 openai-compatible +1、engine.audiogen +1；同日 G-E validate-models audioGen 派发闸门 +3；#57 errors 适配层 +15 测/+2 测试文件（errors.test.ts、api.admin-errors.test.ts）；failover v1（routing/config 新文件）、#52 undici pinned-Agent 真实 loopback 兼容回归 + selectPinRecord、#364 backup env 启用路径两批修复新增，一律以本次实跑为准；G2.4-A 数组契约 `engine.contract.test.ts` +5、`engine.products.test.ts` +3；早前 2026-09-18/19 09-19 翻译 review 重跑回归 `translation-review-rework.test.ts` +1（新文件，真实 tpl-translation 经 gate 退回断言 review 各 attempt 输入含原文+初译）；当日晚 #35 SSRF DNS 有限重试在 ssrf/code-proxy 既有文件再 +5；早前 09-18 gate 禁用词 `prohibited.ts` +8（7 纯函数 + 1 集成），09-17 四项收口新增：G2.2 `engine.contract.test.ts` 9、G1.2 `engine.fork.test.ts` 3 + `api.fork.test.ts` 5、G4.4 `engine.videogen.async.test.ts` 5；此前 09-16 五项补强 runs 全文搜索 4、diagnose 6、parse-file xlsx 5，demo 零配置首跑修复 +1、09-15 演示用户 +23、StreamableHttp notify flaky 修复 +1）。历史备注：Node v22 + macOS seatbelt 下依赖 spawn JS sandbox 子进程的用例曾 status 71 失败（干净基线与带改动失败集合 diff 为空、非回归，CI Linux bwrap 正常）；另有 2 个真实 chromium 的 RPA 浏览器用例需 `pnpm exec playwright install`——**2026-09-20 起本机 chromium 已装（随 E2E 落地），`rpa.browser.test.ts` 本机实跑 4/4 通过**；高并发全量偶发 `audit write failed: table locked`（SQLite 表锁竞争，重跑即过、非回归）。
  * `pnpm --filter @agent-world/mcp-server test`：**71/71 通过**（3 文件；含 stdio 端到端冒烟 3 个。负载性 flaky：`pnpm -r test` 并行时 stdio 冒烟可能超 5s，单独跑稳定）
  * `pnpm --filter @agent-world/web exec vitest run`：**1947 总数**（103 文件；2026-09-20 `--no-file-parallelism` 顺序实跑；G2.4-A Inspector 数组契约表单 +2、状态机 BranchFields +3；早前 2026-09-18 当日晚 #36 `parkCoordScheduler` +6（新文件）、#37 `nodeLabel` +7（新文件）；早前本轮版本逐字高亮 `graph-diff` +6 / `VersionPanel` +1；此前 09-17 3D 美化 + CI 修复新增 `iso3d-shapes.test.ts` 厂房 LED 用例 1、`Canvas3D.test.tsx` 补 PMREM/后处理 stub；此前 09-17 四项收口：RunTimelineView fork/reused +3、新 `InspectorFields/RetryField.test.tsx` 2；09-16 五项补强：lib/graph-diff.test.ts 8、VersionPanel 版本对比 +4、GraphSwitcher 搜索/收藏 +11、RunHistory 全文搜索 +3 与失败诊断 +4、SourceFiles xlsx +2；组件目录零「有 .tsx 无 .test.tsx」）。✅ **本机高并发负载 flaky 已于 2026-09-20 修复（A2，`ee1d635`）**：根因是 testing-library 的 waitFor/findBy 默认 asyncUtilTimeout 仅 1000ms（而 vitest testTimeout 本已 10s），多 worker/高负载下 mock promise 与 React effect 偶尔超 1s 才 flush，导致 VersionPanel/ProductGallery/PublishTargets 等（每次不固定、均不在改动范围）误报“停在加载中”或 worker 提前退出；在全局 `src/test/setup.ts` 设 `configure({ asyncUtilTimeout: 5000 })`（与 ProductGallery 局部包装一致、仍低于 10s testTimeout，真死锁仍被 testTimeout 兜住）后，**默认多 worker 全量 102 文件/1942 实跑全绿（EXIT=0，81s）**，隔离/顺序/CI 原本即全绿。判断回归仍看改动文件 + 全量 + CI。

* **E2E 浏览器冒烟（2026-09-20 落地，B1，独立 @playwright/test runner、不计入上面 3598 单测数）**：根 `playwright.config.ts` + `e2e/smoke.spec.ts`（@playwright/test 1.63，命令 `pnpm e2e`，首次需 `pnpm e2e:install` 装 chromium）；webServer 自动起临时库 server（`ALLOW_DEMO=1`，DB/JWT 密钥/加密密钥/产物/日志全落在 os.tmp 唯一临时目录、跑完即删，不碰真实数据）＋ vite dev web（/api 代理 8791）。2 条冒烟：guest 打开 /→重定向 /login；一键 demo（POST /api/auth/demo）→进入真实产品 + demo 横幅可见 + 无未捕获异常/意外 console error。本机两次连跑 2/2 全绿、RPA 浏览器用例回归 4/4。不跑 AI、无需 provider key。**CI 接入**（runner 装 chromium）与**完整全链路**（注册→配 provider→建产线→跑→出成品）仍缓至对外开放注册，运行说明见 `e2e/README.md`。

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

