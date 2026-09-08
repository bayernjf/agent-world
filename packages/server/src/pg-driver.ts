import { Client, type ClientConfig } from "pg";
import { toPgDdl, toPgPlaceholders } from "./pg-sql.js";
import { createDriver, DDL, type Executor } from "./sqlite-driver.js";

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
