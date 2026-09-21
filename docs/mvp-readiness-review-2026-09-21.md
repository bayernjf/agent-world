# MVP 上线就绪评审（2026-09-21）

> 评审性质：项目级功能性 / 完整度 / 可上线性评审，硬标准 = **产品核心完全可用的 MVP**。
> 评审方法：只采信一手现状（实跑 typecheck/测试、代码核查、Hasee 真机数据、provider 端到端实测、文档核对），不凭印象。
> 评审环境：本地仓库 `feature/20260824`；staging 环境 `dev @ 09735b7`。

---

## 1. 结论（先给判定）

**分两个口径，不能一刀切：**

| 口径 | 判定 | 一句话 |
|---|---|---|
| **A. 个人 / 小团队自托管 MVP**（PRD 阶段 0–4，"自己和小团队用"） | ✅ **达到，且明显超出** | 核心闭环完全可用，经 337 次真实 run + 两次断电自愈 + 3599 测试 + 安全基线 + 异地备份验证；BYOK 路径满足"陌生人 10 分钟接自己 provider 跑起来"。 |
| **B. 对外商业 SaaS**（PRD 阶段 5，"在线卖给陌生用户并收钱"） | ❌ **未达到** | 功能就绪，但上线门槛未过：**真实收款未闭环、无 HTTPS、模型 provider 单点无灾备、SQLite 单机无高可用、错误追踪/监控告警缺失、长任务跨重启续跑有重复计费风险**。 |

**总评：它已经是一个功能完整、经过真实验证的自托管产品（接近 v1.0，而非玩具 Demo）；但作为对外商业 SaaS，处于"功能 Ready、上线 Not Ready"——差距集中在收款与生产运维，而不是产品功能本身。**

---

## 2. PRD 阶段退出条件逐条对照

| 阶段 | 退出条件 | 状态 | 一手证据 |
|---|---|---|---|
| 0 骨架+执行引擎 | 引擎能跑 | ✅ | core 320 测试全绿；compile/graph/engine 完整 |
| 1 真能干活 | 自己愿意跑真实任务 | ✅ | 真实 provider（本轮 agnes 端到端 HTTP 200 实测）、流式、用量计量、指数退避重试、超时、质检、SSE 心跳重连、图/视/音频生成与多模态计费 |
| 2 产线表达力 | 不改代码搭出有并行+汇合+多质检点的产线并存模板 | ✅ | levels 并发 + barrier 汇合（parallel/fanout/branch/loop/map/select）、节点预算、多产线管理、**33 模板 / 11 分类**（编译产物实跑计数）、技能卡 + MCP |
| 3 可信运行 | 十几分钟产线断网恢复后状态正确、事件不丢不重、能说清花多少钱 | ✅ | 运行历史/回放、成本报表（产线/节点/attempt/天）、SSE `Last-Event-ID` 续传、重试 vs 返工区分、FailurePanel、80%/100% 预警熔断、Artifact 分层、合格率/返工率/AB 报告；**Hasee 两次断电关机后服务与 cron 自动恢复、数据零丢失**（强于断网场景） |
| 4 开源准备 | 陌生人 10 分钟跑起来并接上自己 provider | 🟢 **基本达成** | Worker 接缝、file/HTTP connector、MCP 客户端+独立 mcp-server、多模态原料、五类触发（manual/webhook/cron/event/batch）、human 审批、33 示例模板、50+ 篇 docs、gitleaks/CI/Docker、Onboarding+GuidedTour。**遗留：S3/对象存储驱动属阶段 5，不堵自托管** |
| 5 商业化 | （PRD 原文本阶段不做，只留三条接缝） | 🟡 **接缝超额、闭环未合** | 三条接缝（worker 可替换 / 事件带版本 / 成本计量真实）✅；且超前落地账号-JWT-多租户隔离、free/starter/pro/team 套餐与 gate、Stripe A0–A4 代码、demo 获客、用量预警。**缺：Stripe Step6 真实收款、Postgres/Redis/K8s、RBAC/SSO/团队协作、Knowledge** |

---

## 3. 核心闭环可用性（本轮实测）

完整主链路：**注册/体验 → 配 provider（BYOK 或内置）→ 选模板/搭产线 → 派发 → gate 质检/返工 → 出文本/图/视频成品 → 定时/事件自动触发 → 成本对账 → 失败可定位可重跑**。

