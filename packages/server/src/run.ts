import { randomUUID } from "node:crypto";
import { compile, type Graph, type ProductConnector, type RunEvent } from "@agent-world/core";
import type { Db, Product } from "./db.js";
import { ArtifactStore } from "./artifact-store.js";
import { log } from "./logger.js";
import { execute, resume } from "./engine.js";
import { loadConfig } from "./config.js";
import { runAsUser } from "./user-context.js";
import { createReadArtifact } from "./artifact-reader.js";

/** Maps a `product` connector to raw source material by reading the user's product library. */
function productConnectorLoader(db: Db, userId: string) {
  return async (connector: ProductConnector): Promise<{ text: string; images: string[] }> => {
    let products: Product[];
    if (connector.selection === "all") {
      products = db.listProducts(userId, { status: "active" });
    } else if (connector.selection === "filter") {
      products = db.listProducts(userId, connector.filter ?? {});
    } else {
      products = db.getProductsByIds(userId, connector.productIds ?? []);
    }
    const text = products.map(formatProduct).join("\n\n---\n\n");
    const images = products.flatMap((p) => p.images);
    return { text, images };
  };
}

/** Render one product into the plain-text shape a source node feeds downstream. */
function formatProduct(p: Product): string {
  const lines = [`# ${p.name}`];
  if (p.brand) lines.push(`品牌：${p.brand}`);
  if (p.category) lines.push(`分类：${p.category}`);
  if (p.price != null) lines.push(`价格：${p.price}`);
  for (const [k, v] of Object.entries(p.attributes)) {
    if (v != null && v !== "") lines.push(`${k}：${String(v)}`);
  }
  return lines.join("\n");
}

/** Worker type derived from the engine so we don't reach into provider internals. */
type Worker = Parameters<typeof execute>[0]["worker"];

export interface LiveEntry {
  events: RunEvent[];
  done: boolean;
  controller: AbortController;
}
export type LiveMap = Map<string, LiveEntry>;

/** Thrown before a run is scheduled (e.g. graph won't compile). Carries an HTTP status. */
export class RunStartError extends Error {
  constructor(
    message: string,
    public status: number,
    public extra?: unknown,
  ) {
    super(message);
  }
}

export interface StartRunArgs {
  db: Db;
  userId: string;
  worker: Worker;
  artifacts: ArtifactStore;
  live: LiveMap;
  graph: Graph;
  trigger: string;
  budgetUsd?: number | null;
  input?: string;
  connectorValues?: Record<string, string>;
  /** Server origin (e.g. http://localhost:8791); absolutizes artifact URIs in prompts. */
  publicUrl?: string;
  /** Called when the run finishes (used to fire downstream event triggers). */
  onFinish?: (graphId: string, status: string) => void;
  /** Called for each produced artifact (used to fire artifact event triggers). */
  onArtifact?: (artifactId: string) => void;
}

/**
 * Starts a graph run: compiles, records the run row, registers it in the live
 * map, then drains the engine stream in the background (the POST returns
 * immediately with the run id). Shared by the manual `/api/runs` route and the
 * trigger service so every path produces identical run records.
 */
export async function startRun(args: StartRunArgs): Promise<{ runId: string; diagnostics: unknown }> {
  const { db, userId, worker, artifacts, live, graph, trigger, budgetUsd, input, connectorValues, publicUrl } = args;
  const { plan, diagnostics } = compile(graph);
  if (!plan) throw new RunStartError("graph does not compile", 422, diagnostics);

  const runId = randomUUID();
  const startedAt = Date.now();
  db.createRun({ id: runId, userId, graph, budgetUsd: budgetUsd ?? null, at: startedAt, trigger, input });
  const controller = new AbortController();
  const entry: LiveEntry = { events: [], done: false, controller };
  live.set(runId, entry);
  const runLog = log.child({ runId, graphId: graph.id });
  runLog.info("run started", { trigger, nodes: graph.nodes.length });

  void runAsUser(userId, async () => {
    try {
      const cfg = loadConfig(userId);
      const now = new Date();
      // Graph variables: graph-level defaults overridden by persisted values
      // from prior runs (cross-run state). The engine mutates this map by
      // reference; we persist it back once the run finishes.
      const variables = new Map<string, unknown>(
        Object.entries({ ...(graph.variables ?? {}), ...db.loadGraphVariables(graph.id, userId) }),
      );
      for await (const event of execute({
        runId,
        graph,
        plan,
        worker,
        input,
        connectorValues,
        initialVariables: variables,
        bannedTerms: db.bannedTermsText(userId),
        loadProducts: productConnectorLoader(db, userId),
        budgetUsd: budgetUsd ?? null,
        monthlyBudgetUsd: cfg.monthlyBudgetUsd ?? null,
        monthSpentUsd: db.costForMonth(now.getFullYear(), now.getMonth() + 1, userId),
        defaultModel: cfg.defaultModel,
        signal: controller.signal,
        storeBinary: async (data, mimeType, label) => {
          const saved = await artifacts.saveBinary({ userId, data, kind: "image", mimeType, label });
          db.insertArtifact(saved, userId);
          return saved.uri ?? `data:${mimeType};base64,${data.toString("base64")}`;
        },
        readArtifact: createReadArtifact(db, artifacts),
        publicUrl,
        // Subprocess nodes call other saved graphs — resolve them within the
        // same user's scope so users can't invoke graphs they can't see.
        loadSubgraph: (graphId) => db.getGraph(graphId, userId) ?? null,
      })) {
        db.record(runId, event);
        if (event.type === "artifact.produced") {
          await persistArtifact({ db, artifacts, userId, graph, runId, event });
          args.onArtifact?.(event.artifact.id);
        }
        entry.events.push(event);
        if (event.type === "run.finished") {
          db.finishRun(runId, userId, event.status, Date.now(), haltedOf(event));
          // Persist the run's (possibly mutated) variables for the next run.
          db.saveGraphVariables(graph.id, userId, Object.fromEntries(variables));
          args.onFinish?.(graph.id, event.status);
        }
      }
    } catch (err) {
      db.finishRun(runId, userId, "failed", Date.now());
      runLog.error("run crashed", { error: (err as Error)?.message ?? String(err) });
    } finally {
      entry.done = true;
    }
  });

  return { runId, diagnostics };
}

type RunFinishedEvent = Extract<RunEvent, { type: "run.finished" }>;
type ArtifactEvent = Extract<RunEvent, { type: "artifact.produced" }>;

/** What a halted run is waiting on; every other final status clears it. */
export function haltedOf(event: RunFinishedEvent): { nodeId: string | null; reason: string | null } {
  return event.status === "halted"
    ? { nodeId: event.haltedNodeId ?? null, reason: event.reason ?? null }
    : { nodeId: null, reason: null };
}

/**
 * Single artifact-write path for every dispatcher. The resume path used to save
 * without graphId/role, so a human-approved run's finished product showed up in
 * the gallery as "(未知流水线)" instead of under its pipeline.
 */
async function persistArtifact(args: {
  db: Db;
  artifacts: ArtifactStore;
  userId: string;
  graph: Graph;
  runId: string;
  event: ArtifactEvent;
}): Promise<void> {
  const { db, artifacts, userId, graph, runId, event } = args;
  const nodeKind = graph.nodes?.find((n) => n.id === event.nodeId)?.kind;
  const role: "source" | "intermediate" | "final" =
    nodeKind === "sink" ? "final" : nodeKind === "source" ? "source" : "intermediate";
  db.insertArtifact(
    await artifacts.save(event.artifact, {
      runId,
      nodeId: event.nodeId,
      attempt: event.attempt,
      graphId: graph.id,
      role,
    }),
    userId,
  );
}

export type ResumeAction = "continue" | "approve" | "reject" | "edit" | "scrap";

export interface ResumeRunArgs {
  db: Db;
  userId: string;
  worker: Worker;
  artifacts: ArtifactStore;
  live: LiveMap;
  runId: string;
  action?: ResumeAction;
  editOutput?: Record<string, string>;
  /** Retry a failed/tripped run from this node instead of continuing forward. */
  resetFrom?: string;
  approveTools?: string[];
  publicUrl?: string;
  /** Called when the run finishes (used to fire downstream event triggers). */
  onFinish?: (graphId: string, status: string) => void;
  /** Called for each produced artifact (used to fire artifact event triggers). */
  onArtifact?: (artifactId: string) => void;
}

/**
 * Resumes a halted/failed run: validates ownership and liveness, replays the
 * stored event log into engine state, then drains the resumed stream in the
 * background. Shared by `/api/runs/:id/resume` and the review queue's batch
 * decide so one human decision and ten take exactly the same path.
 */
export async function resumeRun(args: ResumeRunArgs): Promise<{ runId: string; action: ResumeAction }> {
  const { db, userId, worker, artifacts, live, runId, publicUrl } = args;
  const action: ResumeAction = args.action ?? "continue";
  const row = db.getRun(runId, userId);
  if (!row) throw new RunStartError("not found", 404);

  // A live entry exists while the generator runs. Reject only if it is still
  // actively executing; a halted/done entry is safe to resume.
  const active = live.get(runId);
  if (active && !active.done) throw new RunStartError("run is still active", 409);
  if (active) live.delete(runId);

  const graph = JSON.parse(row.snapshot) as Graph;
  const { plan, diagnostics } = compile(graph);
  if (!plan) throw new RunStartError("graph does not compile", 422, diagnostics);

  const pastEvents = db.events(runId);
  const controller = new AbortController();
  const entry: LiveEntry = { events: [], done: false, controller };
  live.set(runId, entry);
  const runLog = log.child({ runId, graphId: graph.id });
  runLog.info("run resumed", { action, resetFrom: args.resetFrom ?? null, nodes: graph.nodes.length });
  // A retry from a failed/tripped run reopens the same run; flip its status
  // back to running so listings/UIs reflect the active attempt.
  if (args.resetFrom || row.status === "failed" || row.status === "tripped") {
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
        worker,
        budgetUsd: row.budget_usd ?? null,
        initialVariables: variables,
        bannedTerms: db.bannedTermsText(userId),
        loadProducts: productConnectorLoader(db, userId),
        monthlyBudgetUsd: cfg.monthlyBudgetUsd ?? null,
        monthSpentUsd: db.costForMonth(now.getFullYear(), now.getMonth() + 1, userId),
        defaultModel: cfg.defaultModel,
        pastEvents,
        action,
        resetFrom: args.resetFrom,
        editOutput: args.editOutput,
        approveTools: args.approveTools,
        signal: controller.signal,
        storeBinary: async (data, mimeType, label) => {
          const saved = await artifacts.saveBinary({ userId, data, kind: "image", mimeType, label });
          db.insertArtifact(saved, userId);
          return saved.uri ?? `data:${mimeType};base64,${data.toString("base64")}`;
        },
        // Inline local /api/artifacts/<id> URIs as data:<mime>;base64,... for
        // cloud vision models (they can't reach our localhost).
        readArtifact: createReadArtifact(db, artifacts),
        publicUrl,
        // Subprocess nodes call other saved graphs — resolve them within the
        // same user's scope so users can't invoke graphs they can't see.
        loadSubgraph: (graphId) => db.getGraph(graphId, userId) ?? null,
      })) {
        db.record(runId, event);
        if (event.type === "artifact.produced") {
          await persistArtifact({ db, artifacts, userId, graph, runId, event });
          args.onArtifact?.(event.artifact.id);
        }
        entry.events.push(event);
        if (event.type === "run.finished") {
          db.finishRun(runId, userId, event.status, Date.now(), haltedOf(event));
          db.saveGraphVariables(graph.id, userId, Object.fromEntries(variables));
          args.onFinish?.(graph.id, event.status);
        }
      }
    } catch (err) {
      db.finishRun(runId, userId, "failed", Date.now());
      runLog.error("resume crashed", { error: (err as Error)?.message ?? String(err) });
    } finally {
      entry.done = true;
    }
  });

  return { runId, action };
}
