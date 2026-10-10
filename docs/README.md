# Agent World 文档地图

> **场景导航 + 文档状态约定**。完整文档清单（每个文档的一句话定位）的单一事实源是 [handoff.md](../handoff.md) 的「Project documents」区——本文档不重复维护清单，只回答「我想做某事该看哪个」。

## 怎么读这个仓库（按场景）

| 我想…                    | 看                                                                           |
| ---------------------- | --------------------------------------------------------------------------- |
| 快速跑起来、了解项目门面           | [README.md](../README.md)                                                   |
| 知道现在做到哪、接下来做什么         | [handoff.md](../handoff.md) ★ 交接必读                                          |
| 看整体进度基线、迭代对照           | [project-progress.md](project-progress.md)                                  |
| 用画布（快捷键 / 交互）          | README.md 的 Canvas interaction 一节                                           |
| 看名下所有产线的运营总览（健康度/最近运行/成本） | 命令面板 → 运营工作台（OperationsDashboard，RTS 阶段 A）；设计见 [design-rts-overview.md](design-rts-overview.md) |
| 套用现成产线模板               | [examples.md](examples.md)                                                  |
| 给项目加节点 / Provider / 工具 | [extending.md](extending.md) + [CONTRIBUTING.md](../CONTRIBUTING.md)        |
| 理解架构 / 数据模型 / API      | [technical-design.md](technical-design.md)；技术选型历史决策见 [tech-stack-assessment.md](tech-stack-assessment.md)（2026-08 历史记录） |
| 知道产品往哪走                | [PRD.md](PRD.md) + [roadmap-generalization.md](roadmap-generalization.md) ★ |
| 看竞品（Dify/Coze/n8n 等）都被什么坑、我们还缺什么 | [competitor-painpoints.md](competitor-painpoints.md)（6 类共性痛点 + 现状对账 + G1-G7 增强建议，标注哪些已挂触发条件） |
| 把竞品 P0 痛点变成方案：步级 trace / 上游数据契约 / 长任务降级 | [design-step-trace-and-robustness.md](design-step-trace-and-robustness.md)（G1 步级时间线+fork重跑 / G2 上游 schema 护栏 / G4 超时降级，含 G3/G5 补充决策） |
| 接手某个模块的设计决策            | 对应 [design-\*.md](design-mcp-server.md)                                     |
| 给 agent 加技能卡（工具/提示模块/输出契约） | [design-skill.md](design-skill.md)（§11 现状盘点 + §12 作者指南）+ [extending.md](extending.md) §3 |
| 知识提取 / 跨产线记忆归档 | [design-knowledge-memory.md](design-knowledge-memory.md)（Knowledge / Archive 知识提取与记忆系统，已落地） |
| 把平台暴露给别的 AI 客户端（MCP Server） | **[runbooks/mcp-client-access.md](runbooks/mcp-client-access.md)**（接入手册：stdio / http 两种形态各一段可抄配置、`AGENT_WORLD_TOKEN` 是**用户 JWT** 不是 API key 且撤销不了、只读档、Origin 与 Bearer 两道闸、六条实测验收表、目前「没有」的几件事）+ [design-mcp-server.md](design-mcp-server.md)（§12 协议版本协商 / §13 授权 / §14 未实现清单，方案与取舍）+ [production-ops.md](production-ops.md) §8（部署形态） |
| 接 Notion / Linear / 邮件 / 内容平台等第三方 | [integrations-future.md](integrations-future.md)（未来集成清单与触发条件；当前外接能力走 MCP / HTTP 节点 / Connector） |
| 给播客产线接 AI 配音（TTS Provider） | [design-tts-provider.md](design-tts-provider.md)（audioGen 链路已就绪，推荐 SiliconFlow 原生 OpenAI 兼容 `/audio/speech`；含字节计费口径、音色命名、软降级与 edge-tts 免费备选） + [runbooks/tts-provider-setup.md](runbooks/tts-provider-setup.md)（SF/OpenAI 两套 step-by-step 配置 + 验证清单 + 故障排查） |
| 换/增/删内置模型（不逐条产线手改） | [design-model-catalog.md](design-model-catalog.md)（两平面与字段归属：模型清单=数据、接口方言=代码、端点与凭证=env；规则 A 下架即报错 + 规则 B `model:""`=跟随默认；阶段 ①–④ 已于 2026-09-25/26 全部落地，含 admin 可维护的目录数据面） |
| 视频生成质量差 / 修 agnes 视频方言 / 首帧图生视频 | [design-video-quality-fix.md](design-video-quality-fix.md)（代码方言 vs agnes 官方文档三处冲突：mode/尺寸/轮询路径；阶段 1 修方言 + 阶段 2 首帧图，**2026-10-03 已实施**：`c9662bf`/`7f380db`） |
| 看按版本的变更记录              | [CHANGELOG.md](../CHANGELOG.md)（最近 5 条以内看 handoff）                          |
| 看代码质量 / 安全审计 / 待修复项     | [code-audit-2026-09-06.md](code-audit-2026-09-06.md)（全项目 77 项，已修复 73 / 无需修复 3 / 部分修复 1，low 项 2026-09-11 全部清账） + [security-audit-2026-08-31.md](security-audit-2026-08-31.md) + [code-audit-2026-09-30.md](code-audit-2026-09-30.md)（增量，09-30，基于 09-06 基线，含功能点梳理；＋ **§七 2026-10-04 增量复核 8 条**——本轮专扫原报告没覆盖的**运维工具与数据层**，含 2 条高危：`rotate-reencrypt` 在指错库/空库/PG 部署三种情形都报「旧密钥可以删了」（不可逆数据锁死）、`idx_users_owner` 只由 SQLite 迁移 31 创建而 PG 从不跑迁移 ⇒ 全新 PG 库可并发注册两个 owner；另有一条「已在发生」的：systemd drop-in 用 `Environment=` 写的密钥可被任何本地用户 `systemctl show -p Environment` 明文读到（文件 600 挡不住 D-Bus 属性）。故原报告 §三「无高危」已加作用域限定、§2.2 那条 ✅ 已标注「只在 SQLite 成立」；8 条**已修 7 条**（7.1–7.6 于 10-04；7.7 由拍板后于 10-07 以 Biome `d8daf06` 落地，**但目前只在 feature 分支、dev 里还没有 `pnpm lint`**；只剩 7.8 需 Hasee root），取证方式逐条标注，处置与逐条可伪验收见 §七 末「处置进度」及 handoff #87） + **[product-deep-audit-2026-10-09.md](product-deep-audit-2026-10-09.md)**（最新产品深度审计：代码层面 + 全功能点汇总；29 节点/35 模板/134 端点、全量 3938 passed；自托管 ✅ MVP 达标、对外 SaaS ❌ 卡外部 key，工程侧零阻断） |
| 写 / 跑 web 组件测试           | [web-component-testing-plan.md](web-component-testing-plan.md)（组件测试范围、流程与断言约定；E2E 冒烟见根 `e2e/`，跑法见 CONTRIBUTING） |
| 判断产品是否达到可上线 MVP      | [mvp-readiness-review-2026-09-25.md](mvp-readiness-review-2026-09-25.md)（最新：**判定以 §12 为准**（09-27 第三次独立复评，结论与 §11.1 一致；§11.1 为第二次独立复评，它推翻的是 §10 的四处文档表述、非判定）；**部署版本以 §15 为准（10-07 晚些追记：生产已跑 `dev @ 2871a90`，一手读数＝Deploy run `37639901006` 日志自报 `deploy OK: 2871a90`，而该行按 `scripts/deploy/deploy.sh:33-43` 只在重启后轮询 `/api/health` 判健康才打印；§14 复核时的 `2b301d6`、10-04 的 `96b969b`、§13 的 `779e926` 都已被超过）**——自托管 ✅ 达到「产品核心完全可用的 MVP」，**§12 那个运维签字已半闭**：「只跑单实例」10-04 一手实测闭合（1 进程 / 1 监听），`NODE_ENV` 只剩一行 `/opt/agent-world/.env` 的 grep（systemd 侧已实测两个变量都没有）；**§14 另记两条实测出的生产配置缺口**：`/metrics` 从局域网另一台机打过去 **200 无鉴权**（含 `runs_cost_usd_total`）、`ERROR_REPORT_WEBHOOK_URL` 未设（错误 sink 无消费端），两者都因 `NODE_ENV≠production` 而连启动 warn 都不打——局域网内自托管可接受，**给第二个人或出公网前必收**（见 public-exposure-hardening；旧口径「自托管暴露公网 🟡」的三条同日闭合项仍在 §11.2：`WORKER=fake` 生产拒启 `3df542a`、dist 缺 `.mjs` `02f0e67`、④ 的 `canManageModelCatalog` 前端 0 引用 `69e26b8`；而「SSH 确认线上 = 当前 main」这条判据 09-27 已撤销——**部署源是 dev 不是 main**）；对外商业 SaaS ❌ 不达标；§3 四条一手复验阻断里三条代码项已闭合，第四条口令 09-26 改判为**已接受风险**（实测泄露面、接受范围与四条失效条件都在 §9.6）；含 5 条对旧版口径的更正、门禁读数（§11.4：四包同批低负载实跑 **3873 / 303 文件**——core 346 · server 1460（含 2 条本机 python 环境红）· web 1996 · mcp 71；同 SHA 的 CI 五步全绿；**10-04 同 SHA CI runner 自报 server 1490 passed / 5 skipped**）、以及被证伪后弃用的取证来源清单）+ [09-22 版](mvp-readiness-review-2026-09-22.md) / [09-21 版](mvp-readiness-review-2026-09-21.md)（历史基线；其中「对象存储属阶段 5」「G4 已全部落地」两条已被 09-25 版更正，勿据此判断） |
| 查某个功能为什么缓做、什么条件下重启 | [deferred-items.md](deferred-items.md)（缓做/低优事项登记表，每条挂触发条件与决策链接，单一事实源） |
| 理解投料台连接器 / `${...}` 数据插值 | [design-data-interpolation.md](design-data-interpolation.md)（五类 connector 的 data 通道与插值）+ [design-template-connector-presets.md](design-template-connector-presets.md)（模板按 A/B/C/D 类预设 connector）+ [design-connector-database.md](design-connector-database.md)（SQL 连接器） |
| 让产线定时跑 / 事件 / webhook 自动触发 | [design-triggers.md](design-triggers.md)（cron / webhook / event / batch 四类触发器、调度器单实例与恢复） |
| 用高级编排（人工审批 / 子流程 / 状态变量分支 / 错误边重试） | [phase4-design.md](phase4-design.md)（六项高级编排落地；跨 run 状态机方案 B 缓做，见 deferred-items） |
| 写 / 套用产线模板、模板上线校验 | [design-templates.md](design-templates.md)（模板体系与 TemplateField）+ [template-checklist.md](template-checklist.md)（每个内置模板的狗粮验证清单）+ [examples.md](examples.md)（现成模板一览） |
| 看产线版本历史 / 结构化 diff / 回滚 | [design-versions.md](design-versions.md)（节点级 A/B 对比 + 长文本逐字高亮，已落地） |
| 对两条产线做 A/B 对比实验 | [design-ab-testing.md](design-ab-testing.md)（`/api/ab` + RunCompare，单人隔离已覆盖；流量分流缓做） |
| 看节点产物怎么渲染 / 成品库怎么按产线归集 | [design-artifact-display.md](design-artifact-display.md)（ArtifactCard + 渲染器注册表，已落地）+ [design-artifact-attribution-repo.md](design-artifact-attribution-repo.md)（产物归属 graph_id/role + 按流水线分组成品仓库，已落地） |
| 平台安全 / 合规（角色权限、静态加密、密钥轮换、审计、公告、反馈） | [design-at-rest-encryption.md](design-at-rest-encryption.md) + [design-key-rotation.md](design-key-rotation.md) + [design-audit-log.md](design-audit-log.md) + [design-announcement.md](design-announcement.md) + [design-feedback.md](design-feedback.md) + [design-rbac.md](design-rbac.md)（角色三层分权，均已落地，含 runbook） |
| 代码节点沙箱 / SSRF 防护 | [design-code-sandbox.md](design-code-sandbox.md)（rlimit/bwrap/sandbox-exec 隔离 + 协作式 HTTP 代理 + docker/podman 容器后端方案 §11） |
| 做中英双语 / 调整视觉设计规范       | [design-i18n.md](design-i18n.md)（中文/English 双语方案与 key 约定）+ [design-design-tokens.md](design-design-tokens.md)（颜色/间距/圆角/阴影/字号 token 体系） |
| 让新用户免注册先体验真实产品（演示账号/游客转正） | [design-demo-user.md](design-demo-user.md)（is_demo 真实账号 + 体验额度 + 能力黑名单 + claim 原地转正 + TTL 清理，D1-D6 分步） |
| 部署 / 运维 / 多环境 / 检测环境状态 | [engineering-blueprint.md](engineering-blueprint.md)（企业级工程蓝图·总纲）+ [production-ops.md](production-ops.md)（运维与可观测性）+ [design-logging.md](design-logging.md)（服务端日志规范）+ [environments.md](environments.md)（环境划分）+ [runbooks/](runbooks/deploy-ubuntu-server.md)（部署手册）+ [runbooks/deploy-cicd.md](runbooks/deploy-cicd.md)（push→CI→自部署 Hasee 流水线）+ [runbooks/error-reporting.md](runbooks/error-reporting.md)（错误追踪与告警：webhook sink / relay / 自检 CLI）+ [runbooks/public-exposure-hardening.md](runbooks/public-exposure-hardening.md)（公网暴露加固清单：暴露前逐项闸门）+ [runbooks/change-management.md](runbooks/change-management.md)（变更管理流程）+ [runbooks/postmortem-template.md](runbooks/postmortem-template.md)（事故复盘模板） |
| 让 Claude 自动开浏览器验收部署 | [browser-verification.md](browser-verification.md)（Chrome DevTools MCP 配置与用法）；RPA 回读真实环境接入清单见 [rpa-readback-onboarding.md](rpa-readback-onboarding.md) |
| 查术语 / 名词定义 | [design-glossary.md](design-glossary.md)（领域术语表） |
| SQLite → PostgreSQL 迁移 / 切驱动 | [design-postgres-migration.md](design-postgres-migration.md)（双驱动 + 搬迁脚本 + 端到端演练已完成，生产切换随 SaaS 阶段） |
| 规模化 / 高可用 / 多租户架构 | [design-scaling.md](design-scaling.md) + [design-multitenancy.md](design-multitenancy.md)（自托管先、SaaS 后的分级路线） |

