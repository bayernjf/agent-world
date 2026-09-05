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
  dir = mkdtempSync(join(tmpdir(), "aw-rbac-"));
  process.env.DB_FILE = join(dir, "rbac.sqlite");
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

async function me(token: string): Promise<{ role: string; canManageAnnouncements: boolean }> {
  const res = await app.request("/api/auth/me", { headers: auth(token) });
  expect(res.status).toBe(200);
  const { user } = (await res.json()) as { user: { role: string; canManageAnnouncements: boolean } };
  return user;
}

// bcryptjs compare is mocked to `true` in vitest.setup, so any password works.
async function login(email: string): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const m = /auth_token=([^;]+)/.exec(cookie);
  if (!m) throw new Error(`login failed: ${res.status}`);
  return m[1]!;
}

function idOf(email: string): string {
  return (db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;
}

function setRole(token: string, id: string, role: string): Promise<Response> {
  return app.request(`/api/admin/users/${id}/role`, {
    method: "POST",
    headers: { ...auth(token), "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

describe("rbac P0: global roles on a fresh database", () => {
  let ownerToken: string;
  let plebToken: string;

  beforeAll(async () => {
    ownerToken = await register("first@test.dev");
    plebToken = await register("second@test.dev");
  });

  it("bootstraps the first registered account as owner, later ones as plain users", async () => {
    const owner = await me(ownerToken);
    expect(owner.role).toBe("owner");
    expect(owner.canManageAnnouncements).toBe(true);

    const pleb = await me(plebToken);
    expect(pleb.role).toBe("user");
    expect(pleb.canManageAnnouncements).toBe(false);

    // Single-owner invariant at the storage layer.
    const owners = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get() as { n: number };
    expect(owners.n).toBe(1);
  });

  it("lets the owner manage announcements while plain users get 403", async () => {
    const body = JSON.stringify({ titleZh: "标题", titleEn: "Title" });
    const create = await app.request("/api/announcements", {
      method: "POST",
      headers: { ...auth(ownerToken), "content-type": "application/json" },
      body,
    });
    expect(create.status).toBe(201);

    const forbidden = await app.request("/api/announcements", {
      method: "POST",
      headers: { ...auth(plebToken), "content-type": "application/json" },
      body,
    });
    expect(forbidden.status).toBe(403);
  });
});

describe("rbac P0: migration v31 bootstraps owner on a legacy database", () => {
  it("promotes the earliest registered user when the role column is absent", () => {
    const file = join(dir, "legacy.sqlite");
    // Start from a fully migrated fresh database...
    const legacy = openDb(file);
    legacy.close();
    // ...then rewind it to pre-v31 state: no index, no role column, version
    // row removed, and two users seeded with deterministic created_at order.
    const raw = new DatabaseSync(file);
    raw.exec("DROP INDEX idx_users_owner");
    raw.exec("ALTER TABLE users DROP COLUMN role");
    raw.exec("DELETE FROM schema_migrations WHERE version = 31");
    raw.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run("u-early", "early@test.dev", "x", "2026-01-01T00:00:00Z");
    raw.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run("u-late", "late@test.dev", "x", "2026-06-01T00:00:00Z");
    raw.close();

    // Re-open: migration 31 re-runs (column + index + owner bootstrap).
    const reopened = openDb(file);
    const early = reopened.findUserById("u-early");
    const late = reopened.findUserById("u-late");
    expect(early?.role).toBe("owner");
    expect(late?.role).toBe("user");
    const owners = reopened.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get() as { n: number };
    expect(owners.n).toBe(1);
    reopened.close();
  });
});

describe("rbac P3: admin user management (owner-exclusive)", () => {
  let ownerToken: string;
  let adminToken: string;
  let plebToken: string;
  let ownerId: string;
  let adminId: string;
  let plebId: string;

  beforeAll(async () => {
    // The first registered account (P0 suite above) is the owner.
    ownerToken = await login("first@test.dev");
    adminToken = await register("p3-admin@test.dev");
    plebToken = await register("p3-pleb@test.dev");
    ownerId = idOf("first@test.dev");
    adminId = idOf("p3-admin@test.dev");
    plebId = idOf("p3-pleb@test.dev");
  });

  const roleUpdateRows = (id: string): Array<Record<string, unknown>> =>
    db
      .prepare(
        "SELECT * FROM audit_log WHERE action = 'role.update' AND object_id = ? ORDER BY created_at, rowid",
      )
      .all(id) as Array<Record<string, unknown>>;

  it("owner lists all accounts, earliest registered first", async () => {
    const res = await app.request("/api/admin/users", { headers: auth(ownerToken) });
    expect(res.status).toBe(200);
    const { users } = (await res.json()) as { users: Array<Record<string, string>> };
    expect(users[0]).toMatchObject({ email: "first@test.dev", role: "owner" });
    const emails = users.map((u) => u.email);
    expect(emails).toContain("p3-admin@test.dev");
    expect(emails).toContain("p3-pleb@test.dev");
    // camelCase wire shape, nothing else leaks (no password hash).
    expect(Object.keys(users[0]!).sort()).toEqual(["createdAt", "email", "id", "role"]);
  });

  it("plain users get 403 on the account list", async () => {
    const res = await app.request("/api/admin/users", { headers: auth(plebToken) });
    expect(res.status).toBe(403);
  });

  it("owner grants admin; the grantee's /me reflects role and announcement rights", async () => {
    const res = await setRole(ownerToken, adminId, "admin");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: "admin" });
    const admin = await me(adminToken);
    expect(admin.role).toBe("admin");
    expect(admin.canManageAnnouncements).toBe(true);
  });

  it("granting the same role again is a no-op without a second audit row", async () => {
    const res = await setRole(ownerToken, adminId, "admin");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: "admin", unchanged: true });
    expect(roleUpdateRows(adminId)).toHaveLength(1);
  });

  it("admins cannot list accounts — user management stays owner-exclusive", async () => {
    const res = await app.request("/api/admin/users", { headers: auth(adminToken) });
    expect(res.status).toBe(403);
  });

  it("admins cannot change roles", async () => {
    const res = await setRole(adminToken, plebId, "admin");
    expect(res.status).toBe(403);
    // Nothing leaked to the DB behind the 403.
    expect(db.findUserById(plebId)?.role).toBe("user");
  });

  it("owner revokes admin back to plain user", async () => {
    const res = await setRole(ownerToken, adminId, "user");
    expect(res.status).toBe(200);
    const admin = await me(adminToken);
    expect(admin.role).toBe("user");
    expect(admin.canManageAnnouncements).toBe(false);
  });

  it("owner cannot demote itself", async () => {
    const res = await setRole(ownerToken, ownerId, "user");
    expect(res.status).toBe(400);
  });

  it('granting "owner" is rejected — the single-owner invariant', async () => {
    const res = await setRole(ownerToken, plebId, "owner");
    expect(res.status).toBe(400);
  });

  it("unknown roles are rejected", async () => {
    const res = await setRole(ownerToken, plebId, "superadmin");
    expect(res.status).toBe(400);
  });

  it("unknown target user is 404", async () => {
    const res = await setRole(ownerToken, "no-such-user", "admin");
    expect(res.status).toBe(404);
  });

  it("plain users cannot change roles", async () => {
    const res = await setRole(plebToken, adminId, "admin");
    expect(res.status).toBe(403);
  });

  it("role changes land in the audit log with grantee and role in detail", async () => {
    const rows = roleUpdateRows(adminId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ user_id: ownerId, object_type: "user" });
    expect(JSON.parse(rows[0].detail as string)).toEqual({ grantee: adminId, role: "admin" });
    expect(JSON.parse(rows[1].detail as string)).toEqual({ grantee: adminId, role: "user" });
  });
});

