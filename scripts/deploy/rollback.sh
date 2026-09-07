#!/usr/bin/env bash
# 一键回滚：回退到 deploy.sh 记录的「上一个好版本」commit，重建并重启。
# 用法：sudo /opt/agent-world/rollback.sh
set -euo pipefail
cd /opt/agent-world

PREV=$(cat /var/lib/agent-world/.last-known-good 2>/dev/null || true)
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
echo "rolled back to $PREV"
