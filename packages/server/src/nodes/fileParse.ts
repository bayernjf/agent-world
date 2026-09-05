import { FileParseConfig, incoming, nodeById } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { zeroUsage } from "./shared.js";
import { dataUriToBuffer, parseDocument } from "../parse-file.js";
import { MAX_INLINE_BYTES } from "../artifact-reader.js";

/**
 * FileParse node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function fileParseNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, graph, opts, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = FileParseConfig.parse(node.fileParse ?? {});
    const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
    const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
    if (!sourceId) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: "文件解析节点需要唯一上游，或在配置中显式指定数据来源",
        errorCode: "VALIDATION",
      });
      return;
    }
    const arts = artifacts.get(sourceId) ?? [];
    const fileArts = arts.filter((a) => a.kind === "file" && a.uri);
    if (fileArts.length === 0) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `上游「${nodeById(graph, sourceId)?.name ?? sourceId}」没有产出文件产物`,
        errorCode: "VALIDATION",
      });
      return;
    }
    // Parse every uploaded document (was: first only — a batch of contracts
    // or due-diligence files silently dropped all but the first). Multi-doc
    // text is joined under per-file headers so downstream textGen can tell
    // the documents apart; the single-doc path stays byte-identical.
    const blocks: string[] = [];
    const images: { data: Buffer; mimeType: string; label: string }[] = [];
    let unresolvedCount = 0;
    for (const [i, fileArt] of fileArts.entries()) {
      const resolved = opts.readArtifact ? await opts.readArtifact(fileArt.uri!) : null;
      if (!resolved) {
        unresolvedCount++;
        continue;
      }
      const parsed = await parseDocument(dataUriToBuffer(resolved), fileArt.mimeType);
      const label = fileArt.label ?? `文档 ${i + 1}`;
      const header = fileArts.length > 1 ? `===== ${label} =====` : "";
      blocks.push(header ? `${header}\n${parsed.text}` : parsed.text);
      for (const img of parsed.images) {
        images.push({ data: Buffer.from(img.data), mimeType: img.mimeType, label: `${label} 图片 ${images.length + 1}` });
      }
    }
    if (blocks.length === 0) {
      const capMb = Math.floor(MAX_INLINE_BYTES / (1024 * 1024));
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `无法读取文件内容（${fileArts[0]!.uri}）：产物字节不存在，或文件超过解析上限 ${capMb}MB（上传允许 25MB，但解析需要整体内联读入）`,
        errorCode: "PROVIDER_ERROR",
      });
      return;
    }
    const output = blocks.join("\n\n");
    const produced: Artifact[] = [
      { id: `${nodeId}-txt`, kind: "text", content: output, mimeType: "text/plain" },
    ];
    for (const [idx, img] of images.slice(0, cfg.maxImages).entries()) {
      const ext =
        img.mimeType === "image/png"
          ? "png"
          : img.mimeType === "image/jpeg"
            ? "jpg"
            : (img.mimeType.split("/")[1] ?? "bin");
      const uri = await opts.storeBinary(
        Buffer.from(img.data),
        img.mimeType,
        `${node.name || "file-parse"}-${idx + 1}.${ext}`,
      );
      produced.push({
        id: `${nodeId}-img-${idx}`,
        kind: "image",
        uri,
        mimeType: img.mimeType,
        label: img.label,
      });
    }
    artifacts.set(nodeId, produced);
    for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
    states.set(nodeId, "done");
    const imgCount = produced.length - 1;
    const parsedCount = fileArts.length - unresolvedCount;
    const summary = `解析完成：${parsedCount} 个文档，${output.length} 字符文本${imgCount ? `，提取 ${imgCount} 张图片` : ""}${unresolvedCount > 0 ? `；另有 ${unresolvedCount} 个文档无法读取` : ""}`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "text");
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `文件解析节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
