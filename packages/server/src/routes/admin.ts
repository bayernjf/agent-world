/** Admin route domain (audit P2-2 split from index.ts). */
import { openDatabase } from "../db.js";
import { audit } from "../audit.js";
import { clientIp, EMAIL_RE } from "./shared.js";
import { hashPassword } from "../auth.js";
import { PlatformCatalogSchema, catalogPriceGaps, describeCatalogChange, mergeBuiltinCatalog, platformCatalog, writePlatformCatalog } from "../builtin-catalog.js";
import { builtinCodeDefaults } from "../config.js";
import { recentErrors } from "../errors.js";
import { log } from "../logger.js";
import { graphAccessRole } from "../rbac.js";
import { errMsg } from "../safe-utils.js";
import { listInvoices } from "../invoiceService.js";
import { nodeModelConfig } from "../model-slots.js";
import { isPlanId, normalizeTokens, PLANS } from "../plans.js";
import { getOrCreateSubscription, setPlan, currentPeriodEnd, currentUsage } from "../subscriptionService.js";
import { isSubscriptionStatus, SUBSCRIPTION_STATUSES } from "../subscription.js";
import { markInvoicePaid, voidInvoice } from "../invoiceService.js";
import type { Db } from "../db.js";
import type { PlatformCatalog } from "../builtin-catalog.js";
import { Hono } from "hono";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { RouteContext } from "./ctx.js";

export function registerAdminRoutes(
  app: Hono<{ Variables: { userId: string } }>,
  ctx: RouteContext,
): void {
  const { db, blockDemo } = ctx;

// owner/admin (design-rbac P3) see every user's rows, with an optional
// userId filter. Newest first, cursor-paginated.
app.get("/api/audit", async (c) => {
  const userId = c.get("userId");
  const limit = Number(c.req.query("limit") ?? 100);
  const before = Number(c.req.query("before") ?? 0);
  const opts = {
    limit: Number.isFinite(limit) ? limit : undefined,
    before: Number.isFinite(before) && before > 0 ? before : undefined,
  };
  const role = (await db.findUserById(userId))?.role;
  if (role === "owner" || role === "admin") {
    return c.json({ items: await db.listAuditAdmin({ ...opts, userId: c.req.query("userId") || undefined }) });
  }
  return c.json({ items: await db.listAudit(userId, opts) });
});

// Process-level captured errors (errors.ts). Mirrors /api/audit visibility:
// owner and admin inspect the instance-wide error feed; regular users have no

app.get("/api/admin/errors", async (c) => {
  const role = (await db.findUserById(c.get("userId")))?.role;
  if (role !== "owner" && role !== "admin") return c.json({ error: "forbidden" }, 403);
  const limit = Number(c.req.query("limit") ?? 100);
  return c.json({ items: recentErrors(Number.isFinite(limit) ? limit : 100) });
});

// G4 durable remote render jobs (remote_jobs). Mirrors /api/admin/errors
// visibility: owner and admin inspect in-flight jobs across users. Defaults to
// open (submitted/running) jobs oldest-first so stuck renders surface first;
// pass ?all=1 for the most recent jobs in any state. Read-only.
app.get("/api/admin/remote-jobs", async (c) => {
  const role = (await db.findUserById(c.get("userId")))?.role;
  if (role !== "owner" && role !== "admin") return c.json({ error: "forbidden" }, 403);
  const limitRaw = Number(c.req.query("limit") ?? 100);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
  const openOnly = c.req.query("all") !== "1";
  const items = await db.listRemoteJobs(limit, { openOnly });
  return c.json({ items });
});

// --- Admin operations (design-rbac P3) ------------------------------------
// Route naming note: design-rbac §9 sketched /api/admin/members/:id/role;
// shipped as /api/admin/users/:id/role to match the /api/admin/users
// resource. User management is the instance owner's exclusive power —
// admins (who only gain cross-user audit viewing) get 403 here.

/** RBAC P3: global role changes are the instance owner's exclusive power. */
async function isOwner(userId: string): Promise<boolean> {
  return (await db.findUserById(userId))?.role === "owner";
}

app.get("/api/admin/users", async (c) => {
  if (!(await isOwner(c.get("userId")))) return c.json({ error: "forbidden" }, 403);
  const users = (await db.listUsers()).map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    createdAt: u.created_at,
  }));
  return c.json({ users });
});

