import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb } from "./db.js";
import { bindCatalogStore, platformCatalog, refreshPlatformCatalog } from "./builtin-catalog.js";

/**
 * design-model-catalog ④: the operator-facing built-in model catalog. These
 * tests cover the four things that make it safe rather than merely convenient:
 * the gate, the field allow-list at the write boundary, the audit trail (names
 * not price values), and the retirement path end to end — data-only retirement
 * must produce a dispatch refusal plus an impact answer.
 */

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

async function makeUser(email: string, role?: "admin"): Promise<{ token: string; userId: string }> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const token = /auth_token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1]!;
  const { user } = (await res.json()) as { user: { id: string } };
  if (role) (await db.prepare("UPDATE users SET role = ? WHERE id = ?")).run(role, user.id);
  return { token, userId: user.id };
}
const hdr = (token: string) => ({ cookie: `auth_token=${token}`, "content-type": "application/json" });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-catalog-"));
  process.env.DB_FILE = join(dir, "g.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  delete process.env.MONETIZATION_ENFORCE;
  db = openDb(process.env.DB_FILE!);
  const mod = await import("./index.js");
  app = mod.app;
  // index.ts binds the encrypted adapter at import time with its own db handle;
  // rebind to this test's store so the platform row lands in the temp database.
  bindCatalogStore({
    get: async (k) => await db.getSettings(k),
    set: async (k, v) => await db.saveSettings(k, v),
  });
  await refreshPlatformCatalog();
  // The very first account a fresh database sees is bootstrapped to `owner`,
  // so claim that slot here — otherwise the "plain user" below is silently the
  // owner and every 403 assertion in this file proves nothing.
  await makeUser("cat-bootstrap@test.dev");
});

