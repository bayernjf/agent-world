import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openSqliteOpsDb, resolveSqliteOpsFile } from "../../../scripts/sqlite-ops-db.js";

/**
 * The guard exists because these CLIs used to report success against nothing:
 * node:sqlite creates a missing file, and every one of them opens SQLite
 * regardless of DB_DRIVER. Each case below is the defect, not the happy path —
 * so the negative assertions (exit code, "and no file was created") carry it.
 */

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
const saved = { DB_DRIVER: process.env.DB_DRIVER, DB_FILE: process.env.DB_FILE };

function arm() {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitCalled(code ?? 0);
  }) as never);
}

afterEach(() => {
  exitSpy?.mockRestore();
  errorSpy?.mockRestore();
  process.env.DB_DRIVER = saved.DB_DRIVER;
  process.env.DB_FILE = saved.DB_FILE;
  if (saved.DB_DRIVER === undefined) delete process.env.DB_DRIVER;
  if (saved.DB_FILE === undefined) delete process.env.DB_FILE;
});

function message(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}

function tempDb(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "aw-ops-db-"));
  const file = join(dir, "agent-world.sqlite");
  new DatabaseSync(file).close(); // real file, empty schema
  return { dir, file };
}

describe("resolveSqliteOpsFile", () => {
  it("refuses a non-sqlite driver instead of quietly editing the wrong store", () => {
    arm();
    const { dir, file } = tempDb();
    try {
      process.env.DB_DRIVER = "postgres";
      process.env.DB_FILE = file;
      expect(() => resolveSqliteOpsFile("backfill:usage")).toThrow(ExitCalled);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(message()).toContain("DB_DRIVER=postgres");
      expect(message()).toContain("backfill:usage");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets migrate:postgres past the driver check — writing PG is its purpose", () => {
    arm();
    const { dir, file } = tempDb();
    try {
      process.env.DB_DRIVER = "postgres";
      process.env.DB_FILE = file;
      expect(resolveSqliteOpsFile("migrate:postgres", { requireSqliteDriver: false })).toBe(file);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails loud on a missing file and does not create one", () => {
    arm();
    const dir = mkdtempSync(join(tmpdir(), "aw-ops-db-"));
    const missing = join(dir, "typo-agent-world.sqlite");
    try {
      process.env.DB_FILE = missing;
      expect(() => resolveSqliteOpsFile("prune:demo")).toThrow(ExitCalled);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(message()).toContain("no database at");
      // The old behaviour was the silent half of the defect: DatabaseSync would
      // have created this file and the script would report a clean no-op.
      expect(existsSync(missing)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honours an explicit --db over DB_FILE", () => {
    arm();
    const a = tempDb();
    const b = tempDb();
    try {
      process.env.DB_FILE = a.file;
      expect(resolveSqliteOpsFile("reset:password", { explicit: b.file })).toBe(b.file);
    } finally {
      rmSync(a.dir, { recursive: true, force: true });
      rmSync(b.dir, { recursive: true, force: true });
    }
  });

  it("defaults to packages/server, never the repo-root ghost", () => {
    arm();
    delete process.env.DB_FILE;
    if (!existsSync(join(resolve(import.meta.dirname, ".."), "agent-world.sqlite"))) {
      // Nothing to open on a clean checkout: the guard must still refuse loudly.
      expect(() => resolveSqliteOpsFile("generate:invoices")).toThrow(ExitCalled);
      expect(exitSpy).toHaveBeenCalledWith(1);
      return;
    }
    expect(resolveSqliteOpsFile("generate:invoices")).toContain(join("packages", "server"));
  });
});

describe("openSqliteOpsDb", () => {
  it("still opens an existing file for the root scripts that use it", () => {
    arm();
    const { dir, file } = tempDb();
    try {
      process.env.DB_FILE = file;
      const opened = openSqliteOpsDb("prune-events");
      expect(opened.file).toBe(file);
      expect(opened.db.prepare("SELECT 1 AS one").get()).toEqual({ one: 1 });
      opened.db.close();
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
