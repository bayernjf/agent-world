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
# ① 下载 runner（版本号以 GitHub 页面为准）
sudo -u agentworld mkdir -p /var/lib/agent-world/actions-runner
cd /var/lib/agent-world/actions-runner
sudo -u agentworld curl -o runner.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.327.1/actions-runner-linux-x64-2.327.1.tar.gz
sudo -u agentworld tar xzf runner.tar.gz
sudo rm runner.tar.gz

# ② 注册（token 从 GitHub 仓库 Settings → Actions → Runners → New self-hosted runner 获取）
sudo -u agentworld ./config.sh \
  --url https://github.com/bayernjf/agent-world \
  --token <REGISTRATION_TOKEN> \
  --name hasee-2016-server \
  --labels self-hosted,linux,production \
  --unattended

# ③ 用 systemd 托管 runner（常驻、开机自启）
sudo ./svc.sh install agentworld
sudo ./svc.sh start
```

> 验证：`systemctl status actions.runner.*` 显示 active，GitHub 仓库 Settings → Actions → Runners 里出现 `hasee-2016-server`（Idle 状态）。

### 4.4 写服务器部署脚本

`/opt/agent-world/deploy.sh`（runner 拉取代码后执行）：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-world

git pull --ff-only                                   # 只快进，避免冲突静默
sudo -u agentworld corepack pnpm install --frozen-lockfile   # 依赖可能变了
sudo -u agentworld corepack pnpm -r build            # 全量构建
sudo systemctl restart agent-world                   # 重启服务（最小 sudo）
```

```bash
sudo chmod +x /opt/agent-world/deploy.sh
```

> `git pull --ff-only`：只允许快进合并。若本地有分叉（不该发生，因为服务器代码只由 deploy 脚本改），会直接失败而不是悄悄合并，保证可追溯。

### 4.5 写 CD workflow（`.github/workflows/deploy.yml`）

CI 通过后才触发部署，且只在目标分支 push 时跑：

```yaml
name: Deploy

on:
  push:
    branches: ["main"]   # 上线分支；早期可用 feature/20260824

jobs:
  deploy:
    name: Deploy to Hasee
    runs-on: [self-hosted, linux]          # 指定跑在 Hasee 的 runner 上
    needs: build                            # 依赖 CI job（须与 ci.yml 的 job id 对齐）
    if: github.event_name == 'push'
    steps:
      - name: Deploy
        run: /opt/agent-world/deploy.sh
```

> **关键点**：
> - `needs: build` 需要 `ci.yml` 里 CI job 的 `id` 是 `build`，否则用 `workflow_run` 跨 workflow 触发（见下）。
> - 若 CI 与 CD 分开两个 workflow，改用 `workflow_run` 事件监听 CI workflow 成功后触发。

**跨 workflow 触发写法（CI/CD 分离时用）**：

```yaml
on:
  workflow_run:
    workflows: ["CI"]          # ci.yml 的 name
    types: [completed]          # 只监听完成
    branches: ["main"]

jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success'   # 仅 CI 成功才部署
    runs-on: [self-hosted, linux]
    steps:
      - run: /opt/agent-world/deploy.sh
```

### 4.6 验证

```bash
# 本机 push 一个 commit 后，观察：
gh run watch                          # CI 跑绿
# → deploy job 自动在 Hasee runner 上执行
# → 服务器代码更新 + 服务重启
curl -s http://<server-ip>/api/health   # 返回 {"ok":true} 且版本已更新
```

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
