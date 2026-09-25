import type { GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { setTextArtifact, zeroUsage } from "./shared.js";

/**
 * Sink node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function sinkNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, inputFor, produceArtifacts, sendPackets, states } = ctx;
  const output = await inputFor(node);
  if (!output.trim()) {
    // 上游为空时终点不该静默产出一件空「成品」：照 publish 节点的守卫形状，
    // 记 failed + VALIDATION，让错误边缘/页面能看到原因而不是一路 done。
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: "成品库节点没有收到可整理的文本",
      errorCode: "VALIDATION",
    });
    return;
  }
  setTextArtifact(artifacts, nodeId, output);
  states.set(nodeId, "done");
  emit({ type: "node.started", nodeId, attempt });
  emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
  produceArtifacts(nodeId, output, attempt);
  sendPackets(nodeId, output.slice(0, 120), "text");
  return;
}
