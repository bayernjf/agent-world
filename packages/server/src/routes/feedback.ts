/** Feedback route domain (audit P2-2 split from index.ts). */
import { audit } from "../audit.js";
import { asRecord } from "../safe-utils.js";
import { clientIp } from "./shared.js";
import { isAnnouncementAdmin } from "./admin.js";
import { parseAnnouncementBody } from "./announcements.js";

const FEEDBACK_CATEGORIES = new Set(["bug", "feature", "ux", "other"]);
const FEEDBACK_MESSAGE_MAX = 2_000;
const FEEDBACK_ATTACHMENT_MAX = 1_000_000; // 1MB decoded bytes
const FEEDBACK_RATE_LIMIT = 10; // per user per rolling hour
const FEEDBACK_ATTACHMENT_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
// Context whitelist (design-feedback §3.2): only these keys are persisted —
// anything else a client sends (e.g. settings-shaped payloads) is dropped
// server-side, so the red line "never auto-upload secrets" holds even when
// the client is tampered with.
const FEEDBACK_CONTEXT_KEYS = [
  "route",
  "userAgent",
  "locale",
  "lastRunId",
  "lastError",
] as const;


import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { RouteContext } from "./ctx.js";

export function registerFeedbackRoutes(
  app: Hono<{ Variables: { userId: string } }>,
  ctx: RouteContext,
): void {
  const { db } = ctx;

function sanitizeFeedbackContext(raw: unknown): string {
  const src = asRecord(raw);
  const out: Record<string, unknown> = {};
  for (const key of FEEDBACK_CONTEXT_KEYS) {
    if (src[key] === undefined) continue;
    const v = src[key];
    // Scalars only; lastError is the sole object (message/lineno picked apart).
    if (key === "lastError" && v && typeof v === "object") {
      const e = asRecord(v);
      out.lastError = {
        message: typeof e.message === "string" ? e.message.slice(0, 500) : undefined,
        lineno: typeof e.lineno === "number" ? e.lineno : undefined,
      };
      continue;
    }
    if (typeof v === "string") out[key] = v.slice(0, 500);
    else if (typeof v === "number") out[key] = v;
  }
  return JSON.stringify(out);
}

app.post("/api/feedback", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    message?: unknown;
    category?: unknown;
    context?: unknown;
    attachment?: { data?: unknown; mimeType?: unknown } | null;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return c.json({ error: "message is required" }, 400);
  if (message.length > FEEDBACK_MESSAGE_MAX) {
    return c.json({ error: `message must be at most ${FEEDBACK_MESSAGE_MAX} characters` }, 400);
  }
  const category = typeof body.category === "string" && FEEDBACK_CATEGORIES.has(body.category)
    ? body.category
    : "other";
  // Rate limit: submissions in the last rolling hour (DB-backed so a server
  // restart does not reset the quota).
  if (await db.countFeedbackSince(userId, Date.now() - 3_600_000) >= FEEDBACK_RATE_LIMIT) {
    return c.json({ error: "too many submissions, try again later" }, 429);
  }
  let attachment: Uint8Array | null = null;
  let attachmentMime: string | null = null;
  if (body.attachment && typeof body.attachment === "object") {
    const data = body.attachment.data;
    const mimeType = typeof body.attachment.mimeType === "string" ? body.attachment.mimeType : "";
    if (typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      return c.json({ error: "attachment.data must be base64" }, 400);
    }
    if (!FEEDBACK_ATTACHMENT_MIMES.has(mimeType)) {
      return c.json({ error: "attachment must be an image (png/jpeg/webp/gif)" }, 400);
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.byteLength > FEEDBACK_ATTACHMENT_MAX) {
      return c.json({ error: "attachment must be at most 1MB" }, 413);
    }
    attachment = bytes;
    attachmentMime = mimeType;
  }
  const id = randomUUID();
  await db.insertFeedback({
    id,
    userId,
    message,
    category,
    context: sanitizeFeedbackContext(body.context),
    attachment,
    attachmentMime,
  });
  audit(db, userId, "feedback.submit", {
    objectType: "feedback",
    objectId: id,
    detail: { category },
    ip: clientIp(c),
  });
  return c.json({ ok: true, id }, 201);
});

