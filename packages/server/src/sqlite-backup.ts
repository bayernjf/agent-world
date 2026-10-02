/** Startup snapshot/backup of the on-disk database (audit P2 split). */
import { type DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "./logger.js";

export const BACKUP_RETENTION = 5;

/**
 * Take a consistent snapshot of an existing on-disk database before migrations
 * run, so a botched upgrade never destroys the only copy of event history.
 * Snapshots live in a `backups/` folder next to the database file and are
 * pruned to the newest BACKUP_RETENTION files. In-memory and first-run databases
 * are skipped — there is nothing worth snapshotting yet.
 */
export function backupDatabase(db: DatabaseSync, file: string): void {
  if (file === ":memory:" || !existsSync(file)) return;
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size === 0) return;

    const dir = join(dirname(file), "backups");
    mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = join(dir, `pre-migration-${stamp}.db`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

    // Prune oldest snapshots beyond the retention window.
    const entries = readdirSync(dir)
      .filter((name) => /^pre-migration-.*\.db$/.test(name))
      .map((name) => ({ name, time: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const old of entries.slice(BACKUP_RETENTION)) {
      rmSync(join(dir, old.name), { force: true });
    }
  } catch {
    // Backup failures must never block startup; migrations still run.
  }
}

/**
 * SQLite driver factory: opens the database, runs migrations, and returns the
 * `SqliteDriver` implementation (every method async). Re-exported as `openDb`
 * from `db.ts` for backward compatibility; a future `DB_DRIVER=postgres` switch
 * would return a `PgDriver` here instead.
 * （design-postgres-migration.md §10.2 步骤 1）
 */

