import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearErrors, recordError } from "./errors.js";

// HTTP surface for the process-level error feed. The Hono app is a module
// singleton reading DB/config at import time, so give it a scratch database
// before importing.
let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];
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
  dir = mkdtempSync(join(tmpdir(), "aw-errors-api-"));
  process.env.DB_FILE = join(dir, "api.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  // First registrant is the instance owner; the second is a regular user.
  ownerToken = await auth("/api/auth/register", "owner@example.com");
  userToken = await auth("/api/auth/register", "user@example.com");
});

afterAll(() => {
  clearErrors();
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/admin/errors", () => {
  it("requires authentication", async () => {
    const r = await app.request("/api/admin/errors");
    expect(r.status).toBe(401);
  });

  it("forbids a non-admin user", async () => {
    const r = await app.request("/api/admin/errors", { headers: authed(userToken) });
    expect(r.status).toBe(403);
  });

  it("returns captured errors to the owner and honors limit", async () => {
    clearErrors();
    recordError("manual", new Error("alpha"));
    recordError("manual", new Error("beta"));
    recordError("manual", new Error("gamma"));

    const all = await app.request("/api/admin/errors", { headers: authed(ownerToken) });
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as { items: Array<{ message: string }> };
    expect(allBody.items).toHaveLength(3);
    expect(allBody.items.map((r) => r.message)).toEqual(["gamma", "beta", "alpha"]);

    const limited = await app.request("/api/admin/errors?limit=2", {
      headers: authed(ownerToken),
    });
    const limitedBody = (await limited.json()) as { items: Array<{ message: string }> };
    expect(limitedBody.items).toHaveLength(2);
    expect(limitedBody.items.map((r) => r.message)).toEqual(["gamma", "beta"]);
  });
});
