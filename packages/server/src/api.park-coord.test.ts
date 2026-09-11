import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-park-api-"));
  process.env.DB_FILE = join(dir, "api.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
});

afterAll(async () => {
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
const authed = (token: string) => ({ cookie: `auth_token=${token}` });

async function createGraph(token: string, name: string): Promise<string> {
  const res = await app.request("/api/graphs", {
    method: "POST",
    headers: { ...authed(token), "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  const g = (await res.json()) as { id: string };
  return g.id;
}

function putCoord(token: string, id: string, body: unknown) {
  return app.request(`/api/graphs/${id}/park-coord`, {
    method: "PUT",
    headers: { ...authed(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function overviewRow(token: string, id: string) {
  const res = await app.request("/api/operations/overview", { headers: authed(token) });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { graphs: Array<{ graphId: string; parkX: number | null; parkZ: number | null }> };
  return body.graphs.find((g) => g.graphId === id);
}

describe("RTS stage-B park-coord API (migration 37)", () => {
  it("requires authentication", async () => {
    const res = await app.request("/api/graphs/g1/park-coord", { method: "PUT" });
    expect(res.status).toBe(401);
  });

  it("lets the owner set a coordinate and surfaces it in overview", async () => {
    const owner = await register("park-owner@example.com");
    const id = await createGraph(owner, "Parked");
    const put = await putCoord(owner, id, { x: 8, z: -3.5 });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ ok: true, parkX: 8, parkZ: -3.5 });

    const row = await overviewRow(owner, id);
    expect(row?.parkX).toBe(8);
    expect(row?.parkZ).toBe(-3.5);
  });

  it("rejects non-finite coordinates with 400", async () => {
    const owner = await register("park-nan@example.com");
    const id = await createGraph(owner, "Nan");
    expect((await putCoord(owner, id, { x: Number.NaN, z: 1 })).status).toBe(400);
    expect((await putCoord(owner, id, { x: 1, z: Number.POSITIVE_INFINITY })).status).toBe(400);
    expect((await putCoord(owner, id, { x: "1", z: 1 })).status).toBe(400);
    expect((await putCoord(owner, id, { x: 1 })).status).toBe(400);
  });

  it("hides the graph from an outsider (404) and forbids a shared non-owner (403)", async () => {
    const owner = await register("park-own2@example.com");
    const outsider = await register("park-outsider@example.com");
    const viewer = await register("park-viewer@example.com");
    const id = await createGraph(owner, "ACL");

    // An unrelated user has no access — existence is hidden as 404.
    expect((await putCoord(outsider, id, { x: 1, z: 1 })).status).toBe(404);

    // Grant the viewer read access; they can see the graph but not move it.
    const grant = await app.request(`/api/graphs/${id}/access`, {
      method: "PUT",
      headers: { ...authed(owner), "content-type": "application/json" },
      body: JSON.stringify({ email: "park-viewer@example.com", role: "viewer" }),
    });
    expect(grant.status).toBe(200);

    expect((await putCoord(viewer, id, { x: 1, z: 1 })).status).toBe(403);
    const del = await app.request(`/api/graphs/${id}/park-coord`, {
      method: "DELETE",
      headers: authed(viewer),
    });
    expect(del.status).toBe(403);
  });

  it("returns 404 for an unknown graph", async () => {
    const owner = await register("park-404@example.com");
    expect((await putCoord(owner, "g-missing", { x: 1, z: 1 })).status).toBe(404);
  });

  it("clears a stored coordinate and overview falls back to null", async () => {
    const owner = await register("park-clear@example.com");
    const id = await createGraph(owner, "Clear");
    await putCoord(owner, id, { x: 2, z: 2 });
    const del = await app.request(`/api/graphs/${id}/park-coord`, {
      method: "DELETE",
      headers: authed(owner),
    });
    expect(del.status).toBe(200);
    const row = await overviewRow(owner, id);
    expect(row?.parkX).toBeNull();
    expect(row?.parkZ).toBeNull();
  });
});
