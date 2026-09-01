// Load `.env` first so every later module sees env vars (e.g. AGNES_API_KEY).
import "./load-env.js";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { applyCors, applySecurityHeaders } from "./security.js";
import {
  compile,
  ConnectorConfig,
  envelope,
  getTemplate,
  Graph,
  instantiateTemplate,
  replay,
  TEMPLATES,
  TriggerConfig,
  type RunEvent,
  type SkillPermissions,
} from "@agent-world/core";
import { openDb, backfillExistingData, contentHash } from "./db.js";
import { findGraphIdByName as findGraphIdByNameCore } from "./graphs-name.js";
import { ArtifactStore } from "./artifact-store.js";
import { log } from "./logger.js";
import { execute, resume } from "./engine.js";
import { startRun, RunStartError } from "./run.js";
import { TriggerService, TriggerError } from "./triggers.js";
import { TriggerScheduler } from "./scheduler.js";
import { resolveConnector } from "./connectors.js";
import { startABExperiment } from "./ab.js";
import {
  loadConfig,
  saveConfig,
  bindSettingsStore,
  normalizeBaseUrl,
  modalityOf,
  endpointFor,
  MODALITY_ENDPOINT,
  DEFAULT_MODALITY,
  type AppConfig,
  type Modality,
} from "./config.js";
import { GuardedFetchError, guardedFetch, hostIsInternal } from "./ssrf.js";
import { runAsUser } from "./user-context.js";
import { routingWorker } from "./providers/index.js";
import { WorkerRegistry } from "./worker-plugins.js";
import { connectMcpServer, registerMcpTools, type McpClient, type McpServerSpec } from "./mcp.js";
import { disposeIsolatedWorkers } from "./isolation.js";
import { registerSkill, setMemoryBackend, listBuiltinSkills } from "./skills/registry.js";
import { SQLiteMemoryBackend, extractKnowledgeFromRun } from "./memory.js";
import { fileURLToPath } from "node:url";
import { sanitizeError } from "./sanitize.js";
import { createReadArtifact } from "./artifact-reader.js";
import { decryptString, encryptString } from "./at-rest.js";
import { hashPassword, verifyPassword, signToken, verifyToken, REMEMBER_MAX_AGE_SEC } from "./auth.js";

const PORT = Number(process.env.PORT ?? 8791);
/** Cap for /api/proxy responses (audit L7): 25 MiB of fetched body. */
const MAX_PROXY_RESPONSE_BYTES = 25 * 1024 * 1024;
/** Absolute origin advertised to models so artifact links are fully qualified. */
const PUBLIC_URL = (process.env.AGENT_WORLD_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(
  /\/+$/,
  "");
const db = openDb(process.env.DB_FILE ?? "agent-world.sqlite");
backfillExistingData(db as any);
// Settings are per-user rows in the DB; config.ts reads/writes through this
// store while the legacy file config remains the shared baseline for users
// who have never saved settings.
bindSettingsStore({
  // Settings rows store the whole AppConfig JSON, including provider API keys.
  // Encrypt at rest (audit L3); legacy plaintext rows decrypt as-is and are
  // re-encrypted on the next save.
  get: (userId: string) => {
    const raw = db.getSettings(userId);
    return raw ? decryptString(raw) : null;
  },
  set: (userId: string, data: string) => db.saveSettings(userId, encryptString(data)),
});
const artifacts = ArtifactStore.fromEnv();
const readArtifact = createReadArtifact(db, artifacts);

// First-run onboarding is handled by the web UI (shows a template picker when
// no graphs exist). We no longer seed a default graph on startup — existing
// databases keep their graphs, fresh installs start empty.

// A server restart cannot resume in-memory generators; mark orphaned runs so the
// UI doesn't show them as forever-running.
db.markZombiesInterrupted(Date.now());

// Knowledge base / archive (5.2). FTS5-backed full-text search over
// extracted run outputs; powers the `archive_search` skill card.
const memory = new SQLiteMemoryBackend(db as any);
setMemoryBackend(memory);

const worker = routingWorker();
const workerRegistry = new WorkerRegistry(worker);
const workersDir = process.env.WORKERS_DIR ?? fileURLToPath(new URL("workers", import.meta.url));

/** Live runs, so a reconnecting client can attach mid-flight. */
const live = new Map<
  string,
  { events: RunEvent[]; done: boolean; controller: AbortController }
>();

/** Automatic triggers (webhook/cron/event/batch). Restored from persisted graphs. */
const triggers = new TriggerService({
  db: {
    listAllGraphs: () => db.listAllGraphs(),
    getGraphById: (id: string) => db.getGraphById(id),
    saveGraphUnscoped: (graph: any, at: number) => db.saveGraphUnscoped(graph, at),
  },
  startRun: (graph, opts) => {
    const ownerId = db.getGraphOwnerId(graph.id) ?? "";
    return startRun({
      db,
      userId: ownerId,
      worker,
      artifacts,
      live,
      graph,
      publicUrl: PUBLIC_URL,
      ...opts,
      onFinish: (gid, status) => {
        void triggers.onGraphFinished(gid, status);
        // Engine success status is "done" (not "completed") — extract knowledge
        // once a run settles as success or failure.
        if (status === "done" || status === "failed") {
          try {
            const recent = db.listRunsByGraphUnscoped(gid, 1);
            if (recent.length > 0) {
              const run = recent[0]!;
              const events = db.events(run.id as string);
              const graphName = db.getGraphById(gid)?.name ?? gid;
              const entries = extractKnowledgeFromRun(events, run.id as string, graphName);
              for (const entry of entries) memory.add(ownerId, entry);
            }
          } catch {
            // best-effort
          }
        }
      },
      onArtifact: (aid) => {
        void triggers.onArtifact(aid);
      },
    });
  },
});
triggers.restore();

/** Schedules cron triggers; arms timers after triggers are restored. */
const scheduler = new TriggerScheduler(triggers, (err) =>
  log.error("trigger scheduler", { error: (err as Error)?.message ?? String(err) }),
);
scheduler.start();

/** JSON error response that accepts a dynamic (non-literal) status code. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const app = new Hono<{ Variables: { userId: string } }>();
applyCors(app, process.env.CORS_ORIGINS);
applySecurityHeaders(app);

app.get("/api/health", (c) => c.json({ ok: true }));

// --- Auth routes (no auth required) ---
const AUTH_COOKIE = "auth_token";

/**
 * Whether a stored artifact `uri` is safe to send as a Location header (L2).
 * Only http(s) redirects are allowed; file:/data:/javascript: and other
 * schemes are refused to prevent protocol-smuggling redirects. Exported for
 * unit tests.
 */
export function isSafeRedirectUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

/**
 * Secure-cookie policy: the SECURE_COOKIES env var overrides; without it,
 * production builds enable Secure (they are expected to run behind TLS) while
 * everything else keeps it off so local HTTP development keeps working.
 * Loopback hosts are exempt even when enabled, since browsers accept Secure
 * cookies on http://localhost but many other clients (curl, Playwright) do not.
 */
function secureCookiesEnabled(host?: string): boolean {
  const v = process.env.SECURE_COOKIES;
  const enabled =
    v !== undefined
      ? v === "1" || v.toLowerCase() === "true"
      : process.env.NODE_ENV === "production";
  if (!enabled) return false;
  const h = (host ?? "").toLowerCase();
  return !(
    h === "localhost" ||
    h.startsWith("localhost:") ||
    h === "127.0.0.1" ||
    h.startsWith("127.0.0.1:") ||
    h === "[::1]" ||
    h.startsWith("[::1]:")
  );
}

function setAuthCookie(c: any, token: string, remember: boolean) {
  // Without Max-Age the browser treats it as a session cookie (dropped on close).
  const maxAge = remember ? `; Max-Age=${REMEMBER_MAX_AGE_SEC}` : "";
  const secure = secureCookiesEnabled(c.req.header("host")) ? "; Secure" : "";
  c.header("set-cookie", `${AUTH_COOKIE}=${token}; HttpOnly; Path=/${maxAge}${secure}; SameSite=Lax`);
}

function clearAuthCookie(c: any) {
  const secure = secureCookiesEnabled(c.req.header("host")) ? "; Secure" : "";
  c.header("set-cookie", `${AUTH_COOKIE}=; HttpOnly; Path=/; Max-Age=0${secure}; SameSite=Lax`);
}

app.post("/api/auth/register", async (c) => {
  // M3: the very first account bootstraps the instance. Once a user exists,
  // self-registration is closed unless the operator opts in via
  // ALLOW_REGISTRATION=1 — otherwise anyone who reaches the port can create
  // an account and start running paid models.
  if (db.countUsers() > 0) {
    const flag = (process.env.ALLOW_REGISTRATION ?? "").trim().toLowerCase();
    if (flag !== "1" && flag !== "true") {
      return c.json({ error: "注册已关闭，请联系管理员开通账号" }, 403);
    }
  }
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "请输入有效的邮箱地址" }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: "密码至少需要6个字符" }, 400);
  }
  if (db.findUserByEmail(email)) {
    return c.json({ error: "该邮箱已注册" }, 409);
  }
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  db.createUser(id, email, passwordHash);
  const token = await signToken(id, email, true);
  setAuthCookie(c, token, true);
  return c.json({ user: { id, email } }, 201);
});

app.post("/api/auth/login", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    remember?: boolean;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const remember = body.remember === true;
  const user = db.findUserByEmail(email);
  if (!user) {
    return c.json({ error: "邮箱或密码错误" }, 401);
  }
  const hash = db.findUserPasswordHash(user.id);
  if (!hash || !(await verifyPassword(password, hash))) {
    return c.json({ error: "邮箱或密码错误" }, 401);
  }
  const token = await signToken(user.id, user.email, remember);
  setAuthCookie(c, token, remember);
  return c.json({ user: { id: user.id, email: user.email } });
});

app.post("/api/auth/logout", (c) => {
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
  const user = db.findUserById(payload.userId);
  if (!user) return c.json({ error: "not authenticated" }, 401);
  return c.json({ user: { id: user.id, email: user.email, createdAt: user.created_at } });
});

app.post("/api/auth/password", async (c) => {
  const cookie = c.req.header("cookie") ?? "";
  const token = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))?.[1];
  const payload = token ? await verifyToken(token) : null;
  const user = payload ? db.findUserById(payload.userId) : undefined;
  if (!user) return c.json({ error: "not authenticated" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };
  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";
  if (newPassword.length < 6) {
    return c.json({ error: "新密码至少需要6个字符" }, 400);
  }
  const hash = db.findUserPasswordHash(user.id);
  if (!hash || !(await verifyPassword(currentPassword, hash))) {
    return c.json({ error: "当前密码不正确" }, 401);
  }
  db.updateUserPasswordHash(user.id, await hashPassword(newPassword));
  return c.json({ ok: true });
});

// --- Auth middleware ---
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  // Skip auth for public endpoints
  if (path === "/api/health" || path.startsWith("/api/auth/")) return next();
  // Webhook endpoints use their own secret-based auth
  if (/\/api\/graphs\/[^/]+\/webhook$/.test(path)) return next();

  // Extract token from cookie, Authorization Bearer header, or query param
  // (SSE fallback). Precedence: cookie → Bearer header → ?token= query.
  let token: string | undefined;
  const cookie = c.req.header("cookie") ?? "";
  const cookieMatch = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`));
  token = cookieMatch?.[1];
  if (!token) {
    const auth = c.req.header("authorization") ?? "";
    const bearer = /^Bearer\s+(.+)$/i.exec(auth.trim());
    token = bearer?.[1];
  }
  // Query-param token is accepted ONLY for the SSE stream route — EventSource
  // cannot set headers, so it needs ?token=. Every other route must use the
  // cookie or Bearer header, keeping tokens out of generic URLs/logs (L1).
  if (!token && /\/stream$/.test(path)) {
    token = c.req.query("token");
  }

  if (!token) return c.json({ error: "not authenticated" }, 401);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "invalid or expired token" }, 401);

  c.set("userId", payload.userId);
  await next();
});

app.get("/api/skills", (c) => c.json(listBuiltinSkills()));

app.get("/api/graphs", (c) => {
  const userId = c.get("userId");
  return c.json(db.listGraphs(userId));
});

// Reject names that collide (case-insensitive, trimmed) with any other graph.
// `excludeId` lets PUT /api/graphs/:id skip the row it's updating.
const findGraphIdByName = (name: string, userId: string, excludeId?: string): string | null =>
  findGraphIdByNameCore(db.listGraphs(userId), name, excludeId);


app.get("/api/templates", (c) =>
  c.json(
    TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      // Declared instantiation fields (without applyTo plumbing) so API clients
      // can render the same form the web UI shows.
      fields: (t.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        placeholder: f.placeholder ?? "",
        defaultValue: f.defaultValue ?? "",
      })),
      // Slim geometry so the client can render a preview thumbnail without the
      // full prompts/agents payload.
      nodes: t.graph.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        x: n.x,
        y: n.y,
      })),
      edges: t.graph.edges.map((e) => ({
        from: e.from,
        to: e.to,
        kind: e.kind ?? "edge",
      })),
    })),
  ),
);

app.post("/api/graphs", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    from?: string;
    template?: string;
    fieldValues?: Record<string, string>;
  };
  const id = randomUUID();
  let graph: Graph;
  let originTemplateId: string | null = null;
  if (body.template) {
    const tpl = getTemplate(body.template);
    if (!tpl) return c.json({ error: "template not found" }, 404);
    graph = instantiateTemplate(tpl, {
      id,
      name: body.name?.trim() || tpl.name,
      fieldValues: body.fieldValues,
    });
    originTemplateId = body.template;
  } else if (body.from) {
    const src = db.getGraph(body.from, userId);
    if (!src) return c.json({ error: "source graph not found" }, 404);
    const { version: _srcVersion, ...srcDoc } = src;
    void _srcVersion;
    graph = {
      ...srcDoc,
      id,
      name: body.name?.trim() || `${srcDoc.name} 副本`,
      nodes: srcDoc.nodes.map((n) => ({ ...n })),
      edges: srcDoc.edges.map((e) => ({ ...e })),
    };
    // Clone is an independent copy — not a template instance.
    originTemplateId = null;
  } else {
    graph = {
      id,
      name: body.name?.trim() || "新产线",
      nodes: [],
      edges: [],
    };
    originTemplateId = null;
  }
  const dup = findGraphIdByName(graph.name, userId);
  if (dup) {
    return c.json(
      { error: "duplicate_name", message: `已存在同名产线「${graph.name}」，请换一个名字。`, existingId: dup },
      409,
    );
  }
  db.saveGraph(graph, Date.now(), userId, undefined, originTemplateId);
  return c.json(db.getGraph(id, userId), 201);
});

app.get("/api/graphs/:id", (c) => {
  const userId = c.get("userId");
  const graph = db.getGraph(c.req.param("id"), userId);
  return graph ? c.json(graph) : c.json({ error: "not found" }, 404);
});

app.delete("/api/graphs/:id", (c) => {
  const userId = c.get("userId");
  db.deleteGraph(c.req.param("id"), userId);
  return c.json({ ok: true });
});

/** Auto-snapshot parameters from user settings, falling back to the design
 *  defaults (10 min throttle window, 30 auto-snapshots kept per graph). */
function autoSnapshotSettings(userId: string): { minIntervalMs: number; maxKeep: number } {
  const s = loadConfig(userId).autoSnapshot;
  return {
    minIntervalMs: s?.minIntervalMs ?? 10 * 60 * 1000,
    maxKeep: s?.maxKeep ?? 30,
  };
}

app.put("/api/graphs/:id", async (c) => {
  const userId = c.get("userId");
  const paramId = c.req.param("id");
  const parsed = Graph.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // H1: the body id must match the path — otherwise a crafted body could
  // target a different document than the URL implies.
  if (parsed.data.id !== paramId) {
    return c.json({ error: "id_mismatch", message: "请求体中的产线 ID 与路径不一致" }, 400);
  }

  // H2: a graph document can carry triggers, so enforce the webhook-secret
  // rule on the save path too (the create-trigger route alone is bypassable
  // by writing graph.triggers directly through this PUT).
  const emptySecretWebhook = (parsed.data.triggers ?? []).find(
    (t) => t.type === "webhook" && !t.webhookSecret?.trim(),
  );
  if (emptySecretWebhook) {
    return c.json({ error: "webhook 触发器必须设置 secret" }, 400);
  }

  const dupId = findGraphIdByName(parsed.data.name, userId, paramId);
  if (dupId) {
    return c.json(
      { error: "duplicate_name", message: `已存在同名产线「${parsed.data.name}」，请换一个名字。`, existingId: dupId },
      409,
    );
  }

  // Pre-save auto-snapshot: capture what's about to be overwritten so a bad
  // edit that gets saved can always be rolled back. Throttled and pruned by
  // db.saveAutoSnapshot; parameters come from user settings when configured.
  const existing = db.getGraph(parsed.data.id, userId);
  if (existing) {
    const s = autoSnapshotSettings(userId);
    db.saveAutoSnapshot(parsed.data.id, JSON.stringify(existing), s.minIntervalMs, s.maxKeep);
  }

  // Optimistic concurrency: a tab sends the version it last loaded via
  // If-Match. A mismatch means another tab (or session) saved first, so we
  // refuse instead of silently overwriting their edits.
  const ifMatch = c.req.header("if-match");
  const expectedVersion = ifMatch != null ? Number(ifMatch) : undefined;
  const result = db.saveGraph(parsed.data, Date.now(), userId, expectedVersion);
  if (!result.ok) {
    if ("conflict" in result) {
      return c.json(
        { error: "conflict", message: "该产线已在其他标签页被修改，请刷新后重试。", serverVersion: result.serverVersion },
        409,
      );
    }
    // H1: id collides with another user's graph — never overwrite it.
    return c.json({ error: "forbidden", message: "该产线不属于当前账号" }, 403);
  }
  return c.json({ ok: true, version: result.version });
});

/** Which node kinds require a worker model and which modality they need. */
import { validateModels, type ModelDiagnostic } from "./validate-models.js";

app.post("/api/compile", async (c) => {
  const parsed = Graph.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const result = compile(parsed.data);
  const modelDiags = validateModels(parsed.data, loadConfig(c.get("userId")));
  log.info("compile", {
    graphId: parsed.data.id,
    nodes: parsed.data.nodes.length,
    plan: result.plan !== null,
    diagnostics: [...result.diagnostics, ...modelDiags].map((d) => d.message),
  });
  return c.json({
    ...result,
    diagnostics: [...result.diagnostics, ...modelDiags],
  });
});

app.get("/api/settings", (c) => {
  const cfg = loadConfig(c.get("userId"));
  // Never return raw API keys — redact for the UI.
  const redacted: AppConfig = {
    ...cfg,
    providers: Object.fromEntries(
      Object.entries(cfg.providers).map(([name, p]) => [
        name,
        { ...p, apiKey: p.apiKey ? redactKey(p.apiKey) : undefined },
      ]),
    ),
  };
  return c.json(redacted);
});

app.put("/api/settings", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json()) as Partial<AppConfig>;
  const current = loadConfig(userId);
  const bodyProviders = body.providers ?? {};
  const mergedProviders: AppConfig["providers"] = {};
  // Always keep the internal fake provider.
  if (current.providers.fake) mergedProviders.fake = current.providers.fake;
  for (const [name, provider] of Object.entries(bodyProviders)) {
    // If the UI sent back a redacted key, keep the real one.
    if (provider.apiKey && isRedactedKey(provider.apiKey)) {
      provider.apiKey = current.providers[name]?.apiKey ?? provider.apiKey;
    }
    mergedProviders[name] = provider;
  }
  const merged: AppConfig = {
    ...current,
    ...body,
    providers: mergedProviders,
  };
  const path = saveConfig(merged, userId);
  return c.json({ ok: true, path });
});

/**
 * Test a provider connection without saving. Accepts provider config in the
 * body so the user can verify before hitting save. Text/embedding probe with a
 * minimal non-streaming request; image/audio trigger a real generation (billed)
 * and validate the response shape; video probes cheaply via GET /models and
 * never submits a real generation job.
 */
app.post("/api/providers/test", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    modality?: Modality;
    /** When set, use the saved real key for this provider if the body has no new key. */
    providerName?: string;
  };
  const rawUrl = body.baseUrl ?? "";
  if (!rawUrl.trim()) return c.json({ ok: false, error: "Base URL is required" }, 400);
  const baseUrl = normalizeBaseUrl(rawUrl);
  let apiKey = body.apiKey ?? "";
  const model = body.model?.trim() || "agnes-2.0-flash";

  // Resolve modality: explicit > saved for this model > text default.
  let modality = body.modality ?? DEFAULT_MODALITY;
  const saved = body.providerName
    ? loadConfig(c.get("userId")).providers[body.providerName]
    : undefined;
  if (saved) modality = body.modality ?? modalityOf(saved, model);

  // The UI holds a redacted key for already-saved providers. If the caller did
  // not type a fresh key (empty or looks redacted), resolve the real key from
  // the saved config on the server.
  const looksRedacted = !apiKey || isRedactedKey(apiKey);
  if (looksRedacted && body.providerName) {
    if (!saved) {
      return c.json({ ok: false, error: `Provider "${body.providerName}" 未保存，请先添加并保存` }, 400);
    }
    // A server-resolved key must never travel to a caller-chosen destination:
    // pairing the saved key with a different baseUrl would let any user
    // exfiltrate it to their own host. Key and endpoint must stay same-source;
    // to test a new address, supply a fresh key in the same request.
    if (normalizeBaseUrl(saved.baseUrl ?? "") !== baseUrl) {
      return c.json(
        { ok: false, error: "使用已保存的 API Key 时不能修改 Base URL；如需测试新地址，请同时填入新的 API Key" },
        400,
      );
    }
    if (saved.apiKey && !isRedactedKey(saved.apiKey)) apiKey = saved.apiKey;
  }

  if (!apiKey || isRedactedKey(apiKey)) {
    return c.json({ ok: false, error: "API Key 未配置或已失效，请重新填写" }, 400);
  }

  // Prefer the saved provider's endpoint override (per modality); the probe and
  // the real worker must agree on where to POST, so share endpointFor().
  const endpoint = saved ? endpointFor(saved, model, modality) : MODALITY_ENDPOINT[modality];

  // Video generation is slow and billed per job — "test connection" must not
  // trigger a real job. Probe cheaply (GET /models), matching market practice.
  if (modality === "video") {
    return c.json(await probeVideo(baseUrl, apiKey, model));
  }

  const payload = buildTestPayload(modality, model);

  // Image/video generation is much slower than chat; give those a longer leash.
  const PROBE_TIMEOUT: Record<Modality, number> = {
    text: 15_000,
    embedding: 15_000,
    image: 90_000,
    video: 120_000,
    audio: 60_000,
  };
  const probeTimeoutMs = PROBE_TIMEOUT[modality];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);
  try {
    // Provider probes hit a user-supplied baseUrl — route through the guarded
    // egress so a custom endpoint can never be pointed at internal services
    // (audit H5 SSRF half).
    const res = await guardedFetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return c.json({
        ok: false,
        status: res.status,
        error: sanitizeError(`HTTP ${res.status}: ${text.slice(0, 300)}`),
      });
    }
    // Image is a real, billed call — don't trust a bare 2xx, verify the
    // response actually carries generated images.
    if (modality === "image") {
      const json = (await res.json().catch(() => ({}))) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const items = json.data ?? [];
      if (items.length === 0 || items.some((it) => !it.b64_json && !it.url)) {
        return c.json({
          ok: false,
          status: res.status,
          error: "图片接口返回 2xx 但未包含有效图片数据（data 为空或缺少 url/b64_json）",
        });
      }
    }
    return c.json({ ok: true, modality, endpoint: `${baseUrl}${endpoint}` });
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      return c.json({ ok: false, error: `Connection timed out (${Math.round(probeTimeoutMs / 1000)}s)` });
    }
    return c.json({ ok: false, error: sanitizeError((err as Error).message) });
  }
});


app.get("/api/runs", (c) => {
  const userId = c.get("userId");
  const limit = Number(c.req.query("limit") ?? 50);
  const offset = Number(c.req.query("offset") ?? 0);
  const graphId = c.req.query("graphId");
  const status = c.req.query("status");
  const { rows, total } = db.listRuns(userId, {
    limit,
    offset,
    graphId: graphId || undefined,
    status: status || undefined,
  });
  return c.json({ runs: rows, total });
});

app.get("/api/runs/:id/stats", (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!db.runExists(runId, userId)) return c.json({ error: "not found" }, 404);
  return c.json(db.runStats(runId));
});

/** The graph as it was when this run started (snapshot), used to render a
 *  historical run's finished product in the gallery. */
app.get("/api/runs/:id/graph", (c) => {
  const userId = c.get("userId");
  const run = db.getRun(c.req.param("id"), userId);
  if (!run) return c.json({ error: "not found" }, 404);
  try {
    return c.json(JSON.parse(run.snapshot));
  } catch {
    return c.json({ error: "snapshot corrupted" }, 500);
  }
});

// --- Knowledge base / archive (5.2) ---
app.get("/api/knowledge", (c) => {
  const userId = c.get("userId");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  return c.json({ entries: memory.list(userId, limit, offset), total: memory.count(userId) });
});

app.get("/api/knowledge/search", (c) => {
  const userId = c.get("userId");
  const q = c.req.query("q") ?? "";
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 50);
  return c.json({ entries: memory.search(userId, q, limit) });
});

app.post("/api/knowledge", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; content?: string; source?: string; tags?: string[] };
  if (!body.title || !body.content) return c.json({ error: "title and content are required" }, 400);
  const entry = memory.add(userId, {
    title: body.title,
    content: body.content,
    source: body.source ?? "manual",
    tags: body.tags ?? [],
  });
  return c.json(entry, 201);
});

app.delete("/api/knowledge/:id", (c) => {
  const userId = c.get("userId");
  const ok = memory.delete(c.req.param("id"), userId);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.body(null, 204);
});

/** Available workers (built-in + discovered plugins), for the run-start UI. */
app.get("/api/workers", (c) => c.json(workerRegistry.list()));

/** Connected MCP servers and the tools they contributed as skill cards. */
app.get("/api/mcp", (c) => c.json(mcpStatus));

app.get("/api/costs", (c) => {
  const userId = c.get("userId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  return c.json(
    db.costReport({
      userId,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
    }),
  );
});

app.get("/api/costs.csv", (c) => {
  const userId = c.get("userId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const { byGraph, byNode, byDay } = db.costRows({
    userId,
    from: from ? Number(from) : undefined,
    to: to ? Number(to) : undefined,
  });

  const esc = (v: unknown) => {
    const str = String(v ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines: string[] = [];
  lines.push("# section,key1,key2,runs/attempts,tokens_in,tokens_out,cost_usd");
  for (const g of byGraph) {
    lines.push(["graph", g.graph_name, "", g.runs, g.tokens_in, g.tokens_out, g.cost_usd.toFixed(6)].map(esc).join(","));
  }
  for (const n of byNode) {
    lines.push(["node", n.graph_name, n.node_name, n.attempts, n.tokens_in, n.tokens_out, n.cost_usd.toFixed(6)].map(esc).join(","));
  }
  for (const d of byDay) {
    lines.push(["day", d.day, "", d.runs, d.tokens_in, d.tokens_out, d.cost_usd.toFixed(6)].map(esc).join(","));
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="agent-world-costs-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
});

app.get("/api/eval", (c) => {
  const userId = c.get("userId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const graphId = c.req.query("graphId");
  return c.json(
    db.evalReport({
      userId,
      graphId: graphId || undefined,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
    }),
  );
});

app.get("/api/eval.csv", (c) => {
  const userId = c.get("userId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const graphId = c.req.query("graphId");
  const rep = db.evalReport({
    userId,
    graphId: graphId || undefined,
    from: from ? Number(from) : undefined,
    to: to ? Number(to) : undefined,
  });

  const esc = (v: unknown) => {
    const str = String(v ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const score = (s: number | undefined) => (s ?? 0).toFixed(3);
  const lines: string[] = [];
  lines.push("# section,key1,key2,runs,passed,passRate,avgRework,avgDurationMs,avgScore");
  const t = rep.totals;
  lines.push(
    ["totals", "", "", t.runs, t.passed, t.passRate.toFixed(4), t.avgRework.toFixed(3), Math.round(t.avgDurationMs), score(t.avgScore)]
      .map(esc)
      .join(","),
  );
  for (const g of rep.byGraph) {
    lines.push(
      ["graph", g.graph_name, "", g.runs, g.passed, g.passRate.toFixed(4), g.avgRework.toFixed(3), Math.round(g.avgDurationMs), score(g.avgScore)]
        .map(esc)
        .join(","),
    );
  }
  for (const d of rep.byDay) {
    lines.push(
      ["day", d.day, "", d.runs, d.passed, d.passRate.toFixed(4), d.avgRework.toFixed(3), Math.round(d.avgDurationMs), score(d.avgScore)]
        .map(esc)
        .join(","),
    );
  }
  for (const p of rep.byPrompt) {
    lines.push(
      ["prompt", p.graph_name, p.version, p.runs, p.passed, p.passRate.toFixed(4), p.avgRework.toFixed(3), Math.round(p.avgDurationMs), score(p.avgScore)]
        .map(esc)
        .join(","),
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="agent-world-eval-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

app.post("/api/runs", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    graphId?: string;
    budgetUsd?: number | null;
    trigger?: string;
    input?: string;
    connectorValues?: Record<string, string>;
    workerId?: string;
  };
  const graphs = db.listGraphs(userId);
  const graphId = body.graphId ?? graphs[0]?.id;
  if (!graphId) return c.json({ error: "no graphs found — create one first" }, 400);
  const graph = db.getGraph(graphId, userId);
  if (!graph) return c.json({ error: "graph not found" }, 404);

  const modelDiags = validateModels(graph, loadConfig(c.get("userId")));
  const modelErrors = modelDiags.filter((d) => d.severity === "error");
  if (modelErrors.length > 0) {
    const summary =
      modelErrors.length === 1
        ? modelErrors[0]!.message
        : `${modelErrors.length} 个节点未配置模型：${modelErrors[0]!.message}${modelErrors.length > 1 ? "（其余见 diagnostics）" : ""}`;
    return c.json(
      {
        error: "graph has unconfigured model(s)",
        message: `${summary} 请前往「模型设置」补全后再派发。`,
        diagnostics: modelDiags,
      },
      422,
    );
  }
  try {
    const { runId, diagnostics } = await startRun({
      db,
      userId,
      worker: workerRegistry.get(body.workerId),
      artifacts,
      live,
      graph,
      trigger: body.trigger ?? "manual",
      budgetUsd: body.budgetUsd ?? null,
      input: body.input,
      connectorValues: body.connectorValues,
      publicUrl: PUBLIC_URL,
      onFinish: (gid, status) => {
        void triggers.onGraphFinished(gid, status);
      },
      onArtifact: (aid) => {
        void triggers.onArtifact(aid);
      },
    });
    return c.json({ runId, diagnostics, modelWarnings: modelDiags });
  } catch (e) {
    if (e instanceof RunStartError) {
      return jsonResponse(e.status, { error: e.message, diagnostics: e.extra });
    }
    throw e;
  }
});

// --- Trigger management + webhook ---
app.get("/api/graphs/:id/triggers", (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  if (!db.getGraph(graphId, userId)) return c.json({ error: "graph not found" }, 404);
  return c.json(triggers.listByGraph(graphId));
});

app.post("/api/graphs/:id/triggers", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  if (!db.getGraph(graphId, userId)) return c.json({ error: "graph not found" }, 404);
  const raw = (await c.req.json().catch(() => ({}))) as Partial<TriggerConfig>;
  const withId = raw.id ? raw : { ...raw, id: crypto.randomUUID() };
  const parsed = TriggerConfig.safeParse(withId);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  // Webhook triggers are callable by anyone who knows the URL; an empty
  // secret would leave the pipeline anonymously triggerable.
  if (parsed.data.type === "webhook" && !parsed.data.webhookSecret?.trim()) {
    return c.json({ error: "webhook 触发器必须设置 secret" }, 400);
  }
  try {
    const trigger = await triggers.upsert(graphId, parsed.data);
    scheduler.sync(trigger);
    return c.json(trigger, 201);
  } catch (e) {
    if (e instanceof TriggerError) {
      return jsonResponse(e.status, { error: e.message });
    }
    throw e;
  }
});

app.delete("/api/graphs/:id/triggers/:tid", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  if (!db.getGraph(graphId, userId)) return c.json({ error: "graph not found" }, 404);
  const tid = c.req.param("tid");
  scheduler.unsync(tid);
  await triggers.remove(graphId, tid);
  return c.body(null, 204);
});

// Next cron fire times for the UI (4A.7).
app.get("/api/graphs/:id/triggers/next-runs", (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  if (!db.getGraph(graphId, userId)) return c.json({ error: "graph not found" }, 404);
  return c.json(triggers.nextRunMap(graphId));
});

// Manually fire a trigger (e.g. a batch run, or a cron/event re-run on demand).
app.post("/api/graphs/:id/triggers/:tid/fire", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  const tid = c.req.param("tid");
  if (!db.getGraph(graphId, userId)) return c.json({ error: "graph not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { payload?: unknown };
  const trigger = triggers.get(tid);
  if (!trigger) return jsonResponse(404, { error: "trigger not found" });
  try {
    if (trigger.type === "batch") {
      const runIds = await triggers.fireBatch(tid, body.payload);
      return c.json({ runIds });
    }
    const { runId } = await triggers.fire(tid, body.payload, graphId);
    return c.json({ runId });
  } catch (e) {
    if (e instanceof TriggerError) return jsonResponse(e.status, { error: e.message });
    throw e;
  }
});

app.post("/api/graphs/:id/webhook", async (c) => {
  const graphId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { secret?: string; timestamp?: number; payload?: unknown };
  const secret = body.secret ?? c.req.header("x-webhook-secret") ?? "";
  // M1 replay defence: external callers must send a fresh timestamp (header or
  // body). Missing/stale requests are rejected before the secret is checked.
  const rawTs = c.req.header("x-webhook-timestamp") ?? body.timestamp;
  const timestampMs = rawTs != null ? Number(rawTs) : undefined;
  if (timestampMs == null || !Number.isFinite(timestampMs)) {
    return c.json({ error: "missing X-Webhook-Timestamp" }, 401);
  }
  try {
    const { runId } = await triggers.fireWebhook(graphId, secret, body.payload, timestampMs);
    return c.json({ runId });
  } catch (e) {
    if (e instanceof TriggerError) {
      return jsonResponse(e.status, { error: e.message });
    }
    throw e;
  }
});

// Test a connector config without starting a run (preview the pulled material).
app.post("/api/connectors/test", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { connector?: unknown; formValues?: Record<string, string> };
  if (!body.connector) return c.json({ error: "connector is required" }, 400);
  const parsed = ConnectorConfig.safeParse(body.connector);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  try {
    const material = await resolveConnector(parsed.data, body.formValues);
    const preview = material.text.length > 2000 ? material.text.slice(0, 2000) + "\n…(truncated)" : material.text;
    return c.json({ text: preview, images: material.images, fullLength: material.text.length });
  } catch (e) {
    return c.json({ error: sanitizeError(e) }, 502);
  }
});

app.post("/api/runs/ab", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    graphId?: string;
    targetNodeId?: string;
    variants?: string[];
    budgetUsd?: number | null;
    input?: string;
  };
  if (
    !body.graphId ||
    !body.targetNodeId ||
    !Array.isArray(body.variants) ||
    body.variants.length < 2
  ) {
    return c.json({ error: "需要 graphId、targetNodeId 与至少 2 个 variants" }, 400);
  }
  const graph = db.getGraph(body.graphId, userId);
  if (!graph) return c.json({ error: "graph not found" }, 404);
  const target = graph.nodes.find((n) => n.id === body.targetNodeId);
  if (!target) return c.json({ error: "target node not found" }, 404);
  if (target.kind !== "textGen") {
    return c.json({ error: "A/B 目标必须是厂房(agent)节点" }, 400);
  }
  try {
    const { abGroup, arms } = await startABExperiment(db, worker, {
      userId,
      graph,
      targetNodeId: body.targetNodeId,
      variants: body.variants,
      budgetUsd: body.budgetUsd ?? null,
      input: body.input,
    });
    return c.json({ abGroup, arms });
  } catch (err) {
    return c.json({ error: sanitizeError(err) }, 400);
  }
});

app.get("/api/ab/:groupId", (c) => {
  const userId = c.get("userId");
  const report = db.abReport(c.req.param("groupId"), userId);
  if (!report) return c.json({ error: "not found" }, 404);
  return c.json(report);
});

app.get("/api/brand-terms", (c) => {
  const userId = c.get("userId");
  return c.json(db.listBrandTerms(userId));
});

app.post("/api/brand-terms", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as { term?: string; note?: string };
  if (!body.term?.trim()) return c.json({ error: "term required" }, 400);
  return c.json(db.addBrandTerm(userId, body.term, body.note ?? ""), 201);
});

app.delete("/api/brand-terms/:id", (c) => {
  const userId = c.get("userId");
  db.deleteBrandTerm(c.req.param("id"), userId);
  return c.body(null, 204);
});

// --- Graph versions (5.6) ---
app.get("/api/graphs/:id/versions", (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  const graph = db.getGraph(graphId, userId);
  if (!graph) return c.json({ error: "graph not found" }, 404);
  // Run-correlation hashes (design-versions §3): which snapshot matches what
  // actually ran last, and whether the live graph still matches it.
  const latestRunHash = db.getLatestRunContentHash(graphId, userId);
  return c.json({
    versions: db.listVersions(graphId, userId),
    latestRunHash,
    currentHash: contentHash(JSON.stringify(graph)),
  });
});

app.post("/api/graphs/:id/versions", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  const graph = db.getGraph(graphId, userId);
  if (!graph) return c.json({ error: "graph not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; note?: string };
  const name = body.name?.trim() || new Date().toLocaleString();
  const snapshot = JSON.stringify(graph);
  const version = db.saveVersion(graphId, name, snapshot, body.note ?? "", contentHash(snapshot));
  return c.json(version, 201);
});

app.get("/api/graphs/:id/versions/:vid", (c) => {
  const userId = c.get("userId");
  const v = db.getVersion(c.req.param("vid"), userId);
  if (!v) return c.json({ error: "version not found" }, 404);
  return c.json({ id: v.id, graphId: v.graph_id, name: v.name, note: v.note, createdAt: v.created_at, snapshot: JSON.parse(v.snapshot) });
});

app.post("/api/graphs/:id/versions/:vid/restore", (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  const v = db.getVersion(c.req.param("vid"), userId);
  if (!v) return c.json({ error: "version not found" }, 404);
  if (v.graph_id !== graphId) return c.json({ error: "version does not belong to this graph" }, 400);
  const snapshot = JSON.parse(v.snapshot);
  db.saveGraph(snapshot, Date.now(), userId);
  return c.json({ ok: true, graph: snapshot });
});

app.delete("/api/graphs/:id/versions/:vid", (c) => {
  const userId = c.get("userId");
  db.deleteVersion(c.req.param("vid"), userId);
  return c.body(null, 204);
});

app.post("/api/runs/:id/cancel", (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!db.runExists(runId, userId)) return c.json({ error: "not found" }, 404);
  const entry = live.get(runId);
  if (!entry) return c.json({ error: "not live" }, 404);
  entry.controller.abort();
  return c.json({ ok: true });
});

app.delete("/api/runs/:id", (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!db.runExists(runId, userId)) return c.json({ error: "not found" }, 404);
  const entry = live.get(runId);
  if (entry && !entry.done) {
    return c.json({ error: "run is still in progress; cancel it first" }, 409);
  }
  live.delete(runId);
  db.deleteRun(runId, userId);
  return c.json({ ok: true });
});

/** Resume a halted run: `{ action: "continue" | "approve" | "reject" | "edit" | "scrap", editOutput?, resetFrom? }`. */
app.post("/api/runs/:id/resume", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  const row = db.getRun(runId, userId);
  if (!row) return c.json({ error: "not found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    action?: "continue" | "approve" | "reject" | "edit" | "scrap";
    editOutput?: Record<string, string>;
    resetFrom?: string;
    approveTools?: unknown;
    workerId?: string;
  };
  const action: "continue" | "approve" | "reject" | "edit" | "scrap" =
    body.action === "scrap" ||
    body.action === "approve" ||
    body.action === "reject" ||
    body.action === "edit"
      ? body.action
      : "continue";
  const resetFrom = typeof body.resetFrom === "string" ? body.resetFrom : undefined;
  const editOutput = body.editOutput && typeof body.editOutput === "object" ? body.editOutput : undefined;
  const approveTools =
    Array.isArray(body.approveTools) ? body.approveTools.filter((t) => typeof t === "string") : undefined;

  // A live entry exists while the generator runs. Reject only if it is still
  // actively executing; a halted/done entry is safe to resume.
  const active = live.get(runId);
  if (active && !active.done) return c.json({ error: "run is still active" }, 409);
  if (active) live.delete(runId);

  const graph = JSON.parse(row.snapshot) as Graph;
  const { plan, diagnostics } = compile(graph);
  if (!plan) return c.json({ error: "graph does not compile", diagnostics }, 422);

  const pastEvents = db.events(runId);
  const controller = new AbortController();
  const entry = { events: [] as RunEvent[], done: false, controller };
  live.set(runId, entry);
  const runLog = log.child({ runId, graphId: graph.id });
  runLog.info("run resumed", { action, resetFrom: resetFrom ?? null, nodes: graph.nodes.length });
  // A retry from a failed/tripped run reopens the same run; flip its status
  // back to running so listings/UIs reflect the active attempt.
  if (resetFrom || row.status === "failed" || row.status === "tripped") {
    db.markRunning(runId, userId);
  }

  void runAsUser(userId, async () => {
    try {
      const cfg = loadConfig(userId);
      const now = new Date();
      // Graph variables: defaults overridden by persisted values. Re-loaded on
      // resume so another run's writes since the halt are not lost; written
      // back once the run finishes.
      const variables = new Map<string, unknown>(
        Object.entries({ ...(graph.variables ?? {}), ...db.loadGraphVariables(graph.id, userId) }),
      );
      for await (const event of resume({
        runId,
        graph,
        plan,
        worker: workerRegistry.get(body.workerId),
        budgetUsd: row.budget_usd ?? null,
        initialVariables: variables,
        monthlyBudgetUsd: cfg.monthlyBudgetUsd ?? null,
        monthSpentUsd: db.costForMonth(now.getFullYear(), now.getMonth() + 1, userId),
        defaultModel: cfg.defaultModel,
        pastEvents,
        action,
        resetFrom,
        editOutput,
        approveTools,
        signal: controller.signal,
        storeBinary: async (data, mimeType, label) => {
          const saved = await artifacts.saveBinary({ userId, data, kind: "image", mimeType, label });
          db.insertArtifact(saved, userId);
          return saved.uri ?? `data:${mimeType};base64,${data.toString("base64")}`;
        },
        // Inline local /api/artifacts/<id> URIs as data:<mime>;base64,... for
        // cloud vision models (they can't reach our localhost).
        readArtifact,
        publicUrl: PUBLIC_URL,
        // Subprocess nodes call other saved graphs — resolve them within the
        // same user's scope so users can't invoke graphs they can't see.
        loadSubgraph: (graphId) => db.getGraph(graphId, userId) ?? null,
      })) {
        db.record(runId, event);
        if (event.type === "artifact.produced") {
          db.insertArtifact(
            await artifacts.save(event.artifact, { runId, nodeId: event.nodeId, attempt: event.attempt }),
            userId,
          );
        }
        entry.events.push(event);
        if (event.type === "run.finished") {
          db.finishRun(runId, userId, event.status, Date.now());
          db.saveGraphVariables(graph.id, userId, Object.fromEntries(variables));
        }
      }
    } catch (err) {
      db.finishRun(runId, userId, "failed", Date.now());
      log.child({ runId }).error("resume crashed", { error: (err as Error)?.message ?? String(err) });
    } finally {
      entry.done = true;
    }
  });

  return c.json({ ok: true, action });
});

/**
 * Re-run a finished run: same graph snapshot (exactly what executed), same
 * input and budget. Useful after fixing a failure — one click from the run
 * gallery instead of re-picking nodes on the canvas.
 */
app.post("/api/runs/:id/rerun", async (c) => {
  const userId = c.get("userId");
  const run = db.getRun(c.req.param("id"), userId);
  if (!run) return c.json({ error: "not found" }, 404);
  if (run.status === "running") return c.json({ error: "run is still live" }, 409);
  let graph: Graph;
  try {
    graph = JSON.parse(run.snapshot) as Graph;
  } catch {
    return c.json({ error: "run snapshot is corrupt" }, 422);
  }
  if (!graph?.nodes?.length) return c.json({ error: "run snapshot is empty" }, 422);

  const modelDiags = validateModels(graph, loadConfig(userId));
  const modelErrors = modelDiags.filter((d) => d.severity === "error");
  if (modelErrors.length > 0) {
    return c.json(
      {
        error: "graph has unconfigured model(s)",
        message: `${modelErrors.length} 个节点未配置模型，请先在「模型设置」补全后再重跑。`,
        diagnostics: modelDiags,
      },
      422,
    );
  }
  try {
    const { runId, diagnostics } = await startRun({
      db,
      userId,
      worker: workerRegistry.get(undefined),
      artifacts,
      live,
      graph,
      trigger: "rerun",
      budgetUsd: run.budget_usd,
      input: run.input ?? undefined,
      publicUrl: PUBLIC_URL,
      onFinish: (gid, status) => {
        void triggers.onGraphFinished(gid, status);
      },
      onArtifact: (aid) => {
        void triggers.onArtifact(aid);
      },
    });
    return c.json({ runId, diagnostics, modelWarnings: modelDiags });
  } catch (e) {
    if (e instanceof RunStartError) {
      return jsonResponse(e.status, { error: e.message, diagnostics: e.extra });
    }
    throw e;
  }
});

/** Full event log — the replay scrubber reads this. */
app.get("/api/runs/:id/events", (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!db.runExists(runId, userId)) return c.json({ error: "not found" }, 404);

  // Pagination: ?after=<seq> (exclusive) and ?limit=<n>. With no params the
  // full history is returned together with the reconstructed runtime state,
  // which is what the initial page load needs. Range requests return only the
  // event window plus a nextCursor, since partial events can't replay state.
  const afterRaw = c.req.query("after");
  const limitRaw = c.req.query("limit");
  if (afterRaw == null && limitRaw == null) {
    const events = db.events(runId);
    return c.json({ events, state: replay(events) });
  }

  const after = afterRaw != null ? Number(afterRaw) : -1;
  const limit = limitRaw != null ? Number(limitRaw) : 500;
  if (!Number.isFinite(limit) || limit <= 0 || limit > 10000) {
    return c.json({ error: "limit must be between 1 and 10000" }, 400);
  }
  const { events, nextCursor } = db.eventsRange(runId, after, limit);
  return c.json({ events, after, nextCursor, hasMore: nextCursor != null });
});

/** Live stream. Resumes from `?after=<seq>` so a dropped connection loses nothing. */
app.get("/api/runs/:id/stream", (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!db.runExists(runId, userId)) return c.json({ error: "not found" }, 404);
  // Resume point: explicit ?after= wins; otherwise honor the native
  // Last-Event-ID header the browser sends automatically when reconnecting to
  // a stream that carried `id:` frames.
  const queryAfter = c.req.query("after");
  const headerAfter = c.req.header("last-event-id");
  const after = queryAfter != null
    ? Number(queryAfter)
    : headerAfter != null
      ? Number(headerAfter)
      : -1;

  return streamSSE(c, async (stream) => {
    let cursor = after;

    for (const event of db.events(runId)) {
      if (event.seq <= cursor) continue;
      await stream.writeSSE({ data: JSON.stringify(envelope(event)), id: String(event.seq) });
      cursor = event.seq;
    }

    const entry = live.get(runId);
    let lastWrite = Date.now();
    while (entry && !(entry.done && cursor >= (entry.events.at(-1)?.seq ?? -1))) {
      const pending = entry.events.filter((e) => e.seq > cursor);
      for (const event of pending) {
        await stream.writeSSE({ data: JSON.stringify(envelope(event)), id: String(event.seq) });
        cursor = event.seq;
        lastWrite = Date.now();
      }
      if (entry.done) break;
      // Heartbeat: proxies drop idle SSE connections (~60s). Send a comment
      // frame every 15s so a long model call (no events for tens of seconds)
      // keeps the connection alive. Browsers ignore SSE comment frames.
      if (Date.now() - lastWrite > 15000) {
        await stream.write(": ping\n\n");
        lastWrite = Date.now();
      }
      await stream.sleep(60);
    }
  });
});

/** Artifacts produced by a single run. */
app.get("/api/runs/:id/artifacts", (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!db.runExists(runId, userId)) return c.json({ error: "not found" }, 404);
  return c.json(db.listArtifactsForRun(runId, userId));
});

/** Upload a raw product image/file. Returns a StoredArtifact with a /api/artifacts/:id URI. */
app.post("/api/artifacts/upload", async (c) => {
  const userId = c.get("userId");
  const contentType = c.req.header("content-type") ?? "application/octet-stream";
  const label = c.req.query("label");
  const data = Buffer.from(await c.req.arrayBuffer());
  if (data.length === 0) return c.json({ error: "empty upload" }, 400);
  const MAX = 25 * 1024 * 1024;
  if (data.length > MAX) return c.json({ error: "file too large (max 25MB)" }, 413);

  let kind: "image" | "audio" | "video" | "file" = "file";
  if (contentType.startsWith("image/")) kind = "image";
  else if (contentType.startsWith("video/")) kind = "video";
  else if (contentType.startsWith("audio/")) kind = "audio";

  const saved = await artifacts.saveBinary({
    userId,
    data,
    kind,
    mimeType: contentType,
    label: label || undefined,
  });
  db.insertArtifact(saved, userId);
  return c.json(saved, 201);
});

/** Cross-run artifact listing (latest first), for the product gallery. */
app.get("/api/artifacts", (c) => {
  const userId = c.get("userId");
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const offset = Number(c.req.query("offset") ?? 0);
  return c.json(db.listArtifacts(userId, limit, offset));
});

/**
 * Server-side image proxy. External image URLs referenced by product-json or
 * extracted artifacts often fail in the browser due to hotlink protection /
 * CORS. The server fetches them (browser-like UA) and streams the bytes back
 * same-origin, so gallery + product images render reliably. Only http(s) is
 * allowed and private/internal addresses are refused (SSRF guard, shared with
 * the HTTP node via ssrf.ts — resolves hostnames at fetch time so DNS
 * rebinding cannot smuggle an internal address past the check); failures
 * return 502 so the client can show a graceful placeholder.
 */
app.get("/api/proxy", async (c) => {
  const target = c.req.query("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    return c.json({ error: "invalid or missing url" }, 400);
  }
  try {
    // Single guarded egress: resolves once and pins the connection (no
    // check-vs-connect DNS gap), refuses internal targets, follows redirects
    // manually with the guard re-run on every hop.
    const upstream = await guardedFetch(target, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      return c.json({ error: `upstream returned ${upstream.status}` }, 502);
    }
    // Audit L7: bound the response body so a huge upstream cannot exhaust
    // server memory via this proxy. Stream and count instead of buffering the
    // whole body up front (also honors an early content-length rejection).
    const declared = Number(upstream.headers.get("content-length") ?? 0);
    if (declared > MAX_PROXY_RESPONSE_BYTES) {
      return c.json({ error: "upstream response too large" }, 502);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_PROXY_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          return c.json({ error: "upstream response too large" }, 502);
        }
        chunks.push(Buffer.from(value));
      }
    } else {
      const ab = await upstream.arrayBuffer();
      total = ab.byteLength;
      if (total > MAX_PROXY_RESPONSE_BYTES) {
        return c.json({ error: "upstream response too large" }, 502);
      }
      chunks.push(Buffer.from(ab));
    }
    const buf = Buffer.concat(chunks, total);
    const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
    return new Response(buf, {
      headers: {
        "content-type": ct,
        "cache-control": "public, max-age=86400",
      },
    });
  } catch (err) {
    if (err instanceof GuardedFetchError) {
      return c.json({ error: err.message }, 403);
    }
    return c.json({ error: "failed to fetch upstream image" }, 502);
  }
});

/** Fetch a single artifact: local blobs are streamed, remote URIs redirect. */
app.get("/api/artifacts/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const meta = db.getArtifact(id, userId);
  if (!meta) return c.json({ error: "not found" }, 404);

  if (meta.storage === "uri" && meta.uri) {
    // Audit L2: only redirect to http(s) locations. Refusing everything else
    // (file:, data:, javascript:…) blocks protocol-smuggling redirects and
    // prevents exposing local file semantics through a Location header.
    if (isSafeRedirectUri(meta.uri)) {
      return c.redirect(meta.uri, 302);
    }
    return c.json({ error: "artifact uri uses an unsafe protocol" }, 404);
  }
  if (meta.storage !== "local") {
    return c.json({ error: "artifact has no binary payload" }, 404);
  }

  let file = await artifacts.open(meta.runId, meta.id);
  if (!file && meta.uri?.startsWith("/api/artifacts/")) {
    // Media artifacts emitted by workers are stored once under their own row
    // (e.g. an `up-…` id) and referenced from the run's row via a local
    // `/api/artifacts/<id>` uri — the run row carries size/mime but no bytes
    // of its own. Follow that reference once (dogfood 2026-09-01: generated
    // images 404'd as "blob missing on disk" despite valid bytes on disk).
    const refId = decodeURIComponent(meta.uri.slice("/api/artifacts/".length));
    const ref = refId && refId !== meta.id ? db.getArtifact(refId, userId) : null;
    if (ref && ref.storage === "local") {
      file = await artifacts.open(ref.runId, ref.id);
    }
  }
  if (!file) return c.json({ error: "blob missing on disk" }, 404);
  const headers = new Headers();
  headers.set("content-type", meta.mimeType ?? "application/octet-stream");
  headers.set("content-length", String(file.size));
  if (meta.label) {
    headers.set(
      "content-disposition",
      `inline; filename="${encodeURIComponent(meta.label)}"`,
    );
  }
  return new Response(file.stream as unknown as ReadableStream, { headers });
});

// Discover worker plugins in the background; the built-in worker is already
// registered, so the server is usable immediately and /api/workers reflects
// plugins a moment later.
if (process.env.NODE_ENV !== "test") void workerRegistry.loadFrom(workersDir);

// Connect configured MCP servers (MCP_SERVERS env, a JSON array of server
// specs) and register their tools as skills. A spec is either the legacy
// `{ id, command, args? }` (stdio) or a richer
// `{ id, transport: "stdio"|"http"|"sse", ... , permissions? }`. Failure to
// reach a server is non-fatal.
const mcpClients: McpClient[] = [];
const mcpStatus: { id: string; tools: string[]; transport: string }[] = [];
async function connectMcpServers(): Promise<void> {
  const raw = process.env.MCP_SERVERS;
  if (!raw) return;
  let rawServers: Array<Record<string, unknown>>;
  try {
    rawServers = JSON.parse(raw);
  } catch {
    log.warn("MCP_SERVERS is not valid JSON; skipping MCP setup");
    return;
  }
  for (const s of rawServers) {
    const id = String(s.id ?? "mcp");
    try {
      const transport = (s.transport as string | undefined) ?? "stdio";
      let spec: McpServerSpec;
      if (transport === "stdio") {
        spec = { transport: "stdio", command: String(s.command), args: (s.args as string[]) ?? [], env: s.env as Record<string, string> | undefined };
      } else {
        spec = { transport: transport as "http" | "sse", url: String(s.url), headers: s.headers as Record<string, string> | undefined };
      }
      const client = connectMcpServer(spec);
      mcpClients.push(client);
      const tools = await registerMcpTools(
        id,
        client,
        registerSkill,
        s.permissions as SkillPermissions | undefined,
        (s.danger as boolean | undefined) ?? undefined,
      );
      mcpStatus.push({ id, tools: tools.map((t) => t.name), transport });
      log.info("mcp connected", { id, transport, tools: tools.map((t) => t.name) });
    } catch (err) {
      log.warn("mcp connect failed", { id, error: (err as Error).message });
    }
  }
}
if (process.env.NODE_ENV !== "test") void connectMcpServers();

if (process.env.NODE_ENV !== "test")
serve({ fetch: app.fetch, port: PORT }, (info) => {
  log.info("engine listening", { port: info.port, url: `http://localhost:${info.port}` });
});

// Tear down any forked, isolated worker subprocesses on shutdown.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    disposeIsolatedWorkers();
    process.exit(0);
  });
}

/**
 * Lightweight video connectivity probe. Never submits a real generation job:
 * generation is slow and billed per task, so "test connection" only verifies
 * the key and model existence. Uses GET /models (the OpenAI-compatible
 * standard for key + model-list validation); falls back to POSTing an empty
 * prompt to the video endpoint, which providers reject fast with a 4xx
 * validation error without doing any real work.
 */
async function probeVideo(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<{ ok: boolean; status?: number; error?: string; modality: "video"; endpoint?: string; note?: string }> {
  const PROBE_TIMEOUT_MS = 15_000;
  const modelsUrl = `${baseUrl}/models`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let res: Response;
  try {
    // Provider probes hit a user-supplied baseUrl — leave through the guarded
    // egress (audit H5 SSRF half).
    res = await guardedFetch(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") return { ok: false, modality: "video", error: "连接超时（15s）" };
    return { ok: false, modality: "video", error: sanitizeError((err as Error).message) };
  } finally {
    clearTimeout(timer);
  }

  if (res.ok) {
    const json = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
    const ids = (json.data ?? []).map((m) => m.id).filter(Boolean);
    if (ids.length > 0) {
      if (ids.includes(model)) return { ok: true, modality: "video", endpoint: modelsUrl };
      return { ok: false, modality: "video", endpoint: modelsUrl, error: `模型 ${model} 不在服务商模型列表中` };
    }
    // Key + endpoint responded, but no model list was returned.
    return { ok: true, modality: "video", endpoint: modelsUrl, note: "服务商未返回模型列表，仅校验到 Key 与端点可达" };
  }

  if (res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, modality: "video", error: `HTTP ${res.status}: ${sanitizeError(text.slice(0, 300))}` };
  }

  // No GET /models on this provider (404/405): POST an empty prompt to the
  // video endpoint. Valid providers reject it fast with a 4xx validation
  // error — that proves the endpoint and key without starting a job.
  if (res.status === 404 || res.status === 405) {
    const postController = new AbortController();
    const postTimer = setTimeout(() => postController.abort(), PROBE_TIMEOUT_MS);
    try {
      const postRes = await guardedFetch(`${baseUrl}${MODALITY_ENDPOINT.video}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt: "" }),
        signal: postController.signal,
      });
      if (postRes.status === 400 || postRes.status === 422) {
        return {
          ok: true,
          modality: "video",
          endpoint: `${baseUrl}${MODALITY_ENDPOINT.video}`,
          note: "端点可达且 Key 有效（空 prompt 被参数校验拒绝，未触发生成）",
        };
      }
      if (postRes.status === 401 || postRes.status === 403) {
        return { ok: false, status: postRes.status, modality: "video", error: `HTTP ${postRes.status}: API Key 无效` };
      }
      if (postRes.ok) {
        return { ok: false, modality: "video", error: "服务商接受了空 prompt（返回 2xx），疑似真实触发生成；请改用运行时验证" };
      }
      const text = await postRes.text().catch(() => "");
      return { ok: false, status: postRes.status, modality: "video", error: `HTTP ${postRes.status}: ${sanitizeError(text.slice(0, 300))}` };
    } finally {
      clearTimeout(postTimer);
    }
  }

  const text = await res.text().catch(() => "");
  return { ok: false, status: res.status, modality: "video", error: `HTTP ${res.status}: ${sanitizeError(text.slice(0, 300))}` };
}

/**
 * Minimal request body for a connectivity probe, shaped per modality. Video is
 * excluded: it probes via GET /models and never sends a generation request.
 */
function buildTestPayload(modality: Exclude<Modality, "video">, model: string): Record<string, unknown> {
  switch (modality) {
    case "text":
      return { model, messages: [{ role: "user", content: "hi" }], max_tokens: 1, stream: false };
    case "image":
      return { model, prompt: "test", n: 1, size: "1024x1024" };
    case "embedding":
      return { model, input: "test" };
    case "audio":
      // OpenAI-compatible TTS. A one-character input keeps the response tiny.
      return { model, input: ".", voice: "alloy" };
  }
}

function redactKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 6)}${"*".repeat(6)}${key.slice(-4)}`;
}

/** A key that came back from the UI and looks redacted, not the real secret. */
function isRedactedKey(key: string | undefined): boolean {
  if (!key) return true;
  return key.includes("*") || key.includes("...");
}
