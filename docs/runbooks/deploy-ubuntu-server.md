# Ubuntu 单机部署手册（agent-world）

> 面向**纯 Server 无 GUI 的 Ubuntu**（实测 Ubuntu 24.04 LTS），目标：把 agent-world 跑成一台局域网可访问的**单机服务**（server API + web UI），用于商业化 P0/P1 本地测试。
>
> 适用部署形态：单机单进程（项目设计假设）。不涉及 Docker（仓库 `Dockerfile` 只含 server、不含 web，且 H4 的 bwrap 沙箱在容器里更麻烦）。

## 架构

```
浏览器 (局域网) ──► nginx :80 ──► /apps/web/dist  (静态 SPA)
                         │
                         └──► /api/* 反代 ──► server :8791 (node dist/index.js, systemd)
```

web 与 API **同源**（都由 nginx 提供），因此不需要跨域（`CORS_ORIGINS` 留空用 server 的本地默认）。

## 目录约定

| 路径 | 内容 |
|---|---|
| `/opt/agent-world` | 代码（git clone 或 rsync） |
| `/var/lib/agent-world/` | 数据（`agent-world.sqlite`、`artifacts/`、`logs/`、`.jwt-secret`、`.encryption-keys`、`tessdata/`） |
| `/etc/systemd/system/agent-world.service` | systemd unit |
| `/etc/nginx/sites-available/agent-world` | nginx site |

用**非 root 系统用户** `agentworld` 跑服务。

> **最小权限原则**：服务进程绝不用 root 或管理员账号跑，否则一旦被攻破即全线失守。`agentworld` 是为此创建的专用系统用户，与管理员账号分工如下：

| 用户 | UID | 用途 | 能登录 | 有 sudo |
|---|---|---|---|---|
| `<server-user>`（管理员） | 1000 | 登录 / 运维 / sudo 管理 | ✅ | ✅ |
| `agentworld`（服务） | 998 | 只跑 server + 写数据目录 | ❌ nologin | ❌ |

创建命令 `sudo useradd --system --home /var/lib/agent-world --shell /usr/sbin/nologin agentworld` 拆解：
- `--system`：系统用户，UID < 1000（实际 998），非登录账号
- `--home /var/lib/agent-world`：home 直接指向数据目录
- `--shell /usr/sbin/nologin`：禁用登录，防止被 SSH/终端登录

配合 §四 systemd 三重限制：`User=agentworld`（进程以它身份运行）+ `ProtectSystem=strict` + `ReadWritePaths=/var/lib/agent-world`（整个文件系统只读、唯一可写处是数据目录）+ `NoNewPrivileges=true`（禁提权）。效果：即使服务被攻破，影响也被锁死在数据目录内，拿不到 root、动不了系统其余部分。

---

## 一、装运行时

```bash
# Node 24 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证
node -v        # v24.x（项目要求 >=24）
corepack enable

# pnpm 用 corepack 管理的固定版本（见 packageManager），无需另装

# bubblewrap（可选但推荐：给 code 节点的 Python 沙箱硬隔离，关掉审计 H4）
sudo apt-get install -y bubblewrap

# nginx（托管 web + 反代 API）
sudo apt-get install -y nginx
```

> 换镜像源可加速：`sudo sed -i 's|//archive.ubuntu.com|//mirrors.aliyun.com|g' /etc/apt/sources.list.d/*.sources 2>/dev/null || true`（按需）。

## 二、放代码 + 装依赖 + 构建

```bash
# 系统用户 + 目录
sudo useradd --system --home /var/lib/agent-world --shell /usr/sbin/nologin agentworld
sudo mkdir -p /opt/agent-world /var/lib/agent-world
sudo chown -R agentworld:agentworld /opt/agent-world /var/lib/agent-world

# 方式 A：git clone（推荐，方便后续 pull）
cd /opt/agent-world
sudo -u agentworld git clone <你的私有仓库> .

# 方式 B：从开发机 rsync（不上 git 时）
# rsync -av --exclude node_modules --exclude dist /path/to/agent-world/ agentworld@<server>:/opt/agent-world/

# 依赖 + 全量构建（core/server/web 一起）
cd /opt/agent-world
sudo -u agentworld bash -c 'corepack pnpm install --frozen-lockfile && corepack pnpm -r build'
```

> `--frozen-lockfile` 要求锁文件与代码一致；本地改过依赖时去掉该参数。

## 三、配置 `.env`（仓库根）

server 启动时从仓库根 `.env`（`/opt/agent-world/.env`）自动加载（`load-env.ts`）。先 `git check-ignore .env` 确认被 gitignore（未被跟踪）。

