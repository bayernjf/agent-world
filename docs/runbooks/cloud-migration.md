# 云迁移 runbook：把 agent-world 生产迁离 Hasee（拍板 2026-11-21）

> 背景：owner 拍板 Hasee 不再作为生产依赖（机器不在身边，runner 已 offline，
> 选项 A 排除）。本 runbook 把 11-05 的选项 B/C 合并为一条路径：**新云主机 +
> self-hosted runner**——`deploy.yml` 一行不用改（`runner-check` 直接变绿），
> `deploy.sh` 原样工作，只是从"家用主机"换成"云主机"。
>
> 前置（owner 决策后 agent 可代跑打 ✿ 的步骤）：
> ☐ 选云厂商与规格（参考 Hasee 形态：nginx + systemd node + SQLite，1C1G~2C2G
>   VM 即够；Ubuntu 24.04 对齐现有 runbook）
> ☐ 域名/DNS 计划（现有生产域名切到新机 IP；旧 Hasee DNS 保留作回滚）
>
> 完成前 agent-world 生产状态：Hasee 上最后部署的版本继续运行（机器开机则
> 服务可达），但**无法发布更新**（runner offline）。dev 推进期间可用
> `workflow_dispatch target=hosted` 的 BUILD ONLY 兜底验证编译。

## 阶段一：新机初始化（照现有 runbook 再装一遍）

1. 新 VM 装 Ubuntu 24.04 + node 24 + pnpm + nginx（步骤与
   [deploy-ubuntu-server.md](deploy-ubuntu-server.md) §一~§三 相同，目标目录
   建议 `/opt/agent-world` 保持一致以复用 `deploy.sh`）。
2. ✿ 创建 `agentworld` 系统用户与 `/var/lib/agent-world` 数据目录（§四 systemd
   三重限制原样照抄：ProtectSystem=strict + ReadWritePaths 数据目录 +
   NoNewPrivileges）。
3. ✿ 从 Mac 异地备份恢复数据：取 `backup-agent-world-to-mac.sh` 的最新快照
   （Mac 本地滚动保留 14 份），rsync db/artifacts/logs 到新机数据目录，
   `PRAGMA integrity_check` 通过（恢复演练步骤复用 2026-09-22 演练记录的做法）。
4. ✿ 恢复密钥：`.encryption-keys` / `.jwt-secret` / `env` 三项从 macOS 登录
   钥匙串取（account=agent-world，service 见 2026-09-22 演练更正记录），
   600 权限放回新机数据目录。
5. ✿ 手动跑一次 `deploy.sh` 等价流程（clone → install → build → systemd
   restart → 健康轮询），nginx site 从 deploy-ubuntu-server.md §五 原样套用。

## 阶段二：CI 接管

6. ✿ 新机安装 GitHub Actions self-hosted runner，标签 `[self-hosted,
   production]`（与现 runner 一致）——`deploy.yml` / `runner-check` / 
   `check-production-runner.sh` 全部零改动，下一笔 dev push 自动落到新机。
7. ✿ 首次真实发布验证：push 一个空 docs commit 触发 Deploy workflow，确认
   runner-check 绿 + deploy ~1.5min 完成 + 健康轮询 15s 通过。

## 阶段三：DNS 切换与回滚

8. ✿ 生产域名 A 记录切到新机 IP；TTL 先调低（≤300s）再切换。
9. 回滚预案：旧 Hasee DNS 指向保留 7 天；期间任何生产问题把 DNS 切回
   （数据差异 = 切换后新机新写入，回滚前用 remote-snapshot 反向拉一次）。
10. ✿ 稳定 7 天后：Hasee 下线登记（backup 目录保留），拍板清单 #7 关闭。

## 明确不做

- 不迁数据库引擎（SQLite 继续用，单机形态够当前流量）。
- 不在迁移中顺带改架构（nginx/systemd/deploy.sh 原样）——迁移窗口越窄越好。
- 不保留 Hasee 常开（下线后 backup 走 Mac 端，与现状一致）。
