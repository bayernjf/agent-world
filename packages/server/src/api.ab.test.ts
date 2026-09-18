import type { Graph } from "@agent-world/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import type { Db } from "./db.js";

// G5.1 HTTP surface for sampling a real done run as the A/B starting input.
// The Hono app is a module singleton reading DB/config at import time, so give
// it a scratch database before importing.
let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];
let db: Db;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-ab-api-"));
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
const authed = (token: string) => ({ cookie: `auth_token=${token}`, "content-type": "application/json" });

function writerGraph(id: string, productionPrompt = "现网 prompt v1"): Graph {
  return {
    id,
    name: `AB ${id}`,
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      {
        id: "w",
        kind: "textGen",
        name: "Writer",
        x: 1,
        y: 0,
        textGen: { model: "t", prompt: productionPrompt, skills: [], temperature: 0.7, timeoutMs: 60000 },
      },
      { id: "sink", kind: "sink", name: "SINK", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "w", kind: "flow" },
      { id: "e2", from: "w", to: "sink", kind: "flow" },
    ],
  };
}

async function createGraph(token: string, graph: Graph): Promise<string> {
  const h = authed(token);
  const created = await app.request("/api/graphs", { method: "POST", headers: h, body: JSON.stringify({ name: graph.name }) });
  const { id } = (await created.json()) as { id: string };
  // The body id must match the server-issued id (PUT enforces H1 id match).
  const saved = await app.request(`/api/graphs/${id}`, {
    method: "PUT",
    headers: h,
    body: JSON.stringify({ ...graph, id }),
  });
  expect(saved.status).toBe(200);
  return id;
}

async function seedRun(opts: {
  userId: string;
  graph: Graph;
  id: string;
  status: "done" | "failed";
  input: string;
}): Promise<void> {
  await db.createRun({
    id: opts.id,
    userId: opts.userId,
    graph: opts.graph,
    budgetUsd: null,
    at: Date.now(),
    trigger: "manual",
    input: opts.input,
  });
  await db.finishRun(opts.id, opts.userId, opts.status, Date.now());
}

describe("POST /api/runs/ab — G5.1 sample a done run (fromRunId)", () => {
  it("projects arm A from the live prompt and arm B from the new prompt, reusing the sampled input", async () => {
    const token = await register("ab-sample-ok@example.com");
    const uid = ((await db.prepare("SELECT id FROM users WHERE email = ?")).get("ab-sample-ok@example.com") as { id: string }).id;
    const graphId = await createGraph(token, writerGraph("g-ok"));
    await seedRun({ userId: uid, graph: writerGraph(graphId), id: "run-ok", status: "done", input: "真实起始素材" });

    const res = await app.request("/api/runs/ab", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ graphId, targetNodeId: "w", variants: ["新 prompt B"], fromRunId: "run-ok" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { abGroup: string; arms: Array<{ arm: string; runId: string; prompt: string }> };
    expect(body.arms).toHaveLength(2);
    expect(body.arms[0]!.arm).toBe("A");
    expect(body.arms[0]!.prompt).toBe("现网 prompt v1");
    expect(body.arms[1]!.arm).toBe("B");
    expect(body.arms[1]!.prompt).toBe("新 prompt B");
  });

  it("422 when the sampled run belongs to a different graph", async () => {
    const token = await register("ab-cross-graph@example.com");
    const uid = ((await db.prepare("SELECT id FROM users WHERE email = ?")).get("ab-cross-graph@example.com") as { id: string }).id;
    const g1 = await createGraph(token, writerGraph("g-cross-1"));
    const g2 = await createGraph(token, writerGraph("g-cross-2"));
    await seedRun({ userId: uid, graph: writerGraph(g1), id: "run-cross", status: "done", input: "素材" });

    const res = await app.request("/api/runs/ab", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ graphId: g2, targetNodeId: "w", variants: ["B"], fromRunId: "run-cross" }),
    });
    expect(res.status).toBe(422);
  });

  it("422 when the sampled run is not done", async () => {
    const token = await register("ab-not-done@example.com");
    const uid = ((await db.prepare("SELECT id FROM users WHERE email = ?")).get("ab-not-done@example.com") as { id: string }).id;
    const graphId = await createGraph(token, writerGraph("g-nd"));
    await seedRun({ userId: uid, graph: writerGraph(graphId), id: "run-nd", status: "failed", input: "素材" });

    const res = await app.request("/api/runs/ab", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ graphId, targetNodeId: "w", variants: ["B"], fromRunId: "run-nd" }),
    });
    expect(res.status).toBe(422);
  });

  it("422 when the sampled run carries no starting input", async () => {
    const token = await register("ab-empty-input@example.com");
    const uid = ((await db.prepare("SELECT id FROM users WHERE email = ?")).get("ab-empty-input@example.com") as { id: string }).id;
    const graphId = await createGraph(token, writerGraph("g-ei"));
    await seedRun({ userId: uid, graph: writerGraph(graphId), id: "run-ei", status: "done", input: "   " });

    const res = await app.request("/api/runs/ab", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ graphId, targetNodeId: "w", variants: ["B"], fromRunId: "run-ei" }),
    });
    expect(res.status).toBe(422);
  });

  it("404 when the sampled run does not exist (existence not leaked)", async () => {
    const token = await register("ab-missing-run@example.com");
    const graphId = await createGraph(token, writerGraph("g-mr"));

    const res = await app.request("/api/runs/ab", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ graphId, targetNodeId: "w", variants: ["B"], fromRunId: "run-does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });

  it("still requires 2 variants on the legacy manual path without fromRunId", async () => {
    const token = await register("ab-legacy@example.com");
    const graphId = await createGraph(token, writerGraph("g-legacy"));

    const single = await app.request("/api/runs/ab", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ graphId, targetNodeId: "w", variants: ["only-one"] }),
    });
    expect(single.status).toBe(400);
  });
});
