import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  compile,
  envelope,
  getTemplate,
  Graph,
  instantiateTemplate,
  replay,
  TEMPLATES,
  TriggerConfig,
  type RunEvent,
} from "@agent-world/core";
import { openDb } from "./db.js";
import { ArtifactStore } from "./artifact-store.js";
import { log } from "./logger.js";
import { execute, resume } from "./engine.js";
import { startRun, RunStartError } from "./run.js";
import { TriggerService, TriggerError } from "./triggers.js";
import { TriggerScheduler } from "./scheduler.js";
import { startABExperiment } from "./ab.js";
import { SEED_GRAPH } from "./seed.js";
import {
  loadConfig,
  saveConfig,
  normalizeBaseUrl,
  modalityOf,
  MODALITY_ENDPOINT,
  DEFAULT_MODALITY,
  type AppConfig,
  type Modality,
} from "./config.js";
import { routingWorker } from "./providers/index.js";
import { sanitizeError } from "./sanitize.js";
import { listBuiltinSkills } from "./skills/registry.js";

const PORT = Number(process.env.PORT ?? 8791);
const db = openDb(process.env.DB_FILE ?? "agent-world.sqlite");
const artifacts = new ArtifactStore(process.env.ARTIFACT_DIR ?? ArtifactStore.defaultPath());

if (!db.getGraph(SEED_GRAPH.id)) db.saveGraph(SEED_GRAPH, Date.now());

// A server restart cannot resume in-memory generators; mark orphaned runs so the
// UI doesn't show them as forever-running.
db.markZombiesInterrupted(Date.now());

const worker = routingWorker();

/** Live runs, so a reconnecting client can attach mid-flight. */
const live = new Map<
  string,
  { events: RunEvent[]; done: boolean; controller: AbortController }
>();

/** Automatic triggers (webhook/cron/event/batch). Restored from persisted graphs. */
const triggers = new TriggerService({
  db,
  startRun: (graph, opts) =>
    startRun({
      db,
      worker,
      artifacts,
      live,
      graph,
      ...opts,
      onFinish: (gid, status) => {
        void triggers.onGraphFinished(gid, status);
      },
      onArtifact: (aid) => {
        void triggers.onArtifact(aid);
      },
    }),
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

const app = new Hono();
app.use("/*", cors());

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/skills", (c) => c.json(listBuiltinSkills()));

app.get("/api/graphs", (c) => c.json(db.listGraphs()));

app.get("/api/templates", (c) =>
  c.json(
    TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
    })),
  ),
);

app.post("/api/graphs", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    from?: string;
    template?: string;
  };
  const id = randomUUID();
  let graph: Graph;
  if (body.template) {
    const tpl = getTemplate(body.template);
    if (!tpl) return c.json({ error: "template not found" }, 404);
    graph = instantiateTemplate(tpl, {
      id,
      name: body.name?.trim() || tpl.name,
    });
  } else if (body.from) {
    const src = db.getGraph(body.from);
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
  } else {
    graph = {
      id,
      name: body.name?.trim() || "新产线",
      nodes: [],
      edges: [],
    };
  }
  db.saveGraph(graph, Date.now());
  return c.json(db.getGraph(id), 201);
});

app.get("/api/graphs/:id", (c) => {
  const graph = db.getGraph(c.req.param("id"));
  return graph ? c.json(graph) : c.json({ error: "not found" }, 404);
});

app.delete("/api/graphs/:id", (c) => {
  db.deleteGraph(c.req.param("id"));
  return c.json({ ok: true });
});

app.put("/api/graphs/:id", async (c) => {
  const parsed = Graph.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // Optimistic concurrency: a tab sends the version it last loaded via
  // If-Match. A mismatch means another tab (or session) saved first, so we
  // refuse instead of silently overwriting their edits.
  const ifMatch = c.req.header("if-match");
  const expectedVersion = ifMatch != null ? Number(ifMatch) : undefined;
  const result = db.saveGraph(parsed.data, Date.now(), expectedVersion);
  if (!result.ok) {
    return c.json(
      { error: "conflict", message: "该产线已在其他标签页被修改，请刷新后重试。", serverVersion: result.serverVersion },
      409,
    );
  }
  return c.json({ ok: true, version: result.version });
});

/** Compile without running — the canvas calls this to show diagnostics as you draw. */
app.post("/api/compile", async (c) => {
  const parsed = Graph.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  return c.json(compile(parsed.data));
});

app.get("/api/settings", (c) => {
  const cfg = loadConfig();
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
  const body = (await c.req.json()) as Partial<AppConfig>;
  const current = loadConfig();
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
  const path = saveConfig(merged);
  return c.json({ ok: true, path });
});

