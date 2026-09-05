import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-feedback-"));
  process.env.DB_FILE = join(dir, "feedback.sqlite");
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

function post(token: string, body: unknown): Promise<Response> {
  return app.request("/api/feedback", {
    method: "POST",
    headers: { ...auth(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function idOf(email: string): string {
  return (db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;
}

// 1x1 PNG — the smallest valid image fixture.
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function submitOk(token: string, i: number): Promise<void> {
  const res = await post(token, { message: `feedback #${i}` });
  expect(res.status).toBe(201);
}

describe("feedback: submission", () => {
  let pleb: string;

  beforeAll(async () => {
    pleb = await register(`pleb-${Date.now()}@t.example`);
  });

  it("accepts a minimal submission and returns 201 + id", async () => {
    const res = await post(pleb, { message: "报表页在暗色主题下看不清" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
  });

  it("defaults category to other and persists context", async () => {
    await post(pleb, {
      message: "with context",
      context: { route: "/canvas", userAgent: "vitest-ua", locale: "zh" },
    });
    const row = db
      .prepare("SELECT category, context FROM feedback WHERE message = ?")
      .get("with context") as { category: string; context: string };
    expect(row.category).toBe("other");
    expect(JSON.parse(row.context)).toEqual({ route: "/canvas", userAgent: "vitest-ua", locale: "zh" });
  });

  it("drops non-whitelisted context fields server-side (secret red line)", async () => {
    await post(pleb, {
      message: "sneaky context",
      context: {
        route: "/",
        settings: { providers: { my: { apiKey: "sk-REAL-KEY" } } },
        apiKey: "sk-ANOTHER-KEY",
        localStorage: { token: "jwt-payload" },
        nested: { deep: { secret: "x" } },
      },
    });
    const row = db
      .prepare("SELECT context FROM feedback WHERE message = ?")
      .get("sneaky context") as { context: string };
    const stored = JSON.parse(row.context) as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual(["route"]);
    expect(JSON.stringify(stored)).not.toContain("sk-");
  });

  it("keeps only message/lineno from lastError", async () => {
    await post(pleb, {
      message: "with error",
      context: {
        lastError: { message: "Cannot read properties of undefined", lineno: 42, stack: "at Evil (app.js:1)" },
      },
    });
    const row = db
      .prepare("SELECT context FROM feedback WHERE message = ?")
      .get("with error") as { context: string };
    const stored = JSON.parse(row.context) as { lastError: { message: string; lineno: number } };
    expect(stored.lastError).toEqual({ message: "Cannot read properties of undefined", lineno: 42 });
  });

  it("rejects empty / missing message with 400", async () => {
    expect((await post(pleb, { message: "   " })).status).toBe(400);
    expect((await post(pleb, {})).status).toBe(400);
  });

  it("rejects over-length message with 400", async () => {
    expect((await post(pleb, { message: "x".repeat(2001) })).status).toBe(400);
  });

  it("rejects non-image and over-1MB attachments", async () => {
    const badMime = await post(pleb, {
      message: "bad mime",
      attachment: { data: PNG_1PX, mimeType: "text/html" },
    });
    expect(badMime.status).toBe(400);
    const big = await post(pleb, {
      message: "too big",
      attachment: { data: "A".repeat(1_400_000), mimeType: "image/png" },
    });
    expect(big.status).toBe(413);
  });

  it("stores a valid image attachment and serves it to admins", async () => {
    const res = await post(pleb, {
      message: "with screenshot",
      attachment: { data: PNG_1PX, mimeType: "image/png" },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const row = db
      .prepare("SELECT attachment, attachment_mime FROM feedback WHERE id = ?")
      .get(id) as { attachment: Uint8Array; attachment_mime: string };
    expect(row.attachment.byteLength).toBeGreaterThan(0);
    expect(row.attachment_mime).toBe("image/png");
  });

  it("rate limits to 10 submissions per rolling hour (11th → 429)", async () => {
    const u = await register(`burst-${Date.now()}@t.example`);
    for (let i = 0; i < 10; i++) await submitOk(u, i);
    const res = await post(u, { message: "the 11th" });
    expect(res.status).toBe(429);
  });
});

describe("feedback: admin listing and status flow", () => {
  let owner: string;
  let admin: string;
  let pleb: string;
  let adminEmail: string;
  let plebEmail: string;
  let fbId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    adminEmail = `admin-${stamp}@t.example`;
    plebEmail = `viewer-${stamp}@t.example`;
    // The first describe already registered users on this DB, so its first
    // account is the owner — log in as them (bcrypt compare is mocked true).
    const ownerEmail = (
      db.prepare("SELECT email FROM users WHERE role = 'owner'").get() as { email: string }
    ).email;
    owner = await login(ownerEmail);
    admin = await register(adminEmail);
    pleb = await register(plebEmail);
    // First registered account on a fresh DB is the owner (RBAC P0 bootstrap);
    // promote the second to admin via the owner-only route.
    const res = await app.request(`/api/admin/users/${idOf(adminEmail)}/role`, {
      method: "POST",
      headers: { ...auth(owner), "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(200);
    // One feedback row for the flows below (fresh user so the rate limit holds).
    const r = await post(pleb, { message: "cross-user visible", category: "bug" });
    expect(r.status).toBe(201);
    fbId = ((await r.json()) as { id: string }).id;
  });

  it("forbids GET/PATCH for non-admin users (403)", async () => {
    expect((await app.request("/api/feedback", { headers: auth(pleb) })).status).toBe(403);
    expect(
      (
        await app.request(`/api/feedback/${fbId}`, {
          method: "PATCH",
          headers: { ...auth(pleb), "content-type": "application/json" },
          body: JSON.stringify({ status: "closed" }),
        })
      ).status,
    ).toBe(403);
  });

  it("lists cross-user submissions with submitter email for admin", async () => {
    const res = await app.request("/api/feedback", { headers: auth(admin) });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as {
      items: Array<{ id: string; email: string | null; message: string; category: string; status: string; has_attachment: number }>;
    };
    const row = items.find((i) => i.id === fbId);
    expect(row).toBeDefined();
    expect(row!.message).toBe("cross-user visible");
    expect(row!.category).toBe("bug");
    expect(row!.status).toBe("open");
    expect(row!.email).toMatch(/viewer-.*@t\.example/);
  });

  it("attachment-less rows report has_attachment = 0", async () => {
    const res = await app.request("/api/feedback?status=open", { headers: auth(admin) });
    const { items } = (await res.json()) as { items: Array<{ id: string; has_attachment: number }> };
    const row = items.find((i) => i.id === fbId);
    expect(row).toBeDefined();
    expect(row!.has_attachment).toBe(0);
  });

  it("filters by status", async () => {
    const res = await app.request("/api/feedback?status=open", { headers: auth(admin) });
    const { items } = (await res.json()) as { items: Array<{ status: string }> };
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.status === "open")).toBe(true);
    const none = await app.request("/api/feedback?status=closed", { headers: auth(admin) });
    const body = (await none.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("rejects invalid status with 400 and unknown id with 404", async () => {
    const bad = await app.request(`/api/feedback/${fbId}`, {
      method: "PATCH",
      headers: { ...auth(admin), "content-type": "application/json" },
      body: JSON.stringify({ status: "wip" }),
    });
    expect(bad.status).toBe(400);
    const missing = await app.request("/api/feedback/00000000-0000-4000-8000-000000000000", {
      method: "PATCH",
      headers: { ...auth(admin), "content-type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    expect(missing.status).toBe(404);
  });

  it("walks the three-state flow and writes an audit row per change", async () => {
    const ack = await app.request(`/api/feedback/${fbId}`, {
      method: "PATCH",
      headers: { ...auth(admin), "content-type": "application/json" },
      body: JSON.stringify({ status: "acknowledged" }),
    });
    expect(ack.status).toBe(200);
    const closed = await app.request(`/api/feedback/${fbId}`, {
      method: "PATCH",
      headers: { ...auth(admin), "content-type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    expect(closed.status).toBe(200);
    const row = db.prepare("SELECT status FROM feedback WHERE id = ?").get(fbId) as { status: string };
    expect(row.status).toBe("closed");
    const audits = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'feedback.status_change' AND object_id = ? ORDER BY created_at")
      .all(fbId) as Array<{ detail: string }>;
    expect(audits).toHaveLength(2);
    expect(JSON.parse(audits[0]!.detail)).toEqual({ to: "acknowledged" });
    expect(JSON.parse(audits[1]!.detail)).toEqual({ to: "closed" });
  });

  it("same-status PATCH is idempotent (no audit row)", async () => {
    const before = (
      db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'feedback.status_change'").get() as { n: number }
    ).n;
    const res = await app.request(`/api/feedback/${fbId}`, {
      method: "PATCH",
      headers: { ...auth(admin), "content-type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unchanged?: boolean };
    expect(body.unchanged).toBe(true);
    const after = (
      db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'feedback.status_change'").get() as { n: number }
    ).n;
    expect(after).toBe(before);
  });

  it("serves attachment bytes to admins only", async () => {
    const r = await post(pleb, {
      message: "attachment flow",
      attachment: { data: PNG_1PX, mimeType: "image/png" },
    });
    const { id } = (await r.json()) as { id: string };
    const ok = await app.request(`/api/feedback/${id}/attachment`, { headers: auth(owner) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await ok.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect((await app.request(`/api/feedback/${id}/attachment`, { headers: auth(pleb) })).status).toBe(403);
    const noAttach = await app.request(`/api/feedback/${fbId}/attachment`, { headers: auth(owner) });
    expect(noAttach.status).toBe(404);
  });

  it("audits submissions with category only (never the message)", async () => {
    const rows = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'feedback.submit' ORDER BY created_at")
      .all() as Array<{ detail: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(JSON.stringify(r.detail)).not.toContain("cross-user visible");
      expect(JSON.stringify(r.detail)).not.toContain("报表页");
    }
    expect(JSON.parse(rows.at(-1)!.detail)).toHaveProperty("category");
  });
});

describe("feedback: announce linkage (P3)", () => {
  let owner: string;
  let pleb: string;
  let fb1: string;
  let fb2: string;
  let fbClosed: string;

  const ANNOUNCEMENT = {
    titleZh: "已知问题：导出失败",
    titleEn: "Known issue: export failure",
    bodyZh: "共收到多条同类反馈，正在修复。",
    bodyEn: "Multiple reports received; a fix is in progress.",
    level: "warning",
  };

  function announce(token: string, feedbackIds: string[], announcement: unknown = ANNOUNCEMENT): Promise<Response> {
    return app.request("/api/feedback/announce", {
      method: "POST",
      headers: { ...auth(token), "content-type": "application/json" },
      body: JSON.stringify({ feedbackIds, announcement }),
    });
  }

  beforeAll(async () => {
    const stamp = Date.now();
    const ownerEmail = (
      db.prepare("SELECT email FROM users WHERE role = 'owner'").get() as { email: string }
    ).email;
    owner = await login(ownerEmail);
    pleb = await register(`announce-${stamp}@t.example`);
    const r1 = await post(pleb, { message: "video export stuck at 50%", category: "bug" });
    const r2 = await post(pleb, { message: "no output from video node", category: "bug" });
    const r3 = await post(pleb, { message: "already handled elsewhere", category: "bug" });
    fb1 = ((await r1.json()) as { id: string }).id;
    fb2 = ((await r2.json()) as { id: string }).id;
    fbClosed = ((await r3.json()) as { id: string }).id;
    const pre = await app.request(`/api/feedback/${fbClosed}`, {
      method: "PATCH",
      headers: { ...auth(owner), "content-type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    expect(pre.status).toBe(200);
  });

  it("forbids non-admin callers (403)", async () => {
    expect((await announce(pleb, [fb1])).status).toBe(403);
  });

  it("rejects empty feedbackIds and malformed announcements with 400", async () => {
    expect((await announce(owner, [])).status).toBe(400);
    expect((await announce(owner, [fb1], { titleZh: "", titleEn: "" })).status).toBe(400);
    expect((await announce(owner, [fb1], { ...ANNOUNCEMENT, level: "loud" })).status).toBe(400);
  });

  it("aborts the whole merge on unknown ids (no announcement side effect)", async () => {
    const before = (
      db.prepare("SELECT COUNT(*) AS n FROM announcements").get() as { n: number }
    ).n;
    const res = await announce(owner, [fb1, "00000000-0000-4000-8000-000000000000"]);
    expect(res.status).toBe(404);
    const after = (
      db.prepare("SELECT COUNT(*) AS n FROM announcements").get() as { n: number }
    ).n;
    expect(after).toBe(before);
    const row = db.prepare("SELECT status FROM feedback WHERE id = ?").get(fb1) as { status: string };
    expect(row.status).toBe("open");
  });

  it("merges a batch: creates the announcement, closes open items, skips already-closed", async () => {
    const res = await announce(owner, [fb1, fb2, fbClosed]);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; announcementId: string; closed: number };
    expect(body.ok).toBe(true);
    expect(body.closed).toBe(2); // fbClosed was already closed → skipped

    const ann = db
      .prepare("SELECT title_zh, level FROM announcements WHERE id = ?")
      .get(body.announcementId) as { title_zh: string; level: string };
    expect(ann.title_zh).toBe("已知问题：导出失败");
    expect(ann.level).toBe("warning");

    for (const id of [fb1, fb2, fbClosed]) {
      const row = db.prepare("SELECT status FROM feedback WHERE id = ?").get(id) as { status: string };
      expect(row.status).toBe("closed");
    }

    const audits = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'feedback.announce' AND object_id = ?")
      .all(body.announcementId) as Array<{ detail: string }>;
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0]!.detail)).toEqual({ count: 3, level: "warning" });
  });

  it("is idempotent for re-announced closed batches (closed counts stay honest)", async () => {
    const res = await announce(owner, [fb1, fb2]);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { closed: number };
    expect(body.closed).toBe(0);
  });
});
