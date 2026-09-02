import type { Graph, NodeKind } from "@agent-world/core";
import { providerForModel, DEFAULT_MODALITY, type AppConfig } from "./config.js";

/** Which node kinds require a worker model and which modality they need. */
const NODE_KIND_MODALITY: Partial<Record<NodeKind, "text" | "image" | "video" | "audio">> = {
  textGen: "text",
  imageGen: "image",
  videoGen: "video",
  audioGen: "audio",
};

const MODALITY_LABEL: Record<string, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
  embedding: "向量",
};

export interface ModelDiagnostic {
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
}

/**
 * Validate that every node which needs a worker model actually has one that
 * the engine can route to. Missing/disabled/unknown models are reported as
 * errors so dispatch can refuse the run. A wrong-modality model is an error
 * for media nodes (imageGen/videoGen/audioGen — a text model can never
 * produce their artifact, and a silent skip would mask the failure), but
 * stays a warning for textGen (routing a multimodal model through a text
 * agent for inspection is a legitimate use).
 */
export function validateModels(graph: Graph, config: AppConfig): ModelDiagnostic[] {
  const out: ModelDiagnostic[] = [];
  for (const n of graph.nodes) {
    const wanted = NODE_KIND_MODALITY[n.kind];
    if (!wanted) continue;
    const cfg =
      n.kind === "textGen" ? n.textGen :
      n.kind === "imageGen" ? n.imageGen :
      n.kind === "videoGen" ? n.videoGen :
      n.kind === "audioGen" ? n.audioGen : null;
    if (!cfg) {
      out.push({
        severity: "error",
        message: `节点「${n.name}」(${n.kind}) 缺少配置，无法派发。请在 Inspector 中补全。`,
        nodeId: n.id,
      });
      continue;
    }
    const model = (cfg as { model?: string }).model?.trim() ?? "";
    if (!model) {
      out.push({
        severity: "error",
        message: `节点「${n.name}」(${n.kind}) 还未配置 ${MODALITY_LABEL[wanted]} 模型，请先在「模型设置」中添加后再派发。`,
        nodeId: n.id,
      });
      continue;
    }
    const { name: provName, provider } = providerForModel(config, model);
    // Built-in providers (demo fake worker or product-hosted tier) are
    // allowed because they ship pre-registered from DEFAULT_CONFIG and route
    // through the local fake worker.
    const isBuiltin = provider.source === "builtin";
    const isRegistered = provider.models.includes(model) || provName === model;
    if (!isBuiltin && !isRegistered) {
      out.push({
        severity: "error",
        message: `节点「${n.name}」的模型「${model}」未在「模型设置」中注册。`,
        nodeId: n.id,
      });
      continue;
    }
    if (provider.enabled === false) {
      out.push({
        severity: "error",
        message: `节点「${n.name}」的模型所属 Provider「${provName}」已停用，请在「模型设置」中启用。`,
        nodeId: n.id,
      });
      continue;
    }
    const mod = provider.modalities?.[model] ?? DEFAULT_MODALITY;
    if (mod !== wanted) {
      // Media nodes can never produce their artifact from a wrong-modality
      // model — the engine would soft-skip them and the run would report
      // done with no product (dogfood 2026-09-01, tpl-news-podcast). Block
      // at dispatch instead; textGen stays a warning (multimodal inspection).
      const mediaNode = n.kind === "imageGen" || n.kind === "videoGen" || n.kind === "audioGen";
      out.push({
        severity: mediaNode ? "error" : "warning",
        message: mediaNode
          ? `节点「${n.name}」的模型「${model}」实际是 ${MODALITY_LABEL[mod] ?? mod} 类型，无法产出${MODALITY_LABEL[wanted]}。请在 Inspector 中为该节点选择${MODALITY_LABEL[wanted]}类型模型后再派发。`
          : `节点「${n.name}」的模型「${model}」实际是 ${MODALITY_LABEL[mod] ?? mod} 类型，与该节点期望的 ${MODALITY_LABEL[wanted]} 不一致。`,
        nodeId: n.id,
      });
    }
  }
  return out;
}