## 路线图 / 进度系列怎么分工

这类文档最容易看混，各管一段：

| 文档 | 管什么 |
| --- | --- |
| [PRD.md](PRD.md) | 阶段定义 + 架构护栏（5 阶段的「是什么」） |
| [roadmap-generalization.md](roadmap-generalization.md) | 通用化主线（当前推进方向） |
| [product-content-roadmap.md](product-content-roadmap.md) + [design-ecommerce-roadmap.md](design-ecommerce-roadmap.md) | 内容线专项（淘宝 / 小红书图文 / research-loop / 新闻播客）；电商方向 F1-F10 流水线升级（run 内多变体 / 审核队列 / 商品库 / 批量 / 效果回流，已落地） |
| 看 M1 成本画像产线 / 回采数据 / 每日体检结论 | [handoff.md](../handoff.md) ★ 待办 #41 区（4 条 M1 回采产线的每日体检记录：run 分布 / 失败归类 / 成本对账 / 处置建议）+ [design-monetization.md](design-monetization.md)（价格已用 M1 真实数据校准） |
| 把内容平台数据自动回读进成本/ROI（F6 metrics，RPA 只读） | [design-ecommerce-roadmap.md](design-ecommerce-roadmap.md)（F6 效果回流：`POST /api/metrics` 手填 / `POST /api/metrics/import` CSV / `POST /api/metrics/rpa` 只读回读）+ [rpa-readback-onboarding.md](rpa-readback-onboarding.md)（RPA 接入清单与合规约束） |
| [project-progress.md](project-progress.md) | 进度基线（各模块完成度快照） |
| [roadmap-tasks.md](roadmap-tasks.md) | 历史任务清单（已合并进上面，勿据此实现） |