app.get("/api/feedback", async (c) => {
  if (!(await isAnnouncementAdmin(c.get("userId")))) return c.json({ error: "forbidden" }, 403);
  const status = c.req.query("status");
  const limit = Number(c.req.query("limit") ?? 200);
  const items = await db.listFeedback({
    status: status || undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  return c.json({ items });
});

const FEEDBACK_STATUSES = new Set(["open", "acknowledged", "closed"]);

app.patch("/api/feedback/:id", async (c) => {
  if (!(await isAnnouncementAdmin(c.get("userId")))) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const item = await db.getFeedback(id);
  if (!item) return c.json({ error: "feedback not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown };
  if (typeof body.status !== "string" || !FEEDBACK_STATUSES.has(body.status)) {
    return c.json({ error: "status must be open, acknowledged or closed" }, 400);
  }
  // Idempotent no-op (role.update precedent): skip the UPDATE and the audit row.
  if (item.status === body.status) return c.json({ ok: true, unchanged: true });
  await db.updateFeedbackStatus(id, body.status);
  audit(db, c.get("userId"), "feedback.status_change", {
    objectType: "feedback",
    objectId: id,
    detail: { to: body.status },
    ip: clientIp(c),
  });
  return c.json({ ok: true, status: body.status });
});

/** Raw attachment bytes for the admin UI (cookie auth flows with <img src>). */
app.get("/api/feedback/:id/attachment", async (c) => {
  if (!(await isAnnouncementAdmin(c.get("userId")))) return c.json({ error: "forbidden" }, 403);
  const item = await db.getFeedback(c.req.param("id"));
  if (!item) return c.json({ error: "feedback not found" }, 404);
  const bytes = item.attachment instanceof Uint8Array ? item.attachment : null;
  if (!bytes || !bytes.byteLength) return c.json({ error: "no attachment" }, 404);
  const mime =
    typeof item.attachment_mime === "string" && FEEDBACK_ATTACHMENT_MIMES.has(item.attachment_mime)
      ? item.attachment_mime
      : "application/octet-stream";
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": mime, "cache-control": "private, max-age=3600" },
  });
});

// Feedback → announcement linkage (design-feedback P3): merge a batch of
// similar reports into one product-wide announcement, then close the batch.
// Single round trip so the UI never lands in the half state "announcement
// created but feedback still open".
const FEEDBACK_ANNOUNCE_MAX = 50;

app.post("/api/feedback/announce", async (c) => {
  if (!(await isAnnouncementAdmin(c.get("userId")))) return c.json({ error: "forbidden" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as {
    feedbackIds?: unknown;
    announcement?: unknown;
  };
  const rawIds = Array.isArray(body.feedbackIds) ? body.feedbackIds : [];
  const ids = [
    ...new Set(rawIds.filter((v): v is string => typeof v === "string" && v.length > 0)),
  ];
  if (ids.length === 0) return c.json({ error: "feedbackIds is required" }, 400);
  if (ids.length > FEEDBACK_ANNOUNCE_MAX) {
    return c.json({ error: `feedbackIds must be at most ${FEEDBACK_ANNOUNCE_MAX} items` }, 400);
  }
  // Fail closed: unknown ids abort the whole merge (no partial apply).
  const missing: string[] = [];
  for (const id of ids) {
    if (!(await db.getFeedback(id))) missing.push(id);
  }
  if (missing.length) return c.json({ error: "feedback not found" }, 404);
  const parsed = parseAnnouncementBody(body.announcement);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const announcementId = randomUUID();
  await db.createAnnouncement({ id: announcementId, ...parsed.value });
  let closed = 0;
  for (const id of ids) {
    const item = await db.getFeedback(id);
    if (item?.status === "closed") continue; // idempotent, not re-counted
    await db.updateFeedbackStatus(id, "closed");
    closed++;
  }
  audit(db, c.get("userId"), "feedback.announce", {
    objectType: "announcement",
    objectId: announcementId,
    detail: { count: ids.length, level: parsed.value.level },
    ip: clientIp(c),
  });
  return c.json({ ok: true, announcementId, closed }, 201);
});


// --- Announcements (design-announcement) ---
// Admin gate (RBAC P0, design-rbac.md): global owner/admin roles decide who
// manages announcements. The ANNOUNCEMENT_ADMIN_EMAILS env allowlist is
// retired — owner is assigned at bootstrap, admins by owner via role grant.
}