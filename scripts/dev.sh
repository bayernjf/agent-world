#!/usr/bin/env bash
# 一键本地启动：检查 Node 版本 → 启用 corepack → 装依赖 → 类型检查 → 启动 server+web。
# 用法：./scripts/dev.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# server 依赖 node:sqlite，必须 Node >= 24
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "需要 Node >= 24（当前 $(node -v 2>/dev/null || echo '未安装')）。" >&2
  echo "安装：fnm install 24 && fnm use 24（或 nvm install 24）" >&2
  exit 1
fi

corepack enable
pnpm install --frozen-lockfile
pnpm typecheck

echo ""
echo "依赖与类型检查就绪，启动开发服务器（server + web 并行）..."
exec pnpm dev
