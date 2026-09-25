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

`past_due` / `canceled` 目前**不影响配额**：`enforceSubscription()` 只读 `plan`，`SubscriptionLike.status` 传进来没人读（design-monetization §6.4 的「欠费 → 宽限 → 内置模型阻断」尚未实现）。

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
