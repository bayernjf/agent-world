import type { Artifact, GraphNode, Usage } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { sanitizeError } from "../sanitize.js";

/**
 * VideoGen node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function videoGenNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, inputFor, opts, sendPackets, states, worker } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const cfg = node.videoGen ?? { model: "video-gen", n: 1 };
  if (!worker.generateVideo) {
    // Honest failure: media nodes are often the run's product (dogfood
    // 2026-09-01). Silent skip reported done with no artifact. Templates
    // that want a fallback should add an error edge instead.
    states.set(nodeId, "failed");
    emit({ type: "node.failed", nodeId, attempt, error: "worker 无视频生成能力", errorCode: "VALIDATION" });
    return;
  }
  const prompt = cfg.prompt?.trim() || (await inputFor(node));
  try {
    const results = await worker.generateVideo({ node, config: cfg, input: prompt, signal: opts.signal });
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
    emit({ type: "node.finished", nodeId, attempt, output: "", usage });
    states.set(nodeId, "done");
    sendPackets(nodeId, `生成视频 ${results.length} 段`, "video");
  } catch (err) {
    console.warn(`[videoGen:${nodeId}] generation failed:`, (err as Error).message);
    states.set(nodeId, "failed");
    emit({ type: "node.failed", nodeId, attempt, error: `视频生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
  }
}
