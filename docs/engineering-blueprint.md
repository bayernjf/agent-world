# 企业级工程化蓝图（Engineering Blueprint）

> 状态：**规划蓝图（2026-09-07 定稿，未实施）**。
> 定位：agent-world 从 M0 单机走向企业级（M3 生产 + 规模化）所需**全部工程能力**的全景清单与补齐路线。覆盖 12 个工程域，每域给出「现状 / 缺口 / 补齐方案 / 优先级」。
> 关系：本蓝图是**总纲**。可观测性/密钥/部署的详细见 [production-ops.md](production-ops.md)；各功能设计见 `design-*.md`；缓做项触发条件统一登记 [deferred-items.md](deferred-items.md)。
> ⚠️ **取舍先行**：本蓝图列的是「能力全景」，不是「全都要做」。哪些真需要、哪些视产品形态（自托管 vs 多租户 SaaS）而定、哪些大概率用不上，见 [design-scaling.md §0](design-scaling.md) 的关键取舍判断。
> 创建：2026-09-07

---

## 0. 全景矩阵与优先级约定

优先级定义（结合 agent-world 实际规模，避免过度设计）：

| 级别 | 含义 | 大致时点 |
|---|---|---|
| **P0** | 现在就该有（堵「出事无法止损」的洞） | M0 阶段（当前） |
| **P1** | 对外生产前必须有（M3 硬门槛） | M3 前 |
| **P2** | 规模化才要（有明确触发条件） | M3 之后 |

12 域 × 优先级速览：

| 域 | P0（现在） | P1（M3 前） | P2（规模化） |
|---|---|---|---|
| 1 可观测性 | 自述式 health 探针 | Metrics + 告警 | Tracing、SLO、Profiling |
| 2 可靠性 | 成本硬熔断、全局限流 | 优雅关闭、幂等审计 | 多副本、混沌 |
| 3 发布 | 一键回滚 | CD 自动化、feature flag、migration 回滚 | 金丝雀、SBOM |
| 4 安全 | gitleaks 扫历史 | TLS、供应链扫描、SAST | DAST、合规、渗透 |
| 5 配置密钥 | .env.example、secrets 分离 | Secret Manager | feature flag 平台 |
| 6 IaC | 部署脚本幂等化 | Ansible/Terraform | 不可变基础设施 |
| 7 数据 | 恢复演练 | 归档、一致性校验 | 异地备份 |
| 8 测试 | E2E 冒烟 | 契约测试、覆盖率门禁 | 性能/混沌 |
| 9 性能 | — | APM、负载测试 | 容量规划 |
| 10 DevEx | 一键本地启动 | devcontainer、pre-commit | 平台化 |
| 11 运营 | runbook 补全 | postmortem 模板、SLA | on-call |
| 12 成本 | 硬熔断 | 预算分层、归因完善 | 成本优化自动化 |

---

## 1. 可观测性（Observability）

**现状**：日志落盘（`design-logging.md` 已实施）、请求日志、审计日志（`audit_log`）、软预算告警、自述式 `/api/health`（✅ 已实施，报 env/branch/commit + DB/密钥/Provider 就绪）。

**缺口与补齐**：

| 能力 | 说明 | 补齐方案 | 优先级 |
|---|---|---|---|
| 自述式 health | 环境/分支/commit + DB/密钥/Provider 就绪状态 | ✅ 已实施（2026-09-07），见 [production-ops.md §2](production-ops.md) | 完成 |
| **Metrics（RED）** | Rate/Error/Duration + 业务指标（run 数、成本、产线吞吐） | ✅ 已实施（2026-09-08）：`metrics.ts` 零依赖内存聚合 + `/metrics` Prometheus 端点；HTTP 埋点（requests/errors/duration）+ run 埋点（total/failed/cost/active）；顺带修复请求日志中间件注册顺序（health/auth 请求此前不经过） | 完成 |
| **告警** | 服务挂、错误率飙升、成本逼近预算、磁盘满 | Uptime Kuma（探针）+ Grafana Alerting（指标阈值），推 Telegram/邮件 | P1 |
| **分布式 Tracing** | 一个 run 从 webhook 触发的完整链路 | OpenTelemetry 贯穿 engine/API（runId 作 traceId），Jaeger/Tempo 后端 | P2 |
| **SLO/SLI** | 可用性、错误率、P99 延迟的承诺与监控 | 定义 SLI（如 `/api/health` 成功率、run 完成率）+ 错误预算 | P2 |
| Profiling | CPU/内存热点 | node `--prof` / clinic.js，性能问题时用 | P2 |