产品 / 商业化系列：[PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) = 成本/部署/定价基线 → [design-monetization.md](design-monetization.md) = 商业化实施方案（详细，价格已用 M1 真实数据校准 2026-09-14，P1 代码已完成）→ [design-monetization-m2-implementation.md](design-monetization-m2-implementation.md) = M2 订阅 gate 落地方案（S1-S8 代码全部完成并部署 Hasee，gate 已由 `MONETIZATION_ENFORCE` 控制，Hasee 自 2026-09-14/15 起为开（取值 1/true/yes＝硬拦、observe/log＝只记日志不拦、空＝关））→ [design-monetization-m3-implementation.md](design-monetization-m3-implementation.md) = M3 收款与账单（S1-S5 完成并部署）→ [design-monetization-m3-s6-stripe.md](design-monetization-m3-s6-stripe.md) = S6 Stripe 总方案（后端 A0-A4 完成并部署，schema v39 迁移成功）→ [design-monetization-m3-s6-a5-frontend.md](design-monetization-m3-s6-a5-frontend.md) = S6 A5 前端 BillingTab 实施方案（已完成并部署）**——M3 只剩真机 Step6：待收款主体 + `STRIPE_SECRET_KEY`/`PRICE_IDS` 就绪** → [product-industry-roi.md](product-industry-roi.md) = 行业切入方向评估 → [product-vision-discussion.md](product-vision-discussion.md) = 历史讨论。转化/入门侧：[design-demo-user.md](design-demo-user.md) = 演示用户（免注册一键进真实产品、体验额度、claim 原地转正保留数据；D1-D6 已随 PR #302 合 dev 部署 Hasee 并真机走查，零配置首跑 422 经 PR #305/#307 修复闭环，每小时 prune cron 已挂）。

