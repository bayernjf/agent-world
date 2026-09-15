import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb } from "./db.js";

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

const jsonPost = (token: string | null, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { cookie: `auth_token=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

async function startDemo() {
  const res = await app.request("/api/auth/demo", { method: "POST" });
  const cookie = res.headers.get("set-cookie") ?? "";
  if (!/auth_token=/.test(cookie)) {
    throw new Error(`demo provision failed status=${res.status} body=${await res.text()}`);
  }
  const token = /auth_token=([^;]+)/.exec(cookie)![1]!;
  const body = (await res.json()) as {
    user: { id: string; email: string; isDemo: boolean };
    demo: { expiresAt: string; quota: { tokens: number; maxRunsTotal: number } };
  };
  return { res, token, body };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-demo-api-"));
  process.env.DB_FILE = join(dir, "s.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  process.env.ALLOW_DEMO = "1";
  process.env.MONETIZATION_ENFORCE = "1";
  process.env.DEMO_RATE_LIMIT = "100000";
  const mod = await import("./index.js");
  app = mod.app;
  db = openDb(process.env.DB_FILE!);
});

afterAll(async () => {
  await db.close();
  for (const k of ["DB_FILE", "ALLOW_REGISTRATION", "ALLOW_DEMO", "MONETIZATION_ENFORCE", "DEMO_RATE_LIMIT"]) delete process.env[k];
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/auth/demo", () => {
  it("403 demo_disabled when ALLOW_DEMO is off", async () => {
    process.env.ALLOW_DEMO = "0";
    const r = await app.request("/api/auth/demo", { method: "POST" });
    expect(r.status).toBe(403);
    expect((await r.json() as { code: string }).code).toBe("DEMO_DISABLED");
    process.env.ALLOW_DEMO = "1";
  });

  it("creates a flagged demo with a seeded text pipeline and short cookie", async () => {
    const { res, token, body } = await startDemo();
    expect(res.status).toBe(201);
    expect(body.user.isDemo).toBe(true);
    expect(body.user.email).toMatch(/^demo\+[0-9a-f]+@demo\.local$/);
    expect(body.demo.quota.maxRunsTotal).toBe(15);
    expect(token).toBeTruthy();
    // Seeded exactly one text template graph (tpl-draft).
    const graphs = await db.listGraphs(body.user.id);
    expect(graphs).toHaveLength(1);
  });

  it("seeds tpl-draft with AI nodes that pass model validation out of the box (zero-config first run)", async () => {
    const { body } = await startDemo();
    const graphs = await db.listGraphs(body.user.id);
    const seeded = await db.getGraph(graphs[0]!.id, body.user.id);
    expect(seeded).toBeTruthy();
    // Every textGen node carries an explicit, non-empty model...
    const textNodes = seeded!.nodes.filter((n) => n.kind === "textGen");
    expect(textNodes.length).toBeGreaterThan(0);
    for (const n of textNodes) {
      expect(n.textGen?.model?.trim()).toBeTruthy();
    }
    // ...and the whole graph clears dispatch-time model validation for a
    // brand-new demo user (built-in agnes tier), so the first run is not 422.
    const { loadConfig } = await import("./config.js");
    const { validateModels } = await import("./validate-models.js");
    const errors = validateModels(seeded!, await loadConfig(body.user.id)).filter(
      (d) => d.severity === "error",
    );
    expect(errors).toEqual([]);
  });

  it("reuses the same demo account when the cookie is still valid", async () => {
    const { token, body: first } = await startDemo();
    const r2 = await app.request("/api/auth/demo", {
      method: "POST",
      headers: { cookie: `auth_token=${token}` },
    });
    const b2 = (await r2.json()) as { reused: boolean; user: { id: string } };
    expect(b2.reused).toBe(true);
    expect(b2.user.id).toBe(first.user.id);
  });
});

describe("demo session surface", () => {
  it("GET /me reports isDemo and the demo block", async () => {
    const { token } = await startDemo();
    const r = await app.request("/api/auth/me", { headers: { cookie: `auth_token=${token}` } });
    const b = (await r.json()) as { user: { isDemo: boolean; demo?: unknown } };
    expect(b.user.isDemo).toBe(true);
    expect(b.user.demo).toBeTruthy();
  });

  it("blocks password login for a demo and locks password change", async () => {
    const { token, body } = await startDemo();
    const login = await jsonPost(null, "/api/auth/login", { email: body.user.email, password: "whatever1" });
    expect(login.status).toBe(401);
    expect((await login.json() as { code: string }).code).toBe("DEMO_CLAIM_REQUIRED");

    const pw = await jsonPost(token, "/api/auth/password", { currentPassword: "x", newPassword: "newpass1" });
    expect(pw.status).toBe(403);
    expect((await pw.json() as { code: string }).code).toBe("DEMO_LOCKED");
  });

  it("locks external publish and billing for a demo", async () => {
    const { token } = await startDemo();
    const pub = await jsonPost(token, "/api/publish-targets", { platform: "wechat", config: {} });
    expect(pub.status).toBe(403);
    expect((await pub.json() as { code: string }).code).toBe("DEMO_LOCKED");

    const checkout = await jsonPost(token, "/api/billing/checkout", { plan: "pro" });
    expect(checkout.status).toBe(403);
    expect((await checkout.json() as { feature: string }).feature).toBe("billing");
  });
});

describe("POST /api/auth/claim", () => {
  it("converts the demo in place: real login works, data is retained, second claim 400", async () => {
    const { token, body } = await startDemo();
    const beforeGraphs = await db.listGraphs(body.user.id);
    expect(beforeGraphs.length).toBeGreaterThan(0);

    const claim = await jsonPost(token, "/api/auth/claim", { email: "claimed@x.dev", password: "secret123" });
    expect(claim.status).toBe(200);
    expect((await claim.json()) as { user: { isDemo: boolean; email: string } }).toMatchObject({
      user: { isDemo: false, email: "claimed@x.dev" },
    });

    // Same userId keeps its graphs.
    const afterGraphs = await db.listGraphs(body.user.id);
    expect(afterGraphs).toHaveLength(beforeGraphs.length);

    // Now a normal password login succeeds.
    const login = await jsonPost(null, "/api/auth/login", { email: "claimed@x.dev", password: "secret123" });
    expect(login.status).toBe(200);

    // Re-claiming a non-demo is a 400.
    const newToken = /auth_token=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")![1]!;
    const again = await jsonPost(newToken, "/api/auth/claim", { email: "other@x.dev", password: "secret123" });
    expect(again.status).toBe(400);
  });

  it("409 when the target email is taken by another account", async () => {
    // A real account owns occupied@x.dev.
    const reg = await jsonPost(null, "/api/auth/register", { email: "occupied@x.dev", password: "secret123" });
    expect(reg.status).toBe(201);
    const { token } = await startDemo();
    const claim = await jsonPost(token, "/api/auth/claim", { email: "occupied@x.dev", password: "secret123" });
    expect(claim.status).toBe(409);
  });

  it("validates email/password shape", async () => {
    const { token } = await startDemo();
    expect((await jsonPost(token, "/api/auth/claim", { email: "bad", password: "secret123" })).status).toBe(400);
    expect((await jsonPost(token, "/api/auth/claim", { email: "ok@x.dev", password: "12" })).status).toBe(400);
  });
});

describe("demo run gate (independent of MONETIZATION_ENFORCE)", () => {
  // BYOK text graph ("fake" model) — passes model validation, and the demo gate
  // must NOT apply the free-plan builtin block even with ENFORCE=1 (the key
  // Hasee pitfall: free tokens=0 would otherwise block the demo's first run).
  const byokGraph: Graph = {
    id: "demo-byok",
    name: "Demo BYOK",
    nodes: [
      { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
      { id: "a", kind: "textGen", name: "A", x: 1, y: 0, textGen: { model: "fake", prompt: "hi", skills: [], temperature: 0.7, timeoutMs: 60000 } },
      { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "in", to: "a", kind: "flow" },
      { id: "e2", from: "a", to: "out", kind: "flow" },
    ],
  };

  it("does not return a 402 quota block for a demo's BYOK text run under ENFORCE=1", async () => {
    const { token, body } = await startDemo();
    await db.saveGraph(byokGraph, Date.now(), body.user.id);
    const r = await jsonPost(token, "/api/runs", { graphId: "demo-byok" });
    if (r.status === 402) {
      const b = (await r.json()) as { error?: string };
      throw new Error(`demo text run was quota-blocked: ${JSON.stringify(b)}`);
    }
    // It cleared the gate (downstream "fake" provider may still error, which is fine).
    expect(r.status).not.toBe(402);
  });
});