```bash
sudo -u agentworld tee /opt/agent-world/.env >/dev/null <<'EOF'
# ---- 路径 / 端口 ----
DB_FILE=/var/lib/agent-world/agent-world.sqlite
LOG_FILE=/var/lib/agent-world/logs/server.log
# PORT 默认 8791，局域网测试可不改；要改就放开下行
# PORT=8791

# ---- 沙箱：Linux 上切 bwrap 硬隔离（H4 关闭）----
# 前提：第一节装好了 bubblewrap。装好后 code 节点的 Python 才真正断网/锁文件系统。
CODE_SANDBOX=bwrap

# ---- 账号：本地商业化测试要允许注册 ----
ALLOW_REGISTRATION=1
# 演示用户（免注册一键体验）默认关闭；要开放登录页「先体验演示」入口就置 1。
# 与 MONETIZATION_ENFORCE=1 可共存：demo 走独立 30k token 池，不被 free 层 token=0 拦截。
# ALLOW_DEMO=1
# 可选覆盖（不设即用默认：30000 token / 15 次运行 / 并发 1 / 20MB / TTL 24h / 每 IP 每小时 10 次）
# DEMO_QUOTA_TOKENS=30000
# DEMO_QUOTA_MAX_RUNS=15
# DEMO_QUOTA_STORAGE_MB=20
# DEMO_TTL_HOURS=24
# DEMO_RATE_LIMIT=10
# 若用独立域名/IP 直连（非 nginx 同源），放开并按需加来源：
# CORS_ORIGINS=http://<你的局域网IP>:80

# ---- Provider 凭证（按你的实际配置填）----
# AGNES_API_KEY=...
# OPENAI_API_KEY=...

# ---- 其它可选 ----
# JWT_SECRET=<不设则由首次启动自动生成 .jwt-secret 到 DB 同目录>
# ALLOW_PRIVATE_NETWORK=0
EOF
sudo chmod 600 /opt/agent-world/.env   # .env 含密钥，收紧权限
```

**验证 DB/密钥生成**：首次启动 server 后，`/var/lib/agent-world/` 下应出现 `agent-world.sqlite`、`.jwt-secret`、`.encryption-keys`（0600）。

## 四、systemd 托管 server

```bash
sudo tee /etc/systemd/system/agent-world.service >/dev/null <<'EOF'
[Unit]
Description=Agent World server
After=network.target

[Service]
User=agentworld
Group=agentworld
# 关键：cwd 必须是 packages/server（DB 相对路径与 tsx 约定基于此）
WorkingDirectory=/opt/agent-world/packages/server
ExecStart=/usr/bin/node /opt/agent-world/packages/server/dist/index.js
# .env 由 load-env.ts 自动从仓库根加载，unit 里只放路径类覆盖
Environment=DB_FILE=/var/lib/agent-world/agent-world.sqlite
Environment=CODE_SANDBOX=bwrap
Restart=always
RestartSec=3
# 资源保护
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/agent-world
# PrivateTmp 必须：ProtectSystem=strict 使服务器进程的 /tmp 只读，
# code 节点的 createCodeWorkdir() 在服务器进程内 mkdtemp 会报
# EROFS。PrivateTmp=true 为服务创建可写的私有 /tmp 挂载点。
PrivateTmp=true
# 日志走 journald（也落 LOG_FILE 一份）
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now agent-world
sudo systemctl status agent-world --no-pager

# 冒烟：API 起来没
curl -s http://127.0.0.1:8791/api/health || echo "看下日志: journalctl -u agent-world -n 50"
```

> `ProtectSystem=strict` + `ReadWritePaths=/var/lib/agent-world` 会把文件系统限制在数据目录——正好和 fs-guard / bwrap 的策略一致，别把其它路径写进 unit。**必须同时配 `PrivateTmp=true`**：否则服务器进程的 /tmp 只读，code 节点的 `createCodeWorkdir()` 会报 EROFS 导致所有 code 节点失败。

### 四之一、演示用户（可选，design-demo-user）

演示用户默认**关闭**。迁移 v40 随服务首次启动自动给 `users` 表加 `is_demo / demo_expires_at`（只加带默认值/可空列，回滚只清标记不删列，安全；升级前按第六节做一次 sqlite 备份即可）。

**开启（用 systemd override，不改主 unit）**：

```bash
sudo systemctl edit agent-world
# 在打开的 override.conf 里加：
#   [Service]
#   Environment=ALLOW_DEMO=1
sudo systemctl daemon-reload && sudo systemctl restart agent-world
# 验证：未带 cookie 调 demo 端点应返回 201（关闭时是 403 DEMO_DISABLED）
curl -s -X POST http://127.0.0.1:8791/api/auth/demo
```

> 与 `MONETIZATION_ENFORCE=1` 共存无冲突：正式用户走订阅 gate，demo 始终走独立的 `enforceDemoQuota`（自带 30k token 池，因此 free 层 `tokens=0` 不会把 demo 的第一次文本运行拦掉——这是最容易踩的坑）。

**定时清理过期 demo（脚本默认 dry-run 只列不删，`--apply` 才真删；只删 `is_demo=1 且 demo_expires_at < now`，已转正账号 is_demo=0 天然不入选）**。脚本与其它运维脚本一样用 tsx 跑（不进 `dist/`，对应 `pnpm --filter @agent-world/server prune:demo`）。用 cron（agentworld 身份）：

```bash
sudo -u agentworld crontab -e
# 每小时第 17 分清理一次过期演示账号及其级联数据
17 * * * * DB_FILE=/var/lib/agent-world/agent-world.sqlite /opt/agent-world/node_modules/.bin/tsx /opt/agent-world/packages/server/scripts/prune-demo-users.ts --apply >> /var/lib/agent-world/logs/prune-demo.log 2>&1
```

先手动跑一次 dry-run 确认范围（不加 `--apply` 只列不删）：

```bash
cd /opt/agent-world
sudo -u agentworld DB_FILE=/var/lib/agent-world/agent-world.sqlite \
  pnpm --filter @agent-world/server prune:demo
```

