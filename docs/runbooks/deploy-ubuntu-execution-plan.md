# Ubuntu Server 落地执行方案（agent-world 商业化本地测试）

> 目标机器：用户手头的 **Ubuntu 纯 Server（无 GUI）笔记本**。
> 目标：把 agent-world 以**单机服务**形态跑起来（server API :8791 + web UI，局域网可访问），作为商业化 **P0（成本计量回采）+ P1（订阅 gate / 配额）** 本地测试环境。
>
> 通用命令手册见 [deploy-ubuntu-server.md](deploy-ubuntu-server.md)（本文件是「这台机器怎么落地」的执行计划：阶段、命令、验证点、回滚、验收）。**IP 与机器参数确认后再执行阶段 1+。**

---

## 阶段 0：机器信息确认（已完成，2026-09-07 回填）

| 项 | 值（已回填） | 用途 |
|---|---|---|
| IP 地址 | `<server-ip>`（内网） | 部署后访问入口 `http://<IP>/` |
| SSH 可达性 | ✅ 开发机可 `ssh` 直连（免密已配，别名 `hasee-2016-server`） | agent 远程执行 |
| Ubuntu 版本 | ✅ Ubuntu 22.04.5 LTS | 包管理器命令差异 |
| 是否全新 | ✅ 全新：node/nginx 未装、80/8791 空闲、git/bwrap 已装 | 避免冲突 |
| 磁盘可用 | ✅ 116G，可用 89G（20%） | 代码 + 数据 + swap 预算 |
| 内存 | ✅ 3.7Gi（可用 3.0Gi），swap 已有 3.7Gi | swap 已具备，无需新建 |
| 外网可达 | ✅ deb.nodesource.com 与 npm registry 均 HTTP/2 200 | 无需镜像源 |

> **拿到以上 8 项后**：本方案阶段 1-7 才能给出精确命令并标注「可 agent 远程执行」或「需用户在本机执行」。

---

## 目标架构（不变式）

```
浏览器(局域网) ─► nginx :80 ─► apps/web/dist（SPA，/ 走 try_files 回退 index.html）
                        └────► /api/* 反代 ─► server :8791（systemd 托管 node dist/index.js）
```

- web 与 API **同源**，免 CORS（`CORS_ORIGINS` 留空）。
- 数据目录 `/var/lib/agent-world/`（sqlite + artifacts + logs + 密钥 + tessdata）。
- 非 root 系统用户 `agentworld` 跑服务；`ProtectSystem=strict` 只放开数据目录。

---

## 阶段 1：系统准备

| # | 动作 | 命令要点 | 验证点 / 通过条件 |
|---|---|---|---|
| 1.1 | Node 24 | `curl -fsSL https://deb.nodesource.com/setup_24.x \| sudo -E bash - && sudo apt-get install -y nodejs && corepack enable` | `node -v` = v24.x |
| 1.2 | bubblewrap（关审计 H4） | `sudo apt-get install -y bubblewrap` | `bwrap --version` 有输出 |
| 1.3 | nginx | `sudo apt-get install -y nginx` | `nginx -v` |
| 1.4 | 系统用户 + 目录 | `sudo useradd --system --home /var/lib/agent-world --shell /usr/sbin/nologin agentworld && sudo mkdir -p /opt/agent-world /var/lib/agent-world && sudo chown -R agentworld:agentworld /opt/agent-world /var/lib/agent-world` | `id agentworld`、目录属主 |
| 1.5 | swap（笔记本内存兜底） | `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' \| sudo tee -a /etc/fstab` | `free -h` 显示 swap 4G |
| 1.6 | 省电/合盖不停服（笔记本形态） | `sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target` | `systemctl is-enabled sleep.target` = masked |

**回滚**：`sudo userdel agentworld; rm -rf /opt/agent-world /var/lib/agent-world`（未建数据前可整体回滚）。

---

## 阶段 2：代码与构建

| # | 动作 | 命令要点 | 验证点 |
|---|---|---|---|
| 2.1 | 取代码 | 方式 A：`cd /opt/agent-world && sudo -u agentworld git clone <repo> .`；方式 B：开发机 `rsync -a --exclude node_modules --exclude dist <本地仓库>/ agentworld@<IP>:/opt/agent-world/` | `/opt/agent-world/package.json` 存在 |
| 2.2 | 装依赖 | `cd /opt/agent-world && sudo -u agentworld bash -c 'corepack pnpm install --frozen-lockfile'` | 退出码 0；`node_modules/.pnpm` 存在 |
| 2.3 | 构建 core/server/web | `sudo -u agentworld corepack pnpm -r build` | `packages/server/dist/index.js` 与 `apps/web/dist/index.html` 均存在 |

> 代码来源建议走 git clone（后续 `git pull` 升级），rsync 仅作为无私有仓的兜底。

---

## 阶段 3：配置 `.env` 与密钥

| # | 动作 | 命令要点 | 验证点 |
|---|---|---|---|
| 3.1 | 写 `.env` | 见 [deploy-ubuntu-server.md §三](deploy-ubuntu-server.md)（`DB_FILE`、`LOG_FILE`、`CODE_SANDBOX=bwrap`、`ALLOW_REGISTRATION=1`、Provider 凭证） | `git check-ignore .env` 有输出（确认被忽略） |
| 3.2 | 收紧权限 | `sudo chmod 600 /opt/agent-world/.env` | `ls -l` 600 |
| 3.3 | 首启生成密钥 | 启动 server 一次（见阶段 4） | `/var/lib/agent-world/` 下出现 `agent-world.sqlite`、`.jwt-secret`、`.encryption-keys`（均 0600） |

