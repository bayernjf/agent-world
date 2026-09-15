#!/usr/bin/env bash
# CI/CD 部署脚本（Hasee self-hosted runner 执行）。
#
# 单一事实源：部署逻辑只维护这份 git 跟踪的脚本。服务器 /opt/agent-world/deploy.sh
# 只是 `exec bash /opt/agent-world/scripts/deploy/deploy.sh` 的固定入口
#（.github/workflows/deploy.yml 写死了该绝对路径），不再放逻辑副本，避免两份漂移。
#
# 每次部署前记录「上一个好版本」commit，供 rollback.sh 一键回退；部署后健康检查，
# 失败时提示手动回滚。脚本幂等：install/build/restart 均可安全重复执行。
set -euo pipefail
cd /opt/agent-world

HEALTH_URL="http://127.0.0.1:8791/api/health"
LKG_FILE="/var/lib/agent-world/.last-known-good"

healthy() { curl -sf "$HEALTH_URL" >/dev/null 2>&1; }

# 记录回滚点：仅当「当前在跑的版本健康」时才更新。否则上一次部署已失败（HEAD 停在
# 坏 commit、服务没起来），再跑部署会把坏版本写成回滚点，rollback 就回不到好版本。
if healthy; then
  git rev-parse HEAD > "$LKG_FILE"
  echo "last-known-good -> $(cat "$LKG_FILE")"
else
  echo "WARN: service unhealthy before deploy; keep existing last-known-good ($(cat "$LKG_FILE" 2>/dev/null || echo none))" >&2
fi

git pull --ff-only
corepack pnpm install --frozen-lockfile
corepack pnpm -r build
sudo systemctl restart agent-world

# 部署后健康检查（失败提示手动回滚）；最多等 ~15s，覆盖重启后迁移/监听的短暂窗口
ok=false
for i in 1 2 3 4 5; do
  sleep 3
  if healthy; then ok=true; break; fi
done

if $ok; then
  echo "deploy OK: $(git rev-parse --short HEAD)"
else
  echo "deploy FAILED at $(git rev-parse --short HEAD) — run: sudo /opt/agent-world/rollback.sh" >&2
  exit 1
fi
