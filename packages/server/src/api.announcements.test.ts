import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-ann-"));
  process.env.DB_FILE = join(dir, "ann.sqlite");
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

function auth(token: string): { cookie: string; "content-type"?: string } {
  return { cookie: `auth_token=${token}` };
}

function createBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    titleZh: "维护通知",
    titleEn: "Maintenance notice",
    bodyZh: "今晚 02:00 停机维护。",
    bodyEn: "Downtime tonight at 02:00.",
    level: "info",
    ...over,
  };
}

describe("announcements: window filtering & bilingual payload", () => {
  let token: string;
  beforeAll(async () => {
    token = await register("reader@test.dev");
    const now = Date.now();
    db.createAnnouncement({ id: "a-active", titleZh: "进行中", titleEn: "Active", level: "info", startsAt: now - 1000 });
    db.createAnnouncement({
      id: "a-future", titleZh: "未开始", titleEn: "Future", level: "info", startsAt: now + 60_000,
    });
    db.createAnnouncement({
      id: "a-expired", titleZh: "已结束", titleEn: "Expired", level: "info", startsAt: now - 120_000, endsAt: now - 60_000,
    });
    db.createAnnouncement({
      id: "a-targeted", titleZh: "定向", titleEn: "Targeted", level: "info", startsAt: now - 1000, target: "role:admin",
    });
  });

  it("lists only in-window global announcements with both locales", async () => {
    const res = await app.request("/api/announcements", { headers: auth(token) });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as {
      items: Array<{ id: string; titleZh: string; titleEn: string; read: boolean }>;
    };
    const ids = items.map((a) => a.id);
    expect(ids).toContain("a-active");
    expect(ids).not.toContain("a-future");
    expect(ids).not.toContain("a-expired");
    expect(ids).not.toContain("a-targeted");
    const active = items.find((a) => a.id === "a-active")!;
    expect(active.titleZh).toBe("进行中");
    expect(active.titleEn).toBe("Active");
    expect(active.read).toBe(false);
  });

  it("read state is per user and idempotent", async () => {
    const first = await app.request("/api/announcements/a-active/read", {
      method: "POST",
      headers: auth(token),
    });
    expect(first.status).toBe(200);
    const again = await app.request("/api/announcements/a-active/read", {
      method: "POST",
      headers: auth(token),
    });
    expect(again.status).toBe(200); // upsert → no conflict

    const res = await app.request("/api/announcements", { headers: auth(token) });
    const { items } = (await res.json()) as { items: Array<{ id: string; read: boolean }> };
    expect(items.find((a) => a.id === "a-active")!.read).toBe(true);

    // Another user still sees it unread.
    const other = await register("reader2@test.dev");
    const res2 = await app.request("/api/announcements", { headers: auth(other) });
    const { items: items2 } = (await res2.json()) as { items: Array<{ id: string; read: boolean }> };
    expect(items2.find((a) => a.id === "a-active")!.read).toBe(false);
  });

  it("marks read of an unknown announcement as 404", async () => {
    const res = await app.request("/api/announcements/nope/read", {
      method: "POST",
      headers: auth(token),
    });
    expect(res.status).toBe(404);
  });
});

describe("announcements: admin gate", () => {
  let admin: string;
  let pleb: string;
  beforeAll(async () => {
    admin = await register("boss@test.dev");
    pleb = await register("pleb@test.dev");
    // RBAC P0: announcement admins are users with the global admin role —
    // grant it directly (owner-grant UI is P3, out of scope here).
    db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run("boss@test.dev");
  });

  it("rejects create/update/delete for non-admins", async () => {
    for (const [method, url] of [
      ["POST", "/api/announcements"],
      ["PATCH", "/api/announcements/a-active"],
      ["DELETE", "/api/announcements/a-active"],
    ] as const) {
      const res = await app.request(url, {
        method,
        headers: { ...auth(pleb), "content-type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(createBody()),
      });
      expect(res.status).toBe(403);
    }
  });

  it("validates payloads for admins", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ titleZh: "", titleEn: "x" }, "titleZh"],
      [{ titleZh: "x", titleEn: "" }, "titleEn"],
      [{ ...createBody(), level: "severe" }, "level"],
      [{ ...createBody(), startsAt: 1, endsAt: 0 }, "endsAt"],
    ];
    for (const [body, label] of cases) {
      const res = await app.request("/api/announcements", {
        method: "POST",
        headers: { ...auth(admin), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      const { error } = (await res.json()) as { error: string };
      expect(error).toContain(label === "level" ? "level" : label === "endsAt" ? "endsAt" : "title");
    }
  });

  it("admin can create, the announcement shows up, and update/delete round-trip", async () => {
    const create = await app.request("/api/announcements", {
      method: "POST",
      headers: { ...auth(admin), "content-type": "application/json" },
      body: JSON.stringify(createBody({ level: "warning" })),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; level: string };
    expect(created.level).toBe("warning");

    const list = await app.request("/api/announcements", { headers: auth(pleb) });
    const { items } = (await list.json()) as { items: Array<{ id: string }> };
    expect(items.map((a) => a.id)).toContain(created.id);

    const patch = await app.request(`/api/announcements/${created.id}`, {
      method: "PATCH",
      headers: { ...auth(admin), "content-type": "application/json" },
      body: JSON.stringify(createBody({ level: "critical" })),
    });
    expect(patch.status).toBe(200);

    const del = await app.request(`/api/announcements/${created.id}`, {
      method: "DELETE",
      headers: auth(admin),
    });
    expect(del.status).toBe(200);

    const list2 = await app.request("/api/announcements", { headers: auth(pleb) });
    const { items: items2 } = (await list2.json()) as { items: Array<{ id: string }> };
    expect(items2.map((a) => a.id)).not.toContain(created.id);
  });

  it("exposes the announcement-admin flag only to global admin/owner roles via /me", async () => {
    const meAdmin = await app.request("/api/auth/me", { headers: auth(admin) });
    const { user: adminUser } = (await meAdmin.json()) as {
      user: { role?: string; canManageAnnouncements?: boolean };
    };
    expect(adminUser.role).toBe("admin");
    expect(adminUser.canManageAnnouncements).toBe(true);

    const mePleb = await app.request("/api/auth/me", { headers: auth(pleb) });
    const { user: plebUser } = (await mePleb.json()) as {
      user: { role?: string; canManageAnnouncements?: boolean };
    };
    expect(plebUser.role).toBe("user");
    expect(plebUser.canManageAnnouncements).toBe(false);
  });

  it("returns the full manage list (including not-yet-started / expired) to an admin", async () => {
    const res = await app.request("/api/announcements/manage", { headers: auth(admin) });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: Array<{ id: string }> };
    const ids = items.map((a) => a.id);
    expect(ids).toContain("a-future");
    expect(ids).toContain("a-expired");
    expect(ids).toContain("a-active");
  });

  it("forbids the manage list for non-admins", async () => {
    const res = await app.request("/api/announcements/manage", { headers: auth(pleb) });
    expect(res.status).toBe(403);
  });
});
