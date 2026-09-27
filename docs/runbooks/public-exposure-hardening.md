# 公网暴露加固清单（Public Exposure Hardening）

> **用途**：把 agent-world 从「内网 / 单机自托管」推到「公网可达」之前，逐项过一遍的**发布前闸门**。
> **触发**：服务端口对公网或不可信网络可达；转对外 SaaS；有别人数据入库（任一即适用）。
> **不做什么**：不改任何默认值。`/metrics` 与 `BIND_HOST` 的默认保持开放/全网卡，是**已记录的运维取舍**（见 §0），本文只负责把「暴露前要拧的旋钮」列全。

## 0. 已记录的默认值决定（刻意不改默认）

| 项 | 当前默认 | 为什么不改默认 | 改的时机 |
|---|---|---|---|
| `METRICS_TOKEN` | 不设 = `/metrics` 无鉴权开放 | 内网单机的 Prometheus 直接抓；改默认会打断现有 LAN 直连部署 | 服务端口对不可信网络可达时设 token，或改 `BIND_HOST`（见 §2） |
| `BIND_HOST` | 不设 = 监听所有网卡 | 与历史行为一致；LAN 直连部署依赖它 | 只由本机反代访问时设 `127.0.0.1`（见 §2） |
| `ERROR_REPORT_WEBHOOK_URL` | 不设 = 错误只进内存环形缓冲 + `/api/admin/errors` | 接哪个告警平台是运维决定，仓内无默认消费端 | 暴露前至少接一个（见 §5） |

> 生产（`NODE_ENV=production`）未设 `METRICS_TOKEN` 时**启动会 warn**（`index.ts`），把默认变成一次显式取舍而非静默。决策详情见 [deferred-items.md](../deferred-items.md) 安全线的 `/metrics` 行与 [mvp-readiness-review-2026-09-25.md §10.3](../mvp-readiness-review-2026-09-25.md)。

---

## 1. 网络层（先做这一层，否则下面都白拧）

- [ ] **只暴露 80 / 443**：server 端口（默认 8791）不直接对公网开。有云安全组就只放行 80/443；本机再加 `ufw`：
      ```bash
      sudo ufw default deny incoming
      sudo ufw allow 22/tcp      # 改成你的 SSH 端口/来源
      sudo ufw allow 80,443/tcp
      sudo ufw enable
      sudo ufw status verbose
      ```
- [ ] **server 只监听回环**（nginx 是唯一入口时）：`.env` 或 systemd override 设 `BIND_HOST=127.0.0.1`；
      **LAN 直连的部署不要设**（会打断现有访问，也是这条默认没改的原因）。
- [ ] **TLS**：nginx 上证书（certbot），把 80 跳转到 443。做法见 [deploy-ubuntu-server.md](deploy-ubuntu-server.md) §五/§四之四。
- [ ] **上 TLS 后同步打开 Secure cookie**：设 `NODE_ENV=production`（或显式 `SECURE_COOKIES=1`），并**删掉**为了内网明文 HTTP 而写的 `SECURE_COOKIES=0` 覆盖行——它是显式覆盖，会一直压着 `Secure`。
- [ ] **同源**：web 与 `/api` 都走同一个 nginx origin，`CORS_ORIGINS` 留空。确需跨源才放开到具体域名，不要用 `*`。

## 2. 端点与鉴权

- [ ] **`/metrics` 收口**（二选一）：
      - 设 `METRICS_TOKEN=<强随机>`，抓取端带 `Authorization: Bearer <token>`（401 会回 `WWW-Authenticate`）；
      - 或 `BIND_HOST=127.0.0.1`，只让本机反代可达（此时若 nginx 仍代理 `/metrics`，反代层要自己加访问控制）。
- [ ] **注册入口**：默认已关自注册。确需开放才设 `ALLOW_REGISTRATION=1`；否则保持关闭，账号由 owner 用 `POST /api/admin/users` 开（见 §4）。
- [ ] **演示账号**：确认 `ALLOW_DEMO` 是否要开。开则同时确认 demo 额度/TTL（`DEMO_*`）与限流符合预期，避免免注册入口被刷。
- [ ] **计费闸门**：按需 `MONETIZATION_ENFORCE`（取值与覆盖面见 [deploy-ubuntu-server.md](deploy-ubuntu-server.md) §四之二，注意它只认 `MONETIZATION_ENFORCE` 一个变量名）。
- [ ] **生产禁用假模型**：确认 `WORKER` 未设成 `fake`——生产里它会让每条 run 都「done」但内容是编造的（代码已在生产拒启，仍建议显式确认一次）。

## 3. 数据、进程与出站

