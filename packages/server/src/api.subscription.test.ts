import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];
// The very first registered account bootstraps the instance owner.
let owner: { token: string; userId: string };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-subapi-"));
  process.env.DB_FILE = join(dir, "s.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  db = openDb(process.env.DB_FILE!);
  owner = await register("owner@test.dev");
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
  const cookie = res.headers.get("set-cookie") ?? "";
  const token = /auth_token=([^;]+)/.exec(cookie)![1]!;
  const { user } = (await res.json()) as { user: { id: string } };
  return { token, userId: user.id };
}

describe("GET /api/subscription (M2 S5)", () => {
  it("returns the free plan with zero usage for a fresh user", async () => {
    const { token } = await register("fresh@test.dev");
    const res = await app.request("/api/subscription", {
      headers: { cookie: `auth_token=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan: string;
      usage: { tokensNormalized: number; runs: number; videoSegments: number; tokensLimit: number };
    };
    expect(body.plan).toBe("free");
    expect(body.usage.tokensNormalized).toBe(0);
    expect(body.usage.runs).toBe(0);
    expect(body.usage.videoSegments).toBe(0);
    expect(body.usage.tokensLimit).toBe(0);
  });

  it("401s without a session", async () => {
    const res = await app.request("/api/subscription");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/users/:id/plan (M2 S5)", () => {
  it("lets the owner upgrade free → pro and the change is visible on GET", async () => {
    const target = await register("target@test.dev");

    const put = await app.request(`/api/admin/users/${target.userId}/plan`, {
      method: "POST",
      headers: { cookie: `auth_token=${owner.token}`, "content-type": "application/json" },
      body: JSON.stringify({ plan: "pro" }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).plan).toBe("pro");

    const get = await app.request("/api/subscription", {
      headers: { cookie: `auth_token=${target.token}` },
    });
    const body = (await get.json()) as { plan: string; usage: { tokensLimit: number } };
    expect(body.plan).toBe("pro");
    expect(body.usage.tokensLimit).toBe(2_000_000);
  });

  it("403s for a non-owner", async () => {
    const regular = await register("regular@test.dev");
    const victim = await register("victim@test.dev");
    const res = await app.request(`/api/admin/users/${victim.userId}/plan`, {
      method: "POST",
      headers: { cookie: `auth_token=${regular.token}`, "content-type": "application/json" },
      body: JSON.stringify({ plan: "team" }),
    });
    expect(res.status).toBe(403);
  });

  it("400s on an invalid plan", async () => {
    const target = await register("target-bad@test.dev");
    const res = await app.request(`/api/admin/users/${target.userId}/plan`, {
      method: "POST",
      headers: { cookie: `auth_token=${owner.token}`, "content-type": "application/json" },
      body: JSON.stringify({ plan: "enterprise" }),
    });
    expect(res.status).toBe(400);
  });
});
