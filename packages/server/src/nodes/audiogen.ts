import type { Artifact, GraphNode, Usage } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { sanitizeError } from "../sanitize.js";

/**
 * Maximum characters sent to a TTS provider in one request. OpenAI's
 * /audio/speech historically rejects single inputs beyond this length; other
 * providers (e.g. SiliconFlow) may document a lower ceiling. P1 (G-D in
 * docs/design-tts-provider.md) fails fast with an actionable error instead of
 * silently truncating; P2 may add server-side chunking + stitching.
 */
export const TTS_MAX_INPUT_CHARS = 4096;

/**
 * AudioGen node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function audioGenNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, budgetUsd, emit, inputFor, opts, sendPackets, states, worker } = ctx;
  const cfg = node.audioGen ?? { model: "tts-1", format: "mp3", n: 1 };
  if (!worker.generateAudio) {
    // G-C soft degrade (docs/design-tts-provider.md, decided 2026-09-24): in the
    // podcast flow the written script is the primary deliverable and the
    // voice-over is an add-on. When no audio capability is configured (zero-setup
    // / text-only provider), skip the node — visible in the timeline — instead of
    // failing the whole run. tpl-news-podcast wires a script→sink bypass edge so
    // the script still reaches the depot as a text deliverable. Graphs that treat
    // audio as mandatory should attach an error edge or alert on the skip. Note
    // a configured-but-empty/over-length response still fails below (real error).
    states.set(nodeId, "skipped");
    ctx.log.warn("audioGen skipped: worker has no generateAudio capability", { nodeId, model: cfg.model });
    emit({
      type: "node.skipped",
      nodeId,
      attempt,
      reason: "audio unsupported: worker has no generateAudio capability",
    });
    return;
  }
  emit({ type: "node.started", nodeId, attempt });
  const prompt = cfg.prompt?.trim() || (await inputFor(node));
  // G-D: reject over-length input before paying for a request the provider would
  // reject anyway. `n` produces N variants of the SAME text, not chunks, so the
  // length is checked once. Fail fast with guidance rather than truncating.
  if (prompt.length > TTS_MAX_INPUT_CHARS) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `配音文本过长（${prompt.length} 字符，上限 ${TTS_MAX_INPUT_CHARS} 字符）。请在配音节点前拆分稿件，或缩短上游口播稿长度后重试。`,
      errorCode: "VALIDATION",
    });
    return;
  }
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
    ctx.totalCostUsd += usage.costUsd;
    emit({ type: "power.metered", totalCostUsd: ctx.totalCostUsd, budgetUsd });
    emit({ type: "node.finished", nodeId, attempt, output: "", usage: { ...usage, model: cfg.model } });
    states.set(nodeId, "done");
    sendPackets(nodeId, `生成音频 ${results.length} 段`, "audio");
  } catch (err) {
    ctx.log.warn("audioGen generation failed", { nodeId, error: (err as Error).message });
    states.set(nodeId, "failed");
    emit({ type: "node.failed", nodeId, attempt, error: `音频生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
  }
}
