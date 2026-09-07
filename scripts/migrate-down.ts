/**
 * Roll back the most recently applied DB migration (one step).
 *
 * Usage:  DB_FILE=/path/to/db.sqlite npx tsx scripts/migrate-down.ts
 * Refuses when the latest migration has no `down` step (data migrations
 * without a safe inverse) — see rollbackLatestMigration in db.ts.
 */
import { DatabaseSync } from "node:sqlite";
import { rollbackLatestMigration } from "../src/db.js";

const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
const db = new DatabaseSync(dbFile);
try {
  const result = rollbackLatestMigration(db);
  if (result) {
    console.log(`rolled back migration ${result.version}: ${result.description}`);
  } else {
    console.log("no migrations applied — nothing to roll back");
  }
} finally {
  db.close();
}
