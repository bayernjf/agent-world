import type { Artifact, GraphNode, Usage } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { buildImagePrompt } from "./shared.js";
import { sanitizeError } from "../sanitize.js";

/**
 * ImageGen node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function imageGenNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, graph, opts, sendPackets, states, worker } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const cfg = node.imageGen ?? { model: "agnes-image", prompt: "", n: 1 };
  const prompt = cfg.prompt?.trim() || buildImagePrompt(node, graph);
  try {
    const results = await worker.generateImage({ node, config: cfg, input: prompt, signal: opts.signal });
    // See the videoGen branch: zero images means nothing was produced.
    if (results.length === 0) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `配图生成未返回任何结果（模型 ${cfg.model} 可能不支持该模态，或 provider 未提供该能力）`,
        errorCode: "UNSUPPORTED",
      });
      return;
    }
    let usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { images: 0 } };
    const imageArts: Artifact[] = [];
    for (let idx = 0; idx < results.length; idx++) {
      const res = results[idx]!;
      const uri = await opts.storeBinary(res.data, res.mimeType, `${node.name || "ai-image"}-${idx + 1}.png`);
      const a: Artifact = {
        id: `${nodeId}-img-${idx}`,
        kind: "image",
        uri,
        sizeBytes: res.data.length,
        mimeType: res.mimeType,
        label: results.length > 1 ? `${node.name || "AI 配图"} #${idx + 1}` : node.name || "AI 配图",
      };
      imageArts.push(a);
      emit({ type: "artifact.produced", nodeId, artifact: a });
      usage = {
        tokensIn: (usage.tokensIn ?? 0) + (res.usage.tokensIn ?? 0),
        tokensOut: (usage.tokensOut ?? 0) + (res.usage.tokensOut ?? 0),
        costUsd: (usage.costUsd ?? 0) + (res.usage.costUsd ?? 0),
        units: { ...usage.units, images: (usage.units?.images ?? 0) + (res.usage.units?.images ?? 0) },
      };
    }
    artifacts.set(nodeId, imageArts);
    emit({ type: "node.finished", nodeId, attempt, output: "", usage });
    states.set(nodeId, "done");
    sendPackets(nodeId, `生成配图 ${results.length} 张`, "image");
  } catch (err) {
    // Same rule as videoGen/audioGen: a throw is not a degrade-and-continue.
    // 配图往往就是这条产线的产物（2026-08-31 狗粮撞过 agnes 图片 503），标 done
    // 会交出一条没有图的成品；旧的兜底还往下游发一个 text 包「生图失败（已降级
    // 跳过）」，写手会把这句报错当素材写进正文。要兜底就接 error 边。
    ctx.log.warn("imageGen generation failed", { nodeId, error: (err as Error).message });
    states.set(nodeId, "failed");
    emit({ type: "node.failed", nodeId, attempt, error: `配图生成失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`, errorCode: "PROVIDER_ERROR" });
  }
}
