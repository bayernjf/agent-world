/**
 * Prune events older than PRUNE_EVENTS_DAYS (default 90) from the database.
 *
 * Safe to run: `runs.snapshot` retains each run's full state (design-scaling
 * §2.1), so the archived event history can be reconstructed from the snapshot.
 *
 * Usage:  DB_FILE=/path/to/db.sqlite PRUNE_EVENTS_DAYS=90 npx tsx scripts/prune-events.ts
 * DB_FILE defaults to packages/server/agent-world.sqlite and must already exist.
 *
 * The DELETE goes through the db abstraction (driver.pruneOldEvents) rather
 * than hand-written SQL so the statement never forks from the live
 * MaintenanceLoop (AGENTS.md: data access via db.ts). The sqlite-ops guard is
 * kept: this tool is SQLite-only and must not create/migrate a database.
 */
import { createDriver } from "../packages/server/src/driver-body.js";
import { createSqliteExecutor } from "../packages/server/src/sqlite-driver.js";
import { openSqliteOpsDb } from "./sqlite-ops-db.js";

const { db, file } = openSqliteOpsDb("prune-events");
const driver = createDriver(
  createSqliteExecutor(db),
  {
    close: async () => db.close(),
    prepare: (sql: string) => db.prepare(sql),
  },
  "sqlite",
);
const days = Number(process.env.PRUNE_EVENTS_DAYS ?? 90);
const before = Date.now() - days * 24 * 60 * 60 * 1000;

try {
  const pruned = await driver.pruneOldEvents(before);
  console.log(`pruned ${pruned} events older than ${days} days (${file})`);
} finally {
  await driver.close();
}
