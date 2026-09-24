import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type NewRemoteJob } from "./db.js";

// HTTP surface for the G4 remote-job admin feed. The Hono app is a module
// singleton reading DB/config at import time, so give it a scratch database
// before importing. A second connection to the same file seeds remote_jobs
// (the engine normally writes these internally).
let dir: string;
let dbFile: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];
let seedDb: ReturnType<typeof openDb>;
let ownerToken = "";
let userToken = "";

async function auth(path: string, email: string): Promise<string> {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const m = /auth_token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  if (!m) throw new Error(`auth failed (${path}): ${res.status}`);
  return m[1]!;
}
const authed = (token: string) => ({ cookie: `auth_token=${token}` });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-rj-api-"));
  dbFile = join(dir, "api.sqlite");
  process.env.DB_FILE = dbFile;
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  // First registrant is the instance owner; the second is a regular user.
  ownerToken = await auth("/api/auth/register", "owner@example.com");
  userToken = await auth("/api/auth/register", "user@example.com");
  seedDb = openDb(dbFile);
});

afterAll(() => {
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

async function seedJobs(): Promise<void> {
  const owner = await seedDb.findUserByEmail("owner@example.com");
  if (!owner) throw new Error("owner not seeded");
  const base: Omit<NewRemoteJob, "id" | "remoteJobId" | "submittedAt"> = {
    userId: owner.id,
    runId: "r1",
    graphId: "g1",
    nodeId: "v1",
    attempt: 1,
    kind: "video",
    provider: "siliconflow",
  };
  await seedDb.insertRemoteJob({ ...base, id: "j1", remoteJobId: "rem-1", submittedAt: 3000 });
  await seedDb.insertRemoteJob({ ...base, id: "j2", remoteJobId: "rem-2", submittedAt: 1000 });
  await seedDb.insertRemoteJob({ ...base, id: "j3", remoteJobId: "rem-3", submittedAt: 2000 });
  await seedDb.finishRemoteJob("j3", "succeeded");
}

describe("GET /api/admin/remote-jobs", () => {
  it("requires authentication", async () => {
    const r = await app.request("/api/admin/remote-jobs");
    expect(r.status).toBe(401);
  });

  it("forbids a non-admin user", async () => {
    const r = await app.request("/api/admin/remote-jobs", { headers: authed(userToken) });
    expect(r.status).toBe(403);
  });

  it("returns open jobs oldest-first to the owner and hides terminal jobs", async () => {
    await seedJobs();
    const r = await app.request("/api/admin/remote-jobs", { headers: authed(ownerToken) });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { items: Array<{ id: string; state: string }> };
    // j3 succeeded → excluded; open jobs oldest-first (j2@1000, j1@3000).
    expect(body.items.map((j) => j.id)).toEqual(["j2", "j1"]);
    expect(body.items.every((j) => j.state === "submitted" || j.state === "running")).toBe(true);
  });

  it("includes terminal jobs newest-first with ?all=1", async () => {
    const r = await app.request("/api/admin/remote-jobs?all=1", {
      headers: authed(ownerToken),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((j) => j.id)).toEqual(["j1", "j3", "j2"]);
  });

  it("honors the limit query parameter", async () => {
    const r = await app.request("/api/admin/remote-jobs?limit=1", {
      headers: authed(ownerToken),
    });
    const body = (await r.json()) as { items: Array<{ id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe("j2");
  });
});
