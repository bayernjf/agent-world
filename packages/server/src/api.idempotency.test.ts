import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb } from "./db.js";

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-idem-"));
  process.env.DB_FILE = join(dir, "i.sqlite");
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

async function register(email: string): Promise<{ token: string; userId: string }> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const token = /auth_token=([^;]+)/.exec(cookie)![1]!;
  const { user } = await res.json() as { user: { id: string } };
  return { token, userId: user.id };
}

describe("idempotent run creation (Idempotency-Key)", () => {
  it("reuses the same runId for a duplicate key, new runId for a different key", async () => {
    const { token, userId } = await register("idem@test.dev");
    const graph: Graph = {
      id: "idem-graph",
      name: "Idem",
      nodes: [
        { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
        {
          id: "a",
          kind: "textGen",
          name: "A",
          x: 1,
          y: 0,
          textGen: { model: "fake", prompt: "hi", skills: [], temperature: 0.7, timeoutMs: 60000 },
        },
        { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "in", to: "a", kind: "flow" },
        { id: "e2", from: "a", to: "out", kind: "flow" },
      ],
    };
    await db.saveGraph(graph, Date.now(), userId);

    const run = (key: string) =>
      app.request("/api/runs", {
        method: "POST",
        headers: { cookie: `auth_token=${token}`, "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ graphId: "idem-graph" }),
      });

    const first = await run("key-1");
    expect(first.status).toBe(200);
    const { runId: run1 } = await first.json() as { runId: string };

    const second = await run("key-1");
    expect(second.status).toBe(200);
    const { runId: run2, replay } = await second.json() as { runId: string; replay?: boolean };
    expect(run2).toBe(run1);
    expect(replay).toBe(true);

    const third = await run("key-2");
    const { runId: run3 } = await third.json() as { runId: string };
    expect(run3).not.toBe(run1);
  });

  it("two concurrent requests sharing one key cannot create two runs", async () => {
    const { token, userId } = await register("idem-race@test.dev");
    const graph: Graph = {
      id: "race-graph",
      name: "Race",
      nodes: [
        { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
        {
          id: "a",
          kind: "textGen",
          name: "A",
          x: 1,
          y: 0,
          textGen: { model: "fake", prompt: "hi", skills: [], temperature: 0.7, timeoutMs: 60000 },
        },
        { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "in", to: "a", kind: "flow" },
        { id: "e2", from: "a", to: "out", kind: "flow" },
      ],
    };
    await db.saveGraph(graph, Date.now(), userId);

    const fire = () =>
      app.request("/api/runs", {
        method: "POST",
        headers: { cookie: `auth_token=${token}`, "content-type": "application/json", "Idempotency-Key": "race-key" },
        body: JSON.stringify({ graphId: "race-graph" }),
      });

    const [a, b] = await Promise.all([fire(), fire()]);
    const statuses = [a.status, b.status];
    // Exactly one of them got to create; the other is either the replay of that
    // run (if it read after the mapping filled) or 409 (if it hit the open claim).
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);

    const runIds = new Set<string>();
    for (const res of statuses.map((_, i) => (i === 0 ? a : b))) {
      if (res.status !== 200) continue;
      const body = await res.json() as { runId: string };
      runIds.add(body.runId);
    }
    expect(runIds.size).toBeLessThanOrEqual(1);

    const runs = await db.listRuns(userId, { graphId: "race-graph" });
    expect(runs.rows).toHaveLength(1);
  });
});

describe("idempotency claim primitives", () => {
  const U = "claim-user";

  it("resolves a contested claim to exactly one winner, and refills after release", async () => {
    expect(await db.claimIdempotencyKey(U, "k1", "")).toBe(true);
    expect(await db.claimIdempotencyKey(U, "k1", "")).toBe(false);
    expect(await db.getIdempotentRun(U, "k1")).toBe("");

    await db.saveIdempotentRun(U, "k1", "run-1");
    expect(await db.getIdempotentRun(U, "k1")).toBe("run-1");
    // Filled mapping: neither re-claim nor release may touch it.
    expect(await db.claimIdempotencyKey(U, "k1", "")).toBe(false);
    await db.releaseIdempotentClaim(U, "k1");
    expect(await db.getIdempotentRun(U, "k1")).toBe("run-1");

    // A failed run releases its pending claim so the key is usable again.
    expect(await db.claimIdempotencyKey(U, "k2", "")).toBe(true);
    await db.releaseIdempotentClaim(U, "k2");
    expect(await db.claimIdempotencyKey(U, "k2", "")).toBe(true);
  });

  it("steals only a pending claim older than the cutoff", async () => {
    const raw = new DatabaseSync(process.env.DB_FILE!);
    const now = Date.now();
    raw
      .prepare(
        `INSERT INTO idempotency_keys (user_id, key, run_id, created_at) VALUES (?, ?, '', ?)`,
      )
      .run(U, "stale", now - 60 * 60_000);
    raw
      .prepare(`INSERT INTO idempotency_keys (user_id, key, run_id, created_at) VALUES (?, ?, '', ?)`)
      .run(U, "fresh", now);
    raw.close();

    const cutoff = now - 15 * 60_000;
    expect(await db.stealStaleIdempotentClaim(U, "stale", cutoff)).toBe(true);
    expect(await db.stealStaleIdempotentClaim(U, "fresh", cutoff)).toBe(false);
    expect(await db.getIdempotentRun(U, "stale")).toBeNull();
    expect(await db.claimIdempotencyKey(U, "stale", "")).toBe(true);
  });
});
