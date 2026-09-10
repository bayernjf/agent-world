#!/usr/bin/env bash
# Agent World 异地备份：Hasee 服务器 → 本地 Mac
# ---------------------------------------------------------------
# 补上 deferred-items「异地备份推送」缺口：服务器备份与原库同盘，
# 本脚本把一致快照（db + artifacts + logs）每日拉到 Mac 本机。
#
# 一致性保证：远端用 node:sqlite 只读 VACUUM INTO 生成一致快照
# （含 WAL 内容、不干扰运行中的 server），不依赖服务器端
# wal_checkpoint（服务器未装 sqlite3 的已知缺口不影响本链路）。
#
# 用法：
#   bash backup-agent-world-to-mac.sh            # 正常执行（当天已备份则跳过）
#   bash backup-agent-world-to-mac.sh --force    # 忽略幂等标记强制执行
#
# 定时：~/Library/LaunchAgents/com.agent-world.backup.plist（每日 11:00 + 登录补跑）
# 日志：$DEST/backup.log   幂等标记：$DEST/.last-backup-YYYY-MM-DD
set -euo pipefail

# ---- 配置 ----
SSH_HOST="${AW_BACKUP_SSH_HOST:-hasee-2016-server}"
REMOTE_LIVE=/var/lib/agent-world
REMOTE_SNAP=/tmp/aw-mac-snapshot.db
REMOTE_JS=/tmp/aw-mac-snapshot.js
DEST="/Users/jiangfeng/000-工作项目/agent-world数据备份"
KEEP_DB=14          # 数据库快照保留份数
INCLUDE_KEYS=0      # 是否拉取 .encryption-keys/.jwt-secret（600 权限，当前 SSH 用户读不到；密钥建议单独保管）

# ---- 解析参数 ----
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

mkdir -p "$DEST/db" "$DEST/artifacts" "$DEST/logs"
log() { echo "[$(date '+%F %T %Z')] $*" | tee -a "$DEST/backup.log"; }

# ---- 幂等：当天已成功备份则跳过（--force 除外）----
TODAY=$(date +%F)
if [[ $FORCE -ne 1 && -f "$DEST/.last-backup-$TODAY" ]]; then
  log "今天（${TODAY}）已备份过，跳过（--force 可强制执行）"
  exit 0
fi

log "=== 开始异地备份 ${TODAY} ==="

# ---- 1. 远端生成一致快照 ----
scp -q "$(dirname "$0")/remote-snapshot.js" "$SSH_HOST:$REMOTE_JS"
ssh "$SSH_HOST" "node '$REMOTE_JS' '$REMOTE_LIVE/agent-world.sqlite' '$REMOTE_SNAP'" \
  || { log "FAIL 远端快照生成失败"; exit 1; }
log "远端一致快照生成完成"

# ---- 2. 拉取数据库快照（按日期命名，滚动保留）----
DB_NAME="agent-world-${TODAY}.sqlite"
rsync -a "$SSH_HOST:$REMOTE_SNAP" "$DEST/db/$DB_NAME"
log "数据库快照拉取完成: ${DB_NAME}"

# 本地校验（macOS 自带 sqlite3 CLI）
CHECK=$(sqlite3 "$DEST/db/$DB_NAME" 'PRAGMA integrity_check;' 2>&1) || true
if [[ "$CHECK" != "ok" ]]; then
  log "FAIL 本地完整性校验未通过: ${CHECK}"
  exit 1
fi
log "本地完整性校验通过 (integrity_check=ok)"

# 滚动保留：只留最近 $KEEP_DB 份
ls -1t "$DEST"/db/agent-world-*.sqlite 2>/dev/null | tail -n +$((KEEP_DB + 1)) | while read -r old; do
  rm -f "$old"
done

# ---- 3. 拉取 artifacts 与 logs（增量合并）----
rsync -a "$SSH_HOST:$REMOTE_LIVE/artifacts/" "$DEST/artifacts/"
rsync -a "$SSH_HOST:$REMOTE_LIVE/logs/" "$DEST/logs/"
log "artifacts / logs 拉取完成"

# ---- 4. 密钥（默认不拉；如需开启设 INCLUDE_KEYS=1，但 600 权限需 agentworld 身份）----
if [[ $INCLUDE_KEYS -eq 1 ]]; then
  mkdir -p "$DEST/secrets"
  if rsync -a "$SSH_HOST:$REMOTE_LIVE/.encryption-keys" "$SSH_HOST:$REMOTE_LIVE/.jwt-secret" "$DEST/secrets/" 2>/dev/null; then
    log "密钥已拉取（注意：与数据同放，安全边界请自行评估）"
  else
    log "WARN 密钥拉取失败（600 权限，当前用户读不到）——密钥请单独保管"
  fi
else
  log "密钥未包含（INCLUDE_KEYS=0）；恢复加密字段需要单独保管的 .encryption-keys / .jwt-secret"
fi

# ---- 5. 收尾 ----
touch "$DEST/.last-backup-$TODAY"
log "=== 异地备份完成: db=$(du -h "$DEST/db/$DB_NAME" | cut -f1) artifacts=$(du -sh "$DEST/artifacts" 2>/dev/null | cut -f1) 总=$(du -sh "$DEST" | cut -f1) ==="
