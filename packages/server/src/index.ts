import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { compile, envelope, Graph, replay, type RunEvent } from "@agent-world/core";
import { openDb } from "./db.js";
import { execute } from "./engine.js";
import { SEED_GRAPH } from "./seed.js";
import { fakeWorker } from "./worker.js";

const PORT = Number(process.env.PORT ?? 8791);
const db = openDb(process.env.DB_FILE ?? "agent-world.sqlite");

if (!db.getGraph(SEED_GRAPH.id)) db.saveGraph(SEED_GRAPH, Date.now());

/** Live runs, so a reconnecting client can attach mid-flight. */
const live = new Map<string, { events: RunEvent[]; done: boolean; controller: AbortController }>();

const app = new Hono();
app.use("/*", cors());

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

app.post("/api/runs", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    graphId?: string;
    budgetUsd?: number | null;
  };
  const graph = db.getGraph(body.graphId ?? SEED_GRAPH.id);
  if (!graph) return c.json({ error: "graph not found" }, 404);

  const { plan, diagnostics } = compile(graph);
  if (!plan) return c.json({ error: "graph does not compile", diagnostics }, 422);

  const runId = crypto.randomUUID();
  const budgetUsd = body.budgetUsd ?? null;
  const startedAt = Date.now();
  db.createRun({ id: runId, graph, budgetUsd, at: startedAt });

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
        worker: fakeWorker(),
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
    while (entry && !(entry.done && cursor >= (entry.events.at(-1)?.seq ?? -1))) {
      const pending = entry.events.filter((e) => e.seq > cursor);
      for (const event of pending) {
        await stream.writeSSE({ data: JSON.stringify(envelope(event)), id: String(event.seq) });
        cursor = event.seq;
      }
      if (entry.done) break;
      await stream.sleep(60);
    }
  });
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`agent-world engine listening on http://localhost:${info.port}`);
});