画布 / 体验系列：[design-canvas-isometric.md](design-canvas-isometric.md) = L1 单厂等距 3D（**五期已建成**：几何 → 完整效果 → 交互 → 视觉打磨 → 写实工业风，第五期含 ACES/Bloom/暗角/地台描边/选中光环 + textGen 工业厂房原型）→ [design-rts-overview.md](design-rts-overview.md) = L0 宏观工业园区 RTS 视角（阶段 A 平面运营工作台已上线，阶段 B 宏观沙盘 B1-B9 全部完成，阶段 C 全部完成：C1-C3 随 PR #290、C4-C8 随 PR #292 合 dev 并部署 Hasee、真机走查通过；C5 改期为点击延后/cron 只读、C6 暂只 CTR/GMV 两处裁剪见 handoff 待办 #50）→ [design-rts-stage-b.md](design-rts-stage-b.md) = 阶段 B 宏观沙盘 MVP 落地级细化（B1-B9 全部完成，B5 帧率实测 100 厂=60FPS/15 draw calls 达标无需视口剔除，B9 i18n/token+全量回归+真机验收通过）→ [design-guided-tour.md](design-guided-tour.md) = 新用户分步引导（聚光灯 + 上一步/下一步，多引导注册中心，已落地）。

## 文档状态约定

- **现行**：当前事实，AI 与开发者以此为准；改动直接更新。

- **历史**：决策过程记录，结论已体现在现行文档；如需修改结论，改现行文档而非历史记录。

- **归档**：冻结内容，只读参考，不追加新内容。

- **实施进度**：统一记在 [handoff.md](../handoff.md)（最近 5 条 + 待办），设计文档只写设计，不重复记进度。

- **完整清单**：所有文档（含一句话定位）见 [handoff.md](../handoff.md)「Project documents」区——那是清单的单一事实源，新增文档先在那里登记。
