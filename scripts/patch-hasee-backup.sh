#!/usr/bin/env bash
# Hasee 备份脚本修复补丁（在 Hasee 服务器上以 sudo 执行）
# ============================================================
# 背景：backup-agent-world.sh 里的 `sqlite3 ... wal_checkpoint` 因机器
# 未装 sqlite3 而报错、被 `|| true` 静默吞掉（deferred-items「异地备份
# 推送」登记坐实）。本补丁把该行换成 node:sqlite 实现的 checkpoint
# （Node 24 已装 /usr/bin/node），先备份原脚本再原地替换，最后手动验证。
#
# 用法：把本文件传到 Hasee 后执行
#   scp scripts/patch-hasee-backup.sh hasee-2016-server:/tmp/
#   ssh hasee-2016-server 'sudo bash /tmp/patch-hasee-backup.sh'
set -euo pipefail

SCRIPT=/usr/local/bin/backup-agent-world.sh
TS=$(date +%Y%m%d-%H%M%S)

echo "==> 检查 node 可用"
node --version

echo "==> 备份原脚本到 $SCRIPT.bak-$TS"
cp -a "$SCRIPT" "$SCRIPT.bak-$TS"

echo "==> 替换 wal_checkpoint 行（sqlite3 → node:sqlite）"
python3 - "$SCRIPT" <<'PY'
import sys, re
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    src = f.read()

old = re.compile(
    r'^\s*sqlite3\s+"\$SRC/agent-world\.sqlite"\s+\'PRAGMA wal_checkpoint\(TRUNCATE\);\'\s+2>/dev/null\s+\|\|\s+true\s*$',
    re.M,
)
new = (
    "node -e 'const {DatabaseSync}=require(\"node:sqlite\"); "
    "const db=new DatabaseSync(process.argv[1]); "
    "db.exec(\"PRAGMA wal_checkpoint(TRUNCATE)\"); db.close()' "
    "\"$SRC/agent-world.sqlite\" || echo \"[backup] wal_checkpoint failed, continuing (rsync copies -wal)\""
)
if not old.search(src):
    print("!! 未找到 sqlite3 checkpoint 行，脚本可能已被修改过；中止（不覆盖）")
    sys.exit(1)
src2 = old.sub(new, src, count=1)
with open(path, "w", encoding="utf-8") as f:
    f.write(src2)
print("==> 替换完成")
PY

echo "==> 替换后脚本内容："
cat "$SCRIPT"

echo "==> 手动执行一次验证（应无 checkpoint 报错）"
bash "$SCRIPT"
echo "==> 验证备份目录最新状态"
ls -la /var/backups/agent-world/current/agent-world.sqlite*

echo "==> 完成。确认无误后可删除备份：sudo rm $SCRIPT.bak-$TS"