> 若生产用 `pnpm install --prod` 没装 tsx（devDependency），cron 行可改为先 `cd /opt/agent-world/packages/server` 再用仓库根 `.bin/tsx`；该 bin 随 workspace 依赖安装存在。

### 四之二、订阅 gate 开关（`MONETIZATION_ENFORCE`）与它真实的覆盖面

**当前状态**：Hasee 自 2026-09-14/15 起为 **开**（systemd override 里 `Environment=MONETIZATION_ENFORCE=1`，owner 已升 pro；PR #302 部署后同一 override 另加 `ALLOW_DEMO=1`）。

**关闭（紧急回滚，不需回滚代码）**：

```bash
sudo systemctl edit agent-world        # 删掉 Environment=MONETIZATION_ENFORCE=1 那一行
sudo systemctl daemon-reload && sudo systemctl restart agent-world
# 验证真的关了（而不是以为关了）：拿一个 free 层账号跑内置模型产线
#   开着 → 402 {"error":"subscription","metric":"builtin_model"}
#   关掉 → 不再是 402
#
# 402 体的 code 就是「为什么被拦」，排障时按它分流：
#   QUOTA_EXCEEDED        额度/套餐本身不含该项（含 free 层用内置模型）
#   PAYMENT_REQUIRED      订阅欠费（past_due）→ 前端引导「更新支付方式」
#   SUBSCRIPTION_ENDED    订阅已到期取消 → 前端引导「重新订阅」
#   CONCURRENCY_EXCEEDED  并发槽满（注意 halted run 也算，见下）
```

> ⚠️ 变量名只有一个：`MONETIZATION_ENFORCE`。取值 `1`/`true`/`yes` = 硬拦，`observe`/`log` = 只记日志不拦，空/不设置 = 关。**其它非空值等于关**，但会在日志里打出 `unrecognized value` 并把你写的那个值带上（2026-09-25 之前是 `=== "1"` 严格相等，写 `true` 会静默不生效）。design-monetization-m2-implementation.md 第五节曾把回滚手段写成另一个名字（`ENABLE_SUBSCRIPTION_GATE`），**代码里从来没有这个变量**，已更正；事故时照那个名字去找会以为 gate 已关而它其实还在拦。

**覆盖面（2026-09-25 更新：gate 已从路由移进 `startRun()`，全部派发口一并生效）**

此前闸门挂在 `POST /api/runs` 的 handler 里，5 个 `startRun` 调用点只有 1 个被拦，另有两条**直连 `db.createRun`** 的路由连那个计数都不在里面。现在判定收在 `packages/server/src/dispatch-gate.ts`，由 `startRun()` 在建 run 行**之前**调用（同址先例是 `run.ts` 的月度预算硬熔断）。

| 派发口 | 位置 | 现状 |
|---|---|---|
| 手动派发 `POST /api/runs` | `run.ts` 的 `startRun()` | ✅ |
| 重跑 `POST /api/runs/:id/rerun` | 经 `startRun` | ✅（此前绕过） |
| 批量 / 批量重试 | `batch.ts` 的 `runBatch()`、`/api/batches/:id/items/:itemId/retry` | ✅ 超额条目记 failed；重试路由此前连 try 都没有，配额拦截会被当成 500 |
| cron / webhook / 事件触发器（**M1 四条回采产线**） | `index.ts` 注入给 `TriggerService` 的 `startRun` 适配函数 → `triggers.ts` 的 `fire()` / `fireWebhook()` | ✅（此前绕过）。HTTP 触发回 402；cron tick 被拦则走 `TriggerScheduler.onError` 记 error 日志，**不建 run 行** |
| AB 实验 | `ab.ts` 的 `startABExperiment()` | ✅ 按「一次实验」判一次（放进循环会让 A 组自己的活跃 run 把 B 组按并发超额拦掉） |
| 从 run 分叉 fork | `run.ts` 的 `forkRun()` | ✅ |
| MCP 客户端派发 | `packages/mcp-server` → HTTP `POST /api/runs` | ✅ 走的就是被拦那条路 |
| **继续一个 halted/failed 的 run** | `/api/runs/:id/resume`、`/api/reviews/decide` → `resumeRun()` | ❌ **有意不拦**：一个已经被放行的 run 不该在人工审批之后因配额变化被掐死。它仍会照常计费并计入 token 用量 |

守护：`dispatch-gate.test.ts` 会扫源码，任何**新建**「自己调 `db.createRun(` 却不引用 `dispatchGate`」的文件直接判红（已用植入的 rogue 文件验证过它能失败）。

**打开硬拦之前先跑 observe**（这就是 m2 手册第 6 步「先灰度观察计量是否准确」该有的样子）：

```bash
sudo systemctl edit agent-world        # Environment=MONETIZATION_ENFORCE=observe
sudo systemctl daemon-reload && sudo systemctl restart agent-world
# 观察窗口内只看这一条，它会点名是哪条派发路、哪个 metric、used/limit 多少：
journalctl -u agent-world --since "24 hours ago" | grep "would block dispatch"
```

看什么：**M1 四条回采产线有没有出现 `would block`**。它们过去十几天完全不受配额约束，硬拦一开就第一次受 pro 的 2,000,000 折算 token/月管——出现 `metric:"tokens"` 就说明会在业务时段断供，得先加配额或降频，再改回 `1`。

两条仍然成立的运维含义：

