import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-access-"));
  process.env.DB_FILE = join(dir, "access.sqlite");
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

async function register(email: string): Promise<string> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const m = /auth_token=([^;]+)/.exec(cookie);
  if (!m) throw new Error(`register failed: ${res.status}`);
  return m[1]!;
}

function auth(token: string): { cookie: string } {
  return { cookie: `auth_token=${token}` };
}

async function createGraph(token: string, name: string): Promise<string> {
  const res = await app.request("/api/graphs", {
    method: "POST",
    headers: { ...auth(token), "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  const graph = (await res.json()) as { id: string };
  return graph.id;
}

async function putAccess(
  token: string,
  graphId: string,
  email: string,
  role: string | null,
): Promise<Response> {
  return app.request(`/api/graphs/${graphId}/access`, {
    method: "PUT",
    headers: { ...auth(token), "content-type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
}

describe("graph sharing ACL API (design-rbac P1)", () => {
  let ownerToken: string;
  let editorToken: string;
  let outsiderToken: string;
  let graphId: string;

  beforeAll(async () => {
    ownerToken = await register("acl-owner@test.dev");
    editorToken = await register("acl-editor@test.dev");
    outsiderToken = await register("acl-outsider@test.dev");
    graphId = await createGraph(ownerToken, "shared graph");
  });

  it("grants editor and lists the collaborator", async () => {
    const grant = await putAccess(ownerToken, graphId, "acl-editor@test.dev", "editor");
    expect(grant.status).toBe(200);
    expect(await grant.json()).toEqual({ ok: true, role: "editor" });

    const res = await app.request(`/api/graphs/${graphId}/access`, { headers: auth(ownerToken) });
    expect(res.status).toBe(200);
    const { collaborators } = (await res.json()) as {
      collaborators: Array<{ email: string; role: string }>;
    };
    expect(collaborators).toEqual([
      { userId: expect.any(String), email: "acl-editor@test.dev", role: "editor", createdAt: expect.any(Number) },
    ]);
  });

  it("overwrites editor with viewer (idempotent upsert)", async () => {
    const downgrade = await putAccess(ownerToken, graphId, "acl-editor@test.dev", "viewer");
    expect(downgrade.status).toBe(200);

    const res = await app.request(`/api/graphs/${graphId}/access`, { headers: auth(ownerToken) });
    const { collaborators } = (await res.json()) as { collaborators: Array<{ role: string }> };
    expect(collaborators).toHaveLength(1);
    expect(collaborators[0]!.role).toBe("viewer");
  });

  it("rejects non-owners reading or changing the ACL", async () => {
    // Collaborator (viewer): can see the graph, must not see the ACL.
    const read = await app.request(`/api/graphs/${graphId}/access`, { headers: auth(editorToken) });
    expect(read.status).toBe(403);

    const write = await putAccess(editorToken, graphId, "acl-outsider@test.dev", "editor");
    expect(write.status).toBe(403);

    // Outsider with no access at all: 404, never 403 (no existence leak).
    const outsiderRead = await app.request(`/api/graphs/${graphId}/access`, { headers: auth(outsiderToken) });
    expect(outsiderRead.status).toBe(404);
  });

  it("validates grant payloads", async () => {
    expect((await putAccess(ownerToken, graphId, "acl-editor@test.dev", "admin")).status).toBe(400);
    expect((await putAccess(ownerToken, graphId, "", "editor")).status).toBe(400);
    expect((await putAccess(ownerToken, graphId, "ghost@test.dev", "editor")).status).toBe(404);
    expect((await putAccess(ownerToken, graphId, "acl-owner@test.dev", "editor")).status).toBe(400);
  });

  it("writes audit entries for grant and revoke", async () => {
    const grant = await putAccess(ownerToken, graphId, "acl-outsider@test.dev", "viewer");
    expect(grant.status).toBe(200);

    const revoke = await putAccess(ownerToken, graphId, "acl-outsider@test.dev", null);
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toEqual({ ok: true, revoked: true });

    // Idempotent revoke: nothing left to remove.
    const again = await putAccess(ownerToken, graphId, "acl-outsider@test.dev", null);
    expect(await again.json()).toEqual({ ok: true, revoked: false });

    const actions = db
      .prepare("SELECT action FROM audit_log WHERE object_type = 'graph' AND object_id = ? ORDER BY created_at")
      .all(graphId) as Array<{ action: string }>;
    expect(actions.map((a) => a.action)).toContain("access.grant");
    expect(actions.map((a) => a.action)).toContain("access.revoke");
  });

  it("drops ACL rows when the graph is deleted", async () => {
    const doomed = await createGraph(ownerToken, "doomed");
    expect((await putAccess(ownerToken, doomed, "acl-editor@test.dev", "editor")).status).toBe(200);

    const res = await app.request(`/api/graphs/${doomed}`, { method: "DELETE", headers: auth(ownerToken) });
    expect(res.status).toBe(200);

    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM resource_access WHERE resource_id = ?")
      .get(doomed) as { n: number };
    expect(rows.n).toBe(0);
  });
});

describe("run & artifact access inheritance (design-rbac P1)", () => {
  let ownerToken: string;
  let editorToken: string;
  let viewerToken: string;
  let outsiderToken: string;
  let ownerId: string;
  let graphId: string;
  let runId: string;
  let artifactId: string;

  function userIdByEmail(email: string): string {
    const row = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
    if (!row) throw new Error(`user not found: ${email}`);
    return row.id;
  }

  beforeAll(async () => {
    ownerToken = await register("ra-owner@test.dev");
    editorToken = await register("ra-editor@test.dev");
    viewerToken = await register("ra-viewer@test.dev");
    outsiderToken = await register("ra-outsider@test.dev");
    ownerId = userIdByEmail("ra-owner@test.dev");
    graphId = await createGraph(ownerToken, "run-access graph");
    await putAccess(ownerToken, graphId, "ra-editor@test.dev", "editor");
    await putAccess(ownerToken, graphId, "ra-viewer@test.dev", "viewer");

    // Seed a run owned by the graph owner, plus an artifact on it.
    runId = `run-${graphId.slice(0, 8)}`;
    artifactId = `art-${runId}`;
    db.prepare(
      `INSERT INTO runs (id, user_id, graph_id, snapshot, status, trigger, started_at)
       VALUES (?, ?, ?, ?, 'done', 'manual', ?)`,
    ).run(runId, ownerId, graphId, JSON.stringify({ nodes: [], edges: [] }), Date.now());
    db.prepare(
      `INSERT INTO artifacts (id, run_id, user_id, graph_id, node_id, kind, storage, size_bytes, created_at)
       VALUES (?, ?, ?, ?, 'n-1', 'text', 'local', ?, ?)`,
    ).run(artifactId, runId, ownerId, graphId, 5, Date.now());

    // Write the artifact bytes so /api/artifacts/:id can serve them.
    const artifactDir = join(dirname(resolve(process.env.DB_FILE!)), "artifacts");
    const blobPath = join(artifactDir, runId.slice(0, 2), runId, artifactId);
    mkdirSync(dirname(blobPath), { recursive: true });
    writeFileSync(blobPath, "hello");
  });

  it("lists shared graphs with their role", async () => {
    const res = await app.request("/api/graphs", { headers: auth(editorToken) });
    expect(res.status).toBe(200);
    const graphs = (await res.json()) as Array<{ id: string; sharedRole?: string }>;
    const g = graphs.find((x) => x.id === graphId);
    expect(g).toBeDefined();
    expect(g!.sharedRole).toBe("editor");
  });

  it("grants viewers read-only access to run read endpoints", async () => {
    for (const path of [
      `/api/runs/${runId}/stats`,
      `/api/runs/${runId}/graph`,
      `/api/runs/${runId}/events`,
      `/api/runs/${runId}/artifacts`,
    ]) {
      const res = await app.request(path, { headers: auth(viewerToken) });
      expect(res.status, path).toBe(200);
    }
  });

  it("grants editors read access to run endpoints", async () => {
    for (const path of [
      `/api/runs/${runId}/stats`,
      `/api/runs/${runId}/graph`,
      `/api/runs/${runId}/events`,
      `/api/runs/${runId}/artifacts`,
    ]) {
      const res = await app.request(path, { headers: auth(editorToken) });
      expect(res.status, path).toBe(200);
    }
  });

  it("denies outsiders access to run read endpoints (404, no existence leak)", async () => {
    for (const path of [
      `/api/runs/${runId}/stats`,
      `/api/runs/${runId}/graph`,
      `/api/runs/${runId}/events`,
      `/api/runs/${runId}/artifacts`,
    ]) {
      const res = await app.request(path, { headers: auth(outsiderToken) });
      expect(res.status, path).toBe(404);
    }
  });

  it("forbids viewers from mutating runs (403) but not outsiders (404)", async () => {
    const mutating = [
      { method: "POST", path: `/api/runs/${runId}/cancel` },
      { method: "POST", path: `/api/runs/${runId}/resume`, body: { action: "approve" } },
      { method: "POST", path: `/api/runs/${runId}/rerun` },
    ];
    for (const m of mutating) {
      const viewerRes = await app.request(m.path, {
        method: m.method,
        headers: { ...auth(viewerToken), "content-type": "application/json" },
        body: m.body ? JSON.stringify(m.body) : undefined,
      });
      expect(viewerRes.status, `${m.method} ${m.path} viewer`).toBe(403);

      const outsiderRes = await app.request(m.path, {
        method: m.method,
        headers: { ...auth(outsiderToken), "content-type": "application/json" },
        body: m.body ? JSON.stringify(m.body) : undefined,
      });
      expect(outsiderRes.status, `${m.method} ${m.path} outsider`).toBe(404);
    }
  });

  it("lets editors start runs (passes ACL; worker may be unavailable)", async () => {
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { ...auth(editorToken), "content-type": "application/json" },
      body: JSON.stringify({ graphId }),
    });
    // Editor must not be blocked by access control (403/404). Execution may
    // fail without a worker, but the ACL gate is what we assert here.
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  it("forbids viewers from starting runs", async () => {
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { ...auth(viewerToken), "content-type": "application/json" },
      body: JSON.stringify({ graphId }),
    });
    expect(res.status).toBe(403);
  });

  it("exposes shared graph artifacts to collaborators, hides from outsiders", async () => {
    const list = await app.request("/api/artifacts", { headers: auth(editorToken) });
    expect(list.status).toBe(200);
    const items = (await list.json()) as Array<{ id: string }>;
    expect(items.map((i) => i.id)).toContain(artifactId);

    const one = await app.request(`/api/artifacts/${artifactId}`, { headers: auth(viewerToken) });
    expect(one.status).toBe(200);

    const outsider = await app.request(`/api/artifacts/${artifactId}`, { headers: auth(outsiderToken) });
    expect(outsider.status).toBe(404);
  });
});
