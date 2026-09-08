import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
