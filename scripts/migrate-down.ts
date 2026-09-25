/**
 * Roll back the most recently applied DB migration (one step).
 *
 * Usage:  DB_FILE=/path/to/db.sqlite npx tsx scripts/migrate-down.ts
 * Refuses when the latest migration has no `down` step (data migrations
 * without a safe inverse) — see rollbackLatestMigration in the server's
 * sqlite driver, where those `down` bodies live.
 *
 * SQLite only: the guard in sqlite-ops-db.ts exits rather than opening the
 * wrong store, because the migration `down` steps are sqlite DDL.
 */
import { rollbackLatestMigration } from "../packages/server/src/db.js";
import { openSqliteOpsDb } from "./sqlite-ops-db.js";

const { db, file } = openSqliteOpsDb("migrate-down");

try {
  const result = rollbackLatestMigration(db);
  if (result) {
    console.log(`rolled back migration ${result.version}: ${result.description} (${file})`);
  } else {
    console.log(`no migrations applied — nothing to roll back (${file})`);
  }
} finally {
  db.close();
}