describe("rbac P3: cross-user audit viewing", () => {
  let ownerToken: string;
  let adminToken: string;
  let plebToken: string;
  let adminId: string;
  let plebId: string;

  // Ancient fixed timestamps (2001) — strictly older than every real row, so
  // cursor pagination is deterministic even if wall-clock rows share a ms.
  const SEED_BASE = 1_000_000_000_000;

  beforeAll(async () => {
    ownerToken = await login("first@test.dev");
    adminToken = await login("p3-admin@test.dev");
    plebToken = await login("p3-pleb@test.dev");
    adminId = idOf("p3-admin@test.dev");
    plebId = idOf("p3-pleb@test.dev");
    // Re-grant admin (revoked at the end of the user-management suite).
    const res = await setRole(ownerToken, adminId, "admin");
    expect(res.status).toBe(200);
    // Five pleb rows with distinct, strictly ordered created_at values.
    const seed = db.prepare(
      `INSERT INTO audit_log (id, user_id, action, object_type, object_id, detail, ip, created_at)
       VALUES (?, ?, 'settings.update', 'settings', NULL, NULL, NULL, ?)`,
    );
    for (let i = 0; i < 5; i++) seed.run(`p3-seed-${i}`, plebId, SEED_BASE + i);
  });

  it("owner sees every user's audit rows with emails resolved", async () => {
    // A failed login leaves a row attributed to the unknown actor.
    const failed = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ghost-p3@test.dev", password: "wrong" }),
    });
    expect(failed.status).toBe(401);

    const res = await app.request("/api/audit?limit=200", { headers: auth(ownerToken) });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as {
      items: Array<{ user_id: string; email: string | null }>;
    };
    const byUser = new Map(items.map((i) => [i.user_id, i.email]));
    expect(byUser.get(plebId)).toBe("p3-pleb@test.dev");
    expect(byUser.get(adminId)).toBe("p3-admin@test.dev");
    // user_id 'unknown' has no users row — the LEFT JOIN yields email null.
    expect(byUser.get("unknown")).toBeNull();
  });

  it("admin filters audit by userId; plain users have the filter ignored", async () => {
    const filtered = await app.request(`/api/audit?userId=${plebId}`, { headers: auth(adminToken) });
    expect(filtered.status).toBe(200);
    const { items } = (await filtered.json()) as {
      items: Array<{ user_id: string; email: string }>;
    };
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.user_id).toBe(plebId);
      expect(item.email).toBe("p3-pleb@test.dev");
    }

    // The plain user asks for someone else's rows but only ever gets her own.
    const spoofed = await app.request(`/api/audit?userId=${adminId}`, { headers: auth(plebToken) });
    expect(spoofed.status).toBe(200);
    const { items: own } = (await spoofed.json()) as {
      items: Array<{ user_id: string }>;
    };
    expect(own.length).toBeGreaterThan(0);
    for (const item of own) expect(item.user_id).toBe(plebId);
  });

  it("admin audit listing paginates by limit", async () => {
    const res = await app.request(`/api/audit?userId=${plebId}&limit=2`, {
      headers: auth(adminToken),
    });
    const { items } = (await res.json()) as {
      items: Array<{ action: string; created_at: number }>;
    };
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.action)).toEqual(["account.login", "account.register"]);
    expect(items[0]!.created_at).toBeGreaterThan(items[1]!.created_at);
  });

  it("admin audit listing pages with a before cursor", async () => {
    const first = await app.request(`/api/audit?userId=${plebId}&limit=2`, {
      headers: auth(adminToken),
    });
    const page1 = ((await first.json()) as { items: Array<{ created_at: number }> }).items;
    const before = page1[1]!.created_at;
    const res = await app.request(`/api/audit?userId=${plebId}&limit=2&before=${before}`, {
      headers: auth(adminToken),
    });
    const { items } = (await res.json()) as {
      items: Array<{ created_at: number }>;
    };
    // The seeded rows follow the cursor, newest first, with no overlap.
    expect(items.map((i) => i.created_at)).toEqual([SEED_BASE + 4, SEED_BASE + 3]);
    for (const item of items) expect(item.created_at).toBeLessThan(before);
  });
});
