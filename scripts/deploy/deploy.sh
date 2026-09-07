#!/usr/bin/env bash
# CI/CD 部署脚本（Hasee self-hosted runner 执行）。
# 每次部署前记录「上一个好版本」commit，供 rollback.sh 一键回退；
# 部署后做健康检查，失败时提示手动回滚。
set -euo pipefail
cd /opt/agent-world

# 记录当前（上一个好版本）commit，供 rollback.sh 回退
git rev-parse HEAD > /var/lib/agent-world/.last-known-good

git pull --ff-only
corepack pnpm install --frozen-lockfile
corepack pnpm -r build
sudo systemctl restart agent-world

# 部署后健康检查（失败提示手动回滚）
sleep 3
if curl -sf http://127.0.0.1:8791/api/health > /dev/null; then
  echo "deploy OK: $(git rev-parse --short HEAD)"
else
  echo "deploy FAILED — run: sudo /opt/agent-world/rollback.sh" >&2
  exit 1
fi
