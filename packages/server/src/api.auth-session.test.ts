import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Session revocation + registration-conflict wording (review 2026-11-02
// P3-5/P3-6). Each test drives the real Hono app against a scratch database.

let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-auth-session-"));
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

const authed = (token: string, headers: Record<string, string> = {}) => ({
  cookie: `auth_token=${token}`,
  ...headers,
});

describe("session revocation", () => {
  it("rejects an old token on every guarded route after logout", async () => {
    const res = await register("logout@example.com");
    expect(res.status).toBe(201);
    const token = authToken(res);

    // Both the auth endpoint and a regular API route accept it before logout.
    expect((await app.request("/api/auth/me", { headers: authed(token) })).status).toBe(200);
    expect((await app.request("/api/graphs", { headers: authed(token) })).status).toBe(200);

    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: authed(token),
    });
    expect(logout.status).toBe(204);

    // The captured cookie is now dead even though its JWT is still unexpired.
    expect((await app.request("/api/auth/me", { headers: authed(token) })).status).toBe(401);
    expect((await app.request("/api/graphs", { headers: authed(token) })).status).toBe(401);

    // A fresh password login still works (the epoch bump revokes, not locks).
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "logout@example.com", password: "secret123" }),
    });
    expect(login.status).toBe(200);
    expect((await app.request("/api/auth/me", { headers: authed(authToken(login)) })).status).toBe(200);
  });

  it("invalidates the pre-change token after a password change and re-issues one", async () => {
    const res = await register("rotate@example.com");
    expect(res.status).toBe(201);
    const oldToken = authToken(res);

    const change = await app.request("/api/auth/password", {
      method: "POST",
      headers: authed(oldToken, { "content-type": "application/json" }),
      body: JSON.stringify({ currentPassword: "secret123", newPassword: "secret456" }),
    });
    expect(change.status).toBe(200);
    const newToken = authToken(change);

    expect((await app.request("/api/auth/me", { headers: authed(oldToken) })).status).toBe(401);
    expect((await app.request("/api/auth/me", { headers: authed(newToken) })).status).toBe(200);
  });
});

describe("registration conflict wording", () => {
  it("returns one opaque 409 for an existing email, not an enumeration oracle", async () => {
    const first = await register("taken@example.com");
    expect(first.status).toBe(201);

    const second = await register("taken@example.com");
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; message: string };
    expect(body.error).toBe("registration_conflict");
    expect(body.message).toBe("Registration could not be completed");
    // The body must not echo the address nor say the email is registered.
    expect(JSON.stringify(body)).not.toContain("taken@example.com");
    expect(JSON.stringify(body)).not.toContain("已注册");
  });
});
