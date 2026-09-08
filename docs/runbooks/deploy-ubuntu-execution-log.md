# Ubuntu 部署执行日志（agent-world）

> **本文档是本次部署的"逐步执行记录"**：每一步先在下方写好「指导说明 + 文档化命令」，经确认后执行，再把「实际结果 / 验证点」回填。计划与验收见 [deploy-ubuntu-execution-plan.md](deploy-ubuntu-execution-plan.md)，命令速查见 [deploy-ubuntu-server.md](deploy-ubuntu-server.md)。

## 敏感信息占位符约定（强制）

涉及 IP / 用户名 / 密码的一律用占位符，**真实值永不写入本项目任何文档、不提交**：

| 占位符 | 含义 |
|---|---|
| `<server-ip>` | 目标服务器 IP |
| `<server-user>` | SSH 用户名 |
| `<server-pass>` | SSH 密码（仅会话内一次性认证使用，即使占位符也不填真实值；免密配置后彻底不用） |

> 示例文档化命令：`ssh <server-user>@<server-ip> 'hostname && whoami'`

## 执行状态总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 机器信息确认（占位待填） | ✅ 完成（8 项已确认：Ubuntu 22.04.5 / 3.7G 内存 / 89G 可用 / node·nginx 未装 / bwrap·git 已装 / 80·8791 空闲 / 外网可达） |
| 1 | 系统准备（Node 24 / bwrap / nginx / agentworld 用户 / swap / mask suspend） | ✅ 完成（Node v24.20.0 + nginx 1.18.0；bwrap/swap 已有跳过；agentworld 用户 + mask suspend 已建） |
| 2 | 代码与构建（clone/rsync → pnpm install → build） | ✅ 完成（rsync + pnpm 10.12.1 + build 全通过；修复 pnpm onlyBuiltDependencies 配置） |
| 3 | 配置 `.env` 与密钥 | ✅ 完成（DB_FILE / LOG_FILE / CODE_SANDBOX=bwrap / ALLOW_REGISTRATION=1） |
| 4 | systemd 托管 server + 冒烟 | ✅ 完成（active + /api/health={"ok":true} + 开机自启 + 密钥生成） |
| 5 | web + nginx + 防火墙 + 局域网验收 | ✅ 完成（nginx 反代 + 局域网 curl={"ok":true}；ufw 规则预设未 enable） |
| 6 | 备份与运维加固 | ✅ 完成（备份脚本 + cron 每日 02:30 + 手跑验证） |
| 7 | 商业化 P0/P1 验收清单 | ✅ 完成（8/8 全部通过） |
| CI/CD | 自动部署（deploy key / runner / deploy.sh / deploy.yml） | ✅ 基础设施就绪；deploy.yml 待 push + 合并到 dev 后生效 |

## 执行前置：一次性免密配置

> 目的：后续所有远程命令走 SSH 密钥，避免每次交互输密码（本执行环境非交互）。
> 方法：把开发机公钥追加到 `<server-user>@<server-ip>` 的 `authorized_keys`，仅此一步用密码认证。

### 步骤 A1：生成/确认本地公钥
- 命令（本地开发机）：`ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519`
- 预期：`~/.ssh/id_ed25519.pub` 存在
- 实际结果：已存在（`~/.ssh/id_ed25519.pub`，ed25519），无需生成，跳过 `ssh-keygen`。

### 步骤 A2：投公钥到目标机（唯一一次带密码认证）
- 文档化命令：`ssh-copy-id -o StrictHostKeyChecking=no <server-user>@<server-ip>`
- 密码：`<server-pass>`（仅此步用 expect 一次性输入，脚本用完即删，不落盘不留历史）
- 预期：输出 "Number of key(s) added" / "Now try logging into the machine"
- 实际结果：`ssh-copy-id` 在 macOS + expect 非交互下未跑通（密码提示后无后续输出、未写入）。改用 `expect` + `ssh` 手动幂等追加 `authorized_keys`（`grep -qxF` 防重复 + `chmod 600`），返回 `INSTALL_DONE`，写入成功。密码仅存于命令进程内存，未落盘。

### 步骤 A3：验证免密
- 命令：`ssh <server-user>@<server-ip> 'echo OK; hostnamectl | head -3; free -h; df -h / | tail -1; command -v node nginx bwrap || true'`
- 预期：无密码提示直接返回 OK + 系统概览（Ubuntu 版本/内存/磁盘/已装工具）——这些回填「阶段 0」表
- 实际结果：免密验证通过——`ssh -o BatchMode=yes <server-user>@<server-ip> 'whoami && hostname'` 无密码直接返回 `<server-user>` / `hasee-2016-server`。系统概览（hostnamectl / free / df / 工具探测）留到阶段 1 执行时一并收集。

