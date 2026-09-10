import type { Graph } from "@agent-world/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import type { Db } from "./db.js";

let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];
let db: Db;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-ops-api-"));
  process.env.DB_FILE = join(dir, "api.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  db = openDb(process.env.DB_FILE!);
});

afterAll(async () => {
  await db.close();
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

async function register(email: string): Promise<string> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const m = /auth_token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  if (!m) throw new Error(`register failed: ${res.status}`);
  return m[1]!;
}
const authed = (token: string) => ({ cookie: `auth_token=${token}` });
async function idOf(email: string): Promise<string> {
  const row = (await db.prepare("SELECT id FROM users WHERE email = ?")).get(email) as { id: string };
  return row.id;
}
function emptyGraph(id: string, name: string): Graph {
  return { id, name, nodes: [], edges: [] };
}
async function seedRun(uid: string, id: string, graphId: string, name: string, status: string, at: number, cost?: number) {
  await db.saveGraph(emptyGraph(graphId, name), 1, uid);
  await db.createRun({ id, userId: uid, graph: emptyGraph(graphId, name), budgetUsd: null, at, trigger: "cron" });
  if (cost !== undefined) {
    await db.record(id, { seq: 1, ts: at + 1, type: "node.finished", nodeId: "n1", attempt: 1, output: "o", usage: { tokensIn: 10, tokensOut: 5, costUsd: cost } } as never);
  }
  if (status !== "running") await db.finishRun(id, uid, status, at + 10);
}

async function getOverview(token: string, query = "") {
  const res = await app.request(`/api/operations/overview${query}`, { headers: authed(token) });
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /api/operations/overview (RTS phase A2)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await app.request("/api/operations/overview");
    expect(res.status).toBe(401);
  });

  it("returns zeroed totals for a fresh account", async () => {
    const t = await register("fresh@example.com");
    const body = await getOverview(t);
    expect(body.graphs).toEqual([]);
    expect(body.totals).toMatchObject({ totalRuns: 0, running: 0, halted: 0, done: 0, failed: 0, costUsd: 0 });
    expect(body.nextRuns).toEqual({});
    expect(typeof body.generatedAt).toBe("number");
  });

  it("aggregates totals, per-graph rollups and cost", async () => {
    const t = await register("owner@example.com");
    const uid = await idOf("owner@example.com");
    await seedRun(uid, "s1", "ga", "Alpha", "done", 1000, 0.01);
    await seedRun(uid, "s2", "ga", "Alpha", "failed", 2000, 0.02);
    await seedRun(uid, "s3", "gb", "Beta", "halted", 3000, 0.005);
    await db.saveGraph(emptyGraph("gc", "Gamma"), 1, uid); // zero-run graph

    const body = await getOverview(t);
    expect(body.totals.totalRuns).toBe(3);
    expect(body.totals.done).toBe(1);
    expect(body.totals.failed).toBe(1);
    expect(body.totals.halted).toBe(1);
    expect(body.totals.costUsd).toBeCloseTo(0.035, 6);

    const ids = body.graphs.map((g: { graphId: string }) => g.graphId);
    // newest activity first, zero-run graph last
    expect(ids).toEqual(["gb", "ga", "gc"]);
    const ga = body.graphs.find((g: { graphId: string }) => g.graphId === "ga");
    expect(ga.lastRunId).toBe("s2");
    expect(ga.done).toBe(1);
    expect(ga.failed).toBe(1);
    const gc = body.graphs.find((g: { graphId: string }) => g.graphId === "gc");
    expect(gc.totalRuns).toBe(0);
    expect(gc.lastRunId).toBeNull();
    expect(body.nextRuns).toEqual({});
  });

  it("honors the since window while last* spans all time", async () => {
    const t = await register("window@example.com");
    const uid = await idOf("window@example.com");
    await seedRun(uid, "w1", "gw", "Win", "done", 1000, 0.01);
    await seedRun(uid, "w2", "gw", "Win", "done", 5000, 0.02);

    const body = await getOverview(t, "?since=3000");
    const gw = body.graphs.find((g: { graphId: string }) => g.graphId === "gw");
    expect(gw.totalRuns).toBe(1); // only w2 inside window
    expect(gw.costUsd).toBeCloseTo(0.02, 6);
    expect(gw.lastRunId).toBe("w2"); // most recent across all time
  });

  it("scopes the overview by tenant", async () => {
    const t1 = await register("one@example.com");
    const t2 = await register("two@example.com");
    const u1 = await idOf("one@example.com");
    await seedRun(u1, "x1", "gx", "X", "done", 1000, 0.01);

    const mine = await getOverview(t1);
    expect(mine.graphs.map((g: { graphId: string }) => g.graphId)).toEqual(["gx"]);

    const theirs = await getOverview(t2);
    expect(theirs.graphs).toEqual([]);
    expect(theirs.totals.totalRuns).toBe(0);
  });
});
