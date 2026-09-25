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

/**
 * A three-node pipeline whose single textGen node asks for `model`.
 *
 * The guard cases pass a name no provider owns. Note it is NOT "blank": since
 * 规则 B (`model: ""` = follow the current default, design-model-catalog) a
 * blank slot is dispatchable for any user whose built-in tier has a text model,
 * so "blank" no longer means "undispatchable".
 */
function textSlotGraph(id: string, model: string): Graph {
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
        textGen: { model, prompt: "hi", skills: [], temperature: 0.7, timeoutMs: 60000 },
      },
      { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "in", to: "a", kind: "flow" },
      { id: "e2", from: "a", to: "out", kind: "flow" },
    ],
  };
}

async function seed(email: string, graphId: string, model = "retired-model") {
  const { token, userId } = await register(email);
  const graph = textSlotGraph(graphId, model);
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
  it("refuses a cron trigger fire whose model routes nowhere, and starts no run", async () => {
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
    expect(body.error).toContain("已不可用");
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

  // 规则 B 的端到端证据（不只是纯函数单测）：空槽在派发时被换成"当前默认"，而且
  // 只换进 run 快照。产线文档保持字节原样 → contentHash 与版本快照不受影响；快照
  // 带真名 → 评测 byPrompt 指纹（sqlite-driver.ts:2387 按快照里的 model+prompt 做
  // sha256）能正确区分"换内置默认之前/之后"两代 run。若改成"读取时解析"，快照里
  // 就永远是空串，两代 run 会被悄悄并成一个版本。
  it("resolves a follow-default slot into the run snapshot, leaving the graph document alone", async () => {
    const { userId, headers, graph } = await seed("slot@test.dev", "guard-slot", "");
    await createCronTrigger(graph.id, headers, "trg-slot");

    const res = await app.request(`/api/graphs/${graph.id}/triggers/trg-slot/fire`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const { runId } = (await res.json()) as { runId: string };

    const row = (await db.getRun(runId, userId)) as { snapshot: string };
    const snapshot = JSON.parse(row.snapshot) as Graph;
    expect(snapshot.nodes.find((n) => n.kind === "textGen")?.textGen?.model).toBeTruthy();
    // 空槽被解析成了这个用户的内置默认，而不是留空或报 422。
    const { loadConfig } = await import("./config.js");
    expect(snapshot.nodes.find((n) => n.kind === "textGen")?.textGen?.model).toBe(
      (await loadConfig(userId)).defaultModel,
    );

    const stored = await db.getGraph(graph.id, userId);
    expect(stored?.nodes.find((n) => n.kind === "textGen")?.textGen?.model).toBe("");
  });
});