1. **免费层的并发仍会被「无人审批的 halted run」长期占住**：`activeRuns` 口径是 `status IN ('running','halted')` 且**无时间上限**，启动回收只清 `running`（启动时调 `markZombiesInterrupted`）。开发库实测 7 个 23–28 天前的 halted run，一个账号占 6 个——free 层 `concurrentRuns=1`，这类账号每次派发都 402「并发上限已满」，唯一自救是去取消旧 run。**覆盖面补齐后这条更容易撞上**（触发器路径也开始数并发）。
2. **欠费判定已生效**（`past_due` 即断内置模型、BYOK 不受影响；`canceled` 到 `current_period_end` 才断）。§6.4 的「宽限期 3-7 天」未实现——表里没有「状态何时变更」的列，`updated_at` 会被无关写入顶掉，拿它算宽限会得到会说谎的窗口（见 deferred-items）。

`past_due` / `canceled` 的判定见上一条第 2 点（`bb50612` 起已生效）。§6.4 写的「宽限期 3-7 天」**未实现**——`subscriptions` 没有「状态何时变更」的列，`updated_at` 会被 checkout 镜像与 `setPlan` 等无关写入顶掉，拿它算宽限会得到一个会说谎的窗口；需先加 `status_changed_at`（迁移），已登记 [deferred-items](../deferred-items.md)。当前口径是「欠费即断、`invoice.paid` 一到自动恢复」，比设计更严一点。

### 四之三、升级须知：有两道闸会改变既有部署的行为

| 变化 | 症状 | 处置 |
| --- | --- | --- |
| 远程 MCP（`http` / `sse`）的四处出站请求自 PR #429 起走本仓自己的 SSRF 闸（`mcp.ts` → `guardedFetch`） | 指向 `127.0.0.1` / 局域网的 MCP 服务从「能连」变成被拒，报错里是 `internal-target` | 要么把那个 MCP 服务挪到公网可达地址（或加反代），要么显式 `ALLOW_PRIVATE_NETWORK=1`。**注意这道闸不只管 MCP**：http 节点、`/api/proxy`、连接器出站都受影响，放行等于全部对内网开门 |
| `WORKER=fake` 在生产直接拒绝启动（`assertBootWorkerEnv`，启动自检段） | `systemctl restart` 后服务起不来，异常文本 `WORKER=fake is not allowed in production` | 从 `/opt/agent-world/.env` 里删掉这一行。它只该出现在 demo / 测试环境；留着的效果是**每条 run 编造文本还报 `done`**，成本报表与产物全是假的 |

两条都是**响亮失败**而不是静默降级——这一轮安全与计量收口要的就是这个形状。升级后确认服务起来了：`curl -s http://192.168.31.14/api/health`（`ok:true` 且 `providers` 就绪），再看 `journalctl -u agent-world -b --no-pager | grep -i "fake\|failover"`：`WORKER=fake is set` 这条 warn 在非生产是允许的，出现在生产说明上面那条没做完。

> 上面第 2 条（`WORKER=fake` 拒启）**只在 `NODE_ENV=production` 时才成立**。这台机器目前没设，见下一节。

### 四之四、`NODE_ENV=production` —— 不设，这台机器就自认开发机

第四节的 unit 只写了两行 `Environment=`（`DB_FILE` / `CODE_SANDBOX`），按本节流程新装的机器上 `NODE_ENV` 与 `AGENT_WORLD_ENV` 都不存在，于是 `/api/health` 的 `env` 字段回落到 `"development"`（`packages/server/src/index.ts:401`：`AGENT_WORLD_ENV ?? NODE_ENV ?? "development"`）。**全仓按生产分支走的行为一共四处**（grep `=== "production"` 实测，只有这四处，所以设它不会动调度、计费、沙箱或日志级别），两者都不设时**全部休眠**：

**先读，别照抄结论**——`env` 字段是 `AGENT_WORLD_ENV` 优先，所以它报什么**并不能**证明 `NODE_ENV` 是什么。Hasee 实测报 `env:staging`，这只说明「`AGENT_WORLD_ENV=staging`」与「`AGENT_WORLD_ENV` 未设且 `NODE_ENV=staging`」**两种里的一种**，两者都推不出 `NODE_ENV=production`，也排除不了它（要判定只有下面两条路）。

```bash
# a) 直接读运行时 env（systemd 侧 + .env 侧都看）
systemctl show -p Environment,EnvironmentFiles agent-world | tr ' ' '\n' | grep -E '^(NODE_ENV|AGENT_WORLD_ENV|SECURE_COOKIES)='
grep -nE '^(NODE_ENV|AGENT_WORLD_ENV|SECURE_COOKIES|WORKER)=' /opt/agent-world/.env
# b) 反证（只在 a 读不到时用）：这三条 warn/异常里出现过任意一条，就证明 NODE_ENV 确实是 production
journalctl -u agent-world --since -30d --no-pager \
  | grep -iE "not allowed in production|no error sink configured in production|GET /metrics is unauthenticated"
# 注意反证是不对称的：没搜到 **不能**证明 NODE_ENV 没设——后两条是 warn，
# 已设 METRICS_TOKEN / ERROR_REPORT_WEBHOOK_URL 时它们本来就不该出现。
```

