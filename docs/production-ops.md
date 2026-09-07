# 生产级运维与可观测性（Production Ops & Observability）

> 状态：**决策记录（2026-09-07 讨论定稿，未实施）**。承接 [environments.md](environments.md) 的环境划分，回答三个问题：①怎么检测各环境状态 ②环境变量/密钥多了怎么管理（注入）③用什么平台管理多环境、健康状态与日志。并给出 agent-world 从 M0 单机走向 M3 生产的运维演进路线。
> 创建：2026-09-07

## 1. 结论速览

| 问题 | 结论 |
|---|---|
| 检测各环境状态 | 升级 `/api/health` 为「自述式探针」，一次 `curl` 看 env/branch/commit + DB/密钥/Provider 就绪状态 |
| 密钥/配置注入 | 现状三层已够；补 `.env.example` 模板 + 拆分 `secrets.env`，M3 再上 Secret Manager |
| 多环境/健康/日志平台 | **暂不上 k8s**（SQLite 单机架构是硬矛盾）；用 Docker Compose + 可观测栈（Uptime Kuma / Grafana 生态）或托管云 |

一句话：**要的不是 k8s，是「可观测性」+「配置管理」+「可重复部署」三件事；k8s 是规模化阶段的答案，且其真正前置条件（SQLite→Postgres）尚未发生。**

---

## 2. 环境状态检测

### 2.1 三层探针模型

把「环境状态」拆成三层，逐层检测：

| 层 | 问的是什么 | 现状 | 手段 |
|---|---|---|---|
| **Liveness 活着** | 进程在不在 | ✅ 有 | `systemctl is-active` + `/api/health` |
| **Readiness 能用** | DB 通不通、密钥就绪没、Provider 配了没 | ❌ 缺 | 升级 `/api/health` |
| **Identity 我是谁** | 跑的是哪个环境/分支/commit | ❌ 缺 | 升级 `/api/health` |

### 2.2 自述式 `/api/health`（待实施）

现实现 `index.ts` 仅 `c.json({ ok: true })`。升级为自述式探针（**只报状态，绝不吐密钥值**）：

```json
{
  "ok": true,
  "env": "staging",
  "commit": "c693372",
  "branch": "dev",
  "checks": {
    "db": "ok",
    "jwtSecret": "loaded",
    "encryption": "loaded",
    "providers": { "agnes": "configured" }
  }
}
```

- `env` 来自 `NODE_ENV` / 新增 `AGENT_WORLD_ENV`；`commit`/`branch` 部署时写入。
- `checks.*` 只报 `loaded` / `configured` / `empty`，**不吐值**——密钥、连接串永远是状态词。
- 三个环境各 `curl` 一次 = 一次完整体检。

### 2.3 环境体检清单（建议做成 runbook/脚本）

```
1. 服务层  systemctl is-active agent-world  +  curl /api/health
2. 配置层  /api/health 返回的 env/branch/commit 对不对
3. 数据层  DB 迁移版本、subscriptions/usage_ledger 表在不在（P1 探针）
4. 依赖层  Provider key / 搜索 key 配了没（探针里报 loaded/empty）
```

---

### 2.4 日常运维：实时监测与排障（拿日志）

**实时监测（当前手动手段）**：

```bash
# ① 探活（1 秒看死活）
curl -s http://<server-ip>/api/health        # → {"ok":true}

# ② 服务状态（有没有反复重启/报错）
ssh hasee-2016-server 'systemctl is-active agent-world && systemctl status agent-world --no-pager'

# ③ 端口监听
ssh hasee-2016-server 'ss -ltn | grep -E ":(80|8791)"'
```

**缺口**：无自动告警——服务挂了不会主动通知，需手动 curl。补法（二选一）：
- A. **Uptime Kuma**（服务器起容器 + HTTP 探针指向 `/api/health`，挂了推手机/邮件/Telegram）
- B. 本地 cron 脚本（开发机每 5 分钟 curl，失败弹 macOS 通知）

**出 bug 拿日志（两个来源）**：

```bash
# 途径 1：systemd journal（实时 tail，推荐）
ssh hasee-2016-server 'sudo journalctl -u agent-world -f --no-pager'

# 途径 2：落盘文件
ssh hasee-2016-server 'tail -f /var/lib/agent-world/logs/server.log'

# 查最近 1 小时错误
ssh hasee-2016-server 'sudo journalctl -u agent-world --since "1 hour ago" --no-pager | grep -iE "error|failed|warn"'
```

