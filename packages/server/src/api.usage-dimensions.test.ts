import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * POST /api/runs `usageDimensions` boundary (Tier0 org M3 F3.2 a2).
 * A malformed id must fail loudly: silently dropping it would make the hub
 * ledger look complete while losing the attribution it exists for.
 */
let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-dims-"));
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

describe("POST /api/runs usageDimensions", () => {
  async function graphIdFor(token: string): Promise<string> {
    const h = authed(token);
    const created = await app.request("/api/graphs", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ name: "D" }),
    });
    const { id } = (await created.json()) as { id: string };
    await app.request(`/api/graphs/${id}`, {
      method: "PUT",
      headers: h,
      body: JSON.stringify(simpleGraph(id, "D")),
    });
    return id;
  }

  it("accepts the three org ids and starts the run", async () => {
    const token = await register(`dims-ok-${Date.now()}@t.test`);
    const graphId = await graphIdFor(token);
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({
        graphId,
        input: "hi",
        usageDimensions: { taskId: "task-1", positionId: "pos-1", departmentId: "dep-1" },
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).runId).toBeTruthy();
  });

  it("rejects an empty id instead of dropping attribution silently", async () => {
    const token = await register(`dims-empty-${Date.now()}@t.test`);
    const graphId = await graphIdFor(token);
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ graphId, input: "hi", usageDimensions: { taskId: "" } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid usageDimensions");
    expect(body.message).toContain("taskId");
  });

  it("rejects an unknown field (a typo must not pass as valid)", async () => {
    const token = await register(`dims-typo-${Date.now()}@t.test`);
    const graphId = await graphIdFor(token);
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ graphId, input: "hi", usageDimensions: { taskID: "t1" } }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("taskID");
  });

  it("keeps legacy callers working when the field is absent", async () => {
    const token = await register(`dims-legacy-${Date.now()}@t.test`);
    const graphId = await graphIdFor(token);
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ graphId, input: "hi" }),
    });
    expect(res.status).toBe(200);
  });
});
