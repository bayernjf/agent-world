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
  dir = mkdtempSync(join(tmpdir(), "aw-timeline-api-"));
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
function emptyGraph(id: string, name: string): Graph {
  return { id, name, nodes: [], edges: [] };
}

describe("GET /api/runs/:id/timeline (G1 step trace)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await app.request("/api/runs/nope/timeline");
    expect(res.status).toBe(401);
  });

  it("projects node attempts, status and cost from the event stream", async () => {
    const token = await register("timeline@example.com");
    const uid = ((await db.prepare("SELECT id FROM users WHERE email = ?")).get("timeline@example.com") as { id: string }).id;
    await db.saveGraph(emptyGraph("g1", "G1"), 1, uid);
    await db.createRun({ id: "run-t1", userId: uid, graph: emptyGraph("g1", "G1"), budgetUsd: 0.5, at: 1000, trigger: "cron" });
    await db.record("run-t1", { seq: 1, ts: 1000, type: "run.started", runId: "run-t1", graphId: "g1", budgetUsd: 0.5 } as never);
    await db.record("run-t1", { seq: 2, ts: 1001, type: "node.started", nodeId: "A", attempt: 1 } as never);
    await db.record("run-t1", { seq: 3, ts: 1500, type: "node.finished", nodeId: "A", attempt: 1, output: "alpha", usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01 } } as never);
    await db.record("run-t1", { seq: 4, ts: 1501, type: "node.started", nodeId: "B", attempt: 1 } as never);
    await db.record("run-t1", { seq: 5, ts: 1600, type: "node.failed", nodeId: "B", attempt: 1, error: "rate limited", errorCode: "RATE_LIMIT" } as never);
    await db.finishRun("run-t1", uid, "failed", 1600);

    const res = await app.request("/api/runs/run-t1/timeline", { headers: authed(token) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.id).toBe("run-t1");
    expect(body.run.status).toBe("failed");
    expect(body.run.budgetUsd).toBe(0.5);
    expect(body.timeline.nodes.map((n: { nodeId: string }) => n.nodeId)).toEqual(["A", "B"]);
    expect(body.timeline.nodes[0].attempts[0].status).toBe("done");
    expect(body.timeline.nodes[0].attempts[0].durationMs).toBe(499);
    expect(body.timeline.nodes[1].attempts[0].status).toBe("failed");
    expect(body.timeline.nodes[1].attempts[0].errorCode).toBe("RATE_LIMIT");
    expect(body.timeline.totals.costUsd).toBeCloseTo(0.01);
  });

  it("returns 404 for another user's run", async () => {
    const owner = await register("owner-tl@example.com");
    const other = await register("other-tl@example.com");
    const ownerId = ((await db.prepare("SELECT id FROM users WHERE email = ?")).get("owner-tl@example.com") as { id: string }).id;
    await db.saveGraph(emptyGraph("g2", "G2"), 1, ownerId);
    await db.createRun({ id: "run-t2", userId: ownerId, graph: emptyGraph("g2", "G2"), budgetUsd: null, at: 1000, trigger: "manual" });

    const res = await app.request("/api/runs/run-t2/timeline", { headers: authed(other) });
    expect(res.status).toBe(404);
    void owner;
  });
});

describe("GET /api/runs/:id/nodes/:nodeId/attempt/:attempt/output (G1 lazy full output)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await app.request("/api/runs/run-o1/nodes/A/attempt/1/output");
    expect(res.status).toBe(401);
  });

  it("returns the complete untruncated output and prefers the main variant", async () => {
    const token = await register("output@example.com");
    const uid = ((await db.prepare("SELECT id FROM users WHERE email = ?")).get("output@example.com") as { id: string }).id;
    await db.saveGraph(emptyGraph("go", "GO"), 1, uid);
    await db.createRun({ id: "run-o1", userId: uid, graph: emptyGraph("go", "GO"), budgetUsd: null, at: 2000, trigger: "manual" });
    const long = "x".repeat(500);
    await db.record("run-o1", { seq: 1, ts: 2000, type: "run.started", runId: "run-o1", graphId: "go" } as never);
    await db.record("run-o1", { seq: 2, ts: 2001, type: "node.started", nodeId: "A", attempt: 1 } as never);
    await db.record("run-o1", { seq: 3, ts: 2100, type: "node.finished", nodeId: "A", attempt: 1, output: long, usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 } } as never);
    await db.record("run-o1", { seq: 4, ts: 2101, type: "node.started", nodeId: "A", attempt: 1, variant: "v1" } as never);
    await db.record("run-o1", { seq: 5, ts: 2200, type: "node.finished", nodeId: "A", attempt: 1, variant: "v1", output: "V1-OUTPUT", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 } } as never);

    const res = await app.request("/api/runs/run-o1/nodes/A/attempt/1/output", { headers: authed(token) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodeId).toBe("A");
    expect(body.attempt).toBe(1);
    expect(body.variant).toBe("main");
    expect(body.output).toBe(long);
    expect(body.output.length).toBe(500);
  });

  it("returns 404 when the node/attempt has no finished output", async () => {
    const token = await register("missing@example.com");
    const uid = ((await db.prepare("SELECT id FROM users WHERE email = ?")).get("missing@example.com") as { id: string }).id;
    await db.saveGraph(emptyGraph("gm", "GM"), 1, uid);
    await db.createRun({ id: "run-o2", userId: uid, graph: emptyGraph("gm", "GM"), budgetUsd: null, at: 3000, trigger: "manual" });

    const res = await app.request("/api/runs/run-o2/nodes/Z/attempt/1/output", { headers: authed(token) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric attempt", async () => {
    const token = await register("badattempt@example.com");
    const uid = ((await db.prepare("SELECT id FROM users WHERE email = ?")).get("badattempt@example.com") as { id: string }).id;
    await db.saveGraph(emptyGraph("gb", "GB"), 1, uid);
    await db.createRun({ id: "run-o3", userId: uid, graph: emptyGraph("gb", "GB"), budgetUsd: null, at: 4000, trigger: "manual" });

    const res = await app.request("/api/runs/run-o3/nodes/A/attempt/abc/output", { headers: authed(token) });
    expect(res.status).toBe(400);
  });

  it("returns 404 for another user's run", async () => {
    const owner = await register("owner-out@example.com");
    const other = await register("other-out@example.com");
    const ownerId = ((await db.prepare("SELECT id FROM users WHERE email = ?")).get("owner-out@example.com") as { id: string }).id;
    await db.saveGraph(emptyGraph("gx", "GX"), 1, ownerId);
    await db.createRun({ id: "run-o4", userId: ownerId, graph: emptyGraph("gx", "GX"), budgetUsd: null, at: 5000, trigger: "manual" });

    const res = await app.request("/api/runs/run-o4/nodes/A/attempt/1/output", { headers: authed(other) });
    expect(res.status).toBe(404);
    void owner;
  });
});