> 日志为 JSON 行式（`ts/level/msg` + `runId`/`nodeId` 绑定），可 `grep runId` 定位某次 run。

**前端 bug**：不落服务端（[design-logging.md](design-logging.md) 刻意设计），看浏览器 F12 Console/Network，或走 UI 反馈按钮（带截图 + 诊断）。

**定位一个 bug 的三层路径**：UI 时间线（events 表，哪个节点失败）→ 服务端日志（grep runId 看堆栈）→ 审计日志（`GET /api/audit`）。

---

## 3. 环境变量与密钥管理（注入）

### 3.1 现状：已是「三层密钥存储」

| 密钥类型 | 现在存哪 | 谁注入 | 例子 |
|---|---|---|---|
| **部署级密钥**（每台机器不同） | systemd `Environment=` / `.env` | 部署时手动注入 | `AGNES_API_KEY` |
| **自动生成的机器密钥**（首启生成，0600） | DB 旁 `.jwt-secret`、`.encryption-keys` | 应用首启自生成 | JWT 签名、静态加密 |
| **用户级密钥**（用户在 UI 填） | SQLite `settings` 表 | 用户 | Provider apiKey、搜索 key |

分层本身正确。**唯一短板**：第 1 层（部署级 env）是散落的手工 `.env`，无模板、无版本、无单一真值。

### 3.2 演进路线

| 层级 | 做法 | 适用阶段 |
|---|---|---|
| **1（现状+）** | 建 `.env.example`（占位符，进 git）文档化「有哪些变量」；真值 `.env` 继续 600 + 不进 git | M0 |
| **2（推荐）** | 「配置」与「密钥」分离：非敏感配置进 `.env.example` 模板；敏感密钥真值只放服务器 `/etc/agent-world/secrets.env`（600），systemd 用 `EnvironmentFile=` 注入 | M1-M2 |
| **3** | Secret Manager（AWS/GCP/腾讯云）或 Vault 存真值；CI 部署时拉取 → 写 secrets.env → 600 → 重启 | M3 云托管 |

### 3.3 单一真值原则

> **每个密钥的「真值」只能存在一个地方，其余都是注入副本。**

| 密钥 | 现在真值在哪 | M3 该去哪 |
|---|---|---|
| `AGNES_API_KEY` | Hasee `.env`（无版本） | Secret Manager |
| JWT / 加密密钥 | 服务器自动生成的文件 | **保持**（机器自有，不该进云） |
| Provider / 搜索 key | DB（用户数据） | **保持**（DB，已静态加密） |

**关键边界**：JWT 和加密密钥是「机器自有」的（首启随机生成、跟数据文件绑定），**不该搬去 Secret Manager**——硬搬反而增加泄露面和迁移复杂度。机器自有密钥留机器，只有「部署级凭证」才进云端集中管理。

---

## 4. 部署编排选型（k8s 判断）

### 4.1 为什么现在不上 k8s

**根本矛盾：SQLite 是单文件数据库。** k8s 的价值在于多副本/水平扩展/滚动发布，但 SQLite 无法多副本（多进程写同一文件 = 锁冲突 + 数据不一致）。要上 k8s 得先做 `SQLite → Postgres`，改动量级远大于编排本身。

正确顺序：

```
SQLite → Postgres   （分布式前提）
      ↓
Docker 化           （可移植前提）
      ↓
k8s / 云容器        （规模化前提）
```

**规模也不支持**：现在 1 机 1 用户，M3 约 3 台；k8s 控制面（apiserver + etcd + 网络插件）就要吃掉一台机器相当资源。跳过前两步直接上 k8s = 用集群管理一个无法集群化的应用，教科书级过度设计。

### 4.2 演进路线（与 [environments.md](environments.md) §四对齐）

| 阶段 | 部署编排 | 健康状态 | 日志 | 密钥 |
|---|---|---|---|---|
| **M0 现在** | systemd 单机 | `/api/health` + `systemctl` | `journalctl` | `.env` + 自动生成 |
| **M1-M2** | Docker Compose 化 | Uptime Kuma 探针+告警 | Loki/Grafana 或 journald | `.env.example` + `secrets.env` |
| **M3 正式生产** | 云托管（Lighthouse/ECS） | 云监控 + 托管探针 | 云日志 | Secret Manager |
| **规模化（远期）** | **先 Postgres，再谈 k8s** | — | — | — |

