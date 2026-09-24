import { isTimedOut, type Artifact, type ErrorCode, type GraphNode, type Usage } from "@agent-world/core";
import { randomUUID } from "node:crypto";
import type { NodeRunContext } from "./types.js";
import { sanitizeError } from "../sanitize.js";
import { ProviderError } from "../providers/openai-compatible.js";
import { notifyHalt } from "../notify.js";
import type { RemoteJobStore } from "../db.js";
import type { VideoGenArgs, VideoGenResult, Worker } from "../worker.js";

/** First poll gap for a remote video job; doubles each poll. */
export const VIDEO_POLL_BASE_DELAY_MS = 2000;
/** Cap on the exponential backoff between polls. */
export const VIDEO_POLL_MAX_DELAY_MS = 20_000;
/** Overall ceiling for one in-run polling window before the node degrades. */
export const VIDEO_JOB_DEFAULT_TIMEOUT_MS = 5 * 60_000;
/** Don't write last_polled_at on every poll; touch at most once per N polls. */
const TOUCH_EVERY_POLLS = 3;

/** Exponential backoff between remote video job status polls, capped at 20s. */
export function nextVideoPollDelayMs(pollCount: number): number {
  return Math.min(
    VIDEO_POLL_MAX_DELAY_MS,
    VIDEO_POLL_BASE_DELAY_MS * 2 ** Math.max(0, pollCount),
  );
}

const KNOWN_VIDEO_ERROR_CODES = new Set<ErrorCode>([
  "TIMEOUT",
  "RATE_LIMIT",
  "AUTH",
  "UNSUPPORTED",
  "UNKNOWN",
]);

/** Discriminated outcome of submitting/polling a remote video job (G4). */
type PollOutcome =
  | { kind: "succeeded"; results: VideoGenResult[] }
  | { kind: "failed"; error: string; errorCode: ErrorCode }
  // Poll window exhausted / aborted: the provider job may still be rendering.
  // The remote_jobs row stays OPEN so a later `reattach` continues polling.
  | {
      kind: "degraded";
      reason: string;
      errorCode: ErrorCode;
      jobId: string;
      provider: string | null;
    }
  // Provider no longer recognizes the job id (TTL/cleanup): row finished lost,
  // so the only way forward is an explicit resubmit (which bills again).
  | { kind: "lost"; jobId: string; provider: string | null };

/**
 * Submit a remote render job and poll with backoff. The submit is idempotent:
 * an open job for the same attempt is reused (reattach after a poll window or
 * process restart) instead of re-submitting, so we never double-bill. The job
 * is recorded in remote_jobs at submit, touched while running, and finished on
 * a terminal state. Timeout/abort do NOT fail — they return `degraded` with the
 * row left open; an unknown provider job returns `lost` after finishing the row.
 */
