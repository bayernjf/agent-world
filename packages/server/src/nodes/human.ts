import type { GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { notifyHalt } from "../notify.js";

/**
 * Human node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function humanNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { emit, graph, inputFor, runId } = ctx;
  // Pause the run at an arbitrary point for an operator decision. The
  // upstream text becomes the pending review; approve/edit passes it
  // downstream, reject fails the node (error edges can catch it).
  const output = await inputFor(node);
  emit({ type: "node.started", nodeId, attempt });
  emit({ type: "human.review", nodeId, attempt, content: output });
  ctx.haltNodeId = nodeId;
  ctx.haltReason = `human:${node.human?.prompt || node.name}`;
  ctx.status = "halted";
  ctx.aborted = true;
  void notifyHalt({ runId, graphId: graph.id, nodeId, reason: ctx.haltReason });
}
