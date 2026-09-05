import { OcrConfig, incoming, nodeById } from "@agent-world/core";
import type { GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { setTextArtifact, zeroUsage } from "./shared.js";
import { dataUriToBuffer } from "../parse-file.js";
import { ocrImage } from "../ocr.js";
import { sanitizeError } from "../sanitize.js";

/**
 * Ocr node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function ocrNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, graph, opts, produceArtifacts, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = OcrConfig.parse(node.ocr ?? {});
    const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
    const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
    if (!sourceId) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: "OCR 节点需要唯一上游，或在配置中显式指定数据来源",
        errorCode: "VALIDATION",
      });
      return;
    }
    const arts = artifacts.get(sourceId) ?? [];
    const images = arts.filter((a) => a.kind === "image" && a.uri);
    if (images.length === 0) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `上游「${nodeById(graph, sourceId)?.name ?? sourceId}」没有产出可识别的图片（需要 image 产物）`,
        errorCode: "VALIDATION",
      });
      return;
    }
    const blocks: string[] = [];
    let totalConfidence = 0;
    for (const art of images) {
      const resolved = opts.readArtifact ? await opts.readArtifact(art.uri!) : null;
      if (!resolved) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `无法读取图片内容（${art.uri}）`,
          errorCode: "PROVIDER_ERROR",
        });
        return;
      }
      const buf = dataUriToBuffer(resolved);
      let res: { text: string; confidence: number };
      try {
        res = await ocrImage(buf, cfg);
      } catch (err) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `OCR 识别失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
          errorCode: "PROVIDER_ERROR",
        });
        return;
      }
      blocks.push(res.text);
      totalConfidence += res.confidence;
    }
    const output = blocks.join("\n\n").trim();
    setTextArtifact(artifacts, nodeId, output);
    states.set(nodeId, "done");
    const avgConf = images.length ? Math.round(totalConfidence / images.length) : 0;
    const summary = output
      ? `识别完成：${images.length} 张图片，${output.length} 字符，平均置信度 ${avgConf}%`
      : "识别完成：未识别到文字";
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    const primaryKind = produceArtifacts(nodeId, output, attempt);
    sendPackets(nodeId, summary, primaryKind);
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `OCR 节点执行出错: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
    });
  }
}
