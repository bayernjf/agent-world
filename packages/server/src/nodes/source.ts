import type { Artifact, Graph, GraphNode, SourceConfig } from "@agent-world/core";
import { evaluateTemplate } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { CONNECTOR_MAX_RETRIES, CONNECTOR_RETRY_DELAY_MS, buildSourceBrief, setTextArtifact, zeroUsage } from "./shared.js";
import { CONNECTOR_SHORTCUTS, resolveConnector } from "../connectors.js";

/**
 * Source node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function sourceNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, opts, produceArtifacts, sendPackets, states } = ctx;
  // source: optionally pull raw material from a connector before welding.
  let sourceText = opts.sourceInput ?? "";
  let sourceImages = node.source?.images ?? [];
  const sourceFiles = node.source?.files ?? [];
  const conn = node.source?.connector;
  let sourceData: unknown;
  if (conn) {
    let ok = false;
    let lastErr: unknown;
    for (let i = 0; i <= CONNECTOR_MAX_RETRIES && !ok; i++) {
      try {
        const m = await resolveConnector(conn, opts.connectorValues, opts.loadProducts);
        sourceText = m.text || opts.sourceInput || "";
        sourceImages = [...m.images, ...(node.source?.images ?? [])];
        sourceData = m.data;
        ok = true;
      } catch (err) {
        lastErr = err;
        if (i < CONNECTOR_MAX_RETRIES) await opts.sleep(CONNECTOR_RETRY_DELAY_MS);
      }
    }
    if (!ok) {
      const msg = `Connector "${conn.type}" 拉取失败：${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`;
      states.set(nodeId, "failed");
      ctx.status = "failed";
      emit({ type: "node.failed", nodeId, attempt, error: msg, errorCode: "CONNECTOR" });
      return;
    }
  }

  // 空 data 守护（design-data-interpolation.md §6.2）：product connector 库空/筛空
  // 时快捷名解析全空串，不 fail run，但 warn 一条避免下游 `${product.name}` 静默空。
  if (conn && conn.type === "product" && (!Array.isArray(sourceData) || sourceData.length === 0)) {
    ctx.log.warn("product connector returned empty data; ${product.name} resolves to empty string", { nodeId });
  }
  const output = (() => {
    // D5 (design-data-interpolation.md): brief fields interpolate `${product.x}`
    // against the connector's structured data and the registered global
    // shortcuts. Same "only one source of this type" gate as engine interpCtx,
    // so a brief that sees `${product.name}` is guaranteed to also be visible
    // to downstream nodes. Fallbacks fill empty fact fields (productName/brand)
    // from `data[0]`; tone fields are never auto-filled (D4).
    const briefCtx = sourceData !== undefined && conn
      ? buildBriefCtx(ctx.graph, nodeId, conn.type, sourceData)
      : {};
    const interpolatedNode = interpolateSourceNode(node, briefCtx);
    const fallbacks = sourceData !== undefined && conn
      ? deriveConnectorFallbacks(conn.type, sourceData)
      : undefined;
    return buildSourceBrief(interpolatedNode, sourceText, fallbacks);
  })();
  // D2 (design-data-interpolation.md): expose {data, content} for interpCtx —
  // `${srcId}` keeps resolving to the brief text, `${srcId.data[0].name}`
  // reaches the connector's structured payload. Only written when the
  // connector supplied structured data (product): plain sources keep their
  // ctx entry a bare string, so branch conditions like `${src} > 100` on
  // manual input stay byte-identical.
  if (sourceData !== undefined) {
    ctx.sourceMeta.set(nodeId, { data: sourceData, content: output });
  }
  setTextArtifact(artifacts, nodeId, output);
  states.set(nodeId, "done");
  emit({ type: "node.started", nodeId, attempt });
  emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
  let primaryKind: Artifact["kind"] | undefined;
  // Uploaded documents become first-class file artifacts next to the text
  // note, so a downstream fileParse node can find its `kind === "file"`
  // input. Before this, no source node could produce a file at all — a
  // 「合同文件」 intake left fileParse failing with 没有产出文件产物
  // (dogfood 2026-09-01, tpl-contract-review).
  if (sourceFiles.length) {
    const nodeArts = artifacts.get(nodeId)!;
    for (const [i, f] of sourceFiles.entries()) {
      const a: Artifact = {
        id: `${nodeId}-file${i}`,
        kind: "file",
        uri: f.uri,
        mimeType: f.mimeType,
        label: f.label,
        sizeBytes: f.sizeBytes,
      };
      nodeArts.push(a);
      emit({ type: "artifact.produced", nodeId, artifact: a });
    }
  }
  if (sourceImages.length) {
    const nodeArts = artifacts.get(nodeId)!;
    for (const [i, url] of sourceImages.entries()) {
      const a: Artifact = { id: `${nodeId}-img${i}`, kind: "image", uri: url };
      nodeArts.push(a);
      emit({ type: "artifact.produced", nodeId, artifact: a });
    }
    primaryKind = "image";
  } else {
    primaryKind = produceArtifacts(nodeId, output, attempt);
  }
  sendPackets(nodeId, output.slice(0, 120), primaryKind);
  return;
}

/**
 * Source field names that participate in the brief and are eligible for
 * `${...}` interpolation. Kept here (not in buildSourceBrief) because the
 * interpolation is a pre-step — buildSourceBrief still sees only the final
 * string values, which keeps its public surface free of template concerns.
 */
