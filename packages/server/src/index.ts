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
  type RunEvent,
} from "@agent-world/core";
import { openDb } from "./db.js";
import { execute, resume } from "./engine.js";
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

app.post("/api/runs", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    graphId?: string;
    budgetUsd?: number | null;
    trigger?: string;
    input?: string;
  };
  const graph = db.getGraph(body.graphId ?? SEED_GRAPH.id);
  if (!graph) return c.json({ error: "graph not found" }, 404);

  const { plan, diagnostics } = compile(graph);
  if (!plan) return c.json({ error: "graph does not compile", diagnostics }, 422);

  const runId = crypto.randomUUID();
  const budgetUsd = body.budgetUsd ?? null;
  const startedAt = Date.now();
  db.createRun({
    id: runId,
    graph,
    budgetUsd,
    at: startedAt,
    trigger: body.trigger ?? "manual",
    input: body.input,
  });

  const controller = new AbortController();
  const entry = { events: [] as RunEvent[], done: false, controller };
  live.set(runId, entry);

  // Drain in the background so the POST returns immediately with the run id.
  void (async () => {
    try {
      for await (const event of execute({
        runId,
        graph,
        plan,
        worker,
        input: body.input,
        budgetUsd,
        defaultModel: loadConfig().defaultModel,
        signal: controller.signal,
      })) {
        db.record(runId, event);
        entry.events.push(event);
        if (event.type === "run.finished") db.finishRun(runId, event.status, Date.now());
      }
    } catch (err) {
      db.finishRun(runId, "failed", Date.now());
      console.error(`run ${runId} crashed`, err);
    } finally {
      entry.done = true;
    }
  })();

  return c.json({ runId, diagnostics });
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
  // A retry from a failed/tripped run reopens the same run; flip its status
  // back to running so listings/UIs reflect the active attempt.
  if (resetFrom || row.status === "failed" || row.status === "tripped") {
    db.markRunning(runId);
  }

  void (async () => {
    try {
      for await (const event of resume({
        runId,
        graph,
        plan,
        worker,
        budgetUsd: row.budget_usd ?? null,
        defaultModel: loadConfig().defaultModel,
        pastEvents,
        action,
        resetFrom,
        signal: controller.signal,
      })) {
        db.record(runId, event);
        entry.events.push(event);
        if (event.type === "run.finished") db.finishRun(runId, event.status, Date.now());
      }
    } catch (err) {
      db.finishRun(runId, "failed", Date.now());
      console.error(`run ${runId} resume crashed`, err);
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

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`agent-world engine listening on http://localhost:${info.port}`);
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
