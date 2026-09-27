#!/usr/bin/env bash
# Agent World 恢复 / 恢复演练（restore drill）
# ---------------------------------------------------------------
# 把 runbook（docs/runbooks/deploy-ubuntu-server.md §6之一）里只以 heredoc
# 形式存在的恢复流程固化为可复用脚本，校验「备份 + 密钥 + 数据」真的能还原。
#
# 两种模式：
#   * 演练（默认）：--source <备份目录>
#       拷贝到临时目录 → 校验 sqlite 完整性/行数 → 检查密钥 → 用恢复数据
#       起临时 server 打 /api/health → 清理。不影响生产（临时目录 + 独立端口）。
#   * 实恢复：--source <备份目录> --to <数据目录>
#       把备份恢复到指定目录（请先停 server）。缺密钥直接失败退出——绝不能
#       带着新建的空 keyring 起生产，否则已加密字段会被永久锁死。
#
# 用法：
#   bash scripts/restore-agent-world.sh --source /var/backups/agent-world/current
#   bash scripts/restore-agent-world.sh --source <备份> --to /var/lib/agent-world
#   bash scripts/restore-agent-world.sh --source <备份> --port 8899 --no-boot
#
# 选项：
#   --source DIR   备份目录（必填，须含数据文件）
#   --to DIR       实恢复目标目录；省略即演练
#   --port N       演练临时 server 端口（默认 8899）
#   --no-boot      跳过启动验证，只做数据 + 密钥校验
#   --delete       实恢复时镜像删除目标多余文件（默认只增量覆盖，保守）
#   --force        目标目录非空时仍继续
#
# 环境变量：
#   NODE_BIN       node 可执行文件（默认 node；需 ≥24 才有 node:sqlite）
#   AW_DB_NAME     数据文件名（默认 agent-world.sqlite）
#   SERVER_ENTRY   临时 server 入口（默认 <repo>/packages/server/dist/index.js）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"
AW_DB_NAME="${AW_DB_NAME:-agent-world.sqlite}"
SERVER_ENTRY="${SERVER_ENTRY:-$ROOT/packages/server/dist/index.js}"

SOURCE=""
TARGET=""
PORT="${PORT:-8899}"
BOOT=1
DELETE=0
FORCE=0

usage() {
  sed -n '2,31p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --to)     TARGET="${2:-}"; shift 2 ;;
    --port)   PORT="${2:-}"; shift 2 ;;
    --no-boot) BOOT=0; shift ;;
    --delete) DELETE=1; shift ;;
    --force)  FORCE=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "未知参数: $1" >&2; usage 2 ;;
  esac
done

if [[ -z "$SOURCE" ]]; then
  echo "错误：必须给 --source <备份目录>" >&2
  usage 2
fi
SOURCE_ARG="$SOURCE"
SOURCE="$(cd "$SOURCE_ARG" 2>/dev/null && pwd)" || { echo "错误：备份目录不存在：$SOURCE_ARG" >&2; exit 1; }
if [[ ! -f "$SOURCE/$AW_DB_NAME" ]]; then
  echo "错误：$SOURCE 下没有 $AW_DB_NAME" >&2
  exit 1
fi

REAL=0
if [[ -n "$TARGET" ]]; then
  REAL=1
fi

if [[ $REAL -eq 1 ]]; then
  mkdir -p "$TARGET"
  TARGET="$(cd "$TARGET" && pwd)"
  if [[ "$TARGET" == "$SOURCE" ]]; then
    echo "错误：--to 不能与 --source 相同" >&2
    exit 1
  fi
  if [[ -n "$(ls -A "$TARGET")" && $FORCE -ne 1 ]]; then
    echo "错误：目标目录非空：${TARGET}（确认无误后加 --force）" >&2
    exit 1
  fi
  DEST="$TARGET"
  CLEANUP=0
  # 实恢复不自动起服务：交由运维停/起 systemd，避免脚本猜测服务名。
  BOOT=0
else
  TMPBASE="${TMPDIR:-/tmp}"
  DEST="$(mktemp -d "${TMPBASE%/}/aw-restore-drill-XXXXXX")"
  CLEANUP=1
fi

cleanup() {
  if [[ $CLEANUP -eq 1 ]]; then
    rm -rf "$DEST"
  fi
  return 0
}
trap cleanup EXIT

echo "[1/4] 拷贝备份 → $DEST"
RSYNC_OPTS=(-a)
if [[ $DELETE -eq 1 ]]; then
  RSYNC_OPTS+=(--delete)
fi
rsync "${RSYNC_OPTS[@]}" "$SOURCE/" "$DEST/"

echo "[2/4] 校验 sqlite 完整性 + 行数"
if ! DB_FILE="$DEST/$AW_DB_NAME" "$NODE_BIN" -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.env.DB_FILE, { readOnly: true });
  const integ = db.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]).join(",");
  const n = (t) => { try { return db.prepare("SELECT COUNT(*) n FROM " + t).get().n; } catch { return "n/a"; } };
  console.log("integrity_check:", integ);
  console.log("users:", n("users"), "graphs:", n("graphs"), "runs:", n("runs"));
  db.close();
  if (integ !== "ok") process.exit(3);
'; then
  echo "❌ sqlite 完整性校验未通过，恢复中止" >&2
  exit 1
fi

KEYS_OK=1
[[ -f "$DEST/.jwt-secret" ]] || KEYS_OK=0
[[ -f "$DEST/.encryption-keys" ]] || KEYS_OK=0
if [[ $KEYS_OK -eq 1 ]]; then
  echo "[3/4] 密钥文件齐全（.jwt-secret / .encryption-keys）"
else
  echo "[3/4] ⚠️  备份缺密钥（.jwt-secret / .encryption-keys）——加密字段无法解封"
  if [[ $REAL -eq 1 ]]; then
    echo "❌ 实恢复缺密钥，拒绝继续（带新 keyring 起生产会永久锁死加密字段）" >&2
    exit 1
  fi
fi

if [[ $BOOT -eq 1 ]]; then
  echo "[4/4] 用恢复数据起临时 server（端口 ${PORT}）验证"
  if [[ ! -f "$SERVER_ENTRY" ]]; then
    echo "错误：找不到 server 入口 ${SERVER_ENTRY}（先在仓库根 pnpm -r build）" >&2
    exit 1
  fi
  DB_FILE="$DEST/$AW_DB_NAME" PORT="$PORT" "$NODE_BIN" "$SERVER_ENTRY" > "$DEST/server.log" 2>&1 &
  SRV_PID=$!
  HEALTH=""
  for _ in $(seq 1 24); do
    HEALTH="$(curl -sf "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
    if [[ -n "$HEALTH" ]]; then
      break
    fi
    if ! kill -0 "$SRV_PID" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
  kill "$SRV_PID" 2>/dev/null || true
  wait "$SRV_PID" 2>/dev/null || true
  if [[ -z "$HEALTH" ]]; then
    echo "❌ 临时 server 未就绪（health 未 200）——server.log 末尾：" >&2
    tail -n 15 "$DEST/server.log" >&2 || true
    exit 1
  fi
  echo "$HEALTH"
else
  echo "[4/4] 跳过启动验证"
fi

if [[ $REAL -eq 1 ]]; then
  echo "✅ 实恢复完成：${DEST}（下一步：systemctl start agent-world）"
else
  if [[ $KEYS_OK -eq 1 ]]; then
    echo "✅ 恢复演练通过（数据 + 密钥 + 启动）"
  else
    echo "✅ 恢复演练通过（数据 + 启动）；⚠️ 密钥缺失，加密字段仍未验证"
  fi
fi
