import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { audit, changedFields } from "./audit.js";

// The Hono app is a module singleton with DB/config env read at import time,
// so give it a scratch database before importing.
let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-audit-"));
  process.env.DB_FILE = join(dir, "api.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
});

afterAll(() => {
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function register(email: string, password = "secret123"): Promise<Response> {
  return app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

function authToken(res: Response): string {
  const cookie = res.headers.get("set-cookie") ?? "";
  const m = /auth_token=([^;]+)/.exec(cookie);
  if (!m) throw new Error(`no auth_token in set-cookie: ${cookie}`);
  return m[1]!;
}

function authed(token: string, headers: Record<string, string> = {}): Record<string, string> {
  return { cookie: `auth_token=${token}`, ...headers };
}

/** All audit rows, straight off the scratch database (no app filtering). */
function allAuditRows(): Array<Record<string, unknown>> {
  const raw = new DatabaseSync(process.env.DB_FILE!, { readOnly: true });
  try {
    return raw.prepare(`SELECT * FROM audit_log ORDER BY created_at, rowid`).all() as Array<
      Record<string, unknown>
    >;
  } finally {
    raw.close();
  }
}

describe("audit() helper unit", () => {
  it("swallows insert failures so auditing never breaks the business request", () => {
    const boom = {
      insertAudit: () => {
        throw new Error("table locked");
      },
    };
    expect(() => audit(boom, "u1", "settings.update", { detail: { fields: [] } })).not.toThrow();
  });

  it("changedFields lists top-level and provider-scoped paths, not values", () => {
    const before = {
      defaultModel: "a",
      providers: { my: { apiKey: "sk-old", baseUrl: "https://x" } },
      searchConfig: { provider: "duckduckgo" },
    };
    const after = {
      defaultModel: "b",
      providers: { my: { apiKey: "sk-new", baseUrl: "https://x" } },
      searchConfig: { provider: "tavily", apiKey: "tvly-new" },
    };
    const fields = changedFields(before, after);
    expect(fields).toContain("defaultModel");
    expect(fields).toContain("providers.my.apiKey");
    expect(fields).toContain("searchConfig.provider");
    expect(fields).toContain("searchConfig.apiKey");
    // Red line: no field list entry may carry a value.
    expect(fields.join(" ")).not.toContain("sk-");
    expect(fields.join(" ")).not.toContain("tvly-");
  });
});

describe("audit log route instrumentation", () => {
  let token: string;

  const minimalGraph = (id: string) => ({
    id,
    name: `g-${id}`,
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0, source: {} },
      { id: "depot", kind: "sink", name: "DEPOT", x: 100, y: 0 },
    ],
    edges: [{ id: "e1", from: "src", to: "depot", kind: "flow" }],
  });

  beforeAll(async () => {
    token = authToken(await register("auditor@test.dev"));
  });

  it("records account.register / login / login_failed / password_change", async () => {
    const before = allAuditRows().length;

    await register("late@audit.dev");
    expect(allAuditRows().at(-1)).toMatchObject({ action: "account.register" });

    // failed login (unknown email). The wrong-password-for-real-user branch
    // is unreachable here: vitest.setup mocks bcryptjs compare to `true`, so
    // only the user-lookup miss can produce a login_failed in this suite.
    await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@audit.dev", password: "wrong" }),
    });
    expect(allAuditRows().at(-1)).toMatchObject({ action: "account.login_failed", user_id: "unknown" });

    // successful login
    await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "late@audit.dev", password: "secret123" }),
    });
    expect(allAuditRows().at(-1)).toMatchObject({ action: "account.login" });

    // password change
    await app.request("/api/auth/password", {
      method: "POST",
      headers: authed(token, { "content-type": "application/json" }),
      body: JSON.stringify({ currentPassword: "secret123", newPassword: "newsecret9" }),
    });
    expect(allAuditRows().at(-1)).toMatchObject({ action: "account.password_change" });

    expect(allAuditRows().length).toBeGreaterThanOrEqual(before + 4);
  });

  it("records settings.update with field paths and never the key (red line)", async () => {
    const provider = (apiKey: string) => ({
      aud: {
        type: "openai-compatible" as const,
        baseUrl: "https://audit.example/v1",
        apiKey,
        models: ["m1"],
        enabled: true,
      },
    });
    // First save: a brand-new provider reports at the provider level.
    const first = await app.request("/api/settings", {
      method: "PUT",
      headers: authed(token, { "content-type": "application/json" }),
      body: JSON.stringify({ providers: provider("sk-audit-first-111111") }),
    });
    expect(first.status).toBe(200);
    const firstRow = allAuditRows().at(-1)!;
    expect(firstRow.action).toBe("settings.update");
    expect(JSON.parse(String(firstRow.detail)).fields).toContain("providers.aud");

    // Second save: an existing provider with a rotated key reports the FIELD.
    const second = await app.request("/api/settings", {
      method: "PUT",
      headers: authed(token, { "content-type": "application/json" }),
      body: JSON.stringify({ providers: provider("sk-audit-secret-987654") }),
    });
    expect(second.status).toBe(200);
    const row = allAuditRows().at(-1)!;
    expect(row.action).toBe("settings.update");
    const detail = JSON.parse(String(row.detail)) as { fields: string[] };
    expect(detail.fields).toContain("providers.aud.apiKey");
    // Red line: the raw key, nor any masked echo, may appear anywhere in the row.
    expect(JSON.stringify(row)).not.toContain("sk-audit-secret");
    expect(JSON.stringify(row)).not.toContain("****");
  });

  it("records graph.create / update / delete / restore_version", async () => {
    const created = await app.request("/api/graphs", {
      method: "POST",
      headers: authed(token, { "content-type": "application/json" }),
      body: JSON.stringify({ name: "audit-line" }),
    });
    const graphId = ((await created.json()) as { id: string }).id;
    expect(allAuditRows().at(-1)).toMatchObject({
      action: "graph.create",
      object_id: graphId,
    });

    const put = await app.request(`/api/graphs/${graphId}`, {
      method: "PUT",
      headers: authed(token, { "content-type": "application/json" }),
      body: JSON.stringify(minimalGraph(graphId)),
    });
    expect(put.status).toBe(200);
    expect(allAuditRows().at(-1)).toMatchObject({ action: "graph.update", object_id: graphId });

    // a version snapshot, then restore it
    const version = await app.request(`/api/graphs/${graphId}/versions`, {
      method: "POST",
      headers: authed(token, { "content-type": "application/json" }),
      body: JSON.stringify({ name: "v-audit" }),
    });
    expect(version.status).toBe(201);
    const vid = ((await version.json()) as { id: string }).id;
    const restore = await app.request(`/api/graphs/${graphId}/versions/${vid}/restore`, {
      method: "POST",
      headers: authed(token),
    });
    expect(restore.status).toBe(200);
    const restoreRow = allAuditRows().at(-1)!;
    expect(restoreRow.action).toBe("graph.restore_version");
    expect(JSON.parse(String(restoreRow.detail))).toMatchObject({ version: vid });

    const del = await app.request(`/api/graphs/${graphId}`, { method: "DELETE", headers: authed(token) });
    expect(del.status).toBe(200);
    expect(allAuditRows().at(-1)).toMatchObject({ action: "graph.delete", object_id: graphId });
  });

  it("records run.start", async () => {
    const created = await app.request("/api/graphs", {
      method: "POST",
      headers: authed(token, { "content-type": "application/json" }),
      body: JSON.stringify({ name: "audit-run-line" }),
    });
    const graphId = ((await created.json()) as { id: string }).id;
    await app.request(`/api/graphs/${graphId}`, {
      method: "PUT",
      headers: authed(token, { "content-type": "application/json" }),
      body: JSON.stringify(minimalGraph(graphId)),
    });
    const start = await app.request("/api/runs", {
      method: "POST",
      headers: authed(token, { "content-type": "application/json" }),
      body: JSON.stringify({ graphId }),
    });
    expect(start.status).toBe(200);
    const row = allAuditRows().at(-1)!;
    expect(row.action).toBe("run.start");
    expect(JSON.parse(String(row.detail))).toMatchObject({ graph: graphId, trigger: "manual" });
  });

  it("records publish_target.create / delete without the token (red line)", async () => {
    const created = await app.request("/api/publish-targets", {
      method: "POST",
      headers: authed(token, { "content-type": "application/json" }),
      body: JSON.stringify({
        platform: "wechat",
        provider: "webhook",
        url: "https://hook.example/xyz",
        token: "secret-token-value",
      }),
    });
    expect(created.status).toBe(201);
    const targetId = ((await created.json()) as { id: string }).id;
    const row = allAuditRows().at(-1)!;
    expect(row.action).toBe("publish_target.create");
    expect(JSON.stringify(row)).not.toContain("secret-token-value");
    expect(JSON.stringify(row)).not.toContain("hook.example");

    const del = await app.request(`/api/publish-targets/${targetId}`, {
      method: "DELETE",
      headers: authed(token),
    });
    expect(del.status).toBe(200);
    expect(allAuditRows().at(-1)).toMatchObject({
      action: "publish_target.delete",
      object_id: targetId,
    });
  });
});

