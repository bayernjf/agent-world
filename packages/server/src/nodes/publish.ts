import { PublishConfig, buildPublishPackage, publishArtifact } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { setTextArtifact, zeroUsage } from "./shared.js";

/**
 * Publish node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function publishNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, inputFor, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = PublishConfig.parse(node.publish ?? {});
    const output = await inputFor(node);
    if (!output.trim()) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: "发布节点没有收到可整理的文本",
        errorCode: "VALIDATION",
      });
      return;
    }
    const pkg = buildPublishPackage(output, cfg);
    const payload = publishArtifact(pkg);
    const jsonArtifact: Artifact = {
      id: `${nodeId}-publish`,
      kind: "json",
      content: JSON.stringify(payload),
      mimeType: "application/json",
    };
    const produced: Artifact[] = [jsonArtifact];
    // Downstream nodes consume the assembled body (falls back to the title).
    const downstreamText = pkg.body || pkg.title;
    setTextArtifact(artifacts, nodeId, downstreamText);
    artifacts.set(nodeId, [...produced, ...(artifacts.get(nodeId) ?? [])]);
    for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });

    states.set(nodeId, "done");
    const summary = `已整理为${pkg.platformLabel}待发布包（标题 ${pkg.title.length} 字 / 正文 ${pkg.body.length} 字）`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "json");
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `发布节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
