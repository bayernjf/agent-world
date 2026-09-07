import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb } from "./db.js";

// 端到端冒烟（engineering-blueprint M0 清单第 7 项）：走真实 HTTP 层验证核心
// 链路「health → 注册 → 建产线 → 跑产线 → 完成」能通。产线用 model:"fake" 路由
// 到 fakeWorker，不调任何真实模型 API，可离线跑。
//
// 注意：graph 创建 API 只接受 template / clone / 空产线（不接受内联 nodes），
// 为把 textGen 钉死在 model:"fake"，这里用 db.saveGraph 直接落一个 fake 产线，
// 再经 HTTP POST /api/runs 跑——「建」走数据层、「跑」走 HTTP，仍覆盖端到端。

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-smoke-"));
  process.env.DB_FILE = join(dir, "smoke.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  db = openDb(process.env.DB_FILE!);
});

afterAll(() => {
  db.close();
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

describe("E2E smoke (HTTP core path)", () => {
  it("health → register → graph → run → done", async () => {
    // 1. health 探针正常
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect((await health.json() as { ok: boolean }).ok).toBe(true);

    // 2. 注册账号
    const reg = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "smoke@test.dev", password: "secret123" }),
    });
    expect(reg.status).toBe(201);
    const cookie = reg.headers.get("set-cookie") ?? "";
    const token = /auth_token=([^;]+)/.exec(cookie)?.[1];
    expect(token).toBeTruthy();
    const { user } = await reg.json() as { user: { id: string; email: string } };

    // 3. 落一条 fake-model 产线（source → textGen(fake) → sink）
    const graph: Graph = {
      id: "smoke-graph",
      name: "Smoke",
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
    db.saveGraph(graph, Date.now(), user.id);

    // 4. 经 HTTP 跑产线
    const runRes = await app.request("/api/runs", {
      method: "POST",
      headers: { cookie: `auth_token=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ graphId: "smoke-graph", input: "smoke input" }),
    });
    expect(runRes.status).toBe(200);
    const { runId } = await runRes.json() as { runId: string };
    expect(runId).toBeTruthy();

    // 5. 轮询到终态，期望 done（fakeWorker 秒回，不会真的挂起）。无单个
    //    GET /api/runs/:id，经列表按 graphId 过滤再按 runId 定位 status。
    let status = "";
    for (let i = 0; i < 200; i++) {
      const r = await app.request(`/api/runs?graphId=smoke-graph`, {
        headers: { cookie: `auth_token=${token}` },
      });
      if (r.status === 200) {
        const { runs } = await r.json() as { runs: Array<{ id: string; status: string }> };
        status = runs.find((x) => x.id === runId)?.status ?? "";
      }
      if (["done", "failed", "halted", "tripped", "cancelled"].includes(status)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(status).toBe("done");
  });
});
