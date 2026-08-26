import { randomUUID } from "node:crypto";
import { compile, type Graph, type RunEvent } from "@agent-world/core";
import type { Db } from "./db.js";
import { ArtifactStore } from "./artifact-store.js";
import { log } from "./logger.js";
import { execute } from "./engine.js";
import { loadConfig } from "./config.js";

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
  worker: Worker;
  artifacts: ArtifactStore;
  live: LiveMap;
  graph: Graph;
  trigger: string;
  budgetUsd?: number | null;
  input?: string;
  connectorValues?: Record<string, string>;
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
  const { db, worker, artifacts, live, graph, trigger, budgetUsd, input, connectorValues } = args;
  const { plan, diagnostics } = compile(graph);
  if (!plan) throw new RunStartError("graph does not compile", 422, diagnostics);

  const runId = randomUUID();
  const startedAt = Date.now();
  db.createRun({ id: runId, graph, budgetUsd: budgetUsd ?? null, at: startedAt, trigger, input });
  const controller = new AbortController();
  const entry: LiveEntry = { events: [], done: false, controller };
  live.set(runId, entry);
  const runLog = log.child({ runId, graphId: graph.id });
  runLog.info("run started", { trigger, nodes: graph.nodes.length });

  void (async () => {
    try {
      const cfg = loadConfig();
      const now = new Date();
      for await (const event of execute({
        runId,
        graph,
        plan,
        worker,
        input,
        connectorValues,
        budgetUsd: budgetUsd ?? null,
        monthlyBudgetUsd: cfg.monthlyBudgetUsd ?? null,
        monthSpentUsd: db.costForMonth(now.getFullYear(), now.getMonth() + 1),
        defaultModel: cfg.defaultModel,
        signal: controller.signal,
        storeBinary: (data, mimeType, label) =>
          artifacts.saveBinary({ data, kind: "image", mimeType, label }).uri ??
          `data:${mimeType};base64,${data.toString("base64")}`,
      })) {
        db.record(runId, event);
        if (event.type === "artifact.produced") {
          db.insertArtifact(
            artifacts.save(event.artifact, { runId, nodeId: event.nodeId, attempt: event.attempt }),
          );
          args.onArtifact?.(event.artifact.id);
        }
        entry.events.push(event);
        if (event.type === "run.finished") {
          db.finishRun(runId, event.status, Date.now());
          args.onFinish?.(graph.id, event.status);
        }
      }
    } catch (err) {
      db.finishRun(runId, "failed", Date.now());
      runLog.error("run crashed", { error: (err as Error)?.message ?? String(err) });
    } finally {
      entry.done = true;
    }
  })();

  return { runId, diagnostics };
}
