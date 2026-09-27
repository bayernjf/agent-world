import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-provision-"));
  process.env.DB_FILE = join(dir, "provision.sqlite");
  // These tests need a second self-registered account to prove a plain user
  // cannot provision one; the flag is read per request inside the route.
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  db = openDb(process.env.DB_FILE!);
});

afterAll(async () => {
  await db.close();
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

function cookieOf(res: Response): string {
  const m = /auth_token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  if (!m) throw new Error(`no session cookie (status ${res.status})`);
  return `auth_token=${m[1]}`;
}

async function register(email: string): Promise<string> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return cookieOf(res);
}

// vitest.setup mocks bcryptjs.compare to `true`, so the password value is
// meaningless here — what these tests prove is the flag's lifecycle, not hashing.
async function login(email: string, password = "secret123"): Promise<{ cookie: string; body: any }> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`login failed: ${res.status} ${JSON.stringify(body)}`);
  return { cookie: cookieOf(res), body };
}

function post(email: string, cookie: string): Promise<Response> {
  return app.request("/api/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ email }),
  });
}

async function me(cookie: string): Promise<any> {
  const res = await app.request("/api/auth/me", { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()).user;
}

let ownerCookie: string;
let oneTimePassword = "";

describe("owner provisioning — POST /api/admin/users", () => {
  it("the first account to exist is the owner and can open a second one", async () => {
    // Registration is closed once an account exists, so this also bootstraps the
    // owner (createUser's first-account rule).
    ownerCookie = await register("owner@aw.test");
    const res = await post("teammate@aw.test", ownerCookie);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toMatchObject({ email: "teammate@aw.test", role: "user" });
    expect(typeof body.oneTimePassword).toBe("string");
    expect(body.oneTimePassword.length).toBeGreaterThanOrEqual(16);
    oneTimePassword = body.oneTimePassword;
  });

  it("flags the new account and leaves self-signup alone", async () => {
    const row = await db.findUserByEmail("teammate@aw.test");
    expect(row?.must_change_password).toBe(1);
    const owner = await db.findUserByEmail("owner@aw.test");
    expect(owner?.must_change_password).toBe(0);
  });

  it("the audit row names the account but never carries the password", async () => {
    const raw = new DatabaseSync(process.env.DB_FILE!);
    const rows = raw
      .prepare("SELECT action, detail, object_id FROM audit_log WHERE action = 'account.provision'")
      .all() as Array<{ action: string; detail: string; object_id: string }>;
    raw.close();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.detail)).toEqual({ email: "teammate@aw.test" });
    // The one thing this route writes that could leak: the row must not contain
    // the one-time password, in any column.
    const dumped = JSON.stringify(rows);
    expect(dumped).not.toContain(oneTimePassword);
    expect(dumped).not.toContain("password");
  });

  it("refuses a duplicate or malformed email", async () => {
    expect((await post("teammate@aw.test", ownerCookie)).status).toBe(409);
    expect((await post("not-an-email", ownerCookie)).status).toBe(400);
    expect((await post("", ownerCookie)).status).toBe(400);
  });

  it("is the owner's exclusive power — a plain user gets 403", async () => {
    const pleb = await register("pleb@aw.test");
    const res = await post("third@aw.test", pleb);
    expect(res.status).toBe(403);
    expect(await db.findUserByEmail("third@aw.test")).toBeUndefined();
  });

  it("anonymous callers never reach the handler", async () => {
    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ghost@aw.test" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("must_change_password enforcement", () => {
  it("reports the flag on login and on /me", async () => {
    const { cookie, body } = await login("teammate@aw.test");
    expect(body.user.mustChangePassword).toBe(true);
    expect((await me(cookie)).mustChangePassword).toBe(true);
    // Ordinary accounts are unaffected — the flag must not become a default-on.
    expect((await me(ownerCookie)).mustChangePassword).toBe(false);
  });

  it("refuses every non-auth route while the one-time password stands", async () => {
    const { cookie } = await login("teammate@aw.test");
    for (const path of ["/api/graphs", "/api/skills", "/api/admin/users"]) {
      const res = await app.request(path, { headers: { cookie } });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
  });

  it("still allows the auth routes the invitee needs to get out of it", async () => {
    const { cookie } = await login("teammate@aw.test");
    expect((await app.request("/api/auth/me", { headers: { cookie } })).status).toBe(200);
    const change = await app.request("/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ currentPassword: "whatever", newPassword: "their-own-secret" }),
    });
    expect(change.status).toBe(200);
    // Cleared in the same write as the hash — not left dangling for a route to
    // remember to do.
    expect((await db.findUserByEmail("teammate@aw.test"))?.must_change_password).toBe(0);
  });

  it("opens the product up afterwards, and stays open on a fresh login", async () => {
    const { cookie } = await login("teammate@aw.test", "their-own-secret");
    expect((await app.request("/api/graphs", { headers: { cookie } })).status).toBe(200);
    expect((await me(cookie)).mustChangePassword).toBe(false);
    const again = await login("teammate@aw.test", "their-own-secret");
    expect(again.body.user.mustChangePassword).toBe(false);
  });
});
