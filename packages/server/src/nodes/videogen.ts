import { isTimedOut, type Artifact, type GraphNode, type Usage } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { sanitizeError } from "../sanitize.js";
import { ProviderError } from "../providers/openai-compatible.js";
import type { VideoGenArgs, VideoGenResult, Worker } from "../worker.js";

/** First poll gap for a remote video job; doubles each poll. */
export const VIDEO_POLL_BASE_DELAY_MS = 2000;
/** Cap on the exponential backoff between polls. */
export const VIDEO_POLL_MAX_DELAY_MS = 20_000;
/** Overall ceiling for in-run polling before the node fails with TIMEOUT. */
export const VIDEO_JOB_DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** Exponential backoff between remote video job status polls, capped at 20s. */
export function nextVideoPollDelayMs(pollCount: number): number {
  return Math.min(
    VIDEO_POLL_MAX_DELAY_MS,
    VIDEO_POLL_BASE_DELAY_MS * 2 ** Math.max(0, pollCount),
  );
}

const KNOWN_VIDEO_ERROR_CODES = new Set([
  "TIMEOUT",
  "RATE_LIMIT",
  "AUTH",
  "UNSUPPORTED",
  "UNKNOWN",
]);

/**
 * G4.4 (in-run half): submit a remote render job, then poll with backoff until
 * it succeeds/fails or the polling deadline trips. This turns one long blocking
 * HTTP render call (which gateways time out) into a submit plus many short
 * status requests. Cross-run resumption — re-attaching to `job` after a server
 * restart instead of re-submitting — depends on the G4.2 degraded/halt state
 * machine and is deliberately not part of this path.
 */
async function pollVideoJob(
  worker: Worker,
  args: VideoGenArgs,
  timing: { now: () => number; sleep: (ms: number) => Promise<void>; signal?: AbortSignal },
): Promise<VideoGenResult[]> {
  const job = await worker.submitVideoJob!(args);
  const startedAt = timing.now();
  let pollCount = 0;
  for (;;) {
    if (timing.signal?.aborted) {
      throw new ProviderError("TIMEOUT", `视频任务 ${job.jobId} 已被中止`);
    }
    const status = await worker.queryVideoJob!({ ...args, job });
    if (status.state === "succeeded") return status.results;
    if (status.state === "failed") {
      const raw = status.errorCode ?? "";
      const code = KNOWN_VIDEO_ERROR_CODES.has(raw)
        ? (raw as ProviderError["code"])
        : "PROVIDER_ERROR";
      throw new ProviderError(code, status.error || "视频任务失败");
    }
    if (isTimedOut(startedAt, timing.now(), VIDEO_JOB_DEFAULT_TIMEOUT_MS)) {
      throw new ProviderError(
        "TIMEOUT",
        `视频任务 ${job.jobId} 轮询超时（${VIDEO_JOB_DEFAULT_TIMEOUT_MS / 1000}s）`,
      );
    }
    await timing.sleep(nextVideoPollDelayMs(pollCount));
    pollCount += 1;
  }
}

/**
 * VideoGen node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure for synchronous workers;
 * shared scheduler state arrives via the explicit NodeRunContext.
 */
export async function videoGenNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, budgetUsd, emit, inputFor, opts, sendPackets, states, worker } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const cfg = node.videoGen ?? { model: "video-gen", n: 1 };
  const supportsSync = !!worker.generateVideo;
  // G4.4: an async submit+poll worker is acceptable even without generateVideo.
  const supportsAsync = !!worker.submitVideoJob && !!worker.queryVideoJob;
  if (!supportsSync && !supportsAsync) {
    // Honest failure: media nodes are often the run's product (dogfood
    // 2026-09-01). Silent skip reported done with no artifact. Templates
    // that want a fallback should add an error edge instead.
    states.set(nodeId, "failed");
    emit({ type: "node.failed", nodeId, attempt, error: "worker 无视频生成能力", errorCode: "VALIDATION" });
    return;
  }
  const prompt = cfg.prompt?.trim() || (await inputFor(node));
  try {
    const args: VideoGenArgs = { node, config: cfg, input: prompt, signal: opts.signal };
    const results = supportsAsync
      ? await pollVideoJob(worker, args, { now: opts.now, sleep: opts.sleep, signal: opts.signal })
      : await worker.generateVideo!(args);
    // Zero results is never a success: the node asked for n ≥ 1 clips and got
    // none, which means the provider does not actually serve this modality or
    // model (routingWorker hands back [] for a worker without the method).
    // Reporting done with no artifact is the same fake success b6de7d9 removed
    // for the throw path; audit item L8 flagged this empty-result half.
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
