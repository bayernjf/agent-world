import { describe, expect, it } from "vitest";
import { toPgDdl, toPgPlaceholders } from "./pg-sql.js";

describe("toPgPlaceholders", () => {
  it("rewrites ? to $1, $2 in order", () => {
    expect(toPgPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?")).toBe(
      "SELECT * FROM t WHERE a = $1 AND b = $2",
    );
  });

  it("skips ? inside single-quoted string literals", () => {
    expect(toPgPlaceholders("SELECT '?' AS q WHERE a = ?")).toBe(
      "SELECT '?' AS q WHERE a = $1",
    );
  });

  it("keeps doubled '' escapes intact and skips ? inside them", () => {
    expect(toPgPlaceholders("INSERT INTO t (v) VALUES ('it''s ?', ?)")).toBe(
      "INSERT INTO t (v) VALUES ('it''s ?', $1)",
    );
  });

  it("returns the input unchanged when there are no placeholders", () => {
    expect(toPgPlaceholders("SELECT 1")).toBe("SELECT 1");
  });

  it("numbers placeholders sequentially across the whole statement", () => {
    expect(toPgPlaceholders("INSERT INTO t VALUES (?, ?, ?)")).toBe(
      "INSERT INTO t VALUES ($1, $2, $3)",
    );
  });
});

describe("toPgDdl", () => {
  it("maps SQLite column types to PostgreSQL", () => {
    const ddl = toPgDdl(`CREATE TABLE t (
      id TEXT PRIMARY KEY,
      n INTEGER NOT NULL DEFAULT 0,
      r REAL
    );`);
    expect(ddl).toContain("id text PRIMARY KEY");
    expect(ddl).toContain("n bigint NOT NULL DEFAULT 0");
    expect(ddl).toContain("r double precision");
  });

  it("rewrites the strftime ISO-8601 default to a UTC to_char", () => {
    const ddl = toPgDdl(
      `created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
    );
    expect(ddl).toContain(
      `DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
    );
  });
});
