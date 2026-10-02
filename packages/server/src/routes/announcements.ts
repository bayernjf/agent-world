/** Announcements route domain (audit P2-2 split from index.ts). */
import { audit } from "../audit.js";
import { asRecord } from "../safe-utils.js";
import { clientIp } from "./shared.js";
import { isAnnouncementAdmin, announcementTargetsUser } from "./admin.js";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { RouteContext } from "./ctx.js";

const ANNOUNCEMENT_LEVELS = new Set(["info", "warning", "critical"]);
const ANNOUNCEMENT_BODY_MAX = 20_000;
/** P3 targeting: `graph:<id>` / `template:<id>` with a conservative id charset. */
const ANNOUNCEMENT_TARGET_RE = /^(graph|template):[A-Za-z0-9_-]+$/;

export function parseAnnouncementBody(raw: unknown):
  | { ok: true; value: { titleZh: string; titleEn: string; bodyZh?: string | null; bodyEn?: string | null; level: string; startsAt: number; endsAt?: number | null; target?: string | null } }
  | { ok: false; error: string } {
  const b = asRecord(raw);
  const titleZh = typeof b.titleZh === "string" ? b.titleZh.trim() : "";
  const titleEn = typeof b.titleEn === "string" ? b.titleEn.trim() : "";
  if (!titleZh || !titleEn) return { ok: false, error: "titleZh and titleEn are required" };
  if (titleZh.length > 200 || titleEn.length > 200) {
    return { ok: false, error: "titles must be at most 200 characters" };
  }
  const level = typeof b.level === "string" ? b.level : "info";
  if (!ANNOUNCEMENT_LEVELS.has(level)) return { ok: false, error: `invalid level "${level}"` };
  const startsAt = b.startsAt === undefined ? Date.now() : Number(b.startsAt);
  if (!Number.isFinite(startsAt)) return { ok: false, error: "startsAt must be a number" };
  let endsAt: number | null = null;
  if (b.endsAt !== undefined && b.endsAt !== null) {
    endsAt = Number(b.endsAt);
    if (!Number.isFinite(endsAt)) return { ok: false, error: "endsAt must be a number" };
    if (endsAt <= startsAt) return { ok: false, error: "endsAt must be after startsAt" };
  }
  // Targeting: null/undefined → everyone; otherwise one of the two known forms.
  // Fail closed so malformed values can never be persisted and later silently
  // match nobody/everybody.
  let target: string | null = null;
  if (typeof b.target === "string" && b.target.trim()) {
    target = b.target.trim();
    if (!ANNOUNCEMENT_TARGET_RE.test(target)) {
      return { ok: false, error: 'target must be "graph:<id>" or "template:<id>"' };
    }
  } else if (b.target != null) {
    return { ok: false, error: 'target must be "graph:<id>" or "template:<id>"' };
  }
  const read = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? (v.length > ANNOUNCEMENT_BODY_MAX ? "" : v) : null;
  const bodyZh = read(b.bodyZh);
  const bodyEn = read(b.bodyEn);
  if (bodyZh === "" || bodyEn === "") return { ok: false, error: `body must be at most ${ANNOUNCEMENT_BODY_MAX} characters` };
  return { ok: true, value: { titleZh, titleEn, bodyZh, bodyEn, level, startsAt, endsAt, target } };
}

export function registerAnnouncementsRoutes(
  app: Hono<{ Variables: { userId: string } }>,
  ctx: RouteContext,
): void {
  const { db, blockDemo } = ctx;

app.get("/api/announcements", async (c) => {
  const userId = c.get("userId");
  const now = Date.now();
  const reads = await db.announcementReads(userId);
  const active = await db.listActiveAnnouncements(now);
  const items = (
    await Promise.all(
      active.map(async (a) => ({
        a,
        include: await announcementTargetsUser(db, userId, a.target as string | null),
      })),
    )
  )
    .filter((r) => r.include)
    .map((r) => r.a)
    .map((a) => ({
      id: a.id,
      level: a.level,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      createdAt: a.created_at,
      target: (a.target as string | null) ?? null,
      titleZh: a.title_zh,
      titleEn: a.title_en,
      bodyZh: a.body_zh,
      bodyEn: a.body_en,
      read: reads.has(a.id as string),
    }));
  return c.json({ items });
});

/** Full list (including not-yet-started / expired) for the admin manager UI. */
app.get("/api/announcements/manage", async (c) => {
  if (!(await isAnnouncementAdmin(c.get("userId")))) return c.json({ error: "forbidden" }, 403);
  const items = (await db.listAnnouncements()).map((a) => ({
    id: a.id,
    level: a.level,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    createdAt: a.created_at,
    target: (a.target as string | null) ?? null,
    titleZh: a.title_zh,
    titleEn: a.title_en,
    bodyZh: a.body_zh,
    bodyEn: a.body_en,
  }));
  return c.json({ items });
});

app.post("/api/announcements/:id/read", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!await db.getAnnouncement(id)) return c.json({ error: "announcement not found" }, 404);
  await db.markAnnouncementRead(userId, id); // upsert → idempotent
  return c.json({ ok: true });
});

const ANNOUNCEMENT_LEVELS = new Set(["info", "warning", "critical"]);
const ANNOUNCEMENT_BODY_MAX = 20_000;
/** P3 targeting: `graph:<id>` / `template:<id>` with a conservative id charset. */
const ANNOUNCEMENT_TARGET_RE = /^(graph|template):[A-Za-z0-9_-]+$/;

/** Shared shape validation for create/update bodies. */

app.post("/api/announcements", async (c) => {
  if (!(await isAnnouncementAdmin(c.get("userId")))) return c.json({ error: "forbidden" }, 403);
  const d = await blockDemo(c, "admin"); if (d) return d;
  const parsed = parseAnnouncementBody(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const id = randomUUID();
  await db.createAnnouncement({ id, ...parsed.value });
  audit(db, c.get("userId"), "announcement.create", {
    objectType: "announcement",
    objectId: id,
    detail: { level: parsed.value.level },
    ip: clientIp(c),
  });
  return c.json(await db.getAnnouncement(id), 201);
});

app.patch("/api/announcements/:id", async (c) => {
  if (!(await isAnnouncementAdmin(c.get("userId")))) return c.json({ error: "forbidden" }, 403);
  const d = await blockDemo(c, "admin"); if (d) return d;
  const id = c.req.param("id");
  if (!await db.getAnnouncement(id)) return c.json({ error: "announcement not found" }, 404);
  const parsed = parseAnnouncementBody(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const ok = await db.updateAnnouncement(id, parsed.value);
  audit(db, c.get("userId"), "announcement.update", {
    objectType: "announcement",
    objectId: id,
    detail: { level: parsed.value.level },
    ip: clientIp(c),
  });
  return c.json({ ok });
});

app.delete("/api/announcements/:id", async (c) => {
  if (!(await isAnnouncementAdmin(c.get("userId")))) return c.json({ error: "forbidden" }, 403);
  const d = await blockDemo(c, "admin"); if (d) return d;
  const id = c.req.param("id");
  const ok = await db.deleteAnnouncement(id);
  if (!ok) return c.json({ error: "announcement not found" }, 404);
  audit(db, c.get("userId"), "announcement.delete", {
    objectType: "announcement",
    objectId: id,
    ip: clientIp(c),
  });
  return c.json({ ok: true });
});
}