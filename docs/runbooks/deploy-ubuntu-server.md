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
