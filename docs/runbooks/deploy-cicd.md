# CI/CD 自动部署方案（Hasee server）

> agent-world 代码从 Mac（DEV）同步到 Hasee server（准生产）的**最正规方式**：Git 版本控制 + CI 质量门禁 + CD 自动部署。
> 与「手动 rsync / 手动 git pull」的区别见 §二。本文档为实施方案，命令均以占位符标注敏感信息。

## 一、目标与原理

**核心**：把「提交 → 测试 → 部署」串成一条自动化流水线，你只负责 `commit + push`，其余全自动。

```
Mac 上 commit + push
        ↓
GitHub Actions CI（typecheck / build / test 质量门禁）
        ↓ 测试全绿
CD 自动部署到 Hasee（git pull → install → build → systemctl restart）
        ↓
每次部署 = 一个 commit + 一条 GitHub Actions 记录（可审计、可回滚）
```

## 二、为什么这是「最正规」

| 维度 | 手动 rsync | 手动 git pull | **CI/CD（本文档）** |
|---|---|---|---|
| 版本可追溯 | ❌ | ✅ | ✅ |
| 质量门禁（测试过了才部署） | ❌ | ❌ | ✅ |
| 自动化（push 后不用管） | ❌ | ❌ | ✅ |
| 部署可审计 | ❌ | ❌ | ✅ |
| 防「忘 build / 忘 restart」 | ❌ | ❌ | ✅ |
| 回滚 | ❌ | 手动 | `git revert` + 重新走流水线 |

## 三、技术选型：self-hosted runner（内网障碍的解法）

**障碍**：Hasee 在内网（无公网 IP），GitHub 的公网 runner **无法主动 SSH 连进来**。

**解法**：在 Hasee 上装一个 **GitHub self-hosted runner**——它是一条**出站**连接（服务器主动连 GitHub），绕开内网入站限制。GitHub 有任务时把 job 派发给它，它就在 Hasee 本地执行部署命令。

```
GitHub Actions（公网）
      ▲ 出站长连接（runner 主动连）
      │
Hasee server（self-hosted runner，以 agentworld 用户跑）
      └─ 执行：git pull → build → systemctl restart
```

## 四、实施步骤

### 4.1 配 GitHub Deploy Key（只读）

给仓库配一把**只读** deploy key，让服务器能 `git pull`（不需要完整账号）。

```bash
# 服务器上，以 agentworld 用户生成
sudo -u agentworld mkdir -p /var/lib/agent-world/.ssh
sudo -u agentworld ssh-keygen -t ed25519 -N '' -f /var/lib/agent-world/.ssh/github-deploy
sudo cat /var/lib/agent-world/.ssh/github-deploy.pub   # 复制公钥
```

将公钥添加到 GitHub 仓库 **Settings → Deploy keys → Add deploy key**，**不要**勾选「Allow write access」（pull 只需 read）。

再给 `agentworld` 配 SSH config，让 `git pull` 时用这把 deploy key：

```bash
sudo -u agentworld tee /var/lib/agent-world/.ssh/config >/dev/null <<'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile /var/lib/agent-world/.ssh/github-deploy
    StrictHostKeyChecking no
EOF
sudo chown agentworld:agentworld /var/lib/agent-world/.ssh/config
sudo chmod 600 /var/lib/agent-world/.ssh/config
# 验证能连（应返回 dev 分支的 commit hash）
sudo -u agentworld git ls-remote git@github.com:bayernjf/agent-world.git refs/heads/dev
```

### 4.2 给 agentworld 最小 sudo 权限（只允许重启服务）

部署脚本需要重启 systemd 服务，但 `agentworld` 不能全量 sudo。给它**仅允许重启 agent-world 服务**的最小权限：

```bash
# 服务器上，root 写入 sudoers 规则
echo 'agentworld ALL=(root) NOPASSWD: /usr/bin/systemctl restart agent-world' \
  | sudo tee /etc/sudoers.d/agentworld >/dev/null
sudo chmod 440 /etc/sudoers.d/agentworld
```

### 4.3 装 self-hosted runner

在 Hasee 上下载并配置 runner（以 `agentworld` 用户跑）：