async function pollVideoJob(
  worker: Worker,
  args: VideoGenArgs,
  store: RemoteJobStore,
  loc: { runId: string; graphId: string; nodeId: string; attempt: number },
  timing: { now: () => number; sleep: (ms: number) => Promise<void>; signal?: AbortSignal },
): Promise<PollOutcome> {
  const now0 = timing.now();
  const open = await store.getOpen(loc.runId, loc.nodeId, loc.attempt);
  let rowId: string;
  let provider: string | null;
  let jobId: string;
  if (open) {
    // Reattach: continue the persisted job, no submit.
    rowId = open.id;
    provider = open.provider;
    jobId = open.remoteJobId;
  } else {
    const handle = await worker.submitVideoJob!(args);
    rowId = randomUUID();
    provider = handle.provider ?? null;
    jobId = handle.jobId;
    await store.insert({
      id: rowId,
      userId: store.userId,
      runId: loc.runId,
      graphId: loc.graphId,
      nodeId: loc.nodeId,
      attempt: loc.attempt,
      kind: "video",
      provider,
      remoteJobId: jobId,
      state: "submitted",
      submittedAt: now0,
      meta: null,
    });
  }
  const job = { jobId, provider: provider ?? undefined };
  let pollCount = 0;
  for (;;) {
    if (timing.signal?.aborted) {
      return {
        kind: "degraded",
        reason: `视频任务 ${jobId} 已被中止`,
        errorCode: "TIMEOUT",
        jobId,
        provider,
      };
    }
    const status = await worker.queryVideoJob!({ ...args, job });
    if (status.state === "succeeded") {
      await store.finish(rowId, "succeeded");
      return { kind: "succeeded", results: status.results };
    }
    if (status.state === "failed") {
      const raw = status.errorCode ?? "";
      const code: ErrorCode = KNOWN_VIDEO_ERROR_CODES.has(raw as ErrorCode) ? (raw as ErrorCode) : "PROVIDER_ERROR";
      await store.finish(rowId, "failed", code);
      return { kind: "failed", error: status.error || "视频任务失败", errorCode: code };
    }
    if (status.state === "unknown") {
      await store.finish(rowId, "lost", "REMOTE_JOB_LOST");
      return { kind: "lost", jobId, provider };
    }
    if (isTimedOut(now0, timing.now(), VIDEO_JOB_DEFAULT_TIMEOUT_MS)) {
      // Window closed but the provider job is presumably still rendering.
      // Leave the row open (running) so reattach continues it — no resubmit.
      await store.touch(rowId, "running", timing.now());
      return {
        kind: "degraded",
        reason: `视频任务 ${jobId} 轮询窗口结束（${VIDEO_JOB_DEFAULT_TIMEOUT_MS / 1000}s），远端可能仍在渲染，可稍后继续等待`,
        errorCode: "TIMEOUT",
        jobId,
        provider,
      };
    }
    if (pollCount % TOUCH_EVERY_POLLS === 0) {
      await store.touch(rowId, "running", timing.now());
    }
    await timing.sleep(nextVideoPollDelayMs(pollCount));
    pollCount += 1;
  }
}

/** Halt the run at a degraded video node (human-node-shaped, G4 §3.6). */
function haltDegraded(
  ctx: NodeRunContext,
  nodeId: string,
  attempt: number,
  o: Extract<PollOutcome, { kind: "degraded" }>,
): void {
  ctx.emit({
    type: "node.degraded",
    nodeId,
    attempt,
    reason: o.reason,
    errorCode: o.errorCode,
    remoteJob: { provider: o.provider ?? undefined, jobId: o.jobId, kind: "video" },
  });
  ctx.states.set(nodeId, "degraded");
  ctx.haltNodeId = nodeId;
  ctx.haltReason = `degraded:video:${nodeId}`;
  ctx.status = "halted";
  ctx.aborted = true;
  void notifyHalt({ runId: ctx.runId, graphId: ctx.graph.id, nodeId, reason: ctx.haltReason });
}

/** Halt at a lost video job: the operator must explicitly resubmit (G4 §3.7). */
function haltLost(
  ctx: NodeRunContext,
  nodeId: string,
  attempt: number,
  o: Extract<PollOutcome, { kind: "lost" }>,
): void {
  ctx.emit({
    type: "node.degraded",
    nodeId,
    attempt,
    reason: `视频任务 ${o.jobId} 已被服务商清理（无法找回），需重新提交（将重新计费）`,
    errorCode: "REMOTE_JOB_LOST",
    remoteJob: { provider: o.provider ?? undefined, jobId: o.jobId, kind: "video" },
  });
  ctx.states.set(nodeId, "degraded");
  ctx.haltNodeId = nodeId;
  ctx.haltReason = `degraded:video:${nodeId}`;
  ctx.status = "halted";
  ctx.aborted = true;
  void notifyHalt({ runId: ctx.runId, graphId: ctx.graph.id, nodeId, reason: ctx.haltReason });
}

/**
 * VideoGen node execution body. Synchronous workers behave byte-identically to
 * before; an async submit+poll worker is used together with the G4 persistence
 * seam so timeouts degrade+halt instead of failing, and resumes can reattach.
 */
