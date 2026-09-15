import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DDL,
  DEMO_CASCADE_DIRECT_TABLES,
  DEMO_CASCADE_GLOBAL_TABLES,
  DEMO_CASCADE_INDIRECT_TABLES,
} from "./sqlite-driver.js";
import { openDb, type Db } from "./db.js";

function freshFile(): string {
  return join(mkdtempSync(join(tmpdir(), "aw-demo-")), "db.sqlite");
}

function cols(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
}

describe("demo users — schema (migration v40)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-demo-schema-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("fresh DDL carries is_demo/demo_expires_at on users", () => {
    const file = join(dir, "fresh.sqlite");
    const db = openDb(file);
    const raw = new DatabaseSync(file);
    expect(cols(raw, "users")).toEqual(
      expect.arrayContaining(["is_demo", "demo_expires_at"]),
    );
    raw.close();
    db.close();
  });
});

describe("demo users — driver methods", () => {
  let db: Db;
  let file: string;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-demo-driver-"));
    file = join(dir, "db.sqlite");
    db = openDb(file);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("createDemoUser makes a role=user, is_demo=1 row with expiry; createUser stays is_demo=0", async () => {
    await db.createDemoUser("d1", "demo+a@demo.local", "h", "2026-09-16T00:00:00Z");
    const demo = await db.findUserById("d1");
    expect(demo).toMatchObject({ role: "user", is_demo: 1, demo_expires_at: "2026-09-16T00:00:00Z" });

    // First normal account bootstraps owner and is never a demo.
    await db.createUser("u1", "owner@x.com", "h");
    const real = await db.findUserById("u1");
    expect(real).toMatchObject({ role: "owner", is_demo: 0, demo_expires_at: null });

    const emails = (await db.listUsers()).map((u) => u.email);
    expect(emails).toEqual(["demo+a@demo.local", "owner@x.com"]);
    expect(await db.findUserByEmail("demo+a@demo.local")).toMatchObject({ is_demo: 1 });
  });

  it("claimDemoUser flips the row in place once; a second/non-demo claim changes 0 rows", async () => {
    await db.createDemoUser("d1", "demo+b@demo.local", "oldhash", "2026-09-16T00:00:00Z");
    expect(await db.claimDemoUser("d1", "real@x.com", "newhash")).toBe(1);
    const claimed = await db.findUserById("d1");
    expect(claimed).toMatchObject({ email: "real@x.com", is_demo: 0, demo_expires_at: null });

    // Already claimed → guarded UPDATE matches no is_demo=1 row.
    expect(await db.claimDemoUser("d1", "again@x.com", "h2")).toBe(0);
    // Unknown id → 0.
    expect(await db.claimDemoUser("nope", "x@y.com", "h")).toBe(0);
  });

  it("listExpiredDemoUsers returns only expired, still-demo rows", async () => {
    await db.createDemoUser("fresh", "demo+f@demo.local", "h", "2026-09-20T00:00:00Z");
    await db.createDemoUser("old", "demo+o@demo.local", "h", "2026-09-10T00:00:00Z");
    await db.createDemoUser("claimed", "demo+c@demo.local", "h", "2026-09-10T00:00:00Z");
    await db.claimDemoUser("claimed", "c@x.com", "h");
    await db.createUser("real", "real@x.com", "h");

    const expired = await db.listExpiredDemoUsers("2026-09-15T00:00:00Z");
    expect(expired.map((u) => u.id)).toEqual(["old"]);
  });

  it("deleteUserCascade removes every owned row but is blocked for a real account", async () => {
    await db.createDemoUser("d1", "demo+z@demo.local", "h", "2026-09-10T00:00:00Z");
    await db.createUser("u1", "keep@x.com", "h");

    // Seed owned rows through a raw connection (FKs are not enforced in tests).
    const seed = new DatabaseSync(file);
    const put = (sql: string) => seed.prepare(sql).run();
    put("INSERT INTO graphs (id,user_id,name,doc,updated_at) VALUES ('g1','d1','g','{}',1)");
    put("INSERT INTO runs (id,user_id,graph_id,snapshot,status,started_at) VALUES ('r1','d1','g1','{}','done',1)");
    put("INSERT INTO node_runs (run_id,node_id,attempt,status) VALUES ('r1','n1',1,'done')");
    put("INSERT INTO events (run_id,seq,ts,version,type,payload) VALUES ('r1',0,1,1,'x','{}')");
    put("INSERT INTO artifacts (id,run_id,user_id,node_id,kind,storage,created_at) VALUES ('a1','r1','d1','n1','text','inline',1)");
    put("INSERT INTO settings (user_id,data,updated_at) VALUES ('d1','{}',1)");
    // A real user's row that must survive.
    put("INSERT INTO graphs (id,user_id,name,doc,updated_at) VALUES ('g2','u1','keep','{}',1)");
    seed.close();

    // Refuses to delete a non-demo account (AND is_demo=1 guard).
    expect(await db.deleteUserCascade("u1")).toBe(0);

    expect(await db.deleteUserCascade("d1")).toBe(1);

    const verify = new DatabaseSync(file);
    const count = (t: string, where = "") =>
      (verify.prepare(`SELECT COUNT(*) AS n FROM ${t} ${where}`).get() as { n: number }).n;
    expect(count("users", "WHERE id='d1'")).toBe(0);
    expect(count("graphs", "WHERE user_id='d1'")).toBe(0);
    expect(count("runs", "WHERE user_id='d1'")).toBe(0);
    expect(count("node_runs")).toBe(0);
    expect(count("events")).toBe(0);
    expect(count("artifacts")).toBe(0);
    expect(count("settings", "WHERE user_id='d1'")).toBe(0);
    // Real account and its graph are intact.
    expect(count("users", "WHERE id='u1'")).toBe(1);
    expect(count("graphs", "WHERE user_id='u1'")).toBe(1);
    verify.close();
  });
});

describe("demo cascade — DDL coverage guard", () => {
  it("every user-owned table in DDL is covered by a cascade list (no orphans, no ghosts)", () => {
    const blocks = [...DDL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\)\s*;/g)];
    expect(blocks.length).toBeGreaterThan(20);

    const direct = new Set(DEMO_CASCADE_DIRECT_TABLES);
    const indirect = new Set(DEMO_CASCADE_INDIRECT_TABLES.map(([t]) => t));
    const global = new Set(DEMO_CASCADE_GLOBAL_TABLES);
    const declared = new Set([...direct, ...indirect, ...global]);
    const ddlTables = blocks.map((m) => m[1]!);

    for (const name of ddlTables) {
      const body = blocks.find((m) => m[1] === name)![2]!;
      const hasUser = /\buser_id\b/.test(body);
      const hasRun = /\brun_id\b/.test(body);
      const hasGraph = /\bgraph_id\b/.test(body);
      if (hasUser) {
        expect(direct.has(name), `table ${name} has user_id — add to DEMO_CASCADE_DIRECT_TABLES`).toBe(true);
      } else if (hasRun || hasGraph) {
        expect(indirect.has(name), `table ${name} is owned only via run/graph — add to DEMO_CASCADE_INDIRECT_TABLES`).toBe(true);
      } else {
        expect(global.has(name), `table ${name} has no owner column — add to DEMO_CASCADE_GLOBAL_TABLES`).toBe(true);
      }
      expect(declared.has(name), `cascade list mentions unknown table ${name}`).toBe(true);
    }

    // Every declared table must actually exist in the DDL.
    for (const name of declared) {
      expect(ddlTables, `cascade list references missing table ${name}`).toContain(name);
    }
  });
});
