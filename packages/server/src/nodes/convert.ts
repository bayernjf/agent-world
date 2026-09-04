import { ConvertConfig, incoming, nodeById } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { zeroUsage } from "./shared.js";
import { dataUriToBuffer, extractPdfImages } from "../parse-file.js";
import { decodeImage, encodeJpeg, encodePng } from "../convert.js";
import { sanitizeError } from "../sanitize.js";

/**
 * Convert node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function convertNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, graph, opts, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = ConvertConfig.parse(node.convert ?? {});
    const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
    const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
    if (!sourceId) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: "文件转换节点需要唯一上游，或在配置中显式指定数据来源",
        errorCode: "VALIDATION",
      });
      return;
    }
    const arts = artifacts.get(sourceId) ?? [];
    const produced: Artifact[] = [];
    const ext = (mime: string) => (mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : (mime.split("/")[1] ?? "bin"));
    if (cfg.to === "image") {
      // pdf → image: extract every embedded image (scanned pages = one image each).
      const fileArt = arts.find((a) => a.kind === "file" && a.uri);
      if (!fileArt) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `上游「${nodeById(graph, sourceId)?.name ?? sourceId}」没有产出可转换的文件产物（PDF → 图片需要 file 产物）`,
          errorCode: "VALIDATION",
        });
        return;
      }
      const resolved = opts.readArtifact ? await opts.readArtifact(fileArt.uri!) : null;
      if (!resolved) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `无法读取文件内容（${fileArt.uri}）`,
          errorCode: "PROVIDER_ERROR",
        });
        return;
      }
      const buf = dataUriToBuffer(resolved);
      const images = await extractPdfImages(
        new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      );
      if (images.length === 0) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: "文件中没有可提取的图片（纯文本 PDF 无法转为图片）",
          errorCode: "VALIDATION",
        });
        return;
      }
      for (const [idx, img] of images.entries()) {
        const uri = await opts.storeBinary(
          Buffer.from(img.data),
          img.mimeType,
          `${node.name || "convert"}-${idx + 1}.${ext(img.mimeType)}`,
        );
        produced.push({
          id: `${nodeId}-img-${idx}`,
          kind: "image",
          uri,
          mimeType: img.mimeType,
          label: `${fileArt.label ?? "文件"} 图片 ${idx + 1}`,
        });
      }
    } else {
      // image → png/jpeg: re-encode every upstream image artifact.
      const inputs = arts.filter(
        (a) =>
          a.uri &&
          (a.kind === "image" || (a.kind === "file" && (a.mimeType ?? "").startsWith("image/"))),
      );
      if (inputs.length === 0) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `上游「${nodeById(graph, sourceId)?.name ?? sourceId}」没有产出可转换的图片（需要 image 产物或图片类文件）`,
          errorCode: "VALIDATION",
        });
        return;
      }
      const mime = cfg.to === "jpeg" ? "image/jpeg" : "image/png";
      for (const [idx, art] of inputs.entries()) {
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
        let out: Buffer;
        try {
          const decoded = decodeImage(buf);
          out = cfg.to === "jpeg" ? encodeJpeg(decoded, cfg.quality) : encodePng(decoded);
        } catch (err) {
          states.set(nodeId, "failed");
          emit({
            type: "node.failed",
            nodeId,
            attempt,
            error: `图片转换失败: ${err instanceof Error ? err.message : String(err)}`,
            errorCode: "PROVIDER_ERROR",
          });
          return;
        }
        const uri = await opts.storeBinary(
          out,
          mime,
          `${node.name || "convert"}-${idx + 1}.${cfg.to}`,
        );
        produced.push({
          id: `${nodeId}-img-${idx}`,
          kind: "image",
          uri,
          mimeType: mime,
          label: `${art.label ?? "图片"} → ${cfg.to.toUpperCase()}`,
        });
      }
    }
    artifacts.set(nodeId, produced);
    for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
    states.set(nodeId, "done");
    const summary =
      cfg.to === "image"
        ? `转换完成：提取 ${produced.length} 张图片`
        : `转换完成：${produced.length} 张图片转为 ${cfg.to.toUpperCase()}`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "image");
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `文件转换节点执行出错: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
    });
  }
}
