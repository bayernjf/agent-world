import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The Hono app is a module singleton with DB/config env read at import time,
// so give it a scratch database before importing.
let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-rerun-"));
  process.env.DB_FILE = join(dir, "api.sqlite");
  // These tests exercise the run API, not registration policy; allow account
  // creation despite the M3 self-registration gate.
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

/** A source→sink graph needs no LLM or network, so a run completes instantly. */
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

describe("rerun API", () => {
  it("re-runs a finished run with the same snapshot and input", async () => {
    const token = await register(`rerun-${Date.now()}@t.test`);
    const h = authed(token);
    const created = await app.request("/api/graphs", { method: "POST", headers: h, body: JSON.stringify({ name: "R" }) });
    const { id: graphId } = (await created.json()) as { id: string };
    const saved = await app.request(`/api/graphs/${graphId}`, {
      method: "PUT",
      headers: h,
      body: JSON.stringify(simpleGraph(graphId, "R")),
    });
    expect(saved.status).toBe(200);

    const runRes = await app.request("/api/runs", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ graphId, input: "hello world" }),
    });
    const { runId } = (await runRes.json()) as { runId: string };
    await sleep(400); // let the background run drain to run.finished

    const rerunRes = await app.request(`/api/runs/${runId}/rerun`, { method: "POST", headers: h });
    expect(rerunRes.status).toBe(200);
    const { runId: rerunId } = (await rerunRes.json()) as { runId: string };
    expect(rerunId).not.toBe(runId);
    await sleep(400);
    const stats = await app.request(`/api/runs/${rerunId}/stats`, { method: "GET", headers: h });
    expect(stats.status).toBe(200);
  });

  it("404s for a run that does not exist", async () => {
    const token = await register(`rerun-missing-${Date.now()}@t.test`);
    const res = await app.request("/api/runs/nope/rerun", {
      method: "POST",
      headers: authed(token),
    });
    expect(res.status).toBe(404);
  });
});