/**
 * Open an account for someone else (owner-only). Self-registration closes once
 * the first account exists (M3), so without this the only way to let a second
 * person in is ALLOW_REGISTRATION=1 — which opens signup to everyone who can
 * reach the port, not just the people this instance is for.
 *
 * The password is generated here, returned exactly once, and never written to
 * the audit row or the log; the account comes back flagged
 * must_change_password=1, which the auth middleware enforces on every non-auth
 * route, so a leaked one-time password stops working the moment the invitee
 * follows the prompt.
 */
app.post("/api/admin/users", async (c) => {
  const callerId = c.get("userId");
  if (!(await isOwner(callerId))) return c.json({ error: "forbidden" }, 403);
  const d = await blockDemo(c, "admin");
  if (d) return d;
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return c.json({ error: "请输入有效的邮箱地址" }, 400);
  }
  if (await db.findUserByEmail(email)) {
    return c.json({ error: "该邮箱已注册" }, 409);
  }
  const id = randomUUID();
  // 12 random bytes, base64url — 16 chars, comfortably over the 6-char floor and
  // not something anyone can type from memory, which is the point.
  const oneTimePassword = randomBytes(12).toString("base64url");
  await db.createProvisionedUser(id, email, await hashPassword(oneTimePassword));
  audit(db, callerId, "account.provision", {
    objectType: "user",
    objectId: id,
    detail: { email },
    ip: clientIp(c),
  });
  return c.json({ user: { id, email, role: "user" }, oneTimePassword }, 201);
});

app.post("/api/admin/users/:id/role", async (c) => {
  const callerId = c.get("userId");
  if (!(await isOwner(callerId))) return c.json({ error: "forbidden" }, 403);
  const d = await blockDemo(c, "admin"); if (d) return d;
  const body = (await c.req.json().catch(() => ({}))) as { role?: string };
  // Only "admin" | "user" are grantable — "owner" is bootstrapped, never
  // granted (idx_users_owner guards the single-owner invariant).
  if (body.role !== "admin" && body.role !== "user") {
    return c.json({ error: "role must be admin or user" }, 400);
  }
  const target = await db.findUserById(c.req.param("id"));
  if (!target) return c.json({ error: "user not found" }, 404);
  // §9: the owner cannot be demoted; self-target is always the owner here.
  if (target.id === callerId || target.role === "owner") {
    return c.json({ error: "cannot change the owner's role" }, 400);
  }
  // Idempotent no-op: success without an audit row (access.grant precedent).
  if (target.role === body.role) {
    return c.json({ ok: true, role: target.role, unchanged: true });
  }
  await db.updateUserRole(target.id, body.role);
  audit(db, callerId, "role.update", {
    objectType: "user",
    objectId: target.id,
    detail: { grantee: target.id, role: body.role },
    ip: clientIp(c),
  });
  return c.json({ ok: true, role: body.role });
});

/** Monetization M2: owner manually sets a user's subscription plan (MVP,
 *  bypassing a payment gateway until P2 Stripe). Instant, no proration;
 *  setPlan writes the billing.plan_changed audit entry (design-monetization §6.2). */
app.post("/api/admin/users/:id/plan", async (c) => {
  const callerId = c.get("userId");
  if (!(await isOwner(callerId))) return c.json({ error: "forbidden" }, 403);
  const d = await blockDemo(c, "admin"); if (d) return d;
  const body = (await c.req.json().catch(() => ({}))) as { plan?: string; status?: string };
  if (!isPlanId(body.plan)) {
    return c.json({ error: "plan must be free | starter | pro | team" }, 400);
  }
  // 原先 body.status 被解析出来却没人用——操作者传了它、拿到 200，就会以为状态已改。
  // 现在要么真的生效，要么明确拒掉；不传则**保留原状态**（欠费的清除只该由
  // invoice.paid 或这里的显式 status 触发，改套餐本身不该顺手抹掉）。
  if (body.status !== undefined && !isSubscriptionStatus(body.status)) {
    return c.json({ error: `status must be one of ${SUBSCRIPTION_STATUSES.join(" | ")}` }, 400);
  }
  const target = await db.findUserById(c.req.param("id"));
  if (!target) return c.json({ error: "user not found" }, 404);
  const record = await setPlan(db, target.id, body.plan, callerId, clientIp(c), body.status);
  return c.json({ ok: true, plan: record.plan, status: record.status });
});

