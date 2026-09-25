import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb } from "./db.js";

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-subgate-"));
  process.env.DB_FILE = join(dir, "s.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  db = openDb(process.env.DB_FILE!);
});

afterAll(async () => {
  await db.close();
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  delete process.env.MONETIZATION_ENFORCE;
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

// BYOK graph (model "fake") so it clears model validation without a builtin provider.
const graph: Graph = {
  id: "sub-graph",
  name: "Sub",
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

// A per-case copy: saveGraph keeps the original owner on id collision, so two
// cases sharing an id means the second user cannot see the graph (404).
function graphOwned(id: string): Graph {
  return { ...graph, id, name: `Sub ${id}` };
}

describe("subscription gate on POST /api/runs (M2 S4)", () => {
  it("returns 402 with structured metric/detail when enforced and quota is exceeded", async () => {
    process.env.MONETIZATION_ENFORCE = "1";
    const { token, userId } = await register("sub@test.dev");
    await db.saveGraph(graph, Date.now(), userId);
    // Free tier allows 1 concurrent run; seed one already-running run.
    await db.createRun({ id: "seed-running", userId, graph, budgetUsd: null, at: Date.now() });

    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { cookie: `auth_token=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ graphId: "sub-graph" }),
    });
    expect(res.status).toBe(402);
    const body = await res.json() as { error: string; metric: string; detail: { plan: string; limit: number; used: number } };
    expect(body.error).toBe("subscription");
    expect(body.metric).toBe("concurrency");
    expect(body.detail.plan).toBe("free");
    expect(body.detail.limit).toBe(1);
  });

  it("does not gate when MONETIZATION_ENFORCE is off (default)", async () => {
    delete process.env.MONETIZATION_ENFORCE;
    const { token, userId } = await register("sub-off@test.dev");
    await db.saveGraph(graph, Date.now(), userId);
    await db.createRun({ id: "seed-running-2", userId, graph, budgetUsd: null, at: Date.now() });

    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { cookie: `auth_token=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ graphId: "sub-graph" }),
    });
    // Gate is bypassed → not a 402 subscription block (200 created, or a downstream error).
    expect(res.status).not.toBe(402);
  });
});

/**
 * Route coverage. These are the routes that used to dispatch a run without ever
 * reaching the gate, because the check sat in the POST /api/runs handler rather
 * than in startRun. As of 2026-09-25 the gate lives in startRun, so each of them
 * answers 402 — and a refused dispatch must not leave a run row behind.
 */
describe("every dispatch route reaches the gate", () => {
  /** A free-plan user whose single concurrent slot is already occupied. */
  async function overQuota(email: string, graphId: string) {
    process.env.MONETIZATION_ENFORCE = "1";
    const { token, userId } = await register(email);
    const mine = graphOwned(graphId);
    await db.saveGraph(mine, Date.now(), userId);
    await db.createRun({ id: `live-${graphId}`, userId, graph: mine, budgetUsd: null, at: Date.now() });
    return { token, userId, graph: mine, headers: { cookie: `auth_token=${token}`, "content-type": "application/json" } };
  }

  it("rerun is refused, with the same 402 body POST /api/runs returns", async () => {
    const { userId, headers, graph } = await overQuota("rerun@test.dev", "sub-rerun");
    await db.createRun({ id: "rerun-source", userId, graph, budgetUsd: null, at: Date.now() });
    await db.finishRun("rerun-source", userId, "done", Date.now());

    const fresh = await app.request("/api/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({ graphId: "sub-rerun" }),
    });
    expect(fresh.status).toBe(402);
    const shape = await fresh.json() as Record<string, unknown>;

    const rerun = await app.request("/api/runs/rerun-source/rerun", { method: "POST", headers });
    expect(rerun.status).toBe(402);
    // Same contract, or the web upgrade card silently never appears on rerun.
    expect(await rerun.json()).toMatchObject({
      error: shape.error,
      metric: shape.metric,
      upgradeUrl: shape.upgradeUrl,
    });
  });

  it("batch item retry is refused instead of erroring", async () => {
    const { headers, graph, userId } = await overQuota("batchretry@test.dev", "sub-batchretry");
    await db.createBatch({ id: "b-gate", userId, graphId: graph.id, rows: [{ text: "one" }] });
    const [item] = await db.listBatchItems("b-gate");

    const res = await app.request(`/api/batches/b-gate/items/${item!.id}/retry`, { method: "POST", headers });
    expect(res.status).toBe(402);
  });

  it("firing a cron trigger is refused, and the refused tick creates no run row", async () => {
    const { userId, headers, graph } = await overQuota("fire@test.dev", "sub-fire");
    const created = await app.request(`/api/graphs/${graph.id}/triggers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "trg-gate", type: "cron", cron: "0 * * * *", enabled: true }),
    });
    expect(created.status).toBe(201);
    const before = (await db.listRuns(userId)).length;

    const res = await app.request(`/api/graphs/${graph.id}/triggers/trg-gate/fire`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(402);
    // The gate runs before createRun precisely so a blocked dispatch cannot
    // leave a 'running' row behind to occupy the concurrency slot forever.
    expect((await db.listRuns(userId)).length).toBe(before);
  });

  it("MONETIZATION_ENFORCE=observe dispatches the run that enforce refuses", async () => {
    const { headers } = await overQuota("observe@test.dev", "sub-observe");
    process.env.MONETIZATION_ENFORCE = "observe";

    const res = await app.request("/api/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({ graphId: "sub-observe" }),
    });
    // The grey-observation setting: same evaluation, logged, never blocking.
    expect(res.status).not.toBe(402);
  });
});

/**
 * Still-true characterization, kept as a labelled warning rather than blessed
 * behavior: an approval nobody answers holds a concurrency slot indefinitely.
 */
describe("measured gaps in the gate, not blessed behavior", () => {
  it("counts a halted run against concurrency for as long as it is left halted", async () => {
    const { userId } = await register("halted@test.dev");
    const mine = graphOwned("sub-halted");
    await db.saveGraph(mine, Date.now(), userId);
    await db.createRun({ id: "halted-forever", userId, graph: mine, budgetUsd: null, at: Date.now() });
    await db.finishRun("halted-forever", userId, "halted", Date.now(), {
      nodeId: "a",
      reason: "awaiting approval",
    });

    // activeRuns is `status IN ('running','halted')` with no age bound, and boot
    // only reaps 'running' — so this stays 1 however long the approval is left.
    expect(await db.activeRuns(userId)).toBe(1);
  });
});
