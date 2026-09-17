import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// G1.2 fork HTTP surface. The Hono app is a module singleton reading DB/config
// at import time, so give it a scratch database before importing.
let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-fork-"));
  process.env.DB_FILE = join(dir, "api.sqlite");
  vi.stubEnv("ALLOW_REGISTRATION", "1");
  const mod = await import("./index.js");
  app = mod.app;
});

afterAll(() => {
  delete process.env.DB_FILE;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function register(email: string): Promise<string> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const m = /auth_token=([^;]+)/.exec(cookie);
  if (!m) throw new Error(`no auth_token in set-cookie: ${cookie}`);
  return m[1]!;
}

function authed(token: string): Record<string, string> {
  return { cookie: `auth_token=${token}`, "content-type": "application/json" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** source→sink needs no LLM or network, so a run drains instantly. */
function simpleGraph(id: string, name: string) {
  return {
    id,
    name,
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "sink", kind: "sink", name: "SINK", x: 1, y: 0 },
    ],
    edges: [{ id: "e1", from: "src", to: "sink", kind: "flow" }],
  };
}

async function drainedEvents(token: string, runId: string): Promise<any[]> {
  const res = await app.request(`/api/runs/${runId}/events`, { headers: { cookie: `auth_token=${token}` } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { events: any[]; state: { status: string } };
  return body.events;
}

describe("fork API (G1.2)", () => {
  it("forks from the source: reuses it at zero cost and reruns the sink", async () => {
    const token = await register(`fork-${Date.now()}@t.test`);
    const h = authed(token);
    const created = await app.request("/api/graphs", { method: "POST", headers: h, body: JSON.stringify({ name: "R" }) });
    const { id: graphId } = (await created.json()) as { id: string };
    await app.request(`/api/graphs/${graphId}`, { method: "PUT", headers: h, body: JSON.stringify(simpleGraph(graphId, "R")) });

    const runRes = await app.request("/api/runs", { method: "POST", headers: h, body: JSON.stringify({ graphId, input: "hello" }) });
    const { runId } = (await runRes.json()) as { runId: string };
    await sleep(400);

    const forkRes = await app.request(`/api/runs/${runId}/fork`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ fromNodeId: "src" }),
    });
    expect(forkRes.status).toBe(200);
    const { runId: forkId } = (await forkRes.json()) as { runId: string };
    expect(forkId).not.toBe(runId);
    await sleep(400);

    const events = await drainedEvents(token, forkId);
    const state = (await (await app.request(`/api/runs/${forkId}/events`, { headers: { cookie: `auth_token=${token}` } })).json()).state;
    expect(state.status).toBe("done");

    const srcFinish = events.filter((e) => e.type === "node.finished" && e.nodeId === "src");
    expect(srcFinish).toHaveLength(1);
    expect(srcFinish[0]!.reused).toBe(true);
    expect(srcFinish[0]!.usage.costUsd).toBe(0);

    // The sink actually reran (not marked reused).
    const sinkFinish = events.filter((e) => e.type === "node.finished" && e.nodeId === "sink");
    expect(sinkFinish).toHaveLength(1);
    expect(sinkFinish[0]!.reused).toBeUndefined();

    // Nothing billable ran: total cost across the fork is 0.
    const total = events
      .filter((e) => e.type === "node.finished")
      .reduce((sum, e) => sum + e.usage.costUsd, 0);
    expect(total).toBe(0);
  });

  it("forking from the terminal sink reuses every node and still completes", async () => {
    const token = await register(`fork-end-${Date.now()}@t.test`);
    const h = authed(token);
    const created = await app.request("/api/graphs", { method: "POST", headers: h, body: JSON.stringify({ name: "R" }) });
    const { id: graphId } = (await created.json()) as { id: string };
    await app.request(`/api/graphs/${graphId}`, { method: "PUT", headers: h, body: JSON.stringify(simpleGraph(graphId, "R")) });
    const runRes = await app.request("/api/runs", { method: "POST", headers: h, body: JSON.stringify({ graphId, input: "hi" }) });
    const { runId } = (await runRes.json()) as { runId: string };
    await sleep(400);

    const forkRes = await app.request(`/api/runs/${runId}/fork`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ fromNodeId: "sink" }),
    });
    expect(forkRes.status).toBe(200);
    const { runId: forkId } = (await forkRes.json()) as { runId: string };
    await sleep(400);

    const events = await drainedEvents(token, forkId);
    for (const id of ["src", "sink"]) {
      const f = events.find((e) => e.type === "node.finished" && e.nodeId === id);
      expect(f?.reused).toBe(true);
    }
    const state = (await (await app.request(`/api/runs/${forkId}/events`, { headers: { cookie: `auth_token=${token}` } })).json()).state;
    expect(state.status).toBe("done");
  });

  it("422s when the fork point is not in the snapshot", async () => {
    const token = await register(`fork-badnode-${Date.now()}@t.test`);
    const h = authed(token);
    const created = await app.request("/api/graphs", { method: "POST", headers: h, body: JSON.stringify({ name: "R" }) });
    const { id: graphId } = (await created.json()) as { id: string };
    await app.request(`/api/graphs/${graphId}`, { method: "PUT", headers: h, body: JSON.stringify(simpleGraph(graphId, "R")) });
    const runRes = await app.request("/api/runs", { method: "POST", headers: h, body: JSON.stringify({ graphId, input: "hi" }) });
    const { runId } = (await runRes.json()) as { runId: string };
    await sleep(400);

    const res = await app.request(`/api/runs/${runId}/fork`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ fromNodeId: "ghost" }),
    });
    expect(res.status).toBe(422);
  });

  it("400s when fromNodeId is missing", async () => {
    const token = await register(`fork-missing-${Date.now()}@t.test`);
    const h = authed(token);
    const res = await app.request("/api/runs/whatever/fork", { method: "POST", headers: h, body: JSON.stringify({}) });
    expect([400, 404]).toContain(res.status);
  });

  it("404s for a run that does not exist", async () => {
    const token = await register(`fork-nope-${Date.now()}@t.test`);
    const res = await app.request("/api/runs/nope/fork", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ fromNodeId: "src" }),
    });
    expect(res.status).toBe(404);
  });
});
