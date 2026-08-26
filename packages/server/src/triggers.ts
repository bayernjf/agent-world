import * as fs from "node:fs";
import { TriggerConfig, type Graph } from "@agent-world/core";
import { nextRunAfter } from "./cron.js";

/** Thrown by the trigger service; carries an HTTP status for the route layer. */
export class TriggerError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Minimal graph store surface the service needs (keeps it testable without a real DB). */
export interface TriggerGraphStore {
  listGraphs(): Array<{ id: string; name: string; version: number; updated_at: number }>;
  getGraph(id: string): (Graph & { version: number }) | null;
  saveGraph(graph: Graph, at: number, expectedVersion?: number): unknown;
}

export type StartRunFn = (
  graph: Graph,
  opts: { trigger: string; budgetUsd?: number | null; input?: string; connectorValues?: Record<string, string> },
) => Promise<{ runId: string }>;

export interface TriggerServiceDeps {
  db: TriggerGraphStore;
  startRun: StartRunFn;
}

/**
 * Manages automatic run triggers (webhook/cron/event/batch). Triggers are
 * persisted as part of the graph document (`graph.triggers`), so this service
 * only keeps an in-memory index for fast lookup and restores it on startup.
 */
export class TriggerService {
  private index = new Map<string, { graphId: string; trigger: TriggerConfig }>();

  constructor(private deps: TriggerServiceDeps) {}

  /** Rebuild the in-memory index from persisted graphs. Call once at boot. */
  restore(): void {
    for (const summary of this.deps.db.listGraphs()) {
      const graph = this.deps.db.getGraph(summary.id);
      if (!graph) continue;
      for (const trigger of graph.triggers ?? []) {
        this.index.set(trigger.id, { graphId: summary.id, trigger });
      }
    }
  }

  list(): TriggerConfig[] {
    return [...this.index.values()].map((v) => v.trigger);
  }

  get(triggerId: string): TriggerConfig | undefined {
    return this.index.get(triggerId)?.trigger;
  }

  listByGraph(graphId: string): TriggerConfig[] {
    return this.list().filter((t) => this.index.get(t.id)?.graphId === graphId);
  }

  /**
   * Map of cron trigger id -> next fire time (epoch ms), for the UI. Only cron
   * triggers are included; an empty/invalid `cron` maps to null.
   */
  nextRunMap(graphId?: string): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    const list = graphId ? this.listByGraph(graphId) : this.list();
    for (const t of list) {
      if (t.type === "cron" && t.cron) {
        out[t.id] = nextRunAfter(t.cron, new Date())?.getTime() ?? null;
      }
    }
    return out;
  }

  /** Create or update a trigger on a graph, persisting the graph document. */
  async upsert(graphId: string, trigger: TriggerConfig): Promise<TriggerConfig> {
    const graph = this.deps.db.getGraph(graphId);
    if (!graph) throw new TriggerError("graph not found", 404);
    const triggers = (graph.triggers ?? []).filter((t) => t.id !== trigger.id);
    triggers.push(trigger);
    this.deps.db.saveGraph({ ...graph, triggers }, Date.now());
    this.index.set(trigger.id, { graphId, trigger });
    return trigger;
  }

  async remove(graphId: string, triggerId: string): Promise<void> {
    const graph = this.deps.db.getGraph(graphId);
    if (!graph) return;
    const triggers = (graph.triggers ?? []).filter((t) => t.id !== triggerId);
    this.deps.db.saveGraph({ ...graph, triggers }, Date.now());
    this.index.delete(triggerId);
  }

  /** Fire a trigger by id, optionally with a payload (string → source input). */
  async fire(triggerId: string, payload?: unknown, graphId?: string): Promise<{ runId: string }> {
    const entry = this.index.get(triggerId);
    if (!entry || (graphId != null && entry.graphId !== graphId)) {
      throw new TriggerError("trigger not found", 404);
    }
    const graph = this.deps.db.getGraph(entry.graphId);
    if (!graph) throw new TriggerError("graph not found", 404);
    return this.deps.startRun(graph, { trigger: triggerId, input: payloadToInput(payload) });
  }

  /** Validate the webhook secret for a graph, then fire the matching webhook trigger. */
  async fireWebhook(graphId: string, secret: string, payload?: unknown): Promise<{ runId: string }> {
    const candidate = this.listByGraph(graphId)
      .find((t) => t.type === "webhook" && t.webhookSecret === secret);
    if (!candidate) throw new TriggerError("invalid webhook secret", 401);
    return this.fire(candidate.id, payload, graphId);
  }

  /** Fire event triggers subscribed to a graph finishing a run (only on success). */
  async onGraphFinished(graphId: string, status: string): Promise<void> {
    if (status !== "completed") return;
    const matches = this.list().filter(
      (t) => t.type === "event" && t.eventSource?.kind === "graph" && t.eventSource.id === graphId,
    );
    await Promise.all(matches.map((t) => this.fire(t.id)));
  }

  /** Fire event triggers subscribed to a produced artifact. */
  async onArtifact(artifactId: string): Promise<void> {
    const matches = this.list().filter(
      (t) => t.type === "event" && t.eventSource?.kind === "artifact" && t.eventSource.id === artifactId,
    );
    await Promise.all(matches.map((t) => this.fire(t.id)));
  }

  /**
   * Batch trigger: start one graph run per input row. Rows come from the
   * trigger's `batch` config, or an explicit `payload` array (e.g. a webhook
   * body). Concurrency is limited so a large batch can't hammer the worker.
   */
  async fireBatch(triggerId: string, payload?: unknown, concurrency = 4): Promise<string[]> {
    const entry = this.index.get(triggerId);
    if (!entry) throw new TriggerError("trigger not found", 404);
    const trigger = entry.trigger;
    if (trigger.type !== "batch") throw new TriggerError("trigger is not a batch trigger", 400);
    const graph = this.deps.db.getGraph(entry.graphId);
    if (!graph) throw new TriggerError("graph not found", 404);

    const rows = this.resolveRows(trigger, payload);
    const runIds: string[] = [];
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        if (!row) continue;
        const { runId } = await this.deps.startRun(graph, {
          trigger: triggerId,
          input: JSON.stringify(row),
        });
        runIds.push(runId);
      }
    };
    const poolSize = Math.min(Math.max(concurrency, 1), rows.length || 1);
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
    return runIds;
  }

  private resolveRows(trigger: TriggerConfig, payload: unknown): Record<string, string>[] {
    if (Array.isArray(payload)) return payload as Record<string, string>[];
    const batch = trigger.batch;
    if (!batch) return [];
    if (batch.rows) return batch.rows;
    if (batch.source === "csv" && batch.path) {
      try {
        return parseCsv(fs.readFileSync(batch.path, "utf8"));
      } catch {
        return [];
      }
    }
    return [];
  }
}

function payloadToInput(payload: unknown): string | undefined {
  if (payload == null) return undefined;
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

/**
 * Minimal CSV parser (no quoted-comma handling): first line is the header row,
 * each subsequent line becomes a record keyed by the headers. Good enough for
 * dev batch inputs; swap for a streaming parser if real CSV is needed.
 */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = headerLine.split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}
