import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { compile, envelope, Graph, replay, type RunEvent } from "@agent-world/core";
import { openDb } from "./db.js";
import { execute, resume } from "./engine.js";
import { SEED_GRAPH } from "./seed.js";
import { loadConfig, saveConfig, type AppConfig } from "./config.js";
import { routingWorker } from "./providers/index.js";

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

app.get("/api/graphs", (c) => c.json(db.listGraphs()));

app.get("/api/graphs/:id", (c) => {
  const graph = db.getGraph(c.req.param("id"));
  return graph ? c.json(graph) : c.json({ error: "not found" }, 404);
});

app.put("/api/graphs/:id", async (c) => {
  const parsed = Graph.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  db.saveGraph(parsed.data, Date.now());
  return c.json({ ok: true });
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
  const merged: AppConfig = {
    ...current,
    ...body,
    providers: { ...current.providers, ...(body.providers ?? {}) },
  };
  // If the UI sent back a redacted key, keep the real one.
  for (const [name, provider] of Object.entries(merged.providers)) {
    if (provider.apiKey && provider.apiKey.includes("*")) {
      provider.apiKey = current.providers[name]?.apiKey ?? provider.apiKey;
    }
  }
  const path = saveConfig(merged);
  return c.json({ ok: true, path });
});

app.get("/api/runs", (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const offset = Number(c.req.query("offset") ?? 0);
  return c.json(db.listRuns(limit, offset));
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

/** Resume a halted run: `{ action: "continue" | "scrap" }`. */
app.post("/api/runs/:id/resume", async (c) => {
  const runId = c.req.param("id");
  const row = db.getRun(runId);
  if (!row) return c.json({ error: "not found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { action?: "continue" | "scrap" };
  const action = body.action === "scrap" ? "scrap" : "continue";

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

  void (async () => {
    try {
      for await (const event of resume({
        runId,
        graph,
        plan,
        worker,
        budgetUsd: row.budget_usd ?? null,
        pastEvents,
        action,
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
  const events = db.events(runId);
  return c.json({ events, state: replay(events) });
});

/** Live stream. Resumes from `?after=<seq>` so a dropped connection loses nothing. */
app.get("/api/runs/:id/stream", (c) => {
  const runId = c.req.param("id");
  if (!db.runExists(runId)) return c.json({ error: "not found" }, 404);
  const after = Number(c.req.query("after") ?? -1);

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

function redactKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}