/**
 * Test a provider connection without saving. Accepts provider config in the
 * body so the user can verify before hitting save. Sends a minimal
 * non-streaming chat completion (max 1 token) and reports the result.
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
  if (body.providerName) {
    const saved = loadConfig().providers[body.providerName];
    if (saved) modality = body.modality ?? modalityOf(saved, model);
  }

  // The UI holds a redacted key for already-saved providers. If the caller did
  // not type a fresh key (empty or looks redacted), resolve the real key from
  // the saved config on the server.
  const looksRedacted = !apiKey || isRedactedKey(apiKey);
  if (looksRedacted && body.providerName) {
    const saved = loadConfig().providers[body.providerName];
    if (saved?.apiKey && !isRedactedKey(saved.apiKey)) apiKey = saved.apiKey;
    else if (!saved) {
      return c.json({ ok: false, error: `Provider "${body.providerName}" 未保存，请先添加并保存` }, 400);
    }
  }

  if (!apiKey || isRedactedKey(apiKey)) {
    return c.json({ ok: false, error: "API Key 未配置或已失效，请重新填写" }, 400);
  }

  const endpoint = MODALITY_ENDPOINT[modality];
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
    const res = await fetch(`${baseUrl}${endpoint}`, {
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
  const limit = Number(c.req.query("limit") ?? 50);
  const offset = Number(c.req.query("offset") ?? 0);
  return c.json(db.listRuns(limit, offset));
});

app.get("/api/costs", (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  return c.json(
    db.costReport({
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
    }),
  );
});

app.get("/api/costs.csv", (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const { byGraph, byNode, byDay } = db.costRows({
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
  const from = c.req.query("from");
  const to = c.req.query("to");
  const graphId = c.req.query("graphId");
  return c.json(
    db.evalReport({
      graphId: graphId || undefined,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
    }),
  );
});

app.post("/api/runs", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    graphId?: string;
    budgetUsd?: number | null;
    trigger?: string;
    input?: string;
    connectorValues?: Record<string, string>;
  };
  const graph = db.getGraph(body.graphId ?? SEED_GRAPH.id);
  if (!graph) return c.json({ error: "graph not found" }, 404);

  try {
    const { runId, diagnostics } = await startRun({
      db,
      worker,
      artifacts,
      live,
      graph,
      trigger: body.trigger ?? "manual",
      budgetUsd: body.budgetUsd ?? null,
      input: body.input,
      connectorValues: body.connectorValues,
      onFinish: (gid, status) => {
        void triggers.onGraphFinished(gid, status);
      },
      onArtifact: (aid) => {
        void triggers.onArtifact(aid);
      },
    });
    return c.json({ runId, diagnostics });
  } catch (e) {
    if (e instanceof RunStartError) {
      return jsonResponse(e.status, { error: e.message, diagnostics: e.extra });
    }
    throw e;
  }
});

// --- Trigger management + webhook ---
app.get("/api/graphs/:id/triggers", (c) => {
  const graphId = c.req.param("id");
  if (!db.getGraph(graphId)) return c.json({ error: "graph not found" }, 404);
  return c.json(triggers.listByGraph(graphId));
});

app.post("/api/graphs/:id/triggers", async (c) => {
  const graphId = c.req.param("id");
  const raw = (await c.req.json().catch(() => ({}))) as Partial<TriggerConfig>;
  const withId = raw.id ? raw : { ...raw, id: crypto.randomUUID() };
  const parsed = TriggerConfig.safeParse(withId);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
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
  const tid = c.req.param("tid");
  scheduler.unsync(tid);
  await triggers.remove(c.req.param("id"), tid);
  return c.body(null, 204);
});

// Manually fire a trigger (e.g. a batch run, or a cron/event re-run on demand).
app.post("/api/graphs/:id/triggers/:tid/fire", async (c) => {
  const graphId = c.req.param("id");
  const tid = c.req.param("tid");
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
  const body = (await c.req.json().catch(() => ({}))) as { secret?: string; payload?: unknown };
  const secret = body.secret ?? c.req.header("x-webhook-secret") ?? "";
  try {
    const { runId } = await triggers.fireWebhook(graphId, secret, body.payload);
    return c.json({ runId });
  } catch (e) {
    if (e instanceof TriggerError) {
      return jsonResponse(e.status, { error: e.message });
    }
    throw e;
  }
});

app.post("/api/runs/ab", async (c) => {
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
  const graph = db.getGraph(body.graphId);
  if (!graph) return c.json({ error: "graph not found" }, 404);
  const target = graph.nodes.find((n) => n.id === body.targetNodeId);
  if (!target) return c.json({ error: "target node not found" }, 404);
  if (target.kind !== "agent") {
    return c.json({ error: "A/B 目标必须是厂房(agent)节点" }, 400);
  }
  try {
    const { abGroup, arms } = await startABExperiment(db, worker, {
      graph,
      targetNodeId: body.targetNodeId,
      variants: body.variants,
      budgetUsd: body.budgetUsd ?? null,
      input: body.input,
    });
    return c.json({ abGroup, arms });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/ab/:groupId", (c) => {
  const report = db.abReport(c.req.param("groupId"));
  if (!report) return c.json({ error: "not found" }, 404);
  return c.json(report);
});

app.get("/api/brand-terms", (c) => c.json(db.listBrandTerms()));

app.post("/api/brand-terms", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { term?: string; note?: string };
  if (!body.term?.trim()) return c.json({ error: "term required" }, 400);
  return c.json(db.addBrandTerm(body.term, body.note ?? ""), 201);
});

app.delete("/api/brand-terms/:id", (c) => {
  db.deleteBrandTerm(c.req.param("id"));
  return c.body(null, 204);
});

app.post("/api/runs/:id/cancel", (c) => {
  const entry = live.get(c.req.param("id"));
  if (!entry) return c.json({ error: "not live" }, 404);
  entry.controller.abort();
  return c.json({ ok: true });
});

app.delete("/api/runs/:id", (c) => {
  const runId = c.req.param("id");
  if (!db.runExists(runId)) return c.json({ error: "not found" }, 404);
  const entry = live.get(runId);
  if (entry && !entry.done) {
    return c.json({ error: "run is still in progress; cancel it first" }, 409);
  }
  live.delete(runId);
  db.deleteRun(runId);
  return c.json({ ok: true });
});

/** Resume a halted run: `{ action: "continue" | "scrap" }`. */
app.post("/api/runs/:id/resume", async (c) => {
  const runId = c.req.param("id");
  const row = db.getRun(runId);
  if (!row) return c.json({ error: "not found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    action?: "continue" | "scrap";
    resetFrom?: string;
  };
  const action = body.action === "scrap" ? "scrap" : "continue";
  const resetFrom = typeof body.resetFrom === "string" ? body.resetFrom : undefined;

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
    db.markRunning(runId);
  }

  void (async () => {
    try {
      const cfg = loadConfig();
      const now = new Date();
      for await (const event of resume({
        runId,
        graph,
        plan,
        worker,
        budgetUsd: row.budget_usd ?? null,
        monthlyBudgetUsd: cfg.monthlyBudgetUsd ?? null,
        monthSpentUsd: db.costForMonth(now.getFullYear(), now.getMonth() + 1),
        defaultModel: cfg.defaultModel,
        pastEvents,
        action,
        resetFrom,
        signal: controller.signal,
        storeBinary: (data, mimeType, label) =>
          artifacts.saveBinary({ data, kind: "image", mimeType, label }).uri ??
          `data:${mimeType};base64,${data.toString("base64")}`,
      })) {
        db.record(runId, event);
        if (event.type === "artifact.produced") {
          db.insertArtifact(artifacts.save(event.artifact, { runId, nodeId: event.nodeId, attempt: event.attempt }));
        }
        entry.events.push(event);
        if (event.type === "run.finished") db.finishRun(runId, event.status, Date.now());
      }
    } catch (err) {
      db.finishRun(runId, "failed", Date.now());
      log.child({ runId }).error("resume crashed", { error: (err as Error)?.message ?? String(err) });
    } finally {
      entry.done = true;
    }
  })();

  return c.json({ ok: true, action });
});

/** Full event log — the replay scrubber reads this. */
app.get("/api/runs/:id/events", (c) => {
  const runId = c.req.param("id");
  if (!db.runExists(runId)) return c.json({ error: "not found" }, 404);

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
  const runId = c.req.param("id");
  if (!db.runExists(runId)) return c.json({ error: "not found" }, 404);
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
  const runId = c.req.param("id");
  if (!db.runExists(runId)) return c.json({ error: "not found" }, 404);
  return c.json(db.listArtifactsForRun(runId));
});

/** Upload a raw product image/file. Returns a StoredArtifact with a /api/artifacts/:id URI. */
app.post("/api/artifacts/upload", async (c) => {
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

  const saved = artifacts.saveBinary({
    data,
    kind,
    mimeType: contentType,
    label: label || undefined,
  });
  db.insertArtifact(saved);
  return c.json(saved, 201);
});

/** Cross-run artifact listing (latest first), for the product gallery. */
app.get("/api/artifacts", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const offset = Number(c.req.query("offset") ?? 0);
  return c.json(db.listArtifacts(limit, offset));
});

/** Fetch a single artifact: local blobs are streamed, remote URIs redirect. */
app.get("/api/artifacts/:id", (c) => {
  const id = c.req.param("id");
  const meta = db.getArtifact(id);
  if (!meta) return c.json({ error: "not found" }, 404);

  if (meta.storage === "uri" && meta.uri) {
    return c.redirect(meta.uri, 302);
  }
  if (meta.storage !== "local") {
    return c.json({ error: "artifact has no binary payload" }, 404);
  }

  const file = artifacts.open(meta.runId, meta.id);
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

serve({ fetch: app.fetch, port: PORT }, (info) => {
  log.info("engine listening", { port: info.port, url: `http://localhost:${info.port}` });
});

/** Minimal request body for a connectivity probe, shaped per modality. */
function buildTestPayload(modality: Modality, model: string): Record<string, unknown> {
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
    case "video":
      return { model, prompt: "test" };
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