- [ ] **代码沙箱硬隔离**：Linux 上设 `CODE_SANDBOX=bwrap`（装好 bubblewrap），否则 code 节点的 fs/net 隔离是 best-effort。
- [ ] **内网逃生口保持关闭**：确认 `ALLOW_PRIVATE_NETWORK` 未设。放开等于对 http 节点 / `/api/proxy` / 连接器出站全部对内网开门，也包含远程 MCP。
- [ ] **文件权限**：`.env` 600；数据目录下 `.jwt-secret` / `.encryption-keys` 0600，且**随备份一起带在带外**（丢了密钥 = 加密字段永久锁死）。
- [ ] **备份**：周期备份并**异地/带外**留存；用仓库脚本做一次真实恢复演练（`scripts/restore-agent-world.sh`），确认「备份 + 密钥 + 数据」真能还原。缺密钥的备份脚本会告警，不要当作通过。
- [ ] **密钥轮换**：确认 JWT / 加密密钥轮换流程可用（[runbooks/key-rotation.md](key-rotation.md)），并把轮换列入例行。

## 4. 账号与口令

- [ ] **没有自助找回口令**：仓内无「忘记密码」链路（重置令牌/邮箱验证都没有）。口令丢失时由 owner 用服务端 CLI 重置：
      ```bash
      DB_FILE=/var/lib/agent-world/agent-world.sqlite \
      pnpm --filter @agent-world/server reset:password -- --email=<用户邮箱>
      ```
      命令生成一次性口令、打印一次，并强制该用户**下次登录改密**（`must_change_password=1`）。口令不经命令行传入（避免进 shell history / `ps`），需要固定值才用 `--password=`。
- [ ] **通知：SMTP 只用于 notify 节点**。仓库里的 SMTP（nodemailer）是**出站通知节点**用的（`SMTP_HOST/SMTP_USER/SMTP_PASS`），**不是账号邮件通道**——开号口令仍要 owner 带外转交。
- [ ] **重置不等于下线会话**：CLI 只改口令哈希，不撤销已签发的 JWT（无状态、最长 7 天）。怀疑会话被窃时，除了重置口令，还需**轮换 `JWT_SECRET` 并重启**才能把已发出的会话清掉。

## 5. 可观测与告警

- [ ] **接一个错误出口**：设 `ERROR_REPORT_WEBHOOK_URL`（零依赖 webhook sink），或照 [runbooks/error-reporting.md](error-reporting.md) 起 relay 对接 Sentry/Loki/飞书等。接完跑一次自检：
      ```bash
      pnpm --filter @agent-world/server run selftest:errorsink -- <url>
      ```
- [ ] **健康探针**：对 `/api/health` 配外部探活 + 掉线告警（Uptime Kuma 极轻）。
- [ ] **审计**：owner/admin 可通过 `GET /api/audit`（跨用户）核对登录/开号/password 等动作。

## 6. 暴露前验收（从公网一侧实跑）

```bash
# 1) 服务端口不应从公网可达（应 connection refused / timeout）
curl -sS --max-time 5 http://<公网IP>:8791/api/health || echo "OK: 8791 不可达"

# 2) 走域名应是 HTTPS，且 HTTP 跳转到 HTTPS
curl -sSI http://<域名>/ | grep -iE '^location|^HTTP'
curl -sS https://<域名>/api/health

# 3) /metrics：设了 token 应 401；用 token 应 200
curl -sS -o /dev/null -w '%{http_code}\n' https://<域名>/metrics          # 无 token → 401
curl -sS -H "Authorization: Bearer <METRICS_TOKEN>" https://<域名>/metrics | head -1

# 4) 登录 cookie 带 Secure（上 TLS 后）
curl -sSI -X POST https://<域名>/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"...","password":"..."}' | grep -i 'set-cookie'
```

## 7. 已知接受的风险（暴露前务必处理）

- **明文 sudo 口令在公开 git 历史里**：仓库公开、多 mirror，改写历史无效。暴露前**必须轮换**那台机器的口令；完整失效条件见 [mvp-readiness-review-2026-09-25.md §9.6](../mvp-readiness-review-2026-09-25.md)。
- **限流是进程内、单实例**：多实例/多副本部署前需换成共享限流（当前单机型无碍）。
- **webhook / 触发器派发口未限速**：对外暴露 webhook/触发器端点前应先补限速（见 [deferred-items.md](../deferred-items.md) 派发口行）。

## 8. 相关文档

- [runbooks/deploy-ubuntu-server.md](deploy-ubuntu-server.md) — 部署与 nginx/TLS/环境变量细节
- [runbooks/error-reporting.md](error-reporting.md) — 错误追踪与告警接法
- [runbooks/key-rotation.md](key-rotation.md) — 密钥轮换
- [production-ops.md](../production-ops.md) — 运维与可观测性全景（§5 可观测性栈、§6 缺口）
- [deferred-items.md](../deferred-items.md) — 各项缓做的触发条件（安全线 + 生产运维线）
- [mvp-readiness-review-2026-09-25.md](../mvp-readiness-review-2026-09-25.md) §10.3 — 公网暴露仍存的硬化项
