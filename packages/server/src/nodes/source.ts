import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { CONNECTOR_MAX_RETRIES, CONNECTOR_RETRY_DELAY_MS, buildSourceBrief, setTextArtifact, zeroUsage } from "./shared.js";
import { resolveConnector } from "../connectors.js";

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

  const output = buildSourceBrief(node, sourceText);
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