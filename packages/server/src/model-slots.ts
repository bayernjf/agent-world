import type { Graph, Modality, NodeKind } from "@agent-world/core";
import { modalityOf, type AppConfig, type ProviderConfig } from "./config.js";

/** Which node kinds need a worker model, and which modality they need. */
export const NODE_KIND_MODALITY: Partial<Record<NodeKind, Modality>> = {
  textGen: "text",
  imageGen: "image",
  videoGen: "video",
  audioGen: "audio",
};

/** The model-bearing config of a node, or null when the kind carries none. */
export function nodeModelConfig(
  node: Graph["nodes"][number],
): { model?: string } | null {
  switch (node.kind) {
    case "textGen":
      return node.textGen ?? null;
    case "imageGen":
      return node.imageGen ?? null;
    case "videoGen":
      return node.videoGen ?? null;
    case "audioGen":
      return node.audioGen ?? null;
    case "generic":
      return node.generic ?? null;
    default:
      return null;
  }
}

/**
 * The modality a node's model slot must satisfy. For the four fixed kinds that
 * is `NODE_KIND_MODALITY`; a `generic` node declares its own modality, and
 * without one it auto-dispatches as text (`modalityOf` defaults to text).
 */
export function nodeModality(node: Graph["nodes"][number]): Modality | null {
  const fixed = NODE_KIND_MODALITY[node.kind];
  if (fixed) return fixed;
  if (node.kind === "generic") return node.generic?.modality ?? "text";
  return null;
}

/** An enabled provider that actually owns `model`. */
function ownedEnabled(cfg: AppConfig, provider: ProviderConfig, model: string): boolean {
  if (provider.enabled === false) return false;
  return provider.models.includes(model);
}

/**
 * Which model to use when a node says "follow the current default" (`model: ""`,
 * design-model-catalog 规则 B). Text follows the user's configured default —
 * including when that default is itself broken, because the honest outcome is a
 * `validateModels` error naming it, not a silent substitution. Media has no
 * per-modality setting to read, so it takes the first `modelOrder` entry whose
 * provider is enabled and whose modality matches.
 */
export function defaultModelForModality(cfg: AppConfig, modality: Modality): string {
  if (modality === "text" && cfg.defaultModel?.trim()) return cfg.defaultModel.trim();
  const order = cfg.modelOrder?.length
    ? cfg.modelOrder
    : Object.entries(cfg.providers).flatMap(([name, p]) => p.models.map((m) => `${name}::${m}`));
  for (const ref of order) {
    const sep = ref.indexOf("::");
    if (sep < 0) continue;
    const name = ref.slice(0, sep);
    const model = ref.slice(sep + 2);
    const provider = cfg.providers[name];
    if (!provider || !ownedEnabled(cfg, provider, model)) continue;
    if (modalityOf(provider, model) !== modality) continue;
    return model;
  }
  return "";
}

/**
 * Fill in every "follow the current default" model slot (`model: ""`) from the
 * live config. Returns the same graph instance when nothing needed filling, so
 * callers keep their object identity and an unchanged document costs nothing.
 *
 * This runs once, at dispatch, inside `startRun` — deliberately not at read time:
 * the persisted document must keep its exact bytes (contentHash drives version
 * snapshots), while the run snapshot has to carry the *resolved* name (the eval
 * prompt fingerprint hashes model+prompt off the snapshot, so a snapshot storing
 * "" would silently merge two different model generations into one version).
 * `""` is never a value that survives past this point.
 */
export function resolveModelSlots(graph: Graph, cfg: AppConfig): Graph {
  let nodes: Graph["nodes"] | null = null;
  graph.nodes.forEach((node, i) => {
    const conf = nodeModelConfig(node);
    if (!conf || (conf.model ?? "").trim() !== "") return;
    const modality = nodeModality(node);
    if (!modality) return;
    const model = defaultModelForModality(cfg, modality);
    // Nothing to follow: leave the slot empty and let validateModels report the
    // honest "该节点还未配置模型" rather than inventing a substitution.
    if (!model) return;
    if (!nodes) nodes = [...graph.nodes];
    nodes[i] = withModel(node, model);
  });
  return nodes ? { ...graph, nodes } : graph;
}

function withModel(node: Graph["nodes"][number], model: string): Graph["nodes"][number] {
  switch (node.kind) {
    case "textGen":
      return { ...node, textGen: { ...node.textGen!, model } };
    case "imageGen":
      return { ...node, imageGen: { ...node.imageGen!, model } };
    case "videoGen":
      return { ...node, videoGen: { ...node.videoGen!, model } };
    case "audioGen":
      return { ...node, audioGen: { ...node.audioGen!, model } };
    case "generic":
      return { ...node, generic: { ...node.generic!, model } };
    default:
      return node;
  }
}
