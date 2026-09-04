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
  setTextArtifact(artifacts, nodeId, output);
  states.set(nodeId, "done");
  emit({ type: "node.started", nodeId, attempt });
  emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
  produceArtifacts(nodeId, output, attempt);
  sendPackets(nodeId, output.slice(0, 120), "text");
  return;
}
