#!/usr/bin/env bash
# 一键回滚：回退到 deploy.sh 记录的「上一个好版本」commit，重建、重启并做健康检查。
#
# 单一事实源同 deploy.sh：服务器 /opt/agent-world/rollback.sh 只是
# `exec bash /opt/agent-world/scripts/deploy/rollback.sh` 的固定入口。
# 用法：sudo /opt/agent-world/rollback.sh
set -euo pipefail
cd /opt/agent-world

HEALTH_URL="http://127.0.0.1:8791/api/health"
LKG_FILE="/var/lib/agent-world/.last-known-good"

healthy() { curl -sf "$HEALTH_URL" >/dev/null 2>&1; }

PREV=$(cat "$LKG_FILE" 2>/dev/null || true)
if [ -z "$PREV" ]; then
  echo "no previous known-good commit recorded" >&2
  exit 1
fi

CURRENT=$(git rev-parse HEAD)
if [ "$PREV" = "$CURRENT" ]; then
  echo "already at last known-good commit ($PREV)" >&2
  exit 1
fi

echo "rolling back to $PREV"
git reset --hard "$PREV"
corepack pnpm install --frozen-lockfile
corepack pnpm -r build
sudo systemctl restart agent-world

ok=false
for i in 1 2 3 4 5; do
  sleep 3
  if healthy; then ok=true; break; fi
done

if $ok; then
  echo "rolled back to $PREV (healthy)"
else
  echo "rolled back to $PREV BUT health check still failing — inspect: sudo journalctl -u agent-world -n 200" >&2
  exit 1
fi