**关键点**：日志已有，缺的是「指标 + 追踪 + 告警」三位一体。P1 先上 Metrics + 告警（成本敏感项目最需要「成本指标告警」）。

---

## 2. 可靠性工程（Reliability / SRE）

**现状**：节点重试（`retry.ts`）、error 边容错、失败级联 skip、systemd `Restart=always`、备份。

**缺口与补齐**：

| 能力 | 说明 | 补齐方案 | 优先级 |
|---|---|---|---|
| **成本硬熔断** | 月度预算超限硬停 | ✅ 已实施（2026-09-07）：`startRun` 入口硬停新 run（`monthlyBudgetExceeded` 纯函数 + `AGENT_WORLD_BUDGET_BYPASS=1` owner 放行）；顺带修复 `costForMonth` 带 userId 参数错位 bug | 完成 |
| **全局限流** | 登录/注册/run 创建入口防滥用 | ✅ 已实施（2026-09-08）：`rate-limit.ts` 内存滑动窗口 `RateLimiter`；login 10次/15min/IP、register 30次/小时/IP、run 30次/min/user | 完成 |
| **优雅关闭** | 收到 SIGTERM 时完成在途 run、关闭 DB/SSE | ✅ 已实施（2026-09-08）：`index.ts` 监听 SIGTERM/SIGINT → `server.close()` 停新请求 → drain 在途 run（`AGENT_WORLD_SHUTDOWN_GRACE_MS` 超时 abort）→ 关 DB → `disposeIsolatedWorkers` → exit | 完成 |
| **优雅启动** | readiness 探针在 DB/密钥就绪前不接流量 | ✅ 已实施（2026-09-08）：`/api/health` 的 `ok` = DB/encryption/JWT 关键检查全通过，未就绪返回 503 | 完成 |
| **幂等审计** | 关键 API（建 run、发布、webhook）防重复提交 | ✅ 已实施（2026-09-08）：建 run 幂等——`Idempotency-Key` header + `idempotency_keys` 表（迁移 35），重复提交返回同一 runId（`replay:true`）；发布/webhook 待接入 | 完成 |
| **恢复演练** | 验证备份真的能恢复（RTO/RPO） | ✅ 已实施（2026-09-08）：`restore-agent-world-drill.sh` 恢复到干净目录 + 启动验证，实测 RTO<1min / RPO<24h | 完成 |
| **熔断器** | Provider 连续失败时暂停调用避免雪崩 | 按 Provider 维度的 circuit breaker（失败率/半开探测） | P2 |
| **多副本高可用** | 单点故障切换 | 需先 SQLite→Postgres（见域 6 / k8s 判断） | P2 |
| **混沌测试** | 主动注入故障验证韧性 | 杀进程/断网/磁盘满演练 | P2 |

**关键点**：P0 的「成本硬熔断 + 全局限流」均已落地（2026-09-07/08），堵住「账单爆炸」和「被刷」两个洞。可靠性其余部分依赖 SQLite→Postgres，P2 再展开。

---

## 3. 发布工程（Release Engineering）

**现状**：CI（typecheck/build/test 门禁，见 `deploy-cicd.md`）、`deploy.sh`、回滚排障记录。

**缺口与补齐**：

