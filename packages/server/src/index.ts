import { registerAuthRoutes } from "./routes/auth.js";
import { registerGraphsRoutes } from "./routes/graphs.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerFeedbackRoutes } from "./routes/feedback.js";
import { registerAnnouncementsRoutes } from "./routes/announcements.js";
import { registerRunsRoutes } from "./routes/runs.js";
import { registerOpsRoutes } from "./routes/ops.js";
import { AUTH_COOKIE, demoLocked, isSafeRedirectUri } from "./routes/shared.js";
export { isSafeRedirectUri } from "./routes/shared.js";

// Load `.env` first so every later module sees env vars (e.g. AGNES_API_KEY).
import "./load-env.js";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { randomUUID, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { applyCors, applySecurityHeaders } from "./security.js";
import {
  AD_LAW_BANNED_WORDS,
  DEFAULT_PLAN,
  PLATFORM_PROFILES,
  buildTimeline,
  compile,
  ConnectorConfig,
  envelope,
  getTemplate,
  Graph,
  instantiateTemplate,
  parseCsv,
  replay,
  rowsToCsv,
  TEMPLATES,
  TriggerConfig,
  unpricedModels,
  SkillPermissions,
  type RunEvent,
} from "@agent-world/core";
import { openDatabase, backfillExistingData, contentHash, SCHEMA_VERSION, type Db } from "./db.js";
import { parseGraphSnapshot, SnapshotLikeSchema, type SnapshotLike } from "./graph-snapshot.js";
import { errMsg, asRecord, errorStatus, isAbortError } from "./safe-utils.js";
import { z } from "zod";
import { counter, gauge, histogram, renderMetrics } from "./metrics.js";
import {
  addErrorSink,
  createWebhookErrorSink,
  errorSinkStatus,
  installProcessGuards,
  recentErrors,
  recordError,
} from "./errors.js";
import { findGraphIdByName as findGraphIdByNameCore } from "./graphs-name.js";
import { ArtifactStore } from "./artifact-store.js";
import { log } from "./logger.js";
import { MaintenanceLoop } from "./maintenance.js";
import { startRun, resumeRun, forkRun, RunStartError, type ResumeAction } from "./run.js";
import { buildFailureInfo, diagnoseRun } from "./diagnose.js";
import { runBatch } from "./batch.js";
import { listPendingReviews, parseDecisions } from "./reviews.js";
import { TriggerService, TriggerError, secretEqual, WEBHOOK_TIMESTAMP_WINDOW_MS } from "./triggers.js";
import { TriggerScheduler } from "./scheduler.js";
import { resolveConnector } from "./connectors.js";
import { startABExperiment } from "./ab.js";
import { quotaResponseBody } from "./dispatch-gate.js";
import { loadCrossGraphEdges } from "./crossGraphService.js";
import {
  loadConfig,
  saveConfig,
  bindSettingsStore,
  builtinCodeDefaults,
  normalizeBaseUrl,
  modalityOf,
  failoverCandidates,
  endpointFor,
  MODALITY_ENDPOINT,
  DEFAULT_MODALITY,
  MODALITIES,
  AppConfigSchema,
  type AppConfig,
  type Modality,
} from "./config.js";
import {
  PlatformCatalogSchema,
  bindCatalogStore,
  catalogPriceGaps,
  describeCatalogChange,
  mergeBuiltinCatalog,
  platformCatalog,
  refreshPlatformCatalog,
  writePlatformCatalog,
  type PlatformCatalog,
} from "./builtin-catalog.js";
import { GuardedFetchError, guardedFetch, hostIsInternal } from "./ssrf.js";
import { routingWorker, assertBootWorkerEnv } from "./providers/index.js";
import { WorkerRegistry } from "./worker-plugins.js";
import { connectMcpServer, registerMcpTools, type McpClient, type McpServerSpec } from "./mcp.js";
import { closeAllUserMcpServers, connectUserMcpServer, ensureUserMcpServers, userMcpStatus } from "./mcp-pool.js";
import { disposeIsolatedWorkers } from "./isolation.js";
import { registerSkill, setMemoryBackend, listBuiltinSkills } from "./skills/registry.js";
import { loadUserSkills } from "./skills/user-skills.js";
import { SQLiteMemoryBackend, NoopMemoryBackend, extractKnowledgeFromRun } from "./memory.js";
import { fileURLToPath } from "node:url";
import { sanitizeError } from "./sanitize.js";
import { decryptString, encryptString, getEncryptionRing } from "./at-rest.js";
import { publishToChannel } from "./publish.js";
import { hashPassword, verifyPassword, signToken, verifyToken, REMEMBER_MAX_AGE_SEC } from "./auth.js";
import { audit, changedFields } from "./audit.js";
import { RateLimiter } from "./rate-limit.js";
import {
  DEMO_QUOTA,
  DEMO_TTL_MS,
  type DemoFeature,
} from "./demo.js";
import { graphAccessRole, requireGraph, visibleGraphs, requireRun, runAccessRole, artifactAccessRole, hasAtLeast } from "./rbac.js";

const PORT = Number(process.env.PORT ?? 8791);
/** Cap for /api/proxy responses (audit L7): 25 MiB of fetched body. */
const MAX_PROXY_RESPONSE_BYTES = 25 * 1024 * 1024;
/** Absolute origin advertised to models so artifact links are fully qualified. */
const PUBLIC_URL = (process.env.AGENT_WORLD_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(
  /\/+$/,
  "");
// DB_DRIVER switch (design-postgres-migration.md §5.3 阶段 3): "sqlite"
// (default) opens the local file; "postgres" connects via DATABASE_URL /
// PG_* env. Unknown values fail closed inside openDatabase().
const db = await openDatabase();
// Legacy pre-auth SQLite databases need a default owner backfill; a fresh
// PostgreSQL deployment starts authenticated, so skip it there.
if (db.kind === "sqlite") {
  await backfillExistingData(db as any);
}
// Settings are per-user rows in the DB; config.ts reads/writes through this
// store while the legacy file config remains the shared baseline for users
// who have never saved settings. One adapter, bound twice: the operator model
// catalog lives in a reserved row of the same table, so it inherits the
// encryption at rest without a second crypto path.
const settingsStoreAdapter = {
  // Settings rows store the whole AppConfig JSON, including provider API keys.
  // Encrypt at rest (audit L3); legacy plaintext rows decrypt as-is and are
  // re-encrypted on the next save.
  get: async (userId: string) => {
    const raw = await db.getSettings(userId);
    return raw ? decryptString(raw) : null;
  },
  set: async (userId: string, data: string) => await db.saveSettings(userId, encryptString(data)),
};
bindSettingsStore(settingsStoreAdapter);
bindCatalogStore(settingsStoreAdapter);
const artifacts = ArtifactStore.fromEnv();

// First-run onboarding is handled by the web UI (shows a template picker when
// no graphs exist). We no longer seed a default graph on startup — existing
// databases keep their graphs, fresh installs start empty.

// A server restart cannot resume in-memory generators; mark orphaned runs so the
// UI doesn't show them as forever-running.
await db.markZombiesInterrupted(Date.now());

// Knowledge base / archive (5.2). FTS5-backed full-text search over
// extracted run outputs; powers the `archive_search` skill card.
// FTS5 is SQLite-only — under DB_DRIVER=postgres the knowledge base degrades
// to an honest no-op (empty results) until a PG backend exists.
// (design-postgres-migration.md §5.3 阶段 3 边界)
const memory = db.kind === "postgres" ? new NoopMemoryBackend() : new SQLiteMemoryBackend(db as any);
if (db.kind === "postgres") {
  log.warn("DB_DRIVER=postgres: knowledge base (FTS5) not available — archive_search and knowledge panel return empty until a PG backend lands");
}
await memory.init();
setMemoryBackend(memory);

// 启动自检：`WORKER=fake` 是 demo/测试的合法开关，但在生产里它让每一条 run 都
// 编造文本并报 done——比派发时静默假成功更彻底。生产直接拒绝启动。
assertBootWorkerEnv();

const worker = routingWorker();
const workerRegistry = new WorkerRegistry(worker);
const workersDir = process.env.WORKERS_DIR ?? fileURLToPath(new URL("workers", import.meta.url));

// 启动自检：failover 默认开启，但没填 BACKUP_* 时系统「静默不告警」——运维以为已挂
// 灾备其实没挂。这里显式点出来：agnes 真挂了文本 run 不会切到备份。填齐三项才解除。
{
  try {
    const bootCfg = await loadConfig();
    if (bootCfg.failover?.enabled !== false) {
      const targets = failoverCandidates(bootCfg, bootCfg.defaultModel);
      if (targets.length < 2) {
        log.warn(
          "provider failover is enabled but no usable backup is configured: text runs will NOT fail over on an agnes outage. Set BACKUP_BASE_URL + BACKUP_API_KEY + BACKUP_MODELS (see .env.example).",
        );
      } else {
        log.info("provider failover armed", { defaultModelTargets: targets.map((t) => `${t.name}:${t.model}`) });
      }
    }
  } catch (bootCheckErr) {
    log.warn("boot failover self-check skipped", { error: errMsg(bootCheckErr) });
  }
}


// 启动自检：可观测性的两个默认值在「内网单机」口径下是对的，在「端口可达」口径下
// 不是。`/metrics` 无 token 就能读（RED + run 计数 + 成本累计），`serve()` 默认绑
// 全网卡。这里不改变默认（改了会打断现有 LAN 部署），只在生产把话说出来。
if ((process.env.NODE_ENV === "production" || process.env.AGENT_WORLD_ENV === "production") && !(process.env.METRICS_TOKEN ?? "").trim()) {
  log.warn(
    "GET /metrics is unauthenticated while running in production: anyone who can reach the port reads run counts and cost totals. Set METRICS_TOKEN (scrape with `authorization: {credentials: ...}`) and/or BIND_HOST=127.0.0.1 if a reverse proxy is the only thing that should reach the server.",
  );
}

/** Live runs, so a reconnecting client can attach mid-flight. */
const live = new Map<
  string,
  { events: RunEvent[]; done: boolean; controller: AbortController }
>();

/** Automatic triggers (webhook/cron/event/batch). Restored from persisted graphs. */
const triggers = new TriggerService({
  db: {
    listAllGraphs: async () => await db.listAllGraphs(),
    getGraphById: async (id: string) => await db.getGraphById(id),
    saveGraphUnscoped: async (graph: any, at: number) => await db.saveGraphUnscoped(graph, at),
  },
  startRun: async (graph, opts) => {
    const ownerId = await db.getGraphOwnerId(graph.id) ?? "";
    return startRun({
      db,
      userId: ownerId,
      worker,
      artifacts,
      live,
      graph,
      publicUrl: PUBLIC_URL,
      ...opts,
      onFinish: async (gid, status) => {
        void triggers.onGraphFinished(gid, status);
        // Engine success status is "done" (not "completed") — extract knowledge
        // once a run settles as success or failure.
        if (status === "done" || status === "failed") {
          try {
            const recent = await db.listRunsByGraphUnscoped(gid, 1);
            if (recent.length > 0) {
              const run = recent[0]!;
              const events = await db.events(run.id as string);
              const graphName = (await db.getGraphById(gid))?.name ?? gid;
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
/** Schedules cron triggers; arms timers after triggers are restored. */
const scheduler = new TriggerScheduler(triggers, (err) =>
  log.error("trigger scheduler", { error: errMsg(err) }),
);
// restore() is async (loads triggers from DB); start() must run after it
// completes, otherwise list() is empty and no cron timers are armed.
void triggers
  .restore()
  .then(() => scheduler.start())
  .catch((err) => log.error("trigger restore failed", { error: errMsg(err) }));

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

// --- Metrics (RED) ---
// In-process counters/histograms, exposed at GET /metrics. Single-instance
// aggregation (see metrics.ts); no external scraper required to be useful.
const httpRequestsTotal = counter("http_requests_total", "HTTP requests received, by method and status");
const httpErrorsTotal = counter("http_errors_total", "HTTP responses with status >= 500");
const httpRequestDurationMs = histogram("http_request_duration_ms", "HTTP request latency in milliseconds", [10, 50, 100, 250, 500, 1000, 2500, 5000]);

// --- Request log middleware ---
// Records every /api call with latency. Runs before auth so 401s are visible,
// but never logs query params (they can carry tokens, L1) or SSE bodies.
// Registered BEFORE all routes so every /api handler (including /api/health)
// is observed — Hono middleware only applies to routes registered after it.
app.use("/api/*", async (c, next) => {
  const start = Date.now();
  const path = c.req.path;
  await next();
  const latencyMs = Date.now() - start;
  const status = c.res.status;
  httpRequestsTotal.inc({ method: c.req.method, status: String(status) });
  httpRequestDurationMs.observe(latencyMs);
  if (status >= 500) httpErrorsTotal.inc();
  const record: Record<string, unknown> = {
    method: c.req.method,
    path,
    status,
    latencyMs,
  };
  const uid = c.get("userId") as string | undefined;
  if (uid) record.userId = uid;
  if (status >= 500) log.error("http request", record);
  else if (status >= 400) log.warn("http request", record);
  else log.info("http request", record);
});

// --- Global error capture (errors.ts) ---
// Handlers return explicit statuses, so a thrown error is a genuine 5xx bug,
// not an expected 4xx. Capture message/stack (method/path only — never
// headers/body/query, which can carry tokens) before rendering a JSON 500. A
// future Hono HTTPException carrying a 4xx status passes through without
// polluting the error feed.
app.onError((err, c) => {
  const status = errorStatus(err) ?? 500;
  if (status >= 500) {
    recordError("request", err, { method: c.req.method, path: c.req.path });
    return c.json({ error: "internal server error" }, 500);
  }
  const st = status === 400 || status === 401 || status === 403 || status === 404 || status === 409 ? status : 500;
  return c.json({ error: errMsg(err) || "error" }, st);
});

/** Deployment identity: preferred from CI-injected env (`AGENT_WORLD_GIT_BRANCH`
 *  / `AGENT_WORLD_GIT_COMMIT`), else a live `git` checkout (Hasee is a
 *  `git clone`), else null. Exposed by `/api/health` so a plain browser hit
 *  reveals the exact running code version without SSHing in. */
const GIT_META: { branch: string | null; commit: string | null } = (() => {
  const branch = process.env.AGENT_WORLD_GIT_BRANCH ?? null;
  const commit = process.env.AGENT_WORLD_GIT_COMMIT ?? null;
  if (branch && commit) return { branch, commit };
  try {
    const read = (cmd: string) =>
      execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return { branch: read("git branch --show-current") || null, commit: read("git rev-parse --short HEAD") || null };
  } catch {
    return { branch, commit };
  }
})();

// --- Metrics endpoint (Prometheus text format) ---
// Aggregated in-process (see metrics.ts). A plain GET reveals RED + run
// business metrics (cost totals, failure counts, per-model spend), so it is not
// a free public read: with `METRICS_TOKEN` set it requires
// `Authorization: Bearer <token>`. Leaving it unset keeps the historical
// open endpoint for a co-located scraper -- which is fine only while nothing
// outside the trusted network can reach the port; the boot self-check below
// says so out loud in production rather than letting it be a surprise.
app.get("/metrics", (c) => {
  const want = (process.env.METRICS_TOKEN ?? "").trim();
  if (want) {
    const header = c.req.header("authorization") ?? "";
    const sent = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!sent || !secretEqual(sent, want)) {
      return c.text("unauthorized", 401, { "WWW-Authenticate": "Bearer" });
    }
  }
  return c.text(renderMetrics());
});

app.get("/api/health", async (c) => {
  // Readiness checks report STATE only ("ok"/"loaded"/"configured"), never the
  // underlying secret values, keys, or connection strings.
  let dbStatus: string;
  try {
    dbStatus = await db.ping() ? "ok" : "error";
  } catch {
    dbStatus = "error";
  }
  let encryptionStatus: string;
  try {
    encryptionStatus = getEncryptionRing().length > 0 ? "loaded" : "missing";
  } catch {
    encryptionStatus = "error";
  }
  const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
  const jwtStatus =
    process.env.JWT_SECRET || existsSync(join(dirname(dbFile), ".jwt-secret"))
      ? "loaded"
      : "missing";
  const agnes = (await loadConfig()).providers.agnes;
  const agnesStatus = agnes?.enabled === false ? "disabled" : agnes?.apiKey ? "configured" : "missing";
  // Readiness gate（P1 优雅启动）：关键就绪检查全通过才 200，否则 503 让反代/
  // 探针把流量挡在未就绪实例外。`ok` 只反映「能否接流量」，checks 仍报状态词、不吐值。
  const ready = dbStatus === "ok" && encryptionStatus === "loaded" && jwtStatus === "loaded";
  return c.json(
    {
      ok: ready,
      env: process.env.AGENT_WORLD_ENV ?? process.env.NODE_ENV ?? "development",
      branch: GIT_META.branch,
      commit: GIT_META.commit,
      checks: {
        db: dbStatus,
        jwtSecret: jwtStatus,
        encryption: encryptionStatus,
        providers: { agnes: agnesStatus },
      },
    },
    ready ? 200 : 503,
  );
});

// --- Auth routes (no auth required) ---

/** Resolve the authenticated user and return a 403 response when it is a demo.
 *  Usage at the top of a locked route: `const b = await blockDemo(c,"x"); if (b) return b;` */
async function blockDemo(c: any, feature: DemoFeature) {
  const u = await db.findUserById(c.get("userId") as string);
  return u?.is_demo === 1 ? demoLocked(c, feature) : null;
}

// --- Route-domain registration (audit P2-2 split) ---
const routeContext = {
  db,
  live,
  artifacts,
  memory,
  worker,
  workerRegistry,
  triggers,
  scheduler,
  PUBLIC_URL,
  MAX_PROXY_RESPONSE_BYTES,
  blockDemo,
} satisfies import("./routes/ctx.js").RouteContext;
registerAuthRoutes(app, routeContext);
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  // Skip auth for public endpoints
  if (path === "/api/health" || path.startsWith("/api/auth/")) return next();
  // Webhook endpoints use their own secret-based auth
  if (/\/api\/graphs\/[^/]+\/webhook$/.test(path)) return next();
  if (/\/api\/metrics\/webhook\/[^/]+$/.test(path)) return next();
  // Stripe webhook authenticates via its Stripe-Signature header, not a cookie.
  if (path === "/api/billing/webhook") return next();

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
  // Accounts an owner opened hold a one-time password until it is replaced;
  // refuse everything except /api/auth/* (exempt above, including the
  // change-password route) and the secret-based webhooks. Keyed on a DB read,
  // not on the JWT, so clearing the flag takes effect on the next request
  // without re-signing anything — same reasoning as the guards above this line
  // that re-read the role rather than trusting the token.
  const account = await db.findUserById(payload.userId);
  if (account?.must_change_password === 1) {
    return c.json(
      { error: "password_change_required", message: "Password change required before continuing", code: "PASSWORD_CHANGE_REQUIRED" },
      403,
    );
  }
  await next();
});

// The catalog is what SkillPicker offers for mounting, so it has to include the
// caller's own cards and the tools their MCP servers reported — builtins first,
// same global-first order resolveSkill uses at run time.

registerGraphsRoutes(app, routeContext);
registerSettingsRoutes(app, routeContext);
registerAdminRoutes(app, routeContext);
registerBillingRoutes(app, routeContext);
registerFeedbackRoutes(app, routeContext);
registerAnnouncementsRoutes(app, routeContext);
registerRunsRoutes(app, routeContext);
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
/**
 * MCP connection state, split by who configured it: `operator` servers come
 * from the MCP_SERVERS env var and are process-global; `user` servers are the
 * caller's own, pooled per user. Only the latter are editable through the API.
 */
app.get("/api/mcp", async (c) => {
  const userId = c.get("userId");
  const cfg = await loadConfig(userId);
  await ensureUserMcpServers(userId, cfg.mcpServers);
  return c.json({ operator: mcpStatus, user: userMcpStatus(userId) });
});

/**
 * Connect (or reconnect) one of the caller's own MCP servers and report what
 * came back — tool count on success, the reason on failure. The UI calls this
 * right after saving, which is the "试连" half of save-then-test, and again
 * behind the manual reconnect button. There is no automatic retry.
 */
app.post("/api/mcp/:id/connect", async (c) => {
  const userId = c.get("userId");
  const d = await blockDemo(c, "remote_mcp"); if (d) return d;
  const id = c.req.param("id");
  const cfg = await loadConfig(userId);
  const server = cfg.mcpServers?.find((s) => s.id === id);
  if (!server) return c.json({ error: `unknown MCP server: ${id}` }, 404);
  const status = await connectUserMcpServer(userId, server);
  // Audit the attempt, not the credentials: the URL is the user's own config,
  // the headers never appear here.
  audit(db, userId, "mcp.connect", {
    objectType: "mcp_server",
    objectId: id,
    detail: { transport: server.transport, connected: status.connected, toolCount: status.toolCount },
  });
  return c.json(status, status.connected ? 200 : 502);
});

registerOpsRoutes(app, routeContext);
app.get("/api/eval", async (c) => {
  const userId = c.get("userId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const graphId = c.req.query("graphId");
  return c.json(
    await db.evalReport({
      userId,
      graphId: graphId || undefined,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
    }),
  );
});

app.get("/api/eval.csv", async (c) => {
  const userId = c.get("userId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const graphId = c.req.query("graphId");
  const rep = await db.evalReport({
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

app.post("/api/connectors/test", async (c) => {
  const d = await blockDemo(c, "custom_connector"); if (d) return d;
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
    fromRunId?: string;
  };
  // G5.1: with `fromRunId` the caller only supplies the *new* prompt(s) (≥1);
  // arm A is auto-filled with the current production prompt. Without it the
  // legacy all-manual path still requires ≥2 fully-specified variants.
  const sampling = typeof body.fromRunId === "string" && body.fromRunId.length > 0;
  const minVariants = sampling ? 1 : 2;
  if (
    !body.graphId ||
    !body.targetNodeId ||
    !Array.isArray(body.variants) ||
    body.variants.length < minVariants
  ) {
    return c.json(
      { error: sampling
        ? "需要 graphId、targetNodeId、fromRunId 与至少 1 个新 prompt variant"
        : "需要 graphId、targetNodeId 与至少 2 个 variants" },
      400,
    );
  }
  const access = await requireGraph(db, userId, body.graphId, "editor");
  if (!access) {
    return await graphAccessRole(db, userId, body.graphId) == null
      ? c.json({ error: "not found" }, 404)
      : c.json({ error: "forbidden", message: "只读协作者不能运行产线" }, 403);
  }
  const ownerId = access.graphOwnerId;
  const graph = await db.getGraph(body.graphId, ownerId);
  if (!graph) return c.json({ error: "graph not found" }, 404);
  const target = graph.nodes.find((n) => n.id === body.targetNodeId);
  if (!target) return c.json({ error: "target node not found" }, 404);
  if (target.kind !== "textGen") {
    return c.json({ error: "A/B 目标必须是厂房(agent)节点" }, 400);
  }

  // Resolve the variant list and starting input. In sampling mode every check
  // is fail-closed: any problem returns before a single arm run is created.
  let variants = body.variants;
  let input = body.input;
  if (sampling) {
    // Visibility follows the same rule as the run timeline; an invisible run
    // returns 404 so its existence is never leaked.
    if (!await requireRun(db, userId, body.fromRunId!, "viewer")) {
      return c.json({ error: "not found" }, 404);
    }
    const sample = await db.getRunById(body.fromRunId!);
    if (!sample) return c.json({ error: "not found" }, 404);
    if (sample.graph_id !== body.graphId) {
      return c.json({ error: "取样运行不属于当前产线，不能作为 A/B 样本" }, 422);
    }
    if (sample.status !== "done") {
      return c.json({ error: "只能对已完成(done)的运行取样做 A/B 对比" }, 422);
    }
    let sampleGraph: Graph | null = null;
    try {
      sampleGraph = parseGraphSnapshot(sample.snapshot);
    } catch {
      sampleGraph = null;
    }
    const sampleTarget = sampleGraph?.nodes.find((n) => n.id === body.targetNodeId);
    if (!sampleTarget || sampleTarget.kind !== "textGen") {
      return c.json({ error: "sample_target_node_missing", message: "Target factory node not found in the sampled run snapshot" }, 422);
    }
    const projectedInput = (sample.input ?? "").trim();
    if (!projectedInput) {
      return c.json({ error: "sample_input_missing", message: "Sampled run has no usable starting input; fill in manually instead" }, 422);
    }
    // Arm A = current production prompt (read from the live graph, not the
    // snapshot, so it reflects what production actually uses right now); the
    // caller's prompts become arm B/C/… . Input is always the sampled run's.
    const currentPrompt = target.textGen?.prompt ?? "";
    variants = [currentPrompt, ...body.variants];
    input = sample.input ?? "";
  }

  try {
    const { abGroup, arms } = await startABExperiment(db, worker, {
      userId: ownerId,
      graph,
      targetNodeId: body.targetNodeId,
      variants,
      budgetUsd: body.budgetUsd ?? null,
      input,
      artifacts,
      publicUrl: PUBLIC_URL,
    });
    return c.json({ abGroup, arms });
  } catch (e) {
    // 实验一次建 N 条 run，闸门按这一次用户动作评估一次；被拦要回 402 引导，
    // 而不是被下面的 sanitizeError 折成 400（前端就当普通请求错误处理掉）。
    const quota = quotaResponseBody(e);
    if (quota) return c.json(quota, 402);
    // 同理，模型不可派发的 422 也不该被 sanitizeError 折成 400。
    if (e instanceof RunStartError) return jsonResponse(e.status, { error: e.message, diagnostics: e.extra });
    return c.json({ error: sanitizeError(e) }, 400);
  }
});

app.get("/api/ab/:groupId", async (c) => {
  const userId = c.get("userId");
  const groupId = c.req.param("groupId");
  const graphId = await db.abGroupGraphId(groupId);
  if (!graphId || !await requireGraph(db, userId, graphId, "viewer")) return c.json({ error: "not found" }, 404);
  const ownerId = (await db.graphOwnerId(graphId))!;
  const report = await db.abReport(groupId, ownerId);
  if (!report) return c.json({ error: "not found" }, 404);
  return c.json(report);
});

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
    const rawCt = upstream.headers.get("content-type") ?? "application/octet-stream";
    // H8: this is an image proxy — it must never echo executable content types
    // (text/html, image/svg+xml, application/xhtml+xml, …) back same-origin,
    // otherwise a crafted URL is a reflected XSS. Force anything outside the
    // safe media set to octet-stream and mark nosniff so the browser never
    // sniffs/executes it.
    const safeCt = /^(image\/(?!svg)|video\/|audio\/)/i.test(rawCt)
      ? rawCt
      : "application/octet-stream";
    return new Response(buf, {
      headers: {
        "content-type": safeCt,
        "x-content-type-options": "nosniff",
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
  // Access inherits from the artifact's graph (design-rbac P1). Uploads not
  // yet attached to a run fall back to ownership (artifact's own user_id).
  if (await artifactAccessRole(db, userId, id) == null) return c.json({ error: "not found" }, 404);
  const meta = await db.getArtifactUnscoped(id);
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
    const ref = refId && refId !== meta.id ? await db.getArtifactUnscoped(refId) : null;
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
  return new Response(file.stream, { headers });
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
const McpSpecSchema = z
  .object({
    id: z.string().optional(),
    transport: z.enum(["stdio", "http", "sse"]).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
    danger: z.boolean().optional(),
    permissions: SkillPermissions.optional(),
  })
  .passthrough();

async function connectMcpServers(): Promise<void> {
  const raw = process.env.MCP_SERVERS;
  if (!raw) return;
  let rawServers: unknown;
  try {
    rawServers = JSON.parse(raw);
  } catch {
    log.warn("MCP_SERVERS is not valid JSON; skipping MCP setup");
    return;
  }
  if (!Array.isArray(rawServers)) {
    log.warn("MCP_SERVERS is not a JSON array; skipping MCP setup");
    return;
  }
  for (const entry of rawServers) {
    const parsed = McpSpecSchema.safeParse(entry);
    const id = String((entry && typeof entry === "object" && "id" in entry ? entry.id : undefined) ?? "mcp");
    if (!parsed.success) {
      log.warn("mcp spec invalid, skipping", { id, error: parsed.error.flatten() });
      continue;
    }
    const s = parsed.data;
    try {
      const transport = s.transport ?? "stdio";
      let spec: McpServerSpec;
      if (transport === "stdio") {
        spec = { transport: "stdio", command: s.command ?? "", args: s.args, env: s.env, danger: s.danger };
      } else {
        spec = { transport, url: s.url ?? "", headers: s.headers, danger: s.danger };
      }
      const client = connectMcpServer(spec);
      mcpClients.push(client);
      const tools = await registerMcpTools(
        id,
        client,
        registerSkill,
        s.permissions,
        s.danger,
      );
      mcpStatus.push({ id, tools: tools.map((t) => t.name), transport });
      log.info("mcp connected", { id, transport, tools: tools.map((t) => t.name) });
    } catch (err) {
      log.warn("mcp connect failed", { id, error: errMsg(err) });
    }
  }
}
if (process.env.NODE_ENV !== "test") void connectMcpServers();

if (process.env.NODE_ENV !== "test") {
  // One startup summary: what the server booted against. The key source and
  // ring size are named (env-keys|env|file) but the material itself is never
  // logged. A ring larger than 1 means a rotation is mid-flight: oldest keys
  // decrypt only, converge with scripts/rotate-reencrypt.ts then shrink it.
  const encryptionKeySource = process.env.AGENT_WORLD_ENCRYPTION_KEYS
    ? "env-keys"
    : process.env.AGENT_WORLD_ENCRYPTION_KEY
      ? "env"
      : "file"; // absent env falls back to the keyring file next to the DB
  log.info("server starting", {
    // DB_DRIVER=postgres connects via DATABASE_URL/PG_*; the sqlite path is
    // only meaningful (jwt-secret/keyring/log file locations) on that driver.
    dbDriver: db.kind,
    dbFile: db.kind === "sqlite" ? (process.env.DB_FILE ?? "agent-world.sqlite") : undefined,
    schemaVersion: SCHEMA_VERSION,
    encryptionKeySource,
    encryptionKeyringSize: getEncryptionRing().length,
    logFile: process.env.LOG_FILE ?? "<db-dir>/logs/server.log",
  });
  // 运营者内置模型目录（design-model-catalog ④）：必须在校费缺口自检之前加载，
  // 否则那份报告会描述代码默认目录而不是当前生效的那一份。
  const catalogBoot = await refreshPlatformCatalog();
  if (catalogBoot.error) log.warn("model catalog not loaded", { error: catalogBoot.error });
  const priceGaps = unpricedModels((await loadConfig()).providers);
  if (priceGaps.length > 0) {
    // Not fatal — a dev box routinely has half the price cards blank. But cost
    // metering for an unpriced model returns 0 with no error, and the missing
    // price cannot be applied retroactively, so say it loudly at boot.
    log.warn("models with an incomplete price card will under-meter cost", {
      none: priceGaps.filter((g) => g.level === "none").map((g) => `${g.provider}/${g.model}`),
      partial: priceGaps
        .filter((g) => g.level === "partial")
        .map((g) => `${g.provider}/${g.model} (missing ${g.missing.join(",")})`),
    });
  }
  // events + audit_log 保留清理：启动即清一次，之后每 6h 续清
  // （design-audit-log §5 / design-scaling §2.1）。单轮失败只 warn。
  const maintenance = new MaintenanceLoop(db);
  maintenance.start();
  // BIND_HOST pins the listening interface. Unset keeps Node's default (all
  // interfaces) because the current deployments are reached over the LAN --
  // changing the default would break them. A box that only ever talks to a
  // local nginx/Prometheus should set 127.0.0.1 and stop exposing :8791.
  const bindHost = process.env.BIND_HOST?.trim() || undefined;
  const server = serve({ fetch: app.fetch, port: PORT, hostname: bindHost }, (info) => {
    log.info("engine listening", {
      port: info.port,
      hostname: bindHost ?? "0.0.0.0 (all interfaces)",
      url: `http://localhost:${info.port}`,
    });
  });

  // Graceful shutdown（P1 优雅关闭）：SIGTERM（systemd restart / deploy.sh 触发）
  // 或 SIGINT 时——停接新请求 → 让在途 run 排空（超时 abort）→ 关 DB → 回收隔离
  // 子进程。避免 `systemctl restart` 把 running 的 run 硬杀成卡死状态。
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutdown started", { signal, inflightRuns: live.size });
    server.close();
    const graceMs = Number(process.env.AGENT_WORLD_SHUTDOWN_GRACE_MS ?? 10_000);
    const deadline = Date.now() + graceMs;
    const drain = setInterval(async () => {
      if (live.size > 0 && Date.now() < deadline) return;
      clearInterval(drain);
      maintenance.stop();
      for (const entry of live.values()) entry.controller.abort();
      disposeIsolatedWorkers();
      // Release MCP transports too: the stdio ones own a child process, so
      // skipping this leaks a subprocess past our own exit.
      for (const client of mcpClients) {
        try {
          client.close();
        } catch {
          /* already dead */
        }
      }
      closeAllUserMcpServers();
      try {
        await db.close();
      } catch {
        /* already closed */
      }
      log.info("shutdown complete", { abortedRuns: live.size });
      process.exit(0);
    }, 100);
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => shutdown(sig));
  }

  // Process-level error guards (errors.ts): retain uncaughtException /
  // unhandledRejection in the error feed. After an uncaught exception the V8
  // state is undefined, so drain in-flight runs and exit for the supervisor
  // (systemd) to restart a clean process; rejections are recorded but
  // non-fatal. Optionally fan errors out to a webhook relay (Sentry/Grafana/
  // self-hosted intake) without adding a tracker SDK to the self-hosted build.
  const sinkStatus = errorSinkStatus(process.env);
  if (sinkStatus.configured) {
    addErrorSink(createWebhookErrorSink({ url: process.env.ERROR_REPORT_WEBHOOK_URL! }));
    log.info("error webhook sink enabled", { url: process.env.ERROR_REPORT_WEBHOOK_URL });
  } else if (sinkStatus.warn) {
    // 告警的生产端早就有（环形缓冲 + /api/admin/errors + 这个 sink 接口），缺的一直
    // 是消费端。不设 sink 时崩溃记录随进程一起消失——第一次真事故才发现没人知道
    // 自己挂过。启动时说出来，而不是等出事。
    log.warn(sinkStatus.warn);
  }
  installProcessGuards({ onFatal: () => shutdown("uncaughtException") });
}