| 环节 | 结论 | 证据 |
|---|---|---|
| 模型推理 | ✅ 可用 | 本轮用 Hasee `.env` 真实 key POST `apihub.agnes-ai.com/v1/chat/completions` → **HTTP 200，6.35s，返回 completion id + usage（299 tokens）** |
| 服务健康 | ✅ | `/api/health` = `{ok:true, env:staging, branch:dev, commit:09735b7, db:ok, jwtSecret:loaded, encryption:loaded, agnes:configured}` |
| 触发器 | ✅ 五类齐全 | 代码核查 manual/webhook/cron/event/batch 均在；cron 断电后自动恢复 |
| 节点能力 | ✅ | 29+ 种节点（text/image/video/audio/gate/branch/code/loop/map/parallel/fanout/human/http/database/search/vcs/ocr/translate/compliance…） |
| 成本计量 | ✅ 真实 | 337 run 成功节点无 0/碎片计费；非 LLM 节点 model=NULL/cost=0 属正常；视频按秒、图按张、文本按 token |
| 数据持久化 | ✅ | SQLite（WAL）+ **异地备份闭环**：Mac launchd 每日 11:00 VACUUM INTO 快照、完整性校验、滚动留存；最新快照 2026-09-20 25MB |
| 生产构建 | ✅ | `apps/web/dist/index.html` 存在 |

### 真机稳定性（Hasee，截至 2026-09-21 02:39 UTC）

| 产线 | 累计 run | done | failed | halted/interrupted | 完成率 | 成本 |
|---|---|---|---|---|---|---|
| ①写草稿·高频文本 | 246 | 220 | 18 | 8 interrupted | **89.4%** | $0.43 |
| ②翻译·带返工 | 44 | 23 | 15 | 5 halted + 1 interrupted | **52.3%** ⚠️ | $0.06 |
| ③短视频广告 | 27 | 23 | 4 | — | **85.2%** | $12.43 |
| ④批量内容工坊 | 20 | 17 | 3 | — | **85.0%** | $0.03 |
| **合计** | **337** | 283 | 50 | — | **整体 83.4%**（去中断口径 ~88%） | **$12.94** |

- **provider 单点实证风险**：2026-09-20 13:40 → 09-21 00:50 UTC（约 12h）连续 15 个 run `[PROVIDER_ERROR] fetch failed`（非 429），评审当时判为上游 agnes/网络抖动。**〔2026-09-22 根因订正〕** 09-21 深查证实该波 failed 真因是 PR #349 所含 undici 7→8 与 Node 24 内置 undici 7 fetch 跨大版本不兼容的**部署代码事故**（非 agnes 中断，curl 带 key 全程 200），已由 PR #362（09-21 07:35 UTC 部署）止血、止血后 0 failed，详见 handoff #52。provider 单点风险本身仍成立：failover 切换链路已真机打通（#44/PR #364），卡第二个 provider key。
- **②翻译完成率偏低（52%）**：返工环 + QC 严格 + free-tier 限流叠加；09-19 已补 intake→review flow 边，需新 run 验证收敛（目标 ~94%）。属已知观察项，非阻断。

---

## 4. 质量门核查（本轮实跑，非引用文档数字）

| 项 | 结果 |
|---|---|
| `pnpm -r typecheck`（core/server/mcp-server/web） | ✅ **四包全绿，EXIT=0** |
| core 测试 | ✅ 22 文件 **320/320** |
| mcp-server 测试 | ✅ 3 文件 **71/71** |
| server 测试 | 🟡 154 文件 **1260/1261**；唯一失败 `engine.code` 无限循环 CPU 时限用例，**隔离单跑 18/18 全绿** = 全量并行高负载时序 flaky，非回归（与文档平台基线一致） |
| web 测试 | ✅ 顺序跑 103 文件 **1947/1947**（并行高负载时 ProductGallery 偶发 asyncUtilTimeout flaky，顺序全绿） |
| **合计** | **3599**（320+71+1261+1947），与 README/handoff 声称一致 |
| 安全 | security-audit 29 项全修；gitleaks + npm audit 无泄露/无漏洞；SSRF 防护、最小权限、静态加密、登录/注册/run 限流、JWT 按 user_id 隔离 |
| 备份 | launchd `com.agent-world.backup` 每日运行、完整性校验通过、密钥不入备份；**2026-09-22 Mac 异地备份首次恢复演练通过**（双快照 integrity_check ok、时点行数对账吻合、artifacts 0 缺失、RTO<1min，详见 deferred-items 备份行） |

