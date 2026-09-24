/**
 * Shared guard for the two sqlite-only maintenance scripts
 * (prune-events.ts, migrate-down.ts).
 *
 * Both used to open `DB_FILE ?? "agent-world.sqlite"`. Two ways that goes
 * wrong, both silently:
 *   - node:sqlite creates a missing file, so a typo'd path pruned 0 rows and
 *     reported success — and run from the repo root it hits the empty ghost DB
 *     that already caused a server incident (handoff Known issues).
 *   - neither script can work on PostgreSQL (migrations' `down` steps are
 *     sqlite DDL), so under DB_DRIVER=postgres they would quietly operate on
 *     the wrong store while a SaaS deployment's real data stayed untouched.
 *
 * Hence: refuse on postgres, and require a file that already exists.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = resolve(import.meta.dirname, "..");

export function openSqliteOpsDb(purpose: string): { db: DatabaseSync; file: string } {
  const driver = process.env.DB_DRIVER?.trim() || "sqlite";
  if (driver !== "sqlite") {
    console.error(
      `${purpose}: DB_DRIVER=${driver} is not supported. This tool is SQLite-only; ` +
        `there is no PostgreSQL equivalent for it yet (see docs/design-postgres-migration.md).`,
    );
    process.exit(1);
  }

  // The real database lives under packages/server; the repo-root file is the
  // empty ghost that has already fooled this repo once.
  const file = resolve(process.env.DB_FILE ?? join(REPO_ROOT, "packages/server/agent-world.sqlite"));
  if (!existsSync(file)) {
    console.error(
      `${purpose}: no database at ${file}. Set DB_FILE explicitly rather than ` +
        `letting this create an empty database and report a clean no-op.`,
    );
    process.exit(1);
  }
  return { db: new DatabaseSync(file), file };
}