describe("GET /api/audit", () => {
  let otherToken: string;

  beforeAll(async () => {
    otherToken = authToken(await register("other@audit.dev"));
  });

  it("returns only the caller's records, newest first", async () => {
    const res = await app.request("/api/audit", { headers: authed(otherToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ user_id: string; created_at: number }> };
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) expect(item.user_id).not.toBe("unknown");
    // registration + login from this suite are present; auditor's rows are not.
    const actions = await app.request("/api/audit?limit=100", { headers: authed(otherToken) });
    const list = ((await actions.json()) as { items: Array<{ action: string }> }).items.map((i) => i.action);
    expect(list).toContain("account.register");
    expect(list).not.toContain("settings.update");
  });

  it("paginates with limit and before cursor", async () => {
    // Seed enough rows for this user: three graph creates on top of register.
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/graphs", {
        method: "POST",
        headers: authed(otherToken, { "content-type": "application/json" }),
        body: JSON.stringify({ name: `audit-page-${i}` }),
      });
      expect(res.status).toBe(201);
    }
    const first = (await (
      await app.request("/api/audit?limit=2", { headers: authed(otherToken) })
    ).json()) as { items: Array<{ action: string; created_at: number }> };
    expect(first.items).toHaveLength(2);
    // newest first
    expect(first.items[0]!.created_at).toBeGreaterThanOrEqual(first.items[1]!.created_at);
    // the second page must continue past the first page's oldest row
    const second = (await (
      await app.request(`/api/audit?limit=2&before=${first.items[1]!.created_at}`, {
        headers: authed(otherToken),
      })
    ).json()) as { items: Array<{ action: string; created_at: number }> };
    expect(second.items.length).toBeGreaterThan(0);
    expect(second.items[0]!.created_at).toBeLessThan(first.items[1]!.created_at);
  });
});

describe("audit red line (whole table)", () => {
  it("never stores a secret value in any audit row", () => {
    const blob = JSON.stringify(allAuditRows());
    expect(blob).not.toContain("sk-audit-secret");
    expect(blob).not.toContain("secret-token-value");
    expect(blob).not.toContain("newsecret9"); // the changed password itself
    expect(blob).not.toContain("****");
  });
});