| 行为 | 代码 | 不设的后果 |
| --- | --- | --- |
| `WORKER=fake` 启动即抛 | `providers/index.ts:49` | 那台机器可以带着 `WORKER=fake` 一直跑：每条 run 编造文本还报 `done`，成本报表与产物全是假的（即四之三第 2 条，此刻并不成立） |
| 没接错误 sink 时启动 warn | `errors.ts:67` | 未捕获异常只留在进程内环形缓冲，随进程一起消失，且没有任何一句提醒 |
| `/metrics` 未设 token 时启动 warn | `index.ts:208` | 指标端点（run 数、失败数、**按模型累计的成本**）对任何摸得到端口的人开着，日志里也没这句话 |
| session cookie 加 `Secure` | `routes/shared.ts:29-34`（`secureCookiesEnabled`） | 上了 HTTPS 之后 cookie 仍可被明文 HTTP 送出 |

**⚠️ 设之前先决定 cookie 怎么办**——这是本节唯一会真的咬人的地方。`Secure` 是按**请求的 Host 头**判的，只豁免 `localhost` / `127.0.0.1` / `[::1]`（`routes/shared.ts:36-44`）。Hasee 现在是从局域网用 `http://192.168.31.14` 访问的，所以 `NODE_ENV=production` 一设，登录返回的 `Set-Cookie` 就带上 `Secure`，而浏览器在 http 非回环源上会直接丢掉这个 cookie。**症状是「点登录说成功，回到页面还是未登录」，而服务端日志一行错误都没有**（`routes/shared.ts:30-34`：`SECURE_COOKIES` 显式设了就优先，不再看 `NODE_ENV`）。三选一：

1. **先上 HTTPS 再设**：第五节那份 nginx site 现在只有 `listen 80`，**本 runbook 没有证书流程**（公网暴露时才补：加 443 + 证书 + `server_name`，并把 80 改成跳转）；
2. **暂时只在内网明文 HTTP 跑**：同时写 `Environment=SECURE_COOKIES=0` 显式压掉，等上了 TLS 再删这一行；
3. **只从 `http://localhost` 访问**：回环豁免，什么都不用做。

设置（与 `MONETIZATION_ENFORCE` / `ALLOW_DEMO` 同一手法，用 override 不动主 unit）：

```bash
# 0) 前置：先看现在报什么，以及有没有踩到四之三那条
curl -s http://127.0.0.1:8791/api/health | grep -o '"env":"[^"]*"'
grep -n '^WORKER=' /opt/agent-world/.env        # 有输出就先删掉那行

# 1) 写 override
sudo systemctl edit agent-world
#   [Service]
#   Environment=NODE_ENV=production
#   Environment=SECURE_COOKIES=0     # 只有选上面第 2 条时才加
sudo systemctl daemon-reload && sudo systemctl restart agent-world

# 2) 验 env 字段真的翻了
curl -s http://127.0.0.1:8791/api/health | grep -o '"env":"[^"]*"'

# 3) 验 cookie 没被打断（必须走浏览器，走的是那个局域网地址）
#    用 http://192.168.31.14 登录 → 刷新 → 仍应是登录态；
#    掉线就是第 2 步的 SECURE_COOKIES=0 没加（或没生效）。
```

三点容易记错的：

- `AGENT_WORLD_ENV=production` 只点亮上面**前三**条，**不会**给 cookie 加 `Secure`（`routes/shared.ts:34` 只看 `NODE_ENV`）。要让四条一致就用 `NODE_ENV`。
- **`staging` 不算生产**：那四条是字符串等于 `"production"` 才成立，所以报 `env:staging` 的那台机器（Hasee 就是）在四项上与没设一样——**不管是 `AGENT_WORLD_ENV=staging` 还是 `NODE_ENV=staging`，结论相同**，这也是为什么上面那条推断可以只读 `env` 字段就下。
- 上了 TLS 之后要**删掉** `SECURE_COOKIES=0`：它是显式覆盖，会一直压着 `Secure`，比不设更容易漏。

**2026-10-04 复测（SSH 只读，无 sudo）**：`/api/health` = `ok:true / env:"staging" / branch:dev / commit:2e82187 / providers.agnes:configured`；**单实例这一半就此量到并成立**——`ps` 里 `dist/index.js` 恰好 1 个进程（PID 58950，当时已跑 4h45m），`:8791` 只有 1 个监听 socket。

**a) 的 systemd 那一半也不用 root**：`systemctl show -p Environment,EnvironmentFiles agent-world` 经 D-Bus 读的是 manager 里的 unit 属性，普通用户就能读（正控制：`DB_FILE`/`CODE_SANDBOX` 都出得来）。Hasee 实测这条读数里**既没有 `NODE_ENV` 也没有 `AGENT_WORLD_ENV`，也没有 `SECURE_COOKIES`/`WORKER`** ⇒ 健康端点那个 `staging` 只可能来自 `/opt/agent-world/.env`（`index.ts:14` 先 `import "./load-env.js"`，`.env` 本身是 root 私有）。所以本节剩下的未知只有一个文件、一行：

```bash
sudo grep -nE '^(NODE_ENV|AGENT_WORLD_ENV|SECURE_COOKIES)=' /opt/agent-world/.env
```

**⚠️ 同一条读数暴露了一件该修的事**：`Environment=` 写的密钥会**原样出现在这个可被普通用户读到的属性里**——`agnes.conf` 文件权限 600 守的是「谁能 open 那个文件」，管不到 bus 上的属性。凭据请改走 `EnvironmentFile=` 或 `LoadCredential=`/`LoadCredentialEncrypted=`（后者把凭据放进服务私有的 tmpfs，进程按 `$CREDENTIALS_DIRECTORY` 读）；**这两条都没在这台机上实测过**，所以别把「用了哪个指令」当通过判据，改完用这条可伪的读数验收：

