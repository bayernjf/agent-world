/**
 * Prune events older than PRUNE_EVENTS_DAYS (default 90) from the database.
 *
 * Safe to run: `runs.snapshot` retains each run's full state (design-scaling
 * §2.1), so the archived event history can be reconstructed from the snapshot.
 *
 * Usage:  DB_FILE=/path/to/db.sqlite PRUNE_EVENTS_DAYS=90 npx tsx scripts/prune-events.ts
 * DB_FILE defaults to packages/server/agent-world.sqlite and must already exist.
 */
import { openSqliteOpsDb } from "./sqlite-ops-db.js";

const { db, file } = openSqliteOpsDb("prune-events");
const days = Number(process.env.PRUNE_EVENTS_DAYS ?? 90);
const before = Date.now() - days * 24 * 60 * 60 * 1000;

try {
  const pruned = Number(db.prepare("DELETE FROM events WHERE ts < ?").run(before).changes);
  console.log(`pruned ${pruned} events older than ${days} days (${file})`);
} finally {
  db.close();
}