```bash
# ① 下载 runner（版本号以 GitHub 页面为准，当前 v2.337.0）
sudo -u agentworld mkdir -p /var/lib/agent-world/actions-runner
sudo -u agentworld curl -o /var/lib/agent-world/actions-runner/runner.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-linux-x64-2.337.0.tar.gz
sudo -u agentworld tar xzf /var/lib/agent-world/actions-runner/runner.tar.gz -C /var/lib/agent-world/actions-runner
sudo rm /var/lib/agent-world/actions-runner/runner.tar.gz

# ② 注册（token 用 gh api 生成，1 小时有效）：
#    gh api repos/bayernjf/agent-world/actions/runners/registration-token --method POST --jq .token
sudo -u agentworld /var/lib/agent-world/actions-runner/config.sh \
  --url https://github.com/bayernjf/agent-world \
  --token <REGISTRATION_TOKEN> \
  --name hasee-2016-server \
  --labels self-hosted,linux,production \
  --unattended \
  --work /var/lib/agent-world/actions-runner/_work

# ③ 手写 systemd unit 托管 runner（新版已无 svc.sh）
sudo tee /etc/systemd/system/actions-runner.service >/dev/null <<'EOF'
[Unit]
Description=GitHub Actions Runner (hasee-2016-server)
After=network.target

[Service]
User=agentworld
Group=agentworld
WorkingDirectory=/var/lib/agent-world/actions-runner
ExecStart=/var/lib/agent-world/actions-runner/run.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now actions-runner
```

> **注意**：新版 runner（v2.337.0）**已移除 `svc.sh`**，systemd 托管需手写 unit（如上）。注册后 GitHub 显示 label 为 `self-hosted / Linux / X64 / production`（小写 `linux` 会被自动标准化为 `Linux`）。
> 验证：`systemctl is-active actions-runner` = active，`gh api repos/bayernjf/agent-world/actions/runners --jq '.runners[].status'` = `online`。

### 4.3.5 服务器代码 git 化（从 rsync 切换到 git）

首次 rsync 部署的 `/opt/agent-world` **没有 `.git`**，无法 `git pull`。需切换为 git clone：

```bash
# ① 备份 .env
sudo cp /opt/agent-world/.env /tmp/aw-env-backup

# ② clone dev 分支到新目录（/opt 下 agentworld 无创建权限，先建目录并授权）
sudo mkdir -p /opt/agent-world-new && sudo chown agentworld:agentworld /opt/agent-world-new
sudo -u agentworld git clone -b dev git@github.com:bayernjf/agent-world.git /opt/agent-world-new

# ③ 恢复 .env 并在新目录 install + build
sudo cp /tmp/aw-env-backup /opt/agent-world-new/.env
sudo chown agentworld:agentworld /opt/agent-world-new/.env && sudo chmod 600 /opt/agent-world-new/.env
cd /opt/agent-world-new && sudo -u agentworld corepack pnpm install --frozen-lockfile && sudo -u agentworld corepack pnpm -r build

# ④ 切换（短暂停服几秒）
sudo systemctl stop agent-world
sudo mv /opt/agent-world /opt/agent-world-old
sudo mv /opt/agent-world-new /opt/agent-world
sudo systemctl start agent-world

# ⑤ 验证后清理旧目录
curl -s http://127.0.0.1:8791/api/health   # {"ok":true}
sudo rm -rf /opt/agent-world-old
```

### 4.4 写服务器部署脚本

`/opt/agent-world/deploy.sh`（runner 拉取代码后执行）：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-world

git pull --ff-only                                   # 只快进，避免冲突静默
corepack pnpm install --frozen-lockfile              # 依赖可能变了
corepack pnpm -r build                               # 全量构建
sudo systemctl restart agent-world                   # 重启服务（最小 sudo）
```

> runner 以 `agentworld` 身份执行，故 deploy.sh 里**不需要** `sudo -u agentworld`（已是该用户），只需对 `systemctl restart` 用最小 sudo。

```bash
sudo chmod +x /opt/agent-world/deploy.sh
```

> `git pull --ff-only`：只允许快进合并。若本地有分叉（不该发生，因为服务器代码只由 deploy 脚本改），会直接失败而不是悄悄合并，保证可追溯。

### 4.5 写 CD workflow（`.github/workflows/deploy.yml`）

CI 与 CD 是**两个独立 workflow**，故用 `workflow_run` 跨 workflow 触发：监听 CI（`ci.yml`，name=CI）在 `dev` 分支完成后，仅当 CI 成功才部署到 Hasee。

```yaml
name: Deploy