---

## 5. 可观测性栈

「多环境管理 + 健康 + 日志」是四件事，不需要 k8s：

| 需求 | 组件 | 重量 |
|---|---|---|
| 健康探针 + 掉线告警 | **Uptime Kuma**（自托管）/ UptimeRobot（云） | 极轻，优先上 |
| 日志集中查询 | **Grafana Loki** + Promtail | 中 |
| 指标看板 | **Prometheus** + Grafana + node-exporter | 中 |
| 告警推送 | Uptime Kuma / Grafana Alerting | 中 |

两条路线二选一：

- **A 自托管开源**：`docker compose` 起 Uptime Kuma + Loki + Promtail + Grafana + Prometheus，一个入口看日志+指标+告警，数据在自己手里、维护自己扛。
- **B 托管云**：Grafana Cloud 免费档（Loki+Prometheus 托管）+ UptimeRobot，零维护，免费额度够 3 套环境；数据出网。

**倾向**：先上 A 的 Uptime Kuma（一条命令起，立刻解决健康+告警），日志暂用 `journalctl`（systemd 已存）；日志量上来再决定 Loki 还是 Grafana Cloud。

> 与 [design-logging.md](design-logging.md) 的关系：该文档「刻意不做日志采集/聚合（Loki/ELK）」针对的是**当前单机 sqlite 形态**，本路线将 Loki 列为 M1-M2 之后选项，两者不冲突——触发条件见 [deferred-items.md](deferred-items.md) 平台线。

---

## 6. 生产级工程化全景与缺口

### 6.1 已有的（别重复造）

| 能力 | 落点 |
|---|---|
| DB 版本化迁移 | `migrations.test.ts` + `db.ts` |
| 故障重试/降级 | `retry.ts`（TIMEOUT/RATE_LIMIT/PROVIDER_ERROR） |
| 软成本预算告警 | `monthlyBudgetUsd` 80%/100% warn |
| 反馈限流 | `FEEDBACK_RATE_LIMIT` 10 次/小时 |
| 操作审计 | `graph_versions`（保存可回滚 + run 审计）+ `audit_log` |
| 密钥三层 + 轮换 | `design-key-rotation.md`（已实施） |
| 日志落盘 + 请求日志 | `design-logging.md`（已实施） |
| 最小权限 + 备份 + RBAC + SSRF + 静态加密 | 已落地（见 handoff 安全基线） |

### 6.2 缺口（按致命程度排序，全部登记 [deferred-items.md](deferred-items.md)）

| 优先级 | 缺口 | 为什么对 AI 产品致命 |
|---|---|---|
| **P0** | **成本硬熔断** | 现在只有 warn 不拦截，超预算照烧；死循环产线/被攻破账号/恶意刷量可致账单爆炸 |
| **P0** | **错误追踪（Sentry 类）** | 生产 bug 只能 grep 日志，无未捕获异常聚合/告警 |
| **P0** | **回滚机制** | 回退靠手速记忆，无版本化 release + 一键回退 |
| **P1** | **全局限流 + 防滥用** | 现仅 feedback 有限流；登录爆破/注册滥用/API 滥用无防护 |
| **P1** | **HTTPS/TLS** | M3 对外（域名+公网）必须 |
| **P1** | **供应链安全** | npm audit + Dependabot + gitleaks 密钥泄露扫描未做 |
| **P2** | IaC / E2E 测试 / 链路追踪 / 压测 | 规模化才要 |

**P0 三块是「出事能否快速止损」的关键，比加监控看板更实在。**

---

## 7. 相关文档

- [environments.md](environments.md) —— 环境划分（本路线的前提）
- [design-logging.md](design-logging.md) —— 服务端日志（本路线日志层承接）
- [design-key-rotation.md](design-key-rotation.md) + [runbooks/key-rotation.md](runbooks/key-rotation.md) —— 密钥轮换（本路线密钥层承接）
- [design-monetization.md](design-monetization.md) —— 商业化（成本硬熔断与订阅 gate 同批评估）
- [deferred-items.md](deferred-items.md) —— 本节缺口均登记于此（带触发条件）
- [runbooks/deploy-ubuntu-server.md](runbooks/deploy-ubuntu-server.md) —— 当前 M0 部署形态