| 能力 | 说明 | 补齐方案 | 优先级 |
|---|---|---|---|
| **一键回滚** | 版本化 release + 切软链回退 | `releases/<ts>-<commit>/` 目录 + `rollback.sh` 切 systemd `WorkingDirectory` 软链 | P0 |
| **CD 自动化** | push dev → CI 绿 → 自动部署 Hasee | self-hosted runner + `deploy.sh`（已有雏形，补齐自动触发 + 失败通知） | P1 |
| **migration 回滚** | DB migration 支持 down（出问题能退回） | ✅ 已实施（2026-09-08）：`Migration.down` 可选字段 + `rollbackLatestMigration` + `scripts/migrate-down.ts`；纯 DDL 迁移写 down，无 down 的迁移回滚拒绝（不猜） | 完成 |
| **feature flag** | 功能灰度开关（不发布代码也能开关功能） | ✅ 已实施（2026-09-08）：`feature-flags.ts`（`FEATURE_FLAGS` 注册表 + `isFeatureEnabled`，未知 flag fail-closed）+ `AppConfig.featureFlags`；首个 flag `rpa-metrics`（合规风险默认关，使用点待 RPA 接 API 端点） | 完成 |
| **金丝雀/蓝绿/滚动** | 渐进放量、零停机 | 依赖多副本 + 负载均衡（需先 Docker 化 + 反代） | P2 |
| **制品管理 / SBOM** | 容器镜像、依赖清单、软件物料清单 | Docker 镜像 + `npm audit --omit=dev` + SBOM 生成（syft） | P2 |
| **环境一致性** | 本地/CI/生产环境一致 | devcontainer + 锁文件 + 固定 Node/pnpm 版本（已修 packageManager 固定） | P2 |

**关键点**：P0 的「一键回滚」是止血能力（30 秒回退）；P1 的「migration 回滚 + feature flag」是发布安全的基石。

---

## 4. 安全工程（Security）

**现状**：RBAC、静态加密、SSRF 防护、审计日志、密钥轮换、代码沙箱（`security-audit-2026-08-31.md` 29 项全修复）。

**缺口与补齐**：

| 能力 | 说明 | 补齐方案 | 优先级 |
|---|---|---|---|
| **gitleaks 扫历史** | 排查 git 历史是否泄露过密钥 | `gitleaks detect` / `trufflehog` 扫全历史，发现即轮换 | P0 |
| **TLS/HTTPS** | 传输加密 | 域名 + Let's Encrypt（certbot）或云 SSL，nginx 443 | P1 |
| **依赖漏洞扫描** | 已知 CVE 拦截 | `npm audit` 进 CI 门禁 + Dependabot/Renovate 自动 PR | P1 |
| **SAST** | 代码静态安全分析 | 可选 CodeQL / Semgrep 进 CI | P1 |
| **DAST** | 运行态漏洞扫描 | OWASP ZAP 扫公网端点 | P2 |
| **合规** | SOC 2 / ISO 27001 | 需审计日志防篡改（hash chain）+ 密钥管理流程齐备后评估 | P2 |
| **渗透测试** | 外部攻击者视角 | 上线前请第三方或自助 | P2 |
| **WAF / DDoS** | 应用层防护 | 云 WAF / CDN（M3 上云后） | P2 |
| **密钥集中管理** | 部署级密钥进 Secret Manager | 见域 5 / production-ops §3 | P1 |

**关键点**：P0 的「gitleaks 扫历史」务必做——开发过程踩过 corepack 写 packageManager 这类坑，扫一次确认没有 key 混进 git。其余 P1 是 M3 对外硬门槛。

---

## 5. 配置与密钥管理（Config & Secrets）

**现状**：`.env`、三层密钥存储、keyring 轮换（`design-key-rotation.md`）、`AGENT_WORLD_CONFIG` 机制。

**缺口与补齐**（详见 [production-ops.md §3](production-ops.md)）：

| 能力 | 补齐方案 | 优先级 |
|---|---|---|
| `.env.example` 模板 | 占位符进 git，文档化「有哪些变量」 | P0 |
| 配置/密钥分离 | 非敏感进模板，敏感真值只放 `secrets.env`（600）+ systemd `EnvironmentFile=` | P1 |
| Secret Manager | 部署级凭证进云 Secret Manager，CI 部署时拉取注入 | P1 |
| 配置版本化/diff | 配置变更可审计、可回滚 | P2 |
| feature flag | 见域 3，config 表承载 | P1 |

**关键点**：机器自有密钥（JWT/加密）**不进云**，只有部署级凭证（`AGNES_API_KEY`）进 Secret Manager。

---

## 6. 基础设施即代码（IaC）

**现状**：手工部署脚本 + systemd unit + nginx config（`runbooks/`）。

**缺口与补齐**：

