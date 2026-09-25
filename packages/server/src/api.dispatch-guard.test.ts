import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb } from "./db.js";

/**
 * The pre-dispatch checks belong in startRun(), not in whichever route was
 * written first. Two of them (the subscription gate, validateModels) were only
 * reachable from 3 of the 8 dispatch entry points; these tests pin the shape
 * that replaced that — a check done once, on the path every run shares.
 *
 * Trigger fire is the case that matters: the four M1 pipelines dispatch that
 * way, and a media node with an unusable model used to be soft-skipped by the
 * engine, so a run could report `done` with no product.
 */

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-dispatch-guard-"));
  process.env.DB_FILE = join(dir, "g.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  delete process.env.MONETIZATION_ENFORCE;
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
  const token = /auth_token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1]!;
  const { user } = (await res.json()) as { user: { id: string } };
  return { token, userId: user.id };
}

/** A textGen node whose model is blank — validateModels reports this as an error. */
function unconfiguredGraph(id: string): Graph {
  return {
    id,
    name: `Guard ${id}`,
    nodes: [
      { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
      {
        id: "a",
        kind: "textGen",
        name: "NO MODEL",
        x: 1,
        y: 0,
        textGen: { model: "", prompt: "hi", skills: [], temperature: 0.7, timeoutMs: 60000 },
      },
      { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "in", to: "a", kind: "flow" },
      { id: "e2", from: "a", to: "out", kind: "flow" },
    ],
  };
}

async function seed(email: string, graphId: string) {
  const { token, userId } = await register(email);
  const graph = unconfiguredGraph(graphId);
  await db.saveGraph(graph, Date.now(), userId);
  const headers = { cookie: `auth_token=${token}`, "content-type": "application/json" };
  return { userId, headers, graph };
}

async function createCronTrigger(graphId: string, headers: Record<string, string>, id: string) {
  const res = await app.request(`/api/graphs/${graphId}/triggers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id, type: "cron", cron: "0 * * * *", enabled: true }),
  });
  expect(res.status).toBe(201);
}

describe("pre-dispatch checks apply to every dispatch route", () => {
  it("refuses a cron trigger fire whose node has no model, and starts no run", async () => {
    const { userId, headers, graph } = await seed("fire-guard@test.dev", "guard-fire");
    await createCronTrigger(graph.id, headers, "trg-guard");
    const before = (await db.listRuns(userId)).length;

    const res = await app.request(`/api/graphs/${graph.id}/triggers/trg-guard/fire`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    // Before the hoist this returned 200 with a runId: the route never called
    // validateModels, and the engine soft-skips an unusable text model.
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; diagnostics?: unknown[] };
    expect(body.error).toContain("未配置");
    expect(body.diagnostics).toHaveLength(1);
    expect((await db.listRuns(userId)).length).toBe(before);
  });

  it("refuses a batch item retry the same way instead of erroring", async () => {
    const { headers, graph, userId } = await seed("batch-guard@test.dev", "guard-batch");
    await db.createBatch({ id: "b-guard", userId, graphId: graph.id, rows: [{ text: "one" }] });
    const [item] = await db.listBatchItems("b-guard");

    const res = await app.request(`/api/batches/b-guard/items/${item!.id}/retry`, { method: "POST", headers });
    expect(res.status).toBe(422);
  });

  it("still dispatches a graph whose model is configured", async () => {
    const { headers, graph } = await seed("ok@test.dev", "guard-ok");
    // Same shape, but a registered model: the check must not become a blanket block.
    const fixed = structuredClone(graph);
    fixed.nodes[1]!.textGen = { ...fixed.nodes[1]!.textGen!, model: "fake" };
    await db.saveGraph(fixed, Date.now(), (await db.findUserByEmail("ok@test.dev"))!.id);
    await createCronTrigger(graph.id, headers, "trg-ok");

    const res = await app.request(`/api/graphs/${graph.id}/triggers/trg-ok/fire`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });
});
