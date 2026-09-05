import { BranchConfig, evaluateCondition, nodeById, outgoing } from "@agent-world/core";
import type { GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { zeroUsage } from "./shared.js";

/**
 * Branch node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function branchNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { emit, graph, interpCtx, markBranchSkipped, packetEdges, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const cfg: BranchConfig = BranchConfig.parse(node.branch ?? {});
  // Local condition context (renamed from `ctx`, which now names the NodeRunContext).
  const condCtx = interpCtx(nodeId);
  let target: string | undefined;
  let matchedRule: string | undefined;
  for (const rule of cfg.rules ?? []) {
    if (evaluateCondition(rule.when, condCtx)) {
      target = rule.target;
      matchedRule = rule.id;
      break;
    }
  }
  if (!target && cfg.defaultTarget) {
    target = cfg.defaultTarget;
    matchedRule = undefined;
  }
  if (target) {
    const edge = outgoing(graph, nodeId, "flow").find((e) => e.to === target);
    if (edge) {
      packetEdges.add(edge.id);
      emit({
        type: "packet.sent",
        edgeId: edge.id,
        from: nodeId,
        to: target,
        summary: matchedRule ? `命中分支 ${matchedRule}` : "默认分支",
        artifactKind: "text",
      });
    }
  }
  states.set(nodeId, "done");
  markBranchSkipped(nodeId, target);
  const output = target
    ? `路由 → ${nodeById(graph, target)?.name ?? target}${matchedRule ? `（${matchedRule}）` : "（默认）"}`
    : "未命中任何分支，报文被丢弃";
  emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
}