| 能力 | 补齐方案 | 优先级 |
|---|---|---|
| 部署脚本幂等化 | 现有 `deploy.sh` 补幂等（重复执行安全） | P0 |
| Ansible | 服务器状态声明式管理（装依赖/用户/服务/nginx） | P1 |
| Terraform | 云资源（M3 上云）声明式管理 | P1 |
| 不可变基础设施 | 每次发布构建新镜像而非原地改 | P2 |
| 镜像构建 | Dockerfile + 多阶段构建 | P2（与 k8s 判断同源） |

---

## 7. 数据工程（Data Engineering）

**现状**：版本化 migration（`db.ts`）、备份 cron（每日 02:30）、WAL checkpoint、静态加密。

**缺口与补齐**：

| 能力 | 说明 | 补齐方案 | 优先级 |
|---|---|---|---|
| **恢复演练** | 验证备份可恢复 + 明确 RTO/RPO | 定期在干净目录恢复备份 + 启动验证，runbook 化 | P0 |
| 数据归档/清理 | 旧 run/audit_log 定期清理 | 按保留策略清理（audit_log P3 已登记 180 天） | P1 |
| 一致性校验 | 备份完整性校验 | 备份后 checksum 校验 + 定期抽查 | P1 |
| 异地/多版本备份 | 防单机磁盘故障 | 备份同步到第二位置（M3 上云后） | P2 |
| 数据质量监控 | 成本/用量数据异常检测 | 计量数据对账 + 异常告警 | P2 |

**关键点**：备份已做但**从未演练过恢复**——「能备份不等于能恢复」，P0 先做一次恢复演练确认 RTO/RPO。

---

## 8. 测试工程（Testing）

**现状**：单元测试（server 884 / core 188 / web 1561 / mcp 50）、回归基线、组件测试、CI 门禁。

**缺口与补齐**：

| 能力 | 说明 | 补齐方案 | 优先级 |
|---|---|---|---|
| **E2E 冒烟** | 注册→配 provider→建产线→跑→出成品全链路 | Playwright 脚本，部署后自动跑一次 | P0 |
| 集成测试 | 跨模块（DB/engine/API）真实联动 | 现有 db 集成用例扩展 | P1 |
| 契约测试 | API schema 前后端一致 | OpenAPI 契约 + 契约测试 | P1 |
| 覆盖率门禁 | 关键路径覆盖率下限 | ✅ 已实施（2026-09-08）：`@vitest/coverage-v8` + `test:coverage` 脚本 + 阈值门禁（lines 75 / stmts 72 / funcs 74 / branches 62，基线 79.3/76.7/78.4/67.3） | 完成 |
| 性能/负载测试 | 产线并发、API 吞吐 | k6/autocannon 压测脚本 | P2 |
| 混沌测试 | 故障注入 | 见域 2 | P2 |

---

## 9. 性能工程（Performance）

**现状**：成本计量（无性能监控）。

**缺口与补齐**：

| 能力 | 补齐方案 | 优先级 |
|---|---|---|
| APM | 慢查询/慢节点识别，接入 Metrics（域 1） | P1 |
| 负载测试 | k6 压测 API 与产线并发，得吞吐/延迟基线 | P1 |
| 容量规划 | 根据基线估算单机容量上限 | P2 |
| 缓存策略 | 热点查询/静态资源缓存 | P2 |

---

## 10. 平台工程 / DevEx（Developer Experience）

**现状**：monorepo + pnpm、`AGENTS.md` 规范、i18n/commit 规范。

**缺口与补齐**：

| 能力 | 补齐方案 | 优先级 |
|---|---|---|
| 一键本地启动 | 单命令拉起 server+web+db（`pnpm dev` 已接近，补环境检查） | P0 |
| pre-commit hooks | lint/format 自动执行（husky + lint-staged） | ✅ 已实施（2026-09-08）：husky + `.husky/pre-commit` 跑 `pnpm typecheck`（拦截类型错误；未引入 lint/format 工具，避免全量格式化大改动） | 完成 |
| devcontainer | 新人/新机一键环境（Node 24 + pnpm + 工具） | P1 |
| 依赖管理策略 | 定期升级 + 审计（衔接域 4 供应链） | P1 |
| 代码生成器 | 新节点/模板脚手架 | P2 |

---

## 11. 运营流程（SRE Practice）

**现状**：runbook（部分）、feedback workflow。

**缺口与补齐**：