---

## 5. 上线阻断项（按致命程度，分口径）

### 5.1 对外商业 SaaS 的硬阻断（不过这些不能对外收钱）

| 级别 | 缺口 | 影响 | 现状/依赖 |
|---|---|---|---|
| **P0** | **Stripe 真实收款未闭环（Step6）** | free 层内置模型 `tokens=0 / video=0`，新用户用平台代付模型直接 402；想升级却**无法真实付款** → "注册→付费→用内置模型"商业主闭环断裂。仅 demo 体验 + BYOK 自助两段是通的 | 代码 A0–A4 全完成且优雅降级（缺 key 报 not configured 不崩）；**卡外部输入：收款主体 + `STRIPE_SECRET_KEY`/`WEBHOOK_SECRET`/`PRICE_IDS`** |
| **P0** | **模型 provider 单点，无 fallback** | 上游一次抖动 = 全员停摆（本轮已实证 12h）；对外 SLA 无法承诺 | 仅 agnes 一个内置源，retry 只解决瞬时错误 |
| **P0** | **错误追踪（Sentry 类）缺失** | 生产 bug 只能 `journalctl grep`，无未捕获异常聚合/告警，出事无法快速止损 | production-ops §6.2 已登记；**2026-09-21 起适配层（`errors.ts` 环形缓冲 + webhook sink + `GET /api/admin/errors`）+ runbook + 自检 CLI 已就绪（#57），仅差真实 DSN/relay 部署，零 SDK** |
| **P1** | **HTTPS/TLS + 域名** | 现内网明文 HTTP（health/登录/cookie/key 传输），公网不可用 | 内网自托管够用，对外必须 |
| **P1** | **长任务跨 run 续跑（G4）缺失** | 长视频在网关超时/进程重启后可能**重复生成、重复计费**（涉钱） | G4.4 仅本次运行内 submit+poll 接缝，无 provider 续跑实现 |
| **P1** | **生产数据层 SQLite 单机** | 无高可用/水平扩展，磁盘满或文件损坏即全站 | 双驱动+迁移+Docker 演练已完成，未切 Postgres；自托管/小团队当前够用 |
| **P1** | 监控告警栈未配（Uptime Kuma/Loki） | 无可用性探活告警 | `/api/health`、`/metrics`、失败告警+rerun 已有，差探针与告警通道 |
| **P2** | ~~Dependabot 自动升级~~、全链路 E2E 入 CI、链路追踪、压测、IaC | 规模化/合规需要 | gitleaks+audit 已做；**Dependabot 已于 2026-09 启用并持续提 PR（patch/minor 批次经 #57 合入，major 走专项）**；CI 仅 2 条 Playwright 冒烟 |
| **P2** | 团队协作/RBAC/SSO、审计 hash chain+180 天清理、Knowledge、对象存储 | 阶段 5 范畴 | 基础 owner/admin/user + resource_access 已就位 |
| **P2** | `tpl-news-podcast` 缺 TTS provider | 单模板音频链路不可用 | agnes 无音频模型，需接音频 provider |

### 5.2 自托管 MVP 的遗留（不阻断核心，建议排期）

1. provider 配第二个源或 fallback（同样的单点问题，自托管也会遇到长时间停摆）。
2. 对外/跨网访问时补 HTTPS（纯本地 localhost 可不要）。
3. ②翻译完成率收敛验证（已补 flow 边，观察新 run）。
4. ~~高负载 flaky 用例稳定化（engine.code CPU 时限、ProductGallery asyncUtilTimeout）~~ ✅ **代码侧已修（2026-09-20/21）**：web 全局 asyncUtilTimeout 1s→5s（A2 `ee1d635`，已随 PR #347 合 dev 部署）、engine.code CODE_LIMIT_CPU_SEC 用例 wall 余量 12s→30s / vitest 槽 30s→45s（#57 `f35da0f`，已随 PR #373 合 dev（merge `5c9b7a4`）/#374 合 main 并部署 Hasee）。CI Linux 权威口径本就全绿，此两项治的是本机高负载 / 沙箱时序 flaky，不影响正确性、不改变 CPU 时限语义。
5. 长任务续跑 G4（若重度使用视频生成）。

