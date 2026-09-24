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
 * Characterization tests for the two ways the gate's shape matters to the
 * rollout decision. They assert what the code does TODAY, not what it should
 * do: invert them (and update docs/deferred-items.md「商业化」) when the gap is
 * closed. Both were measured against the dev DB on 2026-09-25.
 */
describe("measured gaps in the gate, not blessed behavior", () => {
  it("rerun dispatches a run that POST /api/runs refuses for the same user", async () => {
    process.env.MONETIZATION_ENFORCE = "1";
    const { token, userId } = await register("rerun@test.dev");
    const mine = graphOwned("sub-rerun");
    await db.saveGraph(mine, Date.now(), userId);
    await db.createRun({ id: "rerun-source", userId, graph: mine, budgetUsd: null, at: Date.now() });
    await db.finishRun("rerun-source", userId, "done", Date.now());
    // Saturate the free plan's single concurrent slot.
    await db.createRun({ id: "rerun-live", userId, graph: mine, budgetUsd: null, at: Date.now() });
    const headers = { cookie: `auth_token=${token}`, "content-type": "application/json" };

    const fresh = await app.request("/api/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({ graphId: "sub-rerun" }),
    });
    expect(fresh.status).toBe(402);

    // Same user, same quota state, second dispatch route: the gate lives in the
    // POST /api/runs handler, not in startRun, so rerun never reaches it.
    const rerun = await app.request("/api/runs/rerun-source/rerun", { method: "POST", headers });
    expect(rerun.status).not.toBe(402);
  });

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