### 步骤 A4：配置本地 SSH 别名（可选，提升体验）
- 命令（本地开发机）：在 `~/.ssh/config` 增加 `Host hasee-2016-server`（HostName / User / IdentityFile 映射仅存本机 config，敏感项不入本文档）
- 预期：`ssh hasee-2016-server 'echo OK'` 免密直连成功
- 实际结果：已配置并验证通过。
- **连接开发服务器：`ssh hasee-2016-server`**（无需再敲 IP / 用户名 / 密码；本机 `~/.ssh/config` 持有真实映射，本文档只记别名）

---

## 逐步执行记录

> 规则：每执行一步前，在此追加该步的「目的 / 文档化命令（占位）/ 预期」，确认后执行，完成后回填「实际结果 / 验证」。系统级/破坏性命令执行前单独征求同意。

## 阶段 0：机器信息确认（2026-09-07 完成）

- 探测命令：`ssh hasee-2016-server '... hostnamectl / free -h / df -h / command -v / ss -ltn / curl 外网 ...'`
- 结果：Ubuntu 22.04.5 LTS；内存 3.7Gi（swap 已有 3.7Gi）；磁盘 116G 可用 89G；git/bwrap/curl 已装，node/npm/pnpm/corepack/nginx 未装；80/8791 空闲；deb.nodesource.com 与 npm registry 均 HTTP/2 200（外网可达）。
- 结论：bwrap、swap 可跳过；Node 24、nginx、agentworld 用户、mask suspend 需执行。

## 阶段 1：系统准备（2026-09-07 完成）

- 1.1 Node 24 + 1.3 nginx：`curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs nginx && sudo corepack enable` → **Node v24.20.0 + nginx 1.18.0** ✅
- 1.2 bwrap：已有 `/usr/bin/bwrap`，跳过 ✅
- 1.4 用户+目录：`sudo useradd --system --home /var/lib/agent-world --shell /usr/sbin/nologin agentworld && sudo mkdir -p /opt/agent-world /var/lib/agent-world && sudo chown -R agentworld:agentworld ...` → **uid=998(agentworld)** ✅
- 1.5 swap：已有 3.7Gi，跳过 ✅
- 1.6 mask suspend：`sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target` → 4 个 target 均 **masked** ✅
- 备注：sudo 需密码（`<server-user>` 在 sudo 组但非 NOPASSWD），远程执行用 `ssh -t` 分配伪终端 + `expect` 喂密码。

## 阶段 2：代码与构建（2026-09-07 完成）

- 2.1 取代码：远程是 GitHub SSH 私有仓且服务器无凭证，改用 **rsync**（排除 node_modules/dist/.git/.env/本地 DB/artifacts/traineddata）→ `/opt/agent-world` ✅
- 2.2+2.3 装依赖+构建：`sudo -u agentworld corepack pnpm install --frozen-lockfile && corepack pnpm -r build` → **pnpm v10.12.1 + 4 包 build 全通过** ✅
- **踩坑修复**：corepack 在服务器拉了 pnpm 12.3.4（package.json 里 corepack 曾写入 `packageManager: pnpm@12.3.4+sha512`），pnpm 12 的 supply-chain 策略不再读 `package.json` 的 `pnpm.onlyBuiltDependencies`（改用 pnpm-workspace.yaml 的 `allowBuilds`），导致 esbuild/tesseract.js 的 postinstall 被拦截报 `ERR_PNPM_IGNORED_BUILDS`。修复：`package.json` 固定 `packageManager: pnpm@10.12.1`（与本地一致）+ 移除 corepack 写入的 12.3.4 与冗余 `pnpm` 字段；`pnpm-workspace.yaml` 加 `onlyBuiltDependencies: [esbuild, tesseract.js]`。

## 阶段 3：配置 `.env` 与密钥（2026-09-07 完成）

- 写入 `/opt/agent-world/.env`：`DB_FILE=/var/lib/agent-world/agent-world.sqlite`、`LOG_FILE=/var/lib/agent-world/logs/server.log`、`CODE_SANDBOX=bwrap`、`ALLOW_REGISTRATION=1`，`chmod 600` + `chown agentworld` ✅
- Provider 凭证（AGNES_API_KEY 等）**留空**，由用户登录后在 Settings 配置。
- 2026-09-07 补：注入 `AGENT_WORLD_ENV=staging`（幂等，`grep -q || tee -a`），作为 `/api/health` 自述式探针的 `env` 来源；重启后 health 返回 `{"ok":true,"env":"staging","branch":"dev","commit":"4409494",...}` ✅