on:
  workflow_run:
    workflows: ["CI"]          # ci.yml 的 name
    types: [completed]          # 只监听完成
    branches: ["dev"]           # 部署分支 = dev（Hasee 是准生产，跑最新集成代码；main 留待 M3 正式生产）

jobs:
  deploy:
    name: Deploy to Hasee
    if: github.event.workflow_run.conclusion == 'success'   # 仅 CI 成功才部署
    runs-on: [self-hosted, production]                      # 匹配 Hasee runner 的 label
    steps:
      - name: Deploy
        run: /opt/agent-world/deploy.sh
```

> **关键点**：
> - `runs-on: [self-hosted, production]`：`production` 是注册 runner 时的自定义 label，用于精确匹配这台机器（避免其它 self-hosted runner 抢任务）。
> - `if: workflow_run.conclusion == 'success'`：CI 失败则不部署，坏代码上不了准生产。
> - workflow 文件必须在 GitHub 上（即需 push 并合并到 `dev` 分支）才会生效。

### 4.6 验证部署是否成功（自己可测，不依赖问人）

部署是否成功，本质是「Hasee 上的代码 == 远程 dev 最新代码」。三种方法由严到松：

**方法 1：对比 commit hash（最可靠，日常推荐）**

```bash
# Mac 上执行（会提示输一次 sudo 密码）
remote=$(git ls-remote origin refs/heads/dev | cut -f1)
hasee=$(ssh -t hasee-2016-server 'sudo -u agentworld git -C /opt/agent-world rev-parse HEAD' 2>/dev/null | grep -oE '[0-9a-f]{40}' | head -1)
[ "$remote" = "$hasee" ] && echo "✅ 已部署最新 dev：$remote" || echo "❌ 未同步：remote=$remote hasee=$hasee"
```

两个 hash 一致 = 部署成功。

**方法 2：看 Deploy workflow（快，确认 job 跑成功）**

```bash
gh run list --workflow=Deploy --limit 1
# completed success = deploy job 执行成功
```

**方法 3：看 Hasee 服务日志（间接验证 migration + 重启）**

```bash
ssh hasee-2016-server 'sudo journalctl -u agent-world --no-pager -n 10'
# 看到 "server starting schemaVersion:34" + 最新时间戳 = 服务已用新代码重启
curl -s http://<server-ip>/api/health   # 返回 {"ok":true}
```

> 三种方法由严到松：方法 1 直接对比代码版本最可靠；方法 2 只看 job 状态；方法 3 看服务是否真重启。日常用方法 1 一句话即可确认。

## 五、日常使用（push 之后自动发生什么）

1. 你 `commit + push`；
2. CI job（公网 runner）跑 typecheck / build / test；
3. 测试全绿 → `deploy` job 派发给 Hasee 的 self-hosted runner；
4. runner 在 Hasee 上执行 `deploy.sh`：`git pull → install → build → systemctl restart`；
5. 服务用新代码重启，部署完成。

**你全程只需要做一件事：push。**

## 六、回滚与排障

**回滚**：`git revert <坏 commit>` + push，流水线会自动重新部署回滚后的代码。

**排障**：
| 现象 | 排查 |
|---|---|
| deploy job 一直排队不跑 | Hasee runner 是否在线（`systemctl status actions.runner.*`） |
| deploy 报 `git pull` 失败 | deploy key 是否只读且已加；服务器网络能否连 github.com |
| deploy 报 `systemctl` 权限不足 | sudoers 规则（§4.2）是否正确 |
| 部署后服务起不来 | `journalctl -u agent-world -n 50` |

## 七、安全边界

- **Deploy Key 只读**：服务器只能 pull，不能 push（防止服务器被攻破后回写代码仓库）。
- **runner 以 agentworld 跑**：不 root，配合 §4.2 的最小 sudo，被攻破影响面锁死在「重启服务 + 数据目录」。
- **`--ff-only`**：部署不做 merge，避免静默冲突。
- **CI 门禁**：测试不过不部署，坏代码上不了准生产。
