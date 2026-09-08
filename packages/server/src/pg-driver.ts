import { Client, type ClientConfig } from "pg";
import { toPgDdl, toPgPlaceholders } from "./pg-sql.js";
import { createDriver, DDL, type Executor } from "./sqlite-driver.js";

// node-pg parses int8/bigint as string by default. The DDL maps SQLite
// INTEGER columns to bigint (epoch-ms timestamps need the range), but the
// shared driver body does arithmetic and strict-equality on them as numbers
// (Date.now() - created_at, countOwners === 0). Epoch millis are far below
// Number.MAX_SAFE_INTEGER, so a numeric parser is safe and keeps PG rows
// shape-identical to SQLite rows. (COUNT(*) also returns int8 — covered.)
import pg from "pg";
pg.types.setTypeParser(20, (v: string) => parseInt(v, 10));

/**
 * PostgreSQL driver (design-postgres-migration.md §5.2 / §5.3 阶段 2).
 * Reuses the shared 137-method driver body from `sqlite-driver.ts`, swapping
 * only the executor: `?` placeholders are translated to `$n` at query time and
 * the schema is derived from the SQLite DDL via `toPgDdl`.
 */

function createPgExecutor(client: Client): Executor {
  return {
    async get(sql, params) {
      const res = await client.query(toPgPlaceholders(sql), params);
      return res.rows[0];
    },
    async all(sql, params) {
      const res = await client.query(toPgPlaceholders(sql), params);
      return res.rows;
    },
    async run(sql, params) {
      const res = await client.query(toPgPlaceholders(sql), params);
      // All primary keys are business-generated TEXT, so there is no
      // last-insert rowid to surface (design §3).
      return { changes: res.rowCount ?? 0, lastInsertId: 0 };
    },
    async exec(sql) {
      await client.query(sql);
    },
  };
}

/**
 * Open a PostgreSQL-backed driver. Connects, creates the schema (derived from
 * the SQLite DDL), and returns the shared driver body bound to `"postgres"`.
 */
export async function createPgDriver(config: ClientConfig) {
  const client = new Client(config);
  await client.connect();
  await client.query(toPgDdl(DDL));
  return createDriver(
    createPgExecutor(client),
    {
      close: async () => {
        await client.end();
      },
      prepare: () => {
        throw new Error("prepare passthrough is SQLite-only (FTS5)");
      },
    },
    "postgres",
  );
}
