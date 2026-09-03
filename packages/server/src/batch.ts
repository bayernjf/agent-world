import { compile, type Graph } from "@agent-world/core";
import type { Db, BatchItem } from "./db.js";
import { ArtifactStore } from "./artifact-store.js";
import { startRun, type LiveMap } from "./run.js";
import type { Worker } from "./worker.js";

export interface RunBatchArgs {
  db: Db;
  userId: string;
  worker: Worker;
  artifacts: ArtifactStore;
  live: LiveMap;
  graph: Graph;
  batchId: string;
  concurrency: number;
  publicUrl?: string;
}

/**
 * Run each batch item as a separate graph run, tracking per-item and per-batch
 * progress. Concurrency is bounded by a worker pool; each run's completion
 * settles its item via the run's onFinish callback. Resolves when every item
 * has reached a terminal state.
 */
export async function runBatch(args: RunBatchArgs): Promise<void> {
  const { db, userId, worker, artifacts, live, graph, batchId, concurrency, publicUrl } = args;
  const { plan } = compile(graph);
  if (!plan) {
    db.setBatchStatus(batchId, "failed", Date.now());
    return;
  }

  db.setBatchStatus(batchId, "running", null);
  const items = db.listBatchItems(batchId);
  let succeeded = 0;
  let failed = 0;
  let settled = 0;

  const runOne = (item: BatchItem): Promise<void> =>
    new Promise((resolve) => {
      const settle = (ok: boolean, err?: string) => {
        if (ok) {
          succeeded += 1;
          db.markBatchItemDone(item.id, null, []);
        } else {
          failed += 1;
          db.markBatchItemFailed(item.id, err ?? "unknown error");
        }
        db.updateBatchCounts(batchId, succeeded, failed);
        settled += 1;
        if (settled === items.length) {
          const finalStatus = failed === 0 ? "done" : succeeded === 0 ? "failed" : "partial";
          db.setBatchStatus(batchId, finalStatus, Date.now());
        }
        resolve();
      };

      startRun({
        db,
        userId,
        worker,
        artifacts,
        live,
        graph,
        trigger: "batch",
        input: JSON.stringify(item.input),
        publicUrl,
        onFinish: (_gid, status) => settle(status === "done", status === "done" ? undefined : `run ${status}`),
      })
        .then(({ runId }) => db.markBatchItemRunning(item.id, runId))
        .catch((e: unknown) => settle(false, (e as Error)?.message ?? String(e)));
    });

  let cursor = 0;
  const pool = Math.min(Math.max(concurrency, 1), items.length || 1);
  const workers = Array.from({ length: pool }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (!item) continue;
      await runOne(item);
    }
  });
  await Promise.all(workers);
}
