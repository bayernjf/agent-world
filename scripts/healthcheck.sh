#!/usr/bin/env bash
# 环境体检（production-ops §2.4）：一键检查服务/配置/数据/依赖四层。
# 用法：./scripts/healthcheck.sh [health_url]
set -uo pipefail
URL="${1:-http://127.0.0.1:8791/api/health}"

echo "== 1. 服务层 =="
systemctl is-active agent-world 2>&1 || echo "（非 systemd 环境可跳过）"

echo ""
echo "== 2. 配置层 + 3. 依赖层（health 探针）=="
BODY=$(curl -sf "$URL" 2>/dev/null || true)
if [ -z "$BODY" ]; then
  echo "❌ health 探针不通：$URL"
  exit 1
fi
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

echo ""
echo "== 4. 快速判定 =="
echo "$BODY" | python3 -c '
import json, sys
try:
    h = json.load(sys.stdin)
    checks = h.get("checks", {})
    ok = bool(h.get("ok")) and checks.get("db") == "ok"
    print("✅ 通过" if ok else "❌ 需处理")
    for k, v in checks.items():
        if isinstance(v, dict):
            for kk, vv in v.items():
                print(f"  {k}.{kk}: {vv}")
        else:
            print(f"  {k}: {v}")
except Exception:
    print("（无法解析 health JSON，请看上面的原始输出）")
'
