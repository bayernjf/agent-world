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