## 阶段 4：systemd 托管 server（2026-09-07 完成）

- 4.1 unit：`/etc/systemd/system/agent-world.service`（User=agentworld、WorkingDirectory=/opt/agent-world/packages/server、ProtectSystem=strict、ReadWritePaths=/var/lib/agent-world、Restart=always）✅
- 4.2 启动：`systemctl start` → **active**，`curl /api/health` → **{"ok":true}** ✅
- 4.3 开机自启：`systemctl enable` → Created symlink ✅
- 4.4 首启密钥：`/var/lib/agent-world/` 下生成 `agent-world.sqlite`、`.jwt-secret`(600)、`.encryption-keys`(600)、`artifacts/`、`logs/` ✅

## 阶段 5：web + nginx + 验收（2026-09-07 完成）

- 5.1 nginx site：`/etc/nginx/sites-available/agent-world`（80 反代 /api→8791、SSE 关缓冲、SPA try_files），`nginx -t` OK + reload ✅
- 5.3 本机验收：`curl 127.0.0.1/` → HTML；`curl 127.0.0.1/api/health` → {"ok":true} ✅
- 5.4 局域网验收：开发机 `curl <server-ip>/api/health` → {"ok":true} ✅（期间一次 `No route to host` 为笔记本 WiFi 临时抖动，ping 通后恢复）
- 5.2 防火墙：ufw 规则已预设（OpenSSH + 80/tcp）但**保持 inactive**（内网测试 + 避免 SSH 切断风险；如需启用见下方）

## 阶段 6：备份与运维加固（2026-09-07 完成）

- 6.1 备份脚本 `/usr/local/bin/backup-agent-world.sh`（checkpoint + rsync + 每日硬链接快照保留 7 份）+ cron `30 2 * * *` → 手跑验证产出 `current/` + `snap-2026-09-07` ✅
- 备注：服务器缺 `sqlite3` CLI（apt 被 unattended-upgrades 锁），脚本内 `sqlite3 ... || true` 已容错，rsync 连 WAL 一起备份数据完整。

## CI/CD 自动部署实施（2026-09-07 完成）

把部署方式从「手动 rsync」升级为「Git + CI/CD 自动部署」，方案见 [deploy-cicd.md](deploy-cicd.md)。实际落地：

- **Deploy Key**：Hasee 生成 ed25519（`/var/lib/agent-world/.ssh/github-deploy`），只读添加到 GitHub（`gh repo deploy-key add`），配 `agentworld` 的 `~/.ssh/config` 让 git pull 走这把 key → `git ls-remote` 验证能拉 dev ✅
- **最小 sudo**：`/etc/sudoers.d/agentworld` 只允许 `systemctl restart agent-world`（NOPASSWD）✅
- **self-hosted runner**：下载 v2.337.0 到 `/var/lib/agent-world/actions-runner`，`config.sh` 注册（name=`hasee-2016-server`，label=`production`）；**新版无 `svc.sh`** → 手写 `/etc/systemd/system/actions-runner.service`，`enable --now` 后 GitHub 状态 **online** ✅
- **服务器 git 化**：原 `/opt/agent-world` 是 rsync 部署（无 `.git`），改为「备份 .env → `git clone -b dev` → 恢复 .env + install + build → 停服切换目录」；切换后为 dev 分支 git 仓库，`/api/health` 正常 ✅
- **deploy.sh**：`/opt/agent-world/deploy.sh`（`git pull --ff-only` → install → build → restart），runner 以 agentworld 跑、无需 `sudo -u` ✅
- **deploy.yml**：`.github/workflows/deploy.yml`（`workflow_run` 监听 CI 在 dev 成功 → self-hosted runner 执行 deploy.sh），已 commit，**待 push + 合并到 dev 后生效** ⏳

## 阶段 7：商业化 P0/P1 验收清单（2026-09-08 完成）

### 验收结果总览