/** M3 S4: owner manually marks an invoice as paid (manual payment path).
 *  Writes billing.invoice_paid audit entry via invoiceService. */
app.post("/api/admin/invoices/:id/mark-paid", async (c) => {
  const callerId = c.get("userId");
  if (!(await isOwner(callerId))) return c.json({ error: "forbidden" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { method?: string; notes?: string };
  const method = body.method ?? "manual";
  try {
    const invoice = await markInvoicePaid(db, c.req.param("id"), method, callerId, body.notes, clientIp(c));
    return c.json({ ok: true, invoice });
  } catch (err) {
    const msg = errMsg(err);
    if (msg.includes("not found")) return c.json({ error: "invoice not found" }, 404);
    if (msg.includes("already paid")) return c.json({ error: "invoice already paid" }, 409);
    if (msg.includes("void")) return c.json({ error: "cannot pay a void invoice" }, 409);
    return c.json({ error: msg }, 400);
  }
});

/** M3 S4: owner voids an invoice (cancel before payment).
 *  Writes billing.invoice_voided audit entry via invoiceService. */
app.post("/api/admin/invoices/:id/void", async (c) => {
  const callerId = c.get("userId");
  if (!(await isOwner(callerId))) return c.json({ error: "forbidden" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  try {
    const invoice = await voidInvoice(db, c.req.param("id"), callerId, body.reason, clientIp(c));
    return c.json({ ok: true, invoice });
  } catch (err) {
    const msg = errMsg(err);
    if (msg.includes("not found")) return c.json({ error: "invoice not found" }, 404);
    if (msg.includes("paid invoice")) return c.json({ error: "cannot void a paid invoice" }, 409);
    return c.json({ error: msg }, 400);
  }
});

/** M3 S4: admin lists all invoices across all users (for payment management). */
app.get("/api/admin/invoices", async (c) => {
  const callerId = c.get("userId");
  if (!(await isOwner(callerId))) return c.json({ error: "forbidden" }, 403);
  // Reuse listInvoices but for all users — need a driver method. For now,
  // iterate all users and collect. (TODO: add listAllInvoices driver method if perf matters.)
  const allUsers = await db.listUsers();
  const allInvoices: Awaited<ReturnType<typeof listInvoices>> = [];
  for (const user of allUsers) {
    const userInvoices = await listInvoices(db, user.id);
    allInvoices.push(...userInvoices);
  }
  // Sort by createdAt descending
  allInvoices.sort((a, b) => b.createdAt - a.createdAt);
  return c.json({ invoices: allInvoices });
});

app.get("/api/admin/model-catalog", async (c) => {
  if (!(await isModelCatalogAdmin(c.get("userId")))) return c.json({ error: "forbidden" }, 403);
  return c.json(modelCatalogView());
});

// Whole-catalog write, not per-field PATCH: the overlay's semantics are
// "replace the maps", so a partial body would mean different things for
// different fields and an accidental omission could retire a model. `null` for
// a provider reverts that tier to the shipped code default.
app.put("/api/admin/model-catalog", async (c) => {
  const userId = c.get("userId");
  if (!(await isModelCatalogAdmin(userId))) return c.json({ error: "forbidden" }, 403);
  const d = await blockDemo(c, "admin");
  if (d) return d;
  const body = (await c.req.json().catch(() => null)) as unknown;
  const parsed = PlatformCatalogSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: `目录载荷不合法：${parsed.error.issues[0]?.message ?? "无法解析"}` },
      400,
    );
  }
  const before = platformCatalog();
  const changes = describeCatalogChange(before, parsed.data, builtinCodeDefaults());
  await writePlatformCatalog(parsed.data);
  audit(db, userId, "model.catalog_update", {
    objectType: "model_catalog",
    // Names only: prices are readable back from the catalog row, so copying
    // the numbers into audit_log would widen the exposure of a billing field
    // without making any question answerable.
    detail: { changes },
    ip: clientIp(c),
  });
  // Catalog edits change what validateModels accepts, so an operator deciding
  // "who breaks if I retire X" needs this answer from the same request.
  const affected = await modelsInUse(parsed.data, before);
  return c.json({
    ...modelCatalogView(),
    changes,
    affected: affected.list,
    affectedTruncated: affected.truncated,
  });
});

}