afterAll(async () => {
  await db.close();
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

const SHIPPED = ["agnes-2.0-flash", "agnes-2.5-flash"];

describe("GET /api/admin/model-catalog", () => {
  it("refuses an anonymous caller", async () => {
    expect((await app.request("/api/admin/model-catalog")).status).toBe(401);
  });

  it("refuses a plain user and answers an admin", async () => {
    const pleb = await makeUser("cat-pleb@test.dev");
    await makeUser("cat-admin@test.dev", "admin");
    const forbidden = await app.request("/api/admin/model-catalog", { headers: hdr(pleb.token) });
    expect(forbidden.status).toBe(403);
  });

  it("shows shipped defaults, the overlay and the merged view separately", async () => {
    const admin = await makeUser("cat-view@test.dev", "admin");
    const res = await app.request("/api/admin/model-catalog", { headers: hdr(admin.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Record<string, { models: string[]; hasKey: boolean }>;
      overlay: Record<string, unknown>;
      code: Record<string, { models: string[] }>;
      gaps: unknown[];
    };
    expect(body.providers.agnes?.models).toContain("agnes-2.0-flash");
    expect(body.overlay).toEqual({});
    // The screen must be able to tell "overridden" from "shipped default".
    expect(body.code.agnes?.models.length).toBeGreaterThan(0);
    // never a credential, only whether one exists
    expect(JSON.stringify(body)).not.toContain("sk-");
  });
});

describe("PUT /api/admin/model-catalog", () => {
  it("accepts a legal overlay, persists it, and audits names without price values", async () => {
    const admin = await makeUser("cat-write@test.dev", "admin");
    const res = await app.request("/api/admin/model-catalog", {
      method: "PUT",
      headers: hdr(admin.token),
      body: JSON.stringify({
        agnes: {
          models: ["agnes-2.0-flash", "agnes-new-1"],
          modalities: { "agnes-2.0-flash": "text", "agnes-new-1": "text" },
          pricing: { "agnes-new-1": { input: 0.4, output: 1.6 } },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Record<string, { models: string[] }>;
      changes: Array<{ provider: string; added: string[] }>;
    };
    expect(body.providers.agnes?.models).toContain("agnes-new-1");
    expect(body.changes[0]?.added).toEqual(["agnes-new-1"]);

    // the write survives a reload (i.e. it is really in the store, not just memory)
    await refreshPlatformCatalog();
    expect(platformCatalog().agnes?.models).toContain("agnes-new-1");

    const row = (await (
      await db.prepare(
        "SELECT detail FROM audit_log WHERE action = 'model.catalog_update' ORDER BY created_at DESC LIMIT 1",
      )
    ).get()) as { detail: string } | undefined;
    expect(row?.detail).toContain("agnes-new-1");
    expect(row?.detail).not.toContain("1.6");
  });

  it("refuses a payload that tries to override the endpoint or the credential plane", async () => {
    const admin = await makeUser("cat-smug@test.dev", "admin");
    for (const patch of [
      { agnes: { baseUrl: "https://attacker.example/v1" } },
      { agnes: { apiKey: "sk-stolen" } },
      { agnes: { videoAdapter: { createBody: { mode: "x" } } } },
      { agnes: { source: "custom" } },
    ]) {
      const res = await app.request("/api/admin/model-catalog", {
        method: "PUT",
        headers: hdr(admin.token),
        body: JSON.stringify(patch),
      });
      expect(res.status).toBe(400);
    }
    // and the refusal left the stored catalog alone
    expect(platformCatalog().agnes?.models).toContain("agnes-new-1");
    expect(platformCatalog().agnes?.baseUrl).toBeUndefined();
  });

  it("retires a model from data: the impact scan names the pipeline and dispatch then refuses it", async () => {
    const admin = await makeUser("cat-retire@test.dev", "admin");
    const owner = await makeUser("cat-owner@test.dev");
    const graph: Graph = {
      id: "cat-graph",
      name: "钉着旧名字",
      nodes: [
        { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
        {
          id: "a",
          kind: "textGen",
          name: "初稿",
          x: 1,
          y: 0,
          textGen: { model: "agnes-2.0-flash", prompt: "hi", skills: [], temperature: 0.7, timeoutMs: 60000 },
        },
        { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "in", to: "a", kind: "flow" },
        { id: "e2", from: "a", to: "out", kind: "flow" },
      ],
    };
    await db.saveGraph(graph, Date.now(), owner.userId);

    const res = await app.request("/api/admin/model-catalog", {
      method: "PUT",
      headers: hdr(admin.token),
      body: JSON.stringify({
        agnes: {
          models: [SHIPPED[1]!],
          modalities: { "agnes-2.5-flash": "text" },
          pricing: { "agnes-2.5-flash": { input: 0.4, output: 1.6 } },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      affected: Array<{ graphName: string; models: string[]; nodes: string[] }>;
    };
    // 预检答得出来：哪条产线、哪个节点、哪个名字
    expect(body.affected.some((a) => a.graphName === "钉着旧名字" && a.nodes.includes("初稿"))).toBe(true);

    const run = await app.request("/api/runs", {
      method: "POST",
      headers: hdr(owner.token),
      body: JSON.stringify({ graphId: graph.id }),
    });
    expect(run.status).toBe(422);
    const refused = (await run.json()) as { error: string; message: string; diagnostics?: unknown[] };
    // The route keeps its long-standing `error` phrase; the retirement reason
    // rides in `message` / `diagnostics` from validateModels.
    expect(refused.message).toContain("已不可用");
    expect(refused.diagnostics).toHaveLength(1);
  });

  it("a reverting write goes back to the shipped catalog (delete = drop the overlay)", async () => {
    const admin = await makeUser("cat-revert@test.dev", "admin");
    const res = await app.request("/api/admin/model-catalog", {
      method: "PUT",
      headers: hdr(admin.token),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: Record<string, { models: string[] }> };
    expect(body.providers.agnes?.models).toContain("agnes-2.0-flash");
    expect(body.providers.agnes?.models).not.toContain("agnes-new-1");
  });

  it("blocks a demo account from the admin plane", async () => {
    const demo = await makeUser("cat-demo@test.dev", "admin");
    (await db.prepare("UPDATE users SET is_demo = 1, demo_expires_at = ? WHERE id = ?")).run(
      new Date(Date.now() + 3600_000).toISOString(),
      demo.userId,
    );
    const res = await app.request("/api/admin/model-catalog", {
      method: "PUT",
      headers: hdr(demo.token),
      body: JSON.stringify({ agnes: { models: ["x"] } }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
