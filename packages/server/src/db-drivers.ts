import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * Database driver abstraction for the `database` node. A driver executes SQL
 * and reports either a row set (query statements) or an affected-row summary
 * (DML). SQLite is the first implementation, backed by the built-in
 * `node:sqlite` module — zero new dependencies. The interface leaves room for
 * MySQL / PostgreSQL / MongoDB drivers later.
 */

export interface DatabaseQueryResult {
  /** Row set for query statements (SELECT / WITH / PRAGMA / EXPLAIN). */
  rows?: Record<string, unknown>[];
  /** Column names for `rows`. */
  columns?: string[];
  /** Affected row count for DML statements (INSERT / UPDATE / DELETE / DDL). */
  affectedRows?: number;
  /** Last inserted row id — only meaningful after INSERT. */
  lastInsertId?: number | bigint;
}

export interface DatabaseDriver {
  readonly kind: string;
  /**
   * Execute setup statements before the main query. Multiple `;`-separated
   * statements are allowed (e.g. `CREATE TABLE …; INSERT …;`); results are
   * discarded. No-op for empty input.
   */
  setup(sql: string): void;
  /**
   * Execute a single SQL statement with optional bound parameters. Query
   * statements return `{ rows, columns }`; everything else returns
   * `{ affectedRows, lastInsertId }`.
   */
  query(
    sql: string,
    opts?: { positional?: unknown[]; named?: Record<string, unknown> },
  ): DatabaseQueryResult;
  close(): void;
}

/** Statements that produce a result set. Everything else is treated as DML. */
const QUERY_RE = /^\s*(select|with|pragma|explain)\b/i;

export function createSqliteDriver(path?: string): DatabaseDriver {
  const db = path ? new DatabaseSync(path) : new DatabaseSync(":memory:");
  return {
    kind: "sqlite",
    setup(sql) {
      if (!sql.trim()) return;
      db.exec(sql);
    },
    query(sql, opts = {}) {
      // Named bindings win when present (single object argument); otherwise the
      // positional list is spread as anonymous parameters.
      const positional = (opts.positional ?? []) as SQLInputValue[];
      const named = (opts.named ?? {}) as Record<string, SQLInputValue>;
      const useNamed = Object.keys(named).length > 0;
      const stmt = db.prepare(sql);
      if (QUERY_RE.test(sql)) {
        const rows = (useNamed ? stmt.all(named) : stmt.all(...positional)) as Record<
          string,
          unknown
        >[];
        return { rows, columns: stmt.columns().map((c) => c.name) };
      }
      const info = (useNamed ? stmt.run(named) : stmt.run(...positional)) as {
        changes: number | bigint;
        lastInsertRowid: number | bigint;
      };
      return { affectedRows: Number(info.changes), lastInsertId: info.lastInsertRowid };
    },
    close() {
      db.close();
    },
  };
}
