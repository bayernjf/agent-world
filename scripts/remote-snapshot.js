#!/usr/bin/env node
// 远程一致快照：用 node:sqlite 只读打开 live 库，VACUUM INTO 生成一致快照。
// 替代服务器端 backup 脚本里因未装 sqlite3 而静默失败的 wal_checkpoint 方案：
// VACUUM INTO 读到的是一致性视图（含 WAL 内容），不干扰运行中的 server，也不依赖 sqlite3 CLI。
// 用法：node remote-snapshot.js <db-path> <snapshot-output-path>
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const dbPath = process.argv[2];
const outPath = process.argv[3];
if (!dbPath || !outPath) {
  console.error("usage: node remote-snapshot.js <db-path> <snapshot-output-path>");
  process.exit(2);
}
// VACUUM INTO 不允许覆盖已存在文件，先清掉上次残留
fs.rmSync(outPath, { force: true });
const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("VACUUM INTO '" + outPath.replace(/'/g, "''") + "'");
db.close();
console.log("snapshot ok: " + outPath);