```bash
systemctl show -p Environment agent-world | grep -c AGNES   # 必须是 0
```

顺带一句取证纪律：读 unit env 时**先把要看的 key 过滤掉再打印**（`| tr ' ' '\n' | grep -E '^(NODE_ENV|...)='`），不要 `systemctl show` 整条倒出来——本项目就在复测途中把一把 provider key 的值倒进了终端。

### 四之五、给第二个人开账号（自注册默认是关的）

首个账号 bootstrap 成 owner 之后，`POST /api/auth/register` 就对后面的人关闭了（`index.ts:558`）——这是对的：不关的话，任何摸得到端口的人都能建号并花你的模型预算。**别为了拉一个人就打开 `ALLOW_REGISTRATION`**，那是把门对整个网络打开。owner 用自己的界面开：

**路径**：登录 → 右上角「账户」菜单 →「管理」→「用户」tab → 填对方邮箱 →「开通账号」。

系统会生成一次性口令并**只在成功后那一屏显示**（点一下整段选中，直接复制）。把它离线交给对方；对方第一次登录后只会看到一张改密屏，改完才进得去产品——这由服务端强制（`/api/*` 鉴权闸对所有非 `/api/auth/*` 路径回 `403 PASSWORD_CHANGE_REQUIRED`），不是界面提示。

```bash
# 没有浏览器时的等价调用（owner 的 cookie）
curl -s -X POST http://127.0.0.1:8791/api/admin/users \
  -H 'content-type: application/json' -b "auth_token=$OWNER_TOKEN" \
  -d '{"email":"teammate@example.com"}'
# → {"user":{"id":"…","email":"…","role":"user"},"oneTimePassword":"…"}  只出现这一次
```

三件要提前知道的：

- **口令没有送达渠道**：仓内确实有 SMTP（`nodemailer`，`notifier.ts`），但它只服务 notify 节点的**出站**邮件，不是账号邮件通道。所以那一串只能离线交给对方——别把 owner 会话留在共享机器上。`account.provision` 审计行只记邮箱，不记口令。
- **对方忘了口令不是死路，但要人动手**：自助「找回密码」仍然没有（登记在 [deferred-items](../deferred-items.md) 的「账号自助三缺」），但 owner 可以替任何账号重置：

  ```bash
  DB_FILE=/var/lib/agent-world/agent-world.sqlite \
    pnpm --filter @agent-world/server reset:password -- --email=user@example.com
  ```

  它生成一条**新的** 16 字符一次性口令、只打印一次，并**重新挂上 `must_change_password=1`**——也就是重置后又被送回「必须先改密」那道门，和开号时同一份契约（`scripts/reset-password.ts`）。口令默认不经 argv（`ps` 与 shell history 都会漏），`--password=` 只为脚本化流程留，别在交互终端用。
- 新账号是 `role:'user'`。要给它管理员权限是另一件事（同页「设为管理员」），开通时不打包办。

## 五、构建并托管 web（nginx 同源）

```bash
# 构建 SPA（产物在 apps/web/dist）
cd /opt/agent-world
sudo -u agentworld corepack pnpm --filter @agent-world/web build

# nginx site
sudo tee /etc/nginx/sites-available/agent-world >/dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    root /opt/agent-world/apps/web/dist;
    index index.html;

    # Prometheus metrics（必须在 /api/ 和 / 之前，否则被 SPA 兜底返回 text/html）
    # server 端 .env 若设了 METRICS_TOKEN，这里就得带上口令，否则抓取拿到 401：
    #   proxy_set_header Authorization "Bearer <METRICS_TOKEN>";
    location /metrics {
        proxy_pass http://127.0.0.1:8791;
        proxy_set_header Host $host;
    }
    # API 反代到 server（同源，浏览器无需 CORS）
    location /api/ {
        proxy_pass http://127.0.0.1:8791;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;   # SSE / 长请求
        proxy_buffering off;       # SSE 必须关缓冲
    }
    # SSE 也经反代，同样关缓冲
    # 必须用正则匹配（带或不带斜杠都匹配）：用 location /api/runs/ 会导致
    # POST /api/runs（不带斜杠）被 nginx 301 重定向到 /api/runs/，
    # 重定向后 POST 变 GET 导致 404。
    location ~ ^/api/runs/? {
        proxy_pass http://127.0.0.1:8791;
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/agent-world /etc/nginx/sites-enabled/agent-world
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

浏览器访问 `http://<服务器局域网IP>/` 即 UI。**首次打开**：注册账号 → 第一个注册用户自动成为 owner（`ALLOW_REGISTRATION=1` 开启注册）。

> 若只在本机测试（不开 nginx），也可以 `cd apps/web && corepack pnpm preview`，但 vite preview **不代理 `/api`**，仍需在 server 侧配 `CORS_ORIGINS` 直连 `:8791`。推荐直接走 nginx 同源。

## 六、备份（每周 + 每日差异）

