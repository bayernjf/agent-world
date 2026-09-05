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