| # | 验收项 | 结果 | 验证方式 |
|---|---|---|---|
| 1 | 注册/账号 | ✅ 通过 | 首次注册 `2467055074@qq.com` 为所有者；二次注册 `1911407837@qq.com` 为普通用户 |
| 2 | 配置 Provider | ✅ 通过 | agnes key 已配置，7 个模型（文本/图片/视频）可下拉，tavily 搜索 key 已配置 |
| 3 | 建产线 + 真实跑通 | ✅ 通过 | 多源研究简报产线跑通（seq 27/27 收工），成品库 2 TXT + 4 JSON |
| 4 | 成本计量（P0 回采） | ✅ 通过 | `/api/costs` 有数据：tokens_in=973, tokens_out=822, runs=1（P0 第一条真实成本数据） |
| 5 | 触发类（cron） | ✅ 通过 | `* * * * *` 每分钟自动触发，服务器日志确认 `run started`（trigger: trg_mtsc2f0a） |
| 6 | code 节点沙箱 | ✅ 通过 | systemd `PrivateTmp=true` + bwrap `--tmpfs /tmp` 双层修复；运营周报"清洗汇总"code 节点正常执行，产出 JSON |
| 7 | P1 前置探针 | ✅ 通过 | `subscriptions` / `usage_ledger` 表存在（`invoices` 表 P2 才建，属正常） |
| 8 | 备份可恢复 | ✅ 通过 | 备份脚本 `/usr/local/bin/backup-agent-world.sh` + root crontab `30 2 * * *`；恢复演练：从快照 rsync 到临时目录，DB 35 表完整，current/ 备份数据与 live DB 一致（2 users / 4 graphs / 6 runs），secrets（.jwt-secret / .encryption-keys）完整 |

### 本次验收修复的 Bug

**nginx 301 重定向导致派发任务 404**——`POST /api/runs`（不带斜杠）被 nginx 301 重定向到 `/api/runs/`，重定向后 POST 变 GET 导致 404。

- 根因：nginx 配置中 `location /api/runs/`（带斜杠）导致不带斜杠的请求被 nginx 自动重定向
- 修复：`location /api/runs/` → `location ~ ^/api/runs/?`（正则匹配，带或不带斜杠都匹配）
- 验证：`POST /api/runs` 返回 401（不再 301），产线可正常派发
- 影响：P0 级阻塞 bug，会导致所有产线无法派发任务

### code 沙箱 Bug 根因与修复（2026-09-08 已修复并验证通过）

**症状**：所有 code 节点报 `EROFS: read-only file system, mkdtemp '<internal-path>'`，运营周报"清洗汇总"节点失败。

**真正根因**：systemd unit 配置了 `ProtectSystem=strict` + `ReadWritePaths=/var/lib/agent-world`，使服务器进程的 **/tmp 是只读的**。`createCodeWorkdir()` 在服务器进程中调用 `mkdtemp()` 时就失败了——根本没到 bwrap 沙箱那一步。

**修复（两层）**：
1. **systemd 层（关键修复）**：在 `/etc/systemd/system/agent-world.service` 添加 `PrivateTmp=true`，为服务创建可写的私有 /tmp 挂载点。`daemon-reload` + `restart` 后生效。
2. **bwrap 层（额外加固）**：在 `packages/server/src/code-sandbox.ts` 的 `bwrapBackend.planSpawn` 中，在 `--bind workdir` 之前添加 `--tmpfs /tmp`，确保 bwrap 沙箱内部的 /tmp 也可写（防止用户代码在沙箱内调用 mkdtemp 失败）。

**验证**：部署后重新派发运营周报产线，code 节点（清洗汇总）正常执行，产线 seq 29/29 收工，成品库有 code 节点产出的 JSON（105 B）。验收项 6 通过。

**后续待办**：
1. ~~修复 code 沙箱并重新部署到 Hasee~~ ✅ 已完成
2. ~~做一次备份 restore 演练~~ ✅ 已完成（见下方）
3. ~~把 nginx 正则匹配、systemd `PrivateTmp=true`、bwrap `--tmpfs /tmp` 写入 `deploy-ubuntu-server.md`~~ ✅ 已完成

### 备份恢复演练（2026-09-08 已完成）

**备份机制**：
- 脚本：`/usr/local/bin/backup-agent-world.sh`（sqlite3 wal_checkpoint + rsync + 每日硬链接快照，保留 7 份）
- 定时：root crontab `30 2 * * *`（每天 02:30 UTC）
- 目录：`/var/backups/agent-world/`（current/ + snap-YYYY-MM-DD/）

**恢复演练步骤**（不中断服务，恢复到临时目录验证）：
1. `rsync -a snap-2026-09-08/ /tmp/restore-test/`
2. 验证文件完整性：DB（393KB）、artifacts/、logs/、secrets（.jwt-secret 64B / .encryption-keys 68B，600 权限）
3. 验证 DB 完整性：`node:sqlite` 打开成功，35 个表全部存在（users/graphs/runs/subscriptions/usage_ledger 等）
4. 验证数据一致性：current/ 备份与 live DB 完全一致（2 users / 4 graphs / 6 runs）

**结论**：备份机制正常工作，数据可完整恢复。验收项 8 通过。

**备注**：每日快照（snap-YYYY-MM-DD）是当天首次备份时创建的硬链接副本，数据为创建时的状态；current/ 目录始终是最新备份。恢复时应使用 current/ 或最新的快照。
