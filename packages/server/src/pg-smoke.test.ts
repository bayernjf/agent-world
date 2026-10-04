import { Client } from "pg";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Graph } from "@agent-world/core";

/**
 * Real-PostgreSQL smoke (audit 7.2/7.3, code-audit §七).
 *
 * Every other test in this package exercises SQLite; `pg-sql.test.ts` only
 * asserts the string translation. So until this file existed, no gate had ever
 * executed one line of the PG path — which is how "idx_users_owner is created by
 * migration 31" survived while `createPgDriver` never runs migrations, and a
 * fresh PG database could grow two owners.
 *
 * Skipped unless PG_SMOKE_URL is set, exactly as the suite skips provider
 * dogfood. CI supplies a postgres:16 service container; locally:
 *   docker run -d --name aw-pg-smoke -e POSTGRES_PASSWORD=smokepw \
 *     -e POSTGRES_DB=awsmoke -p 55442:5432 postgres:16
 *   PG_SMOKE_URL=postgres://postgres:smokepw@127.0.0.1:55442/awsmoke \
 *     pnpm --filter @agent-world/server exec vitest run src/pg-smoke.test.ts
 */
const url = process.env.PG_SMOKE_URL ?? "";
const suite = url ? describe : describe.skip;

// Fixed keyring: at-rest caches its ring per module instance, so the import of
// the driver happens after env is arranged (fresh() below), same as the
// key-rotation suite.
const KEY = "c".repeat(64);

async function fresh<T>(module: string): Promise<T> {
  vi.resetModules();
  return (await import(/* @vite-ignore */ module)) as T;
}

async function admin(fn: (c: Client) => Promise<void>): Promise<void> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await fn(c);
  } finally {
    await c.end();
  }
}

/** A brand-new PG build is what the defect was about, so every case starts empty. */
async function resetSchema(): Promise<void> {
  await admin(async (c) => {
    await c.query("DROP SCHEMA public CASCADE");
    await c.query("CREATE SCHEMA public");
  });
}

const secretGraph = (): Graph =>
  ({
    id: "g-pg",
    name: "pg-smoke",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0, source: {} },
      {
        id: "txt",
        kind: "textGen",
        name: "TXT",
        x: 1,
        y: 0,
        textGen: { model: "t", prompt: "p", apiKey: "sk-pg-smoke-secret" },
      },
      { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "txt", kind: "flow" },
      { id: "e2", from: "txt", to: "depot", kind: "flow" },
    ],
    triggers: [],
  }) as unknown as Graph;

suite("PostgreSQL path smoke (real server, not string translation)", () => {
  beforeAll(() => {
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = KEY;
  });

  afterEach(async () => {
    await resetSchema();
  });

  it("builds the schema on a real server and carries the owner constraint", async () => {
    await resetSchema();
    const { createPgDriver } = await fresh<typeof import("./pg-driver.js")>("./pg-driver.js");
    const db = await createPgDriver({ connectionString: url });
    try {
      await admin(async (c) => {
        const idx = await c.query(
          "SELECT indexname FROM pg_indexes WHERE tablename = 'users' ORDER BY indexname",
        );
        expect(idx.rows.map((r: { indexname: string }) => r.indexname)).toContain("idx_users_owner");
        const tables = await c.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
          [["users", "graphs", "runs", "node_runs", "settings", "artifacts"]],
        );
        expect(tables.rows).toHaveLength(6);
      });
    } finally {
      await db.close();
    }
  });

  it("cannot grow two owners from concurrent first registrations", async () => {
    await resetSchema();
    const { createPgDriver } = await fresh<typeof import("./pg-driver.js")>("./pg-driver.js");
    const db = await createPgDriver({ connectionString: url });
    try {
      // Exactly the race the check-then-insert in createUser used to lose: both
      // callers see zero owners and both insert role='owner'.
      const settled = await Promise.allSettled([
        db.createUser("u-a", "a@example.com", "hash-a"),
        db.createUser("u-b", "b@example.com", "hash-b"),
      ]);
      const fulfilled = settled.filter((s) => s.status === "fulfilled");
      const rejected = settled.filter((s) => s.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String((settled.find((s) => s.status === "rejected") as PromiseRejectedResult).reason)).toContain(
        "idx_users_owner",
      );

      await admin(async (c) => {
        const owners = await c.query("SELECT count(*)::int AS n FROM users WHERE role = 'owner'");
        expect(owners.rows[0].n).toBe(1);
      });
    } finally {
      await db.close();
    }
  });

  it("round-trips a sealed graph and a run row through the PG executor", async () => {
    await resetSchema();
    const { createPgDriver } = await fresh<typeof import("./pg-driver.js")>("./pg-driver.js");
    const db = await createPgDriver({ connectionString: url });
    const graph = secretGraph();
    try {
      const created = await db.createUser("u1", "u1@example.com", "hash-1");
      expect(created.role).toBe("owner");

      const saved = await db.saveGraph(graph, 1, "u1");
      expect(saved.ok).toBe(true);

      const read = await db.getGraph("g-pg", "u1");
      expect(read?.nodes.find((n) => n.id === "txt")?.textGen?.apiKey).toBe("sk-pg-smoke-secret");
      // A different tenant must not be able to read it (cross-tenant guard).
      expect(await db.getGraph("g-pg", "someone-else")).toBeNull();

      await admin(async (c) => {
        const raw = await c.query("SELECT doc FROM graphs WHERE id = 'g-pg'");
        expect(String(raw.rows[0].doc)).toContain("enc:v2:");
        expect(String(raw.rows[0].doc)).not.toContain("sk-pg-smoke-secret");
      });

      await db.createRun({ id: "run-1", userId: "u1", graph, budgetUsd: null, at: 2, trigger: "manual" });
      const run = await db.getRun("run-1", "u1");
      expect(run?.id).toBe("run-1");
      // int8 columns come back as numbers (the type parser pg-driver installs);
      // the shared driver body does arithmetic on them.
      expect(typeof run?.started_at).toBe("number");
      // The run's snapshot is sealed at rest and opened on read.
      expect(JSON.stringify(run?.snapshot)).toContain("sk-pg-smoke-secret");
    } finally {
      await db.close();
    }
  });
});
