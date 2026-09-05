import { LoopConfig, incoming, nodeById, outgoing, transformJson } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { zeroUsage } from "./shared.js";

/**
 * Loop node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function loopNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifactValue, artifacts, emit, graph, loopItemByNode, nodeCtx, plan, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const bodyIds = new Set<string>();
  try {
    const cfg = LoopConfig.parse(node.loop ?? {});
    // Local template context (renamed from `ctx`, which now names the NodeRunContext).
    const tplCtx = nodeCtx(nodeId);
    const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
    const defaultSource = sources.length === 1 ? sources[0] : undefined;
    const itemsExpr = cfg.items ?? (defaultSource ? `\${${defaultSource}}` : "");
    if (!itemsExpr) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: "Loop 节点需要 items 表达式（或恰好一个上游节点提供数组）",
        errorCode: "VALIDATION",
      });
      return;
    }
    const raw = transformJson(itemsExpr, tplCtx);
    if (!Array.isArray(raw)) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `items 表达式求值结果不是数组（当前: ${typeof raw}）`,
        errorCode: "VALIDATION",
      });
      return;
    }
    const max = cfg.maxIterations ?? 100;
    const slice = raw.slice(0, max);

    // Loop body: BFS from the loop's flow edges. A node is part of the
    // body iff every flow predecessor is the loop itself or already in
    // the body — this stops at merge points that have outside inputs.
    const queue = outgoing(graph, nodeId, "flow").map((e) => e.to);
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (bodyIds.has(id)) continue;
      const ins = incoming(graph, id, "flow");
      const allInside = ins.every((e) => e.from === nodeId || bodyIds.has(e.from));
      if (!allInside) continue;
      bodyIds.add(id);
      for (const e of outgoing(graph, id, "flow")) queue.push(e.to);
    }
    const bodyOrder = plan.order.filter((id) => bodyIds.has(id));
    if (bodyOrder.length === 0) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: "Loop 节点没有可执行的循环体，请连接下游节点",
        errorCode: "VALIDATION",
      });
      return;
    }
    // Terminal nodes of the body: all flow edges point outside it.
    const endNodes = bodyOrder.filter((id) =>
      outgoing(graph, id, "flow").every((e) => !bodyIds.has(e.to)),
    );
    const results: unknown[] = [];
    for (let i = 0; i < slice.length; i++) {
      const item = slice[i];
      for (const bodyId of bodyOrder) loopItemByNode.set(bodyId, item);
      for (const bodyId of bodyOrder) {
        // Borrow a ctx.running slot: runNode's finally decrements it, so
        // this keeps the run open while the loop executes its body
        // inline (otherwise ctx.running hits 0 mid-loop and the run closes).
        ctx.running++;
        await ctx.runNode(bodyId);
        if (states.get(bodyId) === "failed") {
          throw new Error(`循环体节点「${nodeById(graph, bodyId)?.name ?? bodyId}」执行失败`);
        }
      }
      if (endNodes.length === 1) {
        results.push(artifactValue(endNodes[0]!));
      } else {
        const round: Record<string, unknown> = {};
        for (const id of endNodes) round[id] = artifactValue(id);
        results.push(round);
      }
    }
    for (const bodyId of bodyIds) loopItemByNode.delete(bodyId);
    const content = JSON.stringify({ results });
    const artifact: Artifact = {
      id: `${nodeId}-loop-json`,
      kind: "json",
      content,
      mimeType: "application/json",
    };
    artifacts.set(nodeId, [artifact]);
    emit({ type: "artifact.produced", nodeId, attempt, artifact });
    states.set(nodeId, "done");
    const summary = `循环 ${slice.length} 次完成`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "json");
  } catch (err) {
    for (const bodyId of bodyIds) loopItemByNode.delete(bodyId);
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `Loop 节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  return;
}