| 能力 | 补齐方案 | 优先级 |
|---|---|---|
| runbook 补全 | 覆盖常见故障（服务挂/DB 锁/磁盘满/成本超限） | P0 |
| postmortem 模板 | 事故复盘模板（时间线/根因/行动项） | P1 |
| SLA/SLO 定义 | 明确承诺（见域 1 SLO） | P1 |
| 变更管理 | 变更记录 + 审批流程 | P1 |
| on-call 值班 | 多人协作才有意义，个人项目暂缓 | P2 |

---

## 12. 成本工程（FinOps）

**现状**：成本计量（token + 单价）、软预算告警（80%/100%）。

**缺口与补齐**：

| 能力 | 补齐方案 | 优先级 |
|---|---|---|
| **硬熔断** | 月度预算超限硬停（见域 2） | P0 |
| 预算分层 | 按产线/用户/Provider 分层预算 | P1 |
| 成本归因完善 | 内容级成本归因（F9 已有雏形，补 variant/渠道维度） | P1 |
| 成本优化 | 识别高价低效产线、模型降级建议 | P2 |

---

## 13. 分级实施路线（里程碑）

### M0（现在，堵 P0 洞）

```
1. ~~自述式 /api/health（可观测性）~~ ✅ 已实施（2026-09-07）
2. ~~成本硬熔断 + 全局限流（可靠性 / 成本）~~ ✅ 已实施（2026-09-07/08）
3. ~~一键回滚 + deploy 幂等化（发布 / IaC）~~ ✅ 已实施（2026-09-08，deploy.sh 记录 last-known-good + rollback.sh 一键回退 + 部署后健康检查）
4. ~~gitleaks 扫 git 历史（安全）~~ ✅ 已实施（2026-09-08，1081 commits no leaks + `pnpm audit` 无漏洞）
5. ~~.env.example 模板（配置）~~ ✅ 已实施（2026-09-08，覆盖核心/密钥/沙箱/存储/集成等 60+ 变量）
6. ~~备份恢复演练（数据）~~ ✅ 已实施（2026-09-08，restore drill 验证通过）
7. ~~E2E 冒烟 + 一键本地启动（测试 / DevEx）~~ ✅ 已实施（2026-09-08，`smoke.test.ts` HTTP 端到端冒烟 + `scripts/dev.sh` 一键启动）
8. ~~runbook 补全（运营）~~ ✅ 已实施（2026-09-08，`scripts/healthcheck.sh` 环境体检脚本）
```

### M3 前（对外硬门槛）

```
1. Metrics + 告警（可观测性）
2. 优雅关闭/启动 + 幂等审计（可靠性）
3. CD 自动化 + feature flag + migration 回滚（发布）
4. TLS + 依赖扫描 + SAST + Secret Manager（安全 / 配置）
5. Ansible/Terraform（IaC）
6. 数据归档 + 一致性校验（数据）
7. 集成/契约测试 + 覆盖率门禁（测试）
8. APM + 负载测试（性能）
9. devcontainer + pre-commit（DevEx）
10. postmortem + SLA + 变更管理（运营）
```

### M3 之后（规模化才做）

```
1. Tracing + SLO + Profiling（可观测性）
2. 多副本 HA + 混沌（可靠性）—— 前置 SQLite→Postgres
3. 金丝雀 + SBOM（发布）
4. DAST + 合规 + 渗透 + WAF（安全）
5. 不可变基础设施 + 镜像（IaC）
6. 异地备份（数据）
7. 性能/混沌测试（测试）
8. 容量规划 + 缓存（性能）
9. 平台化（DevEx）
10. on-call（运营）
```

---

## 14. 与既有文档的关系

- 分布式/高可用/高并发/大数据量/托管/合规的**具体架构方案** → [design-scaling.md](design-scaling.md)
- 可观测性/密钥/部署编排的详细方案 → [production-ops.md](production-ops.md)
- 各功能设计 → `design-*.md`（日志/审计/密钥轮换/沙箱/RBAC 等）
- 缓做项触发条件 → [deferred-items.md](deferred-items.md)「生产级运维线」
- 环境划分 → [environments.md](environments.md)
- 部署现状 → [runbooks/](runbooks/deploy-ubuntu-server.md)

> 一句话：**P0 补「止血」、P1 补「上生产」、P2 补「规模化」——每项都有明确落地方案与触发条件，不做过度设计，也不裸奔。**