export async function videoGenNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, budgetUsd, emit, graph, inputFor, opts, sendPackets, states, worker } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const cfg = node.videoGen ?? { model: "video-gen", n: 1 };
  const supportsSync = !!worker.generateVideo;
  const supportsAsync = !!worker.submitVideoJob && !!worker.queryVideoJob;
  if (!supportsSync && !supportsAsync) {
    // Honest failure: media nodes are often the run's product. Templates that
    // want a fallback should add an error edge instead of silently skipping.
    states.set(nodeId, "failed");
    emit({ type: "node.failed", nodeId, attempt, error: "worker 无视频生成能力", errorCode: "VALIDATION" });
    return;
  }
  const prompt = cfg.prompt?.trim() || (await inputFor(node));
  try {
    const args: VideoGenArgs = { node, config: cfg, input: prompt, signal: opts.signal };
    let results: VideoGenResult[];
    if (supportsAsync && ctx.remoteJobStore) {
      const outcome = await pollVideoJob(
        worker,
        args,
        ctx.remoteJobStore,
        { runId: ctx.runId, graphId: graph.id, nodeId, attempt },
        { now: opts.now, sleep: opts.sleep, signal: opts.signal },
      );
      if (outcome.kind === "degraded") return haltDegraded(ctx, nodeId, attempt, outcome);
      if (outcome.kind === "lost") return haltLost(ctx, nodeId, attempt, outcome);
      if (outcome.kind === "failed") {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `视频生成失败: ${sanitizeError(outcome.error)}`,
          errorCode: outcome.errorCode,
        });
        return;
      }
      results = outcome.results;
    } else {
      results = await worker.generateVideo!(args);
    }
    // Zero results is never a success: the node asked for n ≥ 1 clips and got
    // none, which means the provider does not actually serve this modality.
    if (results.length === 0) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `视频生成未返回任何结果（模型 ${cfg.model} 可能不支持该模态，或 provider 未提供该能力）`,
        errorCode: "UNSUPPORTED",
      });
      return;
    }
    let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: {} };
    const videoArts: Artifact[] = [];
    for (let idx = 0; idx < results.length; idx++) {
      const res = results[idx]!;
      const ext = res.mimeType.includes("mp4") ? "mp4" : res.mimeType.includes("webm") ? "webm" : "mp4";
      const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "ai-video"}-${idx + 1}.${ext}`);
      const a: Artifact = {
        id: `${nodeId}-vid-${idx}`,
        kind: "video",
        uri,
        sizeBytes: res.data.length,
        mimeType: res.mimeType,
        label: results.length > 1 ? `${node.name || "AI 视频"} #${idx + 1}` : node.name || "AI 视频",
      };
      videoArts.push(a);
      emit({ type: "artifact.produced", nodeId, artifact: a });
      usage = {
        tokensIn: (usage.tokensIn ?? 0) + (res.usage.tokensIn ?? 0),
        tokensOut: (usage.tokensOut ?? 0) + (res.usage.tokensOut ?? 0),
        costUsd: (usage.costUsd ?? 0) + (res.usage.costUsd ?? 0),
        units: { ...usage.units, ...res.usage.units },
      };
    }
    artifacts.set(nodeId, videoArts);
    ctx.totalCostUsd += usage.costUsd;
    emit({ type: "power.metered", totalCostUsd: ctx.totalCostUsd, budgetUsd });
    emit({ type: "node.finished", nodeId, attempt, output: "", usage: { ...usage, model: cfg.model } });
    states.set(nodeId, "done");
    sendPackets(nodeId, `生成视频 ${results.length} 段`, "video");
  } catch (err) {
    ctx.log.warn("videoGen generation failed", { nodeId, error: (err as Error).message });
    const code = err instanceof ProviderError ? err.code : "PROVIDER_ERROR";
    states.set(nodeId, "failed");
    emit({ type: "node.failed", nodeId, attempt, error: `视频生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: code });
  }
}