---

## 6. Go / No-Go 判定矩阵

| 维度 | 自托管 MVP 门槛 | 实测 | 商业 SaaS 门槛 | 实测 |
|---|---|---|---|---|
| 核心功能闭环 | 必须 | ✅ | 必须 | ✅ |
| 真实模型可用 | 必须 | ✅（含 BYOK） | 必须 + 灾备 | 🟡 单源 |
| 表达力（并行/汇合/质检/模板） | 必须 | ✅ | 必须 | ✅ |
| 可信运行（重连/对账/失败恢复） | 必须 | ✅ | 必须 | ✅ |
| 测试/类型/安全基线 | 必须 | ✅ 3599 | 必须 | ✅ |
| 数据备份 | 必须 | ✅ | 必须 + 高可用 | 🟡 有备份无 HA |
| 获客体验 | 不要求 | ✅ demo | 必须 | ✅ demo |
| 在线收款 | 不要求 | — | 必须 | ❌ Stripe Step6 |
| HTTPS/域名 | 跨网才要 | ❌（内网 HTTP） | 必须 | ❌ |
| 错误追踪/告警 | 建议 | ❌ | 必须 | ❌ |
| 长任务续跑（防重复计费） | 建议 | 🟡 | 必须 | 🟡 |
| **总判定** | — | **✅ GO** | — | **❌ NO-GO（功能 Ready，运维/收款 Not Ready）** |

---

## 7. 上线前必做清单（建议顺序）

**若目标 = 个人/小团队自托管正式日用（最短路径）：**
- [ ] 配第二个模型 provider / fallback（消除单点，优先级最高，本轮 12h 中断的根因）
- [ ] 跨网访问则上 HTTPS（Caddy 自动证书即可）
- [ ] 接一个最轻量错误告警（哪怕 healthcheck 推送到 webhook）　**〔2026-09-21 补注：错误 sink + owner/admin 只读 `GET /api/admin/errors` + 配置 runbook + `pnpm selftest:errorsink` 自检 CLI 均已就绪（#57 `0b76fb7`/`f16f6c3`，见 [runbooks/error-reporting.md](runbooks/error-reporting.md)），本条只差配一个真实 `ERROR_REPORT_WEBHOOK_URL` / relay，无需再写代码〕**
- [ ] 观察 ②翻译新 run 完成率收敛

**若目标 = 对外商业 SaaS（在上面之外还要）：**
- [ ] **Stripe Step6**：确定收款主体，配 `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`PRICE_IDS`，真机走通 checkout→webhook→套餐升级→402 消失
- [ ] 决策 free 层是否给少量内置模型体验额度（当前 =0，配合收款未闭环会卡住非技术用户；BYOK 用户不受影响）
- [ ] HTTPS + 域名 + 公网部署
- [ ] Sentry + Uptime 探针告警
- [ ] G4 长任务跨重启续跑（上线卖视频前必须，防重复计费）
- [ ] 切 Postgres（+ 备份/HA），评估 Redis/K8s 时点
- [ ] 全链路 E2E 入 CI、压测、Dependabot
- [ ] 补 TTS provider 或下线 news-podcast 模板

---

## 8. 证据与口径

- typecheck/测试为 2026-09-21 本地 `feature/20260824` 实跑（Node 24，fnm）；server 单用例失败经隔离重跑定性为高负载 flaky。
- Hasee 运行/成本数据为 2026-09-21 02:39 UTC SQLite 直查（python3 sqlite3）；provider 200 为 02:39–02:44 UTC 真实推理实测。
- 模板/节点/触发器/套餐/gate 为代码与编译产物核查（非文档转述）：33 模板 11 分类、5 类触发器、free `tokens=0/video=0`、demo 独立小额文本池。
- 备份为 Mac launchd 与快照目录实测（最新 2026-09-20，完整性校验 ok）。
- 完成率口径：done / 总 run；interrupted（断电/手动）单列，去中断后整体约 88%。
- 本评审为只读评审，未改动业务代码；Stripe/TLS/provider 灾备等均为外部决策或后续任务，未在本轮实施。
