/** Auth route domain (audit P2-2 split from index.ts). */
import { audit } from "../audit.js";
import { hashPassword, signToken, verifyPassword, verifyToken } from "../auth.js";
import { DEMO_TTL_MS } from "../demo.js";
import { AUTH_COOKIE, clientIp, clearAuthCookie, DEMO_SEED_TEMPLATE_IDS, demoEnabled, demoLimiter, demoLocked, demoPublicQuota, EMAIL_RE, loginLimiter, rateLimitIp, registerLimiter, setAuthCookie } from "./shared.js";
import { getTemplate, instantiateTemplate } from "@agent-world/core";
import { Hono } from "hono";
import { randomBytes, randomUUID } from "node:crypto";
import { isAnnouncementAdmin, isModelCatalogAdmin } from "./admin.js";
import type { RouteContext } from "./ctx.js";


export function registerAuthRoutes(
  app: Hono<{ Variables: { userId: string } }>,
  ctx: RouteContext,
): void {
  const { db } = ctx;

app.post("/api/auth/register", async (c) => {
  if (!registerLimiter.allow(`register:${rateLimitIp(c)}`)) {
    return c.json({ error: "注册过于频繁，请稍后再试" }, 429);
  }
  // M3: the very first account bootstraps the instance. Once a user exists,
  // self-registration is closed unless the operator opts in via
  // ALLOW_REGISTRATION=1 — otherwise anyone who reaches the port can create
  // an account and start running paid models.
  if (await db.countUsers() > 0) {
    const flag = (process.env.ALLOW_REGISTRATION ?? "").trim().toLowerCase();
    if (flag !== "1" && flag !== "true") {
      return c.json({ error: "注册已关闭，请联系管理员开通账号" }, 403);
    }
  }
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !EMAIL_RE.test(email)) {
    return c.json({ error: "请输入有效的邮箱地址" }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: "密码至少需要6个字符" }, 400);
  }
  if (await db.findUserByEmail(email)) {
    return c.json({ error: "该邮箱已注册" }, 409);
  }
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  await db.createUser(id, email, passwordHash);
  audit(db, id, "account.register", { ip: clientIp(c) });
  const token = await signToken(id, email, true);
  setAuthCookie(c, token, true);
  return c.json({ user: { id, email } }, 201);
});

app.post("/api/auth/login", async (c) => {
  if (!loginLimiter.allow(`login:${rateLimitIp(c)}`)) {
    return c.json({ error: "尝试过于频繁，请稍后再试" }, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    remember?: boolean;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const remember = body.remember === true;
  const user = await db.findUserByEmail(email);
  if (!user) {
    audit(db, "unknown", "account.login_failed", { ip: clientIp(c) });
    return c.json({ error: "邮箱或密码错误" }, 401);
  }
  // A demo account has an unknowable random password and must convert via
  // /api/auth/claim (or start a fresh demo) rather than logging in by password.
  if (user.is_demo === 1) {
    audit(db, user.id, "account.login_blocked_demo", { ip: clientIp(c) });
    return c.json(
      { error: "演示账号请通过注册转正后登录，或重新开启演示", code: "DEMO_CLAIM_REQUIRED" },
      401,
    );
  }
  const hash = await db.findUserPasswordHash(user.id);
  if (!hash || !(await verifyPassword(password, hash))) {
    audit(db, user.id, "account.login_failed", { ip: clientIp(c) });
    return c.json({ error: "邮箱或密码错误" }, 401);
  }
  audit(db, user.id, "account.login", { ip: clientIp(c) });
  const token = await signToken(user.id, user.email, remember);
  setAuthCookie(c, token, remember);
  return c.json({
    user: { id: user.id, email: user.email, mustChangePassword: user.must_change_password === 1 },
  });
});

app.post("/api/auth/logout", async (c) => {
  // /api/auth/* bypasses the auth middleware, so resolve the caller from the
  // cookie manually — best effort, an anonymous logout isn't worth a row.
  const cookie = c.req.header("cookie") ?? "";
  const token = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))?.[1];
  const payload = token ? await verifyToken(token) : null;
  if (payload?.userId) audit(db, payload.userId, "auth.logout", { ip: clientIp(c) });
  clearAuthCookie(c);
  return c.body(null, 204);
});

