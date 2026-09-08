/**
 * SQLite → PostgreSQL migration CLI (design-postgres-migration.md §6.1 方案 A).
 *
 * Usage:
 *   DB_FILE=/path/to/agent-world.sqlite \
 *   DATABASE_URL=postgres://... \
 *   pnpm --filter @agent-world/server exec tsx scripts/migrate-to-postgres.ts \
 *     [--dry-run] [--verify-only]
 *
 * --dry-run needs no PG: it prints the per-table plan from the SQLite side.
 * A real run takes a VACUUM INTO snapshot of the source first — that file is
 * the rollback base; keep it (§7). Exit code is non-zero on row-count
 * mismatch.
 */
import { migrateToPostgres } from "../src/migrate-to-postgres.js";
import { pgConfigFromEnv } from "../src/db.js";

const args = process.argv.slice(2);
const dryRun = args.some((a) => a === "--dry-run" || a === "--dry-run=true");
const verifyOnly = args.some((a) => a === "--verify-only" || a === "--verify-only=true");

const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
try {
  const report = await migrateToPostgres({
    dbFile,
    // Config resolution is skipped for dry-run (no PG connection needed), but
    // resolving it anyway gives an early actionable error for real runs.
    pgConfig: dryRun ? {} : pgConfigFromEnv(),
    dryRun,
    verifyOnly,
  });

  const width = Math.max(...report.tables.map((t) => t.table.length), "TABLE".length);
  const mode = report.dryRun ? "  [dry-run]" : report.verifyOnly ? "  [verify-only]" : "";
  console.log(`source: ${report.sqliteFile}${mode}`);
  if (report.snapshot) console.log(`snapshot (rollback base, keep it): ${report.snapshot}`);
  console.log(`${"TABLE".padEnd(width)}  ${"SQLITE".padStart(8)}  ${"PG".padStart(8)}  ${"COPIED".padStart(8)}  NOTE`);
  for (const t of report.tables) {
    const note = t.skipped ?? (t.pgRows !== null && t.pgRows !== t.sqliteRows ? "ROW COUNT MISMATCH" : "");
    console.log(
      `${t.table.padEnd(width)}  ${String(t.sqliteRows).padStart(8)}  ${String(t.pgRows ?? "-").padStart(8)}  ${String(t.copied).padStart(8)}  ${note}`,
    );
  }
  const mismatch = report.tables.some((t) => t.pgRows !== null && t.pgRows !== t.sqliteRows);
  if (report.dryRun) {
    console.log("dry-run: no PG connection, no writes. Re-run without --dry-run to migrate.");
  } else if (mismatch) {
    console.error("ROW COUNT MISMATCH — do not switch DB_DRIVER; inspect the tables above and the snapshot.");
    process.exitCode = 1;
  } else if (!report.verifyOnly) {
    console.log("all tables aligned. Next: restart with DB_DRIVER=postgres (keep the snapshot for rollback).");
  }
} catch (err) {
  console.error(`migration aborted: ${(err as Error).message}`);
  process.exitCode = 1;
}