const db = await openDatabase();

export async function isAnnouncementAdmin(userId: string): Promise<boolean> {
  const user = await db.findUserById(userId);
  return user?.role === "owner" || user?.role === "admin";
}

export async function isModelCatalogAdmin(userId: string): Promise<boolean> {
  return isAnnouncementAdmin(userId);
}

export function modelCatalogView() {
  const code = builtinCodeDefaults();
  const overlay = platformCatalog();
  const shape = (p: (typeof code)[string]) => ({
    type: p.type,
    models: p.models,
    modalities: p.modalities ?? {},
    pricing: p.pricing ?? {},
    enabled: p.enabled !== false,
    // The credential and endpoint plane is deliberately absent: this response is
    // what an admin screen renders, and echoing `apiKey` would ship the hosted
    // tier's gateway key to the browser. `hasKey` is enough to explain why a
    // tier is unusable, and a write can never change either field anyway.
    hasKey: Boolean(p.apiKey),
  });
  const providers: Record<string, unknown> = {};
  const codeView: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(code)) {
    providers[name] = shape(mergeBuiltinCatalog(def, overlay[name]));
    codeView[name] = shape(def);
  }
  return { providers, overlay, code: codeView, gaps: catalogPriceGaps(overlay, code) };
}

/** Cap for the retirement impact scan; past it the answer is partial and the
 *  caller is told so via `affectedTruncated`. */
const GRAPH_SCAN_CAP = 2000;

export async function modelsInUse(
  next: PlatformCatalog,
  before: PlatformCatalog,
): Promise<{ list: unknown[]; truncated: boolean }> {
  const code = builtinCodeDefaults();
  const dropped: string[] = [];
  for (const name of new Set([...Object.keys(code), ...Object.keys(next)])) {
    const had = new Set(mergeBuiltinCatalog(code[name]!, before[name]).models);
    const has = new Set(mergeBuiltinCatalog(code[name]!, next[name]).models);
    for (const m of had) if (!has.has(m)) dropped.push(m);
  }
  if (dropped.length === 0) return { list: [], truncated: false };
  const out: Array<{ graphId: string; graphName: string; models: string[]; nodes: string[] }> = [];
  // Admin-only, runs on a catalog write. One query per pipeline (listAllGraphs
  // carries no owner, so the owner comes from getGraphOwnerId) — bounded by
  // GRAPH_SCAN_CAP so a large instance cannot be pinned by one click.
  const graphs = (await db.listAllGraphs()).slice(0, GRAPH_SCAN_CAP);
  for (const g of graphs) {
    const ownerId = await db.getGraphOwnerId(g.id);
    if (!ownerId) continue;
    const doc = await db.getGraph(g.id, ownerId);
    if (!doc) continue;
    const hits = new Map<string, string[]>();
    for (const n of doc.nodes) {
      const conf = nodeModelConfig(n);
      const m = conf?.model?.trim();
      if (m && dropped.includes(m)) hits.set(n.name, [...(hits.get(n.name) ?? []), m]);
    }
    if (hits.size > 0) {
      out.push({
        graphId: g.id,
        graphName: g.name,
        models: [...new Set([...hits.values()].flat())],
        nodes: [...hits.keys()],
      });
    }
  }
  return { list: out.slice(0, 50), truncated: graphs.length >= GRAPH_SCAN_CAP };
}

export async function announcementTargetsUser(
  db: Db,
  userId: string,
  target: string | null | undefined,
): Promise<boolean> {
  if (target == null) return true;
  if (target.startsWith("user:")) {
    // Per-user notice (M2 usage alerts); visible only to that user.
    return userId === target.slice("user:".length);
  }
  if (target.startsWith("graph:")) {
    return await graphAccessRole(db, userId, target.slice("graph:".length)) != null;
  }
  if (target.startsWith("template:")) {
    return await db.userUsesTemplate(userId, target.slice("template:".length));
  }
  return false;
}
