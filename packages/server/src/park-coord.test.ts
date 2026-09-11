import type { Graph } from "@agent-world/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, SCHEMA_VERSION } from "./db.js";

function emptyGraph(id: string, name: string): Graph {
  return { id, name, nodes: [], edges: [] };
}

function cols(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
}

describe("RTS stage-B park coordinates (migration 37)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-park-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fresh schema carries park_x/park_z and an empty coord map", () => {
    const db = openDb(join(dir, "fresh.sqlite"));
    expect(SCHEMA_VERSION).toBe(37);
    const raw = new DatabaseSync(join(dir, "fresh.sqlite"));
    expect(cols(raw, "graphs")).toEqual(expect.arrayContaining(["park_x", "park_z"]));
    raw.close();
    return db.close();
  });

  it("set → get → clear round-trips and falls back to NULL after clear", async () => {
    const db = openDb(join(dir, "crud.sqlite"));
    await db.saveGraph(emptyGraph("g1", "G1"), 1000, "uA");
    expect(await db.getParkCoords("uA")).toEqual({});

    expect(await db.setParkCoord("uA", "g1", 12.5, -7.25)).toBe(true);
    expect(await db.getParkCoords("uA")).toEqual({ g1: { x: 12.5, z: -7.25 } });

    expect(await db.clearParkCoord("uA", "g1")).toBe(true);
    expect(await db.getParkCoords("uA")).toEqual({});
    return db.close();
  });

  it("isolates coordinates across users (B cannot read or overwrite A)", async () => {
    const db = openDb(join(dir, "iso.sqlite"));
    await db.saveGraph(emptyGraph("gA", "A"), 1000, "uA");
    await db.setParkCoord("uA", "gA", 3, 4);

    // B owns no graph with that position.
    expect(await db.getParkCoords("uB")).toEqual({});
    // The owner-scoped UPDATE matches no row → false, and A's value is intact.
    expect(await db.setParkCoord("uB", "gA", 99, 99)).toBe(false);
    expect(await db.clearParkCoord("uB", "gA")).toBe(false);
    expect(await db.getParkCoords("uA")).toEqual({ gA: { x: 3, z: 4 } });
    return db.close();
  });

  it("returns shared-scope coordinates for an authorized graphId set", async () => {
    const db = openDb(join(dir, "shared.sqlite"));
    await db.saveGraph(emptyGraph("gA", "A"), 1000, "uA");
    await db.saveGraph(emptyGraph("gB", "B"), 1001, "uB");
    await db.setParkCoord("uA", "gA", 1, 1);
    await db.setParkCoord("uB", "gB", 2, 2);

    // A viewer authorized for both graphs gets both laid-out positions in one call.
    const coords = await db.getParkCoords("uViewer", ["gA", "gB", "gMissing"]);
    expect(coords).toEqual({ gA: { x: 1, z: 1 }, gB: { x: 2, z: 2 } });
    return db.close();
  });

  it("does not bump updated_at when a coordinate is written", async () => {
    const file = join(dir, "ts.sqlite");
    const db = openDb(file);
    await db.saveGraph(emptyGraph("g1", "G1"), 1000, "uA");
    const raw = new DatabaseSync(file);
    const readTs = () =>
      (raw.prepare("SELECT updated_at FROM graphs WHERE id = ?").get("g1") as { updated_at: number }).updated_at;
    const before = readTs();
    await db.setParkCoord("uA", "g1", 5, 5);
    expect(readTs()).toBe(before);
    raw.close();
    return db.close();
  });

  it("upgrades a pre-37 database: adds two NULL columns and is idempotent", () => {
    const file = join(dir, "old.sqlite");
    const old = new DatabaseSync(file);
    // A minimal pre-37 graphs table without park columns.
    old.exec(`CREATE TABLE graphs (
      id TEXT PRIMARY KEY, user_id TEXT, name TEXT NOT NULL, doc TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, origin_template_id TEXT);
      INSERT INTO graphs (id, name, doc, updated_at) VALUES ('g1', 'old', '{}', 1);`);
    old.close();

    // First open applies migration 37 (and any earlier pending migrations).
    openDb(file).close();
    const upgraded = new DatabaseSync(file);
    expect(cols(upgraded, "graphs")).toEqual(expect.arrayContaining(["park_x", "park_z"]));
    const row = upgraded.prepare("SELECT park_x, park_z FROM graphs WHERE id = 'g1'").get() as {
      park_x: number | null;
      park_z: number | null;
    };
    expect(row.park_x).toBeNull();
    expect(row.park_z).toBeNull();
    const v = upgraded.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    expect(v.v).toBe(SCHEMA_VERSION);
    upgraded.close();

    // Second open must not error (detect-based idempotency) and stay at 37.
    openDb(file).close();
    const again = new DatabaseSync(file);
    const v2 = again.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    expect(v2.v).toBe(SCHEMA_VERSION);
    again.close();
  });
});