app.get("/api/auth/me", async (c) => {
  const cookie = c.req.header("cookie") ?? "";
  const tokenMatch = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`));
  const token = tokenMatch?.[1];
  if (!token) return c.json({ error: "not authenticated" }, 401);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "not authenticated" }, 401);
  const user = await db.findUserById(payload.userId);
  if (!user) return c.json({ error: "not authenticated" }, 401);
  const isDemo = user.is_demo === 1;
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
      role: user.role,
      isDemo,
      mustChangePassword: user.must_change_password === 1,
      ...(isDemo
        ? { demo: { expiresAt: user.demo_expires_at, quota: demoPublicQuota() } }
        : {}),
      canManageAnnouncements: await isAnnouncementAdmin(user.id),
      canManageModelCatalog: await isModelCatalogAdmin(user.id),
    },
  });
});

app.post("/api/auth/password", async (c) => {
  const cookie = c.req.header("cookie") ?? "";
  const token = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))?.[1];
  const payload = token ? await verifyToken(token) : null;
  const user = payload ? await db.findUserById(payload.userId) : undefined;
  if (!user) return c.json({ error: "not authenticated" }, 401);
  // Demo accounts have an unknowable random password and no password to change;
  // they convert into a real account via /api/auth/claim instead.
  if (user.is_demo === 1) return demoLocked(c, "password");
  const body = (await c.req.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };
  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";
  if (newPassword.length < 6) {
    return c.json({ error: "新密码至少需要6个字符" }, 400);
  }
  const hash = await db.findUserPasswordHash(user.id);
  if (!hash || !(await verifyPassword(currentPassword, hash))) {
    return c.json({ error: "当前密码不正确" }, 401);
  }
  await db.updateUserPasswordHash(user.id, await hashPassword(newPassword));
  audit(db, user.id, "account.password_change", { objectType: "account", ip: clientIp(c) });
  return c.json({ ok: true });
});

// --- Demo (try-before-signup) accounts: design-demo-user.md ---
// Provision a real, flagged account with a short TTL and a seeded text pipeline,
// no signup form. Public (sits under /api/auth/* whitelist) but gated by
// ALLOW_DEMO and a tight per-IP limiter. Reuses an unexpired demo cookie rather
// than minting a fresh account on every click.
app.post("/api/auth/demo", async (c) => {
  if (!demoEnabled()) {
    return c.json({ error: "demo_disabled", code: "DEMO_DISABLED" }, 403);
  }
  if (!demoLimiter.allow(`demo:${rateLimitIp(c)}`)) {
    return c.json({ error: "演示创建过于频繁，请稍后再试" }, 429);
  }

  // Reuse an existing, still-valid demo session from the caller's cookie.
  const cookie = c.req.header("cookie") ?? "";
  const existingToken = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))?.[1];
  const existingPayload = existingToken ? await verifyToken(existingToken) : null;
  if (existingPayload) {
    const existing = await db.findUserById(existingPayload.userId);
    if (
      existing?.is_demo === 1 &&
      existing.demo_expires_at &&
      new Date(existing.demo_expires_at).getTime() > Date.now()
    ) {
      return c.json({
        user: { id: existing.id, email: existing.email, isDemo: true },
        demo: { expiresAt: existing.demo_expires_at, quota: demoPublicQuota() },
        reused: true,
      });
    }
  }

  const id = randomUUID();
  const email = `demo+${id.replace(/-/g, "").slice(0, 8)}@demo.local`;
  // Nobody knows this password — the only way out of a demo is claim (or prune).
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const expiresAt = new Date(Date.now() + DEMO_TTL_MS).toISOString();
  await db.createDemoUser(id, email, passwordHash, expiresAt);

  // Seed simple text-only pipelines so the first screen isn't an empty canvas.
  const seeded: string[] = [];
  for (const tplId of DEMO_SEED_TEMPLATE_IDS) {
    const tpl = getTemplate(tplId);
    if (!tpl) continue;
    const seededGraph = instantiateTemplate(tpl, { id: randomUUID(), name: tpl.name });
    await db.saveGraph(seededGraph, Date.now(), id, undefined, tplId);
    seeded.push(tplId);
  }

  audit(db, id, "account.demo_start", { objectType: "account", detail: { seeded }, ip: clientIp(c) });
  // Short session (remember=false → 24h, aligned with the account TTL).
  const token = await signToken(id, email, false);
  setAuthCookie(c, token, false);
  return c.json(
    {
      user: { id, email, isDemo: true },
      demo: { expiresAt, quota: demoPublicQuota(), seededTemplates: seeded },
    },
    201,
  );
});

// Convert the caller's demo account into a real one IN PLACE (same userId, so
// every graph/run/artifact is retained). Requires an authenticated demo.
app.post("/api/auth/claim", async (c) => {
  const cookie = c.req.header("cookie") ?? "";
  const token = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))?.[1];
  const payload = token ? await verifyToken(token) : null;
  const user = payload ? await db.findUserById(payload.userId) : undefined;
  if (!user) return c.json({ error: "not authenticated" }, 401);
  if (user.is_demo !== 1) {
    return c.json({ error: "not_a_demo", code: "NOT_A_DEMO" }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !EMAIL_RE.test(email)) {
    return c.json({ error: "请输入有效的邮箱地址" }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: "密码至少需要6个字符" }, 400);
  }
  // Target email already taken by a DIFFERENT account → can't merge, refuse.
  const occupied = await db.findUserByEmail(email);
  if (occupied && occupied.id !== user.id) {
    return c.json({ error: "该邮箱已被其他账号占用" }, 409);
  }
  const changed = await db.claimDemoUser(user.id, email, await hashPassword(password));
  if (changed !== 1) {
    // Race: row was no longer is_demo=1 by the time we wrote.
    return c.json({ error: "演示账号已失效或已转正，请刷新后重试" }, 409);
  }
  audit(db, user.id, "account.claim", { objectType: "account", ip: clientIp(c) });
  const newToken = await signToken(user.id, email, true);
  setAuthCookie(c, newToken, true);
  return c.json({ user: { id: user.id, email, isDemo: false } });
});
}