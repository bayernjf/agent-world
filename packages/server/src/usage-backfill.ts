/**
 * Idempotent usage-ledger backfill (M2 §S3).
 *
 * The gate reads usage_ledger, which only starts accumulating once the online
 * hook (recordRunUsage in run.ts) ships. Existing finished runs must be folded
 * in or every user looks like they have consumed nothing. This recomputes each
 * (user, billing-period) total straight from node_runs / runs.snapshot and
 * OVERWRITES the ledger via setUsage, so re-running never double-counts.
 *
 * Storage is a live snapshot (sumArtifactBytes), so it is intentionally not
 * backfilled here.
 */
import type { Graph } from "@agent-world/core";
import type { Db } from "./db.js";
import { currentPeriodStart, videoNodeIds } from "./subscription.js";

type Metric = "tokens_in" | "tokens_out" | "runs" | "video_segments";

interface PeriodBucket {
  userId: string;
  periodStart: number;
  tokens_in: number;
  tokens_out: number;
  runs: number;
  video_segments: number;
}

export interface BackfillResult {
  runsProcessed: number;
  users: number;
  periodsWritten: number;
}

export async function backfillUsage(
  db: Db,
  opts: { since?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<BackfillResult> {
  const since = opts.since ?? 0;
  const runs = await db.listFinishedRunsSince(since);
  const buckets = new Map<string, PeriodBucket>();
  const userSet = new Set<string>();

  let processed = 0;
  for (const run of runs) {
    let graph: Graph | null = null;
    try {
      graph = JSON.parse(run.snapshot) as Graph;
    } catch {
      graph = null;
    }
    const periodStart = currentPeriodStart(run.startedAt);
    const key = `${run.userId}:${periodStart}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { userId: run.userId, periodStart, tokens_in: 0, tokens_out: 0, runs: 0, video_segments: 0 };
      buckets.set(key, bucket);
    }
    const stats = await db.runStats(run.id);
    bucket.tokens_in += stats.tokensIn;
    bucket.tokens_out += stats.tokensOut;
    bucket.runs += 1;
    if (graph) {
      bucket.video_segments += await db.countDoneNodes(run.id, videoNodeIds(graph));
    }
    userSet.add(run.userId);
    processed += 1;
    opts.onProgress?.(processed, runs.length);
  }

  let periodsWritten = 0;
  for (const bucket of buckets.values()) {
    const metrics: Array<[Metric, number]> = [
      ["tokens_in", bucket.tokens_in],
      ["tokens_out", bucket.tokens_out],
      ["runs", bucket.runs],
      ["video_segments", bucket.video_segments],
    ];
    for (const [metric, amount] of metrics) {
      await db.setUsage(bucket.userId, bucket.periodStart, metric, amount);
    }
    periodsWritten += 1;
  }

  return { runsProcessed: processed, users: userSet.size, periodsWritten };
}
