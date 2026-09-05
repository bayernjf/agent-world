import type { Artifact, GraphNode, Usage } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { sanitizeError } from "../sanitize.js";

/**
 * AudioGen node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function audioGenNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, inputFor, opts, sendPackets, states, worker } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const cfg = node.audioGen ?? { model: "tts-1", format: "mp3", n: 1 };
  if (!worker.generateAudio) {
    // Honest failure: audio is often the run's product (dogfood 2026-09-01,
    // tpl-news-podcast). Templates wanting a fallback add an error edge.
    states.set(nodeId, "failed");
    emit({ type: "node.failed", nodeId, attempt, error: "worker 无音频生成能力", errorCode: "VALIDATION" });
    return;
  }
  const prompt = cfg.prompt?.trim() || (await inputFor(node));
  try {
    const results = await worker.generateAudio({ node, config: cfg, input: prompt, signal: opts.signal });
    // See the videoGen branch: an empty result set means no audio was made,
    // which for an audio-first pipeline is a failed run, not a done one.
    if (results.length === 0) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `音频生成未返回任何结果（模型 ${cfg.model} 可能不支持该模态，或 provider 未提供该能力）`,
        errorCode: "UNSUPPORTED",
      });
      return;
    }
    let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: {} };
    const audioArts: Artifact[] = [];
    for (let idx = 0; idx < results.length; idx++) {
      const res = results[idx]!;
      const ext = res.mimeType.includes("wav") ? "wav" : res.mimeType.includes("ogg") ? "ogg" : res.mimeType.includes("opus") ? "opus" : "mp3";
      const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "ai-audio"}-${idx + 1}.${ext}`);
      const a: Artifact = {
        id: `${nodeId}-aud-${idx}`,
        kind: "audio",
        uri,
        sizeBytes: res.data.length,
        mimeType: res.mimeType,
        label: results.length > 1 ? `${node.name || "AI 音频"} #${idx + 1}` : node.name || "AI 音频",
      };
      audioArts.push(a);
      emit({ type: "artifact.produced", nodeId, artifact: a });
      usage = {
        tokensIn: (usage.tokensIn ?? 0) + (res.usage.tokensIn ?? 0),
        tokensOut: (usage.tokensOut ?? 0) + (res.usage.tokensOut ?? 0),
        costUsd: (usage.costUsd ?? 0) + (res.usage.costUsd ?? 0),
        units: { ...usage.units, ...res.usage.units },
      };
    }
    artifacts.set(nodeId, audioArts);
    emit({ type: "node.finished", nodeId, attempt, output: "", usage });
    states.set(nodeId, "done");
    sendPackets(nodeId, `生成音频 ${results.length} 段`, "audio");
  } catch (err) {
    console.warn(`[audioGen:${nodeId}] generation failed:`, (err as Error).message);
    states.set(nodeId, "failed");
    emit({ type: "node.failed", nodeId, attempt, error: `音频生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
  }
}
