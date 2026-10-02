import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { openDatabase, openDb } from "./db.js";

/**
 * DB_DRIVER switch guard (design-postgres-migration.md §5.3 阶段 3).
 * The default and explicit "sqlite" open the local file; "postgres" without
 * connection config fails closed with an actionable message; unknown values
 * are rejected instead of silently falling back to SQLite.
 */

const envKeys = ["DB_DRIVER", "DB_FILE", "DATABASE_URL", "PG_HOST", "PG_DATABASE", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_SSL"] as const;

function scrubEnv() {
  for (const k of envKeys) vi.stubEnv(k, "");
}

let tmpDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

function tmpDbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-driver-switch-"));
  tmpDirs.push(dir);
  return join(dir, "db.sqlite");
}

describe("openDatabase driver switch", () => {
  it("defaults to sqlite when DB_DRIVER is unset", async () => {
    scrubEnv();
    const db = await openDatabase();
    expect(db.kind).toBe("sqlite");
    await db.close();
  });

  it("opens sqlite explicitly with DB_DRIVER=sqlite and DB_FILE", async () => {
    scrubEnv();
    vi.stubEnv("DB_DRIVER", "sqlite");
    vi.stubEnv("DB_FILE", tmpDbFile());
    const db = await openDatabase();
    expect(db.kind).toBe("sqlite");
    await db.close();
  });

  it("rejects unknown DB_DRIVER values instead of falling back", async () => {
    scrubEnv();
    vi.stubEnv("DB_DRIVER", "mysql");
    await expect(openDatabase()).rejects.toThrow(/Unknown DB_DRIVER "mysql"/);
  });

  it("DB_DRIVER=postgres without connection config fails closed with guidance", async () => {
    scrubEnv();
    vi.stubEnv("DB_DRIVER", "postgres");
    await expect(openDatabase()).rejects.toThrow(
      /DB_DRIVER=postgres requires DATABASE_URL, or PG_HOST \+ PG_DATABASE/,
    );
  });

  it("openDb (SQLite factory alias) still exposes kind=sqlite", () => {
    const db = openDb(tmpDbFile());
    expect(db.kind).toBe("sqlite");
  });
});

/**
 * SQL-access boundary guard (AGENTS.md「数据访问——必须走 db.ts 抽象层」).
 *
 * `db.ts` is the only sanctioned door to the database: SQL dialect differences
 * must live inside the driver layer so the Postgres port stays a driver swap.
 * A handful of modules legitimately own their own tables / SQLite handles and
 * may use the driver's raw `prepare` passthrough — those are pinned here with
 * a reason. Everything else must call a `db.ts` method. Same shape as the
 * dispatch-gate guard: a source scan that goes red the moment a new module
 * reaches past the abstraction.
 */
describe("raw SQL / SQLite handles stay inside the documented allow-list", () => {
  // Keyed by path relative to `src/` (so a nested module can't hide behind a
  // same-named top-level file). Reason is documentation, not decoration.
  const ALLOWED: Record<string, string> = {
    "sqlite-driver.ts": "the SQLite dialect layer itself (owns prepare / DatabaseSync)",
    "sqlite-schema.ts": "DDL/migration runner of the SQLite dialect layer (audit P2 split from sqlite-driver)",
    "driver-body.ts": "shared driver body of the SQL dialect layer (owns prepare; audit P2 split from sqlite-driver)",
    "db-drivers.ts": "the user `database` node — runs user SQL on its own DB handle",
    "memory.ts": "knowledge-base FTS5 virtual table + triggers (SQLite-only; PG path no-ops)",
    "key-rotation.ts": "standalone re-encryption CLI owning its own DatabaseSync",
    "connectors.ts": "user-defined SQL connectors — the SQL is the feature",
    "migrate-to-postgres.ts": "one-shot SQLite→PG migration script",
  };

  /** Drop block and line comments so a comment mentioning `.prepare(` (e.g. in
   *  maintenance.ts) doesn't count as real usage. `//` after a `:` — as in a
   *  URL — is left intact. */
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

  const RAW_SQL_RE = /\.prepare\(|new\s+DatabaseSync\b/;

  const walkTs = (dir: string, onFile: (full: string) => void): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkTs(full, onFile);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      onFile(full);
    }
  };

  it("no module outside the allow-list calls .prepare( or constructs DatabaseSync", () => {
    const srcDir = join(process.cwd(), "src");
    const offenders: string[] = [];
    walkTs(srcDir, (full) => {
      const rel = relative(srcDir, full);
      if (ALLOWED[rel]) return;
      if (RAW_SQL_RE.test(stripComments(readFileSync(full, "utf8")))) {
        offenders.push(rel);
      }
    });

    expect(
      offenders,
      `这些模块绕过 db.ts 直接碰了裸 SQL / SQLite，将来迁 PG 要逐处返工：${offenders.join(", ")}。若确属刻意例外，请连同理由加进 ALLOWED。`,
    ).toEqual([]);
  });

  it("the allow-list has no stale entries (each listed file really uses raw SQL)", () => {
    const srcDir = join(process.cwd(), "src");
    const stale: string[] = [];
    for (const rel of Object.keys(ALLOWED)) {
      let found = false;
      walkTs(srcDir, (full) => {
        if (relative(srcDir, full) !== rel) return;
        found = RAW_SQL_RE.test(stripComments(readFileSync(full, "utf8")));
      });
      if (!found) stale.push(rel);
    }
    expect(
      stale,
      `这些条目已不再使用裸 SQL，应从 ALLOWED 移除，否则白名单会被撑大而失去意义：${stale.join(", ")}`,
    ).toEqual([]);
  });
});