---

## 阶段 4：systemd 托管 server

| # | 动作 | 命令要点 | 验证点 |
|---|---|---|---|
| 4.1 | 写 unit | 见 [deploy-ubuntu-server.md §四](deploy-ubuntu-server.md)（`WorkingDirectory=/opt/agent-world/packages/server` 必须对，否则 DB 落错目录） | `systemctl status` active |
| 4.2 | 启停检查 | `sudo systemctl enable --now agent-world && sleep 1 && systemctl is-active agent-world` | = active |
| 4.3 | API 冒烟 | `curl -s http://127.0.0.1:8791/api/health` | `{"ok":true}` |
| 4.4 | 崩溃自愈 | `sudo systemctl kill -s SIGKILL agent-world && sleep 4 && systemctl is-active agent-world` | SIGKILL 后 Restart=always 拉起，= active |

**回滚**：`sudo systemctl disable --now agent-world && rm /etc/systemd/system/agent-world.service`。

---

## 阶段 5：web + nginx + 验收

| # | 动作 | 命令要点 | 验证点 |
|---|---|---|---|
| 5.1 | nginx site | 见 [deploy-ubuntu-server.md §五](deploy-ubuntu-server.md)（含 SSE 关 buffering + SPA try_files） | `nginx -t` OK |
| 5.2 | 防火墙 | `sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw enable` | `ufw status` |
| 5.3 | 本机验收 | `curl -s http://127.0.0.1/ \| head`、`curl -s http://127.0.0.1/api/health` | 前者是 HTML，后者 `{"ok":true}` |
| 5.4 | 局域网验收 | 开发机浏览器开 `http://<IP>/` | 注册页正常加载 |

> 若同网段访问不通：先查 `ufw status`、`ip addr`（IP 是否配错）、nginx `server_name _` 是否生效。

---

## 阶段 6：备份与运维加固

| # | 动作 | 命令要点 | 验证点 |
|---|---|---|---|
| 6.1 | 备份脚本 + cron | 见 [deploy-ubuntu-server.md §六](deploy-ubuntu-server.md)（checkpoint 后 rsync + 硬链接快照 7 份，每日 02:30） | 手跑一次脚本退出码 0，`/var/backups/agent-world/` 有内容 |
| 6.2 | 数据目录只写测试 | 以 `agentworld` 跑一条产线，确认 artifacts 落在 `/var/lib/agent-world/artifacts/` | 目录增长 |

---

## 阶段 7：商业化 P0/P1 验收清单（本次落地的"成功标准"）

- [ ] **注册/账号**：首次注册用户成为 owner；二次注册为普通 user（`ALLOW_REGISTRATION=1`）
- [ ] **配置 Provider**：Settings 里填 agnes key（或自配 OpenAI 兼容），模型可下拉
- [ ] **建产线 + 真实跑通**：用任一模板（如 tpl-product）跑一条 run 到 done，成品出现在成品库
- [ ] **成本计量**：跑完一条 run，成本报表（`/api/costs`）出现 >0 的成本项——这是 **P0 回采**的数据来源
- [ ] **触发类**（无人值守）：cron 触发跑通一次（建 `* * * * *` 触发器，等分钟级自触发）
- [ ] **code 节点沙箱**：跑一条含 code 节点的模板，确认在 `CODE_SANDBOX=bwrap` 下正常执行
- [ ] **P1 前置探针**：确认 `subscriptions`/`usage_ledger` 表存在（迁移已建），`enforceSubscription` 逻辑可测
- [ ] **备份可恢复**：`restore` 演练一次（拷回备份目录，server 重启后数据完整）

> 通过以上 8 项 = 这台机器具备跑商业化 P0/P1 本地测试的能力。

---

## 风险与应对

| 风险 | 概率 | 应对 |
|---|---|---|
| Node 安装源不通（无外网/被墙） | 中 | 阶段 0 先确认外网；不通则 rsync 开发机的 Node 二进制或走 apt 官方源 |
| 80/8791 被占 | 低 | 阶段 0 查 `ss -ltnp`；被占则 nginx `listen 8080` + 访问带端口 |
| bwrap 在当前内核/容器受限 | 低 | `bwrap --version` + 起一条含 code 的产线实测；受限则 `CODE_SANDBOX=rlimit` 并记回审计 H4 |
| 笔记本断电/合盖停服 | 中 | 阶段 1.6 已 mask suspend；阶段 6 备份兜底；提醒用户接电 |
| 误配 DB 路径导致数据落错目录 | 中 | 阶段 4.1 的 `WorkingDirectory` 与 `.env` `DB_FILE` 用绝对路径钉死；首启后校验文件位置 |
| 磁盘写满（artifacts 增长） | 低→中 | 阶段 6 备份含轮转；观察 `df -h`，必要时加日志/产物清理策略（deferred） |

---

## 执行分工（拿到阶段 0 信息后明确）

- 若开发机可 `ssh` 到目标机：agent 按阶段 1-7 逐条执行，每阶段跑完即报告验证点结果。
- 若不可达：agent 输出「按阶段分片的命令包」，用户在目标机执行并回报输出，agent 据此判断下一步。
- 所有破坏性/系统级命令（useradd、ufw enable、mask suspend）执行前均需用户确认。
