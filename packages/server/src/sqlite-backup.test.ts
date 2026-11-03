import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "./logger.js";
import { backupDatabase, BACKUP_RETENTION } from "./sqlite-backup.js";

describe("sqlite pre-migration backup (2026-11-02 review P2-1)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-backup-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("snapshots the database before migrations and the snapshot is readable", () => {
    const file = join(dir, "app.sqlite");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE events (id TEXT PRIMARY KEY, body TEXT)");
    db.prepare("INSERT INTO events (id, body) VALUES (?, ?)").run("e1", "payload");

    backupDatabase(db, file);

    const backups = readdirSync(join(dir, "backups")).filter((name) => name.endsWith(".db"));
    expect(backups).toHaveLength(1);

    const snapshot = new DatabaseSync(join(dir, "backups", backups[0] as string));
    const row = snapshot.prepare("SELECT body FROM events WHERE id = ?").get("e1") as { body: string };
    expect(row.body).toBe("payload");
    db.close();
    snapshot.close();
  });

  it("prunes snapshots beyond the retention window", () => {
    // Pre-seed old snapshots with distinct, old mtimes; the real backup below
    // is newest and must push the oldest ones out.
    const backupsDir = join(dir, "backups");
    mkdirSync(backupsDir, { recursive: true });
    for (let i = 0; i < BACKUP_RETENTION + 2; i += 1) {
      const fake = join(backupsDir, `pre-migration-2026-01-0${i + 1}T00-00-00-000Z.db`);
      writeFileSync(fake, "x");
      utimesSync(fake, new Date(2026, 0, i + 1), new Date(2026, 0, i + 1));
    }

    const file = join(dir, "app.sqlite");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE t (id TEXT)");
    backupDatabase(db, file);
    db.close();

    const remaining = readdirSync(backupsDir).filter((name) => name.endsWith(".db"));
    expect(remaining).toHaveLength(BACKUP_RETENTION);
    expect(remaining).not.toContain("pre-migration-2026-01-01T00-00-00-000Z.db");
    expect(remaining).not.toContain("pre-migration-2026-01-02T00-00-00-000Z.db");
  });

  it("logs a warning instead of failing silently when the snapshot cannot be taken", () => {
    const file = join(dir, "app.sqlite");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE t (id TEXT)");
    db.close();
    // A closed database makes VACUUM INTO throw inside backupDatabase.
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});

    expect(() => backupDatabase(db, file)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toBe("pre-migration backup failed");
    expect(String((warn.mock.calls[0]?.[1] as { error?: string }).error ?? "")).not.toBe("");
  });

  it("skips in-memory and missing databases without logging", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    backupDatabase(new DatabaseSync(":memory:"), ":memory:");
    backupDatabase(new DatabaseSync(":memory:"), join(dir, "missing.sqlite"));
    expect(warn).not.toHaveBeenCalled();
  });
});
