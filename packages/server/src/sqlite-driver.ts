import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";

import { backupDatabase } from "./sqlite-backup.js";
import { DDL, runMigrations } from "./sqlite-schema.js";
import { createDriver } from "./driver-body.js";

export function createSqliteDriver(file: string) {
  const db = new DatabaseSync(file);
  // Snapshot before any schema work. On a brand-new file the size is 0 here
  // (the WAL pragma below would otherwise write a header), so first-run
  // databases correctly produce no backup.
  backupDatabase(db, file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(DDL);
  runMigrations(db);

  return createDriver(createSqliteExecutor(db), {
    close: async () => {
      db.close();
    },
    prepare: (sql: string) => db.prepare(sql),
  }, "sqlite");
}

/**
 * SQL execution abstraction shared by `createSqliteDriver` and the future
 * `PgDriver`. Methods take a raw SQL string plus positional parameters so the
 * driver body can stay identical across backends — only the executor (and its
 * SQL translation) differs. (design-postgres-migration.md §5.2)
 */
export interface Executor {
  get(sql: string, params: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  run(sql: string, params: unknown[]): Promise<{ changes: number; lastInsertId: number | bigint }>;
  exec(sql: string): Promise<void>;
}

/** Executor backed by the synchronous `node:sqlite` DatabaseSync (wrapped async). */
function createSqliteExecutor(db: DatabaseSync): Executor {
  return {
    async get(sql, params) {
      return db.prepare(sql).get(...(params as SQLInputValue[])) as Record<string, unknown> | undefined;
    },
    async all(sql, params) {
      return db.prepare(sql).all(...(params as SQLInputValue[])) as Record<string, unknown>[];
    },
    async run(sql, params) {
      const r = db.prepare(sql).run(...(params as SQLInputValue[])) as {
        changes: number | bigint;
        lastInsertRowid: number | bigint;
      };
      return { changes: Number(r.changes), lastInsertId: r.lastInsertRowid };
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}

/**
 * Builds the shared driver body (137 methods) on top of an `Executor`. Hooks
 * cover the two backend-specific capabilities that aren't SQL execution:
 * closing the connection and the raw `prepare` passthrough (SQLite-only FTS5).
 */

/**
 * If the users table is empty but data tables have rows (pre-auth database),
 * create a default user and assign all existing data to it. This ensures
 * zero-downtime migration for dev databases.
 */
export async function backfillExistingData(database: { prepare(sql: string): Promise<{ get(...args: unknown[]): unknown; run(...args: unknown[]): unknown }> }): Promise<void> {
  const userCount = ((await database.prepare("SELECT COUNT(*) as c FROM users")).get() as { c: number }).c;
  if (userCount > 0) return;

  const graphCount = ((await database.prepare("SELECT COUNT(*) as c FROM graphs")).get() as { c: number }).c;
  if (graphCount === 0) return;

  const defaultUserId = randomUUID();
  const defaultEmail = "admin@local.dev";
  const placeholderHash = "__no_login__";

  // The backfilled user is the only account in this scenario — it bootstraps
  // as owner (RBAC P0, design-rbac.md).
  (await database.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'owner')")).run(
    defaultUserId,
    defaultEmail,
    placeholderHash,
  );
  (await database.prepare("UPDATE graphs SET user_id = ? WHERE user_id IS NULL")).run(defaultUserId);
  (await database.prepare("UPDATE runs SET user_id = ? WHERE user_id IS NULL")).run(defaultUserId);
  (await database.prepare("UPDATE brand_terms SET user_id = ? WHERE user_id IS NULL")).run(defaultUserId);
  // Migration 15 already attributed run/graph-linked artifacts; whatever is still
  // ownerless here is a pre-auth upload with no link to follow.
  (await database.prepare("UPDATE artifacts SET user_id = ? WHERE user_id IS NULL")).run(defaultUserId);
}

/**
 * Re-exports for the audit P2 split. The driver body now lives in
 * driver-body.ts (shared with the PostgreSQL driver); schema/migrations live
 * in sqlite-schema.ts; row mappers in sqlite-mappers.ts; startup backup in
 * sqlite-backup.ts; demo-cascade table lists in sqlite-cascade.ts.
 */
export { contentHash } from "./sqlite-mappers.js";
export type { InvoiceRow } from "./sqlite-schema.js";
export { DDL, SCHEMA_VERSION, rollbackLatestMigration } from "./sqlite-schema.js";
export { BACKUP_RETENTION } from "./sqlite-backup.js";
export {
  DEMO_CASCADE_INDIRECT_TABLES,
  DEMO_CASCADE_DIRECT_TABLES,
  DEMO_CASCADE_GLOBAL_TABLES,
} from "./sqlite-cascade.js";
export { createDriver } from "./driver-body.js";