```bash
sudo tee /usr/local/bin/backup-agent-world.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SRC=/var/lib/agent-world
DST=/var/backups/agent-world
mkdir -p "$DST"
# 先让 sqlite 一致（触发 checkpoint 后拷文件；机器未装 sqlite3 时用 node:sqlite；checkpoint 失败不中断，rsync 会连 -wal 一起拷）
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$SRC/agent-world.sqlite" 'PRAGMA wal_checkpoint(TRUNCATE);' || echo '[backup] wal_checkpoint failed, continuing'
else
  node -e 'const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[1]); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close()' "$SRC/agent-world.sqlite" || echo '[backup] wal_checkpoint failed, continuing'
fi
rsync -a --delete "$SRC/" "$DST/current/"
# 每日轮转快照（保留 7 份）
ts=$(date +%F)
if [ ! -e "$DST/snap-$ts" ]; then
  cp -al "$DST/current" "$DST/snap-$ts"   # 硬链接快照，省空间
  find "$DST" -maxdepth 1 -name 'snap-*' | sort | head -n -7 | xargs -r rm -rf
fi
EOF
sudo chmod +x /usr/local/bin/backup-agent-world.sh

# cron 每日 02:30
(crontab -l 2>/dev/null; echo "30 2 * * * /usr/local/bin/backup-agent-world.sh") | sudo crontab -
```

> 机器是笔记本：备份比云盘更重要——DB + artifacts + 密钥都在 `/var/lib/agent-world`，整目录备份即可恢复。sqlite 备份用 `VACUUM INTO` 或先 checkpoint 再拷文件，别直接拷热文件。

> **异地备份（已落地 2026-09-10，Mac 端拉取）**：服务器同盘备份仍是机器级故障的唯一兜底；**异地备份由 Mac 每日拉取**（补上 deferred-items「异地备份推送」缺口）：
>
> * 脚本：`scripts/backup-agent-world-to-mac.sh`（远端 node:sqlite 只读 `VACUUM INTO` 一致快照 → rsync 拉 db/artifacts/logs → 本地 `sqlite3 PRAGMA integrity_check` → 滚动保留 14 份 → 幂等标记）+ `scripts/remote-snapshot.js`（快照生成，VACUUM INTO 前自动清理旧文件）
> * 定时：launchd `~/Library/LaunchAgents/com.agent-world.backup.plist`（每日 11:00 本地时间 + RunAtLoad 登录补跑；脚本幂等，当天已备份则跳过）；SSH 免密走 `~/.ssh/id_ed25519` 无口令 key，不依赖 ssh-agent，重启可用
> * 备份目标：`/Users/jiangfeng/000-工作项目/agent-world数据备份/`（`db/agent-world-<date>.sqlite` + `artifacts/` + `logs/` + `backup.log`）
> * **边界**：`.encryption-keys`/`.jwt-secret` 为 600 权限（agentworld 所有），异地备份**不含密钥**——恢复加密字段需单独保管密钥；如需包含，先以 agentworld 身份配好读取权限再开 `INCLUDE_KEYS=1`
>
> **✅ 服务器端 checkpoint 修复（已执行 2026-09-10）**：`backup-agent-world.sh` 里 `sqlite3 wal_checkpoint` 因未装 sqlite3 静默失败。补丁 `scripts/patch-hasee-backup.sh`（改 node:sqlite checkpoint，先备份原脚本再替换并验证）已执行——原脚本备份为 `/usr/local/bin/backup-agent-world.sh.bak-20260909-182215`（确认 cron 运行正常后可删），替换后手动验证通过（`-wal` 清空、主库落盘）。补丁逻辑：checkpoint 失败时 echo 告警继续，不中断 rsync（rsync 会连 `-wal` 一起拷）。
>
> **🔐 密钥单独保管（已落地 2026-09-10）**：三个密钥文件（`.encryption-keys` 68B / `.jwt-secret` 64B / `/opt/agent-world/.env` 224B，均 600）已逐字节 hash 验证后存入 **macOS 钥匙串**（service=`agent-world`）。取回：
>
> ```bash
> security find-generic-password -a agent-world -s encryption-keys -w    # 明文密钥
> security find-generic-password -a agent-world -s jwt-secret -w         # 明文密钥
> security find-generic-password -a agent-world -s env -w | base64 -D    # .env（多行内容以 base64 存储）
> ```
>
> 服务器原文件保留不动。
>
> 重新执行（如需）：`scp scripts/patch-hasee-backup.sh hasee-2016-server:/tmp/` 后 `ssh hasee-2016-server 'sudo bash /tmp/patch-hasee-backup.sh'`；回滚：`sudo cp /usr/local/bin/backup-agent-world.sh.bak-20260909-182215 /usr/local/bin/backup-agent-world.sh`。
>
> 另核实（2026-09-10）：服务器 cron 每日 02:30 正常运行，`current` 与 `snap-*` 硬链接快照轮转正常——曾疑「current 停旧」，实为数据无变化时 rsync 全部跳过所致，非故障。

### 六之一、备份恢复演练（restore drill）

备份做了不代表能恢复——必须定期在**干净目录**做恢复演练，验证「备份 + 密钥 + 数据」真的能还原并启动（不影响生产：临时目录 + 独立端口）。

**仓库已内置可复用脚本 [scripts/restore-agent-world.sh](../../scripts/restore-agent-world.sh)**（支持 `--source` 演练 / `--to` 实恢复 / `--no-boot` / `--delete`；实恢复缺密钥直接失败，防止带新建 keyring 起生产把加密字段锁死）。首选直接用它；下面这段 heredoc 仅作**离线安装参考**（脚本更完整，二者等价）。