const BRIEF_FIELDS = [
  "productName",
  "brand",
  "audience",
  "priceRange",
  "tone",
  "prohibited",
  "brandTerms",
  "notes",
] as const satisfies ReadonlyArray<keyof SourceConfig>;

/**
 * Build the interpolation context for brief-field evaluation. Mirrors the
 * "exactly one source of this connector type" rule used by engine interpCtx
 * (design-data-interpolation.md §3.2), so the brief never sees `${product.x}`
 * when downstream nodes wouldn't. Always exposes `data` (the connector payload)
 * directly so `${data[0].name}` works regardless of shortcut availability.
 */
function buildBriefCtx(
  graph: Graph,
  thisNodeId: string,
  thisConnector: string,
  thisData: unknown,
): Record<string, unknown> {
  const counts = new Map<string, number>();
  for (const n of graph.nodes) {
    if (n.kind !== "source") continue;
    const t = n.source?.connector?.type;
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const ctx: Record<string, unknown> = { data: thisData };
  for (const s of CONNECTOR_SHORTCUTS) {
    if (s.connector !== thisConnector) continue;
    if ((counts.get(s.connector) ?? 0) !== 1) continue;
    ctx[s.name] = s.pick(thisData);
  }
  return ctx;
}

/**
 * Evaluate `${...}` placeholders in any brief field that opted into it. Pure
 * string fields are passed through untouched (single-pass replace; data
 * values carrying literal `${var.x}` are NOT expanded twice — design §6).
 * Returns a shallow-cloned node whose `source` only contains post-interpolation
 * values, leaving the caller's `node` reference unchanged.
 */
function interpolateSourceNode(node: GraphNode, ctx: Record<string, unknown>): GraphNode {
  const src = node.source;
  if (!src) return node;
  const out: SourceConfig = { ...src };
  let changed = false;
  for (const key of BRIEF_FIELDS) {
    const v = src[key];
    if (typeof v === "string" && v.includes("${")) {
      (out as Record<string, unknown>)[key] = evaluateTemplate(v, ctx);
      changed = true;
    }
  }
  return changed ? { ...node, source: out } : node;
}

/**
 * Build fact-field fallbacks from connector data. Only `product` participates
 * today (other connectors will add their own mapping when they adopt the
 * structured channel). Returns undefined for unknown connector types, empty
 * data, or rows missing both `name` and `brand` — the brief keeps its
 * pre-fallback output in those cases, which is the safe default.
 */
function deriveConnectorFallbacks(
  connectorType: string,
  data: unknown,
): Record<string, string> | undefined {
  if (connectorType !== "product") return undefined;
  if (!Array.isArray(data) || data.length === 0) return undefined;
  const first = data[0] as Record<string, unknown>;
  const f: Record<string, string> = {};
  if (typeof first.name === "string" && first.name) f.productName = first.name;
  if (typeof first.brand === "string" && first.brand) f.brand = first.brand;
  return Object.keys(f).length > 0 ? f : undefined;
}