```bash
sudo tee /usr/local/bin/restore-agent-world-drill.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
# 恢复演练：恢复到临时目录 → 校验 sqlite → 校验密钥 → 用恢复数据启动临时 server → 清理。
# 不影响生产（生产 server 继续跑 8791，临时 server 用 8899）。
set -euo pipefail
SRC=/var/backups/agent-world/current
DRILL=$(mktemp -d /tmp/aw-restore-drill-XXXXXX)
PORT=8899

echo "[1/4] 恢复到临时目录 $DRILL"
rsync -a "$SRC/" "$DRILL/"
chown -R agentworld:agentworld "$DRILL"

echo "[2/4] 校验 sqlite 完整性 + 行数"
DB_FILE="$DRILL/agent-world.sqlite" node -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.env.DB_FILE, { readOnly: true });
  console.log("integrity:", JSON.stringify(db.prepare("PRAGMA integrity_check").all()));
  console.log("users:", db.prepare("SELECT COUNT(*) n FROM users").get().n);
  console.log("graphs:", db.prepare("SELECT COUNT(*) n FROM graphs").get().n);
'

echo "[3/4] 校验密钥文件"
[ -f "$DRILL/.jwt-secret" ] && [ -f "$DRILL/.encryption-keys" ] && echo "密钥文件在"

echo "[4/4] 用恢复数据启动临时 server（端口 $PORT）"
sudo -u agentworld env DB_FILE="$DRILL/agent-world.sqlite" PORT=$PORT \
  node /opt/agent-world/packages/server/dist/index.js > "$DRILL/server.log" 2>&1 &
TMP_PID=$!
sleep 4
curl -s "http://127.0.0.1:$PORT/api/health" && echo
kill "$TMP_PID" 2>/dev/null || true
rm -rf "$DRILL"
echo "restore drill OK"
EOF
sudo chmod +x /usr/local/bin/restore-agent-world-drill.sh
```

以 root 跑：`sudo /usr/local/bin/restore-agent-world-drill.sh`（内部 `sudo -u agentworld` 免密）。

**RTO/RPO**：
- **RPO**：每日 02:30 备份，最坏丢失 < 24 小时（当前数据量小，rsync 秒级完成）。
- **RTO**：恢复 = rsync 秒级 + 启动数秒，实测 < 1 分钟（不含新机器环境准备）。

**演练结果（2026-09-08 已执行，通过）**：从 `current/` 恢复到 `/tmp/aw-drill` → `integrity_check: ok` + 密钥文件在 → 临时 server（8899）health 返回 `{"ok":true,"db":"ok","jwtSecret":"loaded","encryption":"loaded"}` ✅。

**脚本化后复测（2026-09-27）**：用 Mac 侧异地快照 `agent-world-2026-09-27.sqlite` 跑 `bash scripts/restore-agent-world.sh --source <快照目录>` → `integrity_check: ok`（users 5 / graphs 15 / runs 476）+ 临时 server health `{"ok":true,"checks":{"db":"ok","encryption":"loaded"}}` ✅；并验三条拒绝路径（实恢复缺密钥 / 目标非空未加 `--force` / 源目录不存在）均按预期失败退出。注意异地快照按设计**不含密钥**，脚本会显式告警「加密字段未验证」而非静默放行。

## 七、Server 机器注意事项（笔记本形态）

```bash
# 合盖/省电不停服务
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
# 或只忽略合盖：在 /etc/systemd/logind.conf 设 HandleLidSwitch=ignore 后 restart systemd-logind

# 防火墙：只开 80（web）和 22（ssh），8791 不对外
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw enable

# swap 兜底（Node 处理大产物内存峰值）
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 常见排障

| 现象 | 排查 |
|---|---|
| 浏览器打不开 UI | `systemctl status nginx`、`nginx -t`、防火墙 80 |
| 能开 UI 但运行/列表报错 | `journalctl -u agent-world -n 50`；确认 nginx `/api` 反代到 8791 |
| SSE/运行过程不实时 | nginx 对 `/api/runs/` 必须 `proxy_buffering off`（见第五节） |
| code 节点报 `EROFS: read-only file system` | 确认 systemd unit 有 `PrivateTmp=true`（`ProtectSystem=strict` 使 /tmp 只读）；`systemctl cat agent-world \| grep PrivateTmp` |
| code 节点报错 | 确认 `bwrap` 装好且 `CODE_SANDBOX=bwrap`；`bwrap --version` |
| 报 `No such built-in module: node:sqlite` | 用了 <22 的 node，确认 `node -v` 是 24 |
| 登录后空白/接口 401 | 首次注册的用户才是 owner；`ALLOW_REGISTRATION=1` 是否生效 |
| 想升级 | `git pull` → `corepack pnpm install` → `corepack pnpm -r build` → `sudo systemctl restart agent-world` |

## 后续商业化台阶

- **P0 成本计量回采**：本部署已可跑（server 自带 `db.costForMonth` + 用量报表）。跑 2-4 周拿真实成本 → 再定 `design-monetization.md` 的套餐价。
- **P1 订阅 gate**：纯服务端逻辑，本机继续够。
- **P2 真实收款**：届时才需要公网（Stripe webhook 回调 / TLS / 域名）——可保持这台机器 + cloudflared/ngrok 隧道，或再上云 VM（数据可直接 rsync 迁移）。
