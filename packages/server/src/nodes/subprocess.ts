import { SubprocessConfig, compile } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { prefixEvent, zeroUsage } from "./shared.js";
import type { NodeState, SchedulerInit, Status } from "../engine.js";

/**
 * Subprocess node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function subprocessNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { approved, artifactValue, artifacts, attempts, budgetUsd, emit, extractSubInit, fallbackModel, finish, graph, inputFor, mergeSubInit, monthSpentUsd, monthlyBudgetUsd, nodeCostUsd, opts, packetEdges, plan, runId, sendPackets, states, variables, worker } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = SubprocessConfig.parse(node.subprocess ?? {});
    const depth = opts.subprocessDepth ?? 0;
    if (depth >= cfg.maxDepth) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `子流程调用深度超限（第 ${depth + 1} 层超过 maxDepth ${cfg.maxDepth}），可能存在循环调用`,
        errorCode: "VALIDATION",
      });
      return;
    }
    const childGraph = opts.loadSubgraph?.(cfg.graphId);
    if (!childGraph) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `找不到子流程图「${cfg.graphId}」`,
        errorCode: "VALIDATION",
      });
      return;
    }
    const { plan: childPlan, diagnostics } = compile(childGraph);
    if (!childPlan) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `子流程图编译失败：${diagnostics.map((d) => d.message).join("；")}`,
        errorCode: "VALIDATION",
      });
      return;
    }

    // Isolated namespace: every child node id is prefixed with
    // `<subNode>#sub:` in the parent's maps/events so child ids can't
    // collide with (or leak into) the parent graph.
    const prefix = `${nodeId}#sub:`;
    const saved = extractSubInit(prefix, childGraph);
    const childInit: SchedulerInit = saved ?? {
      artifacts: new Map(),
      attempts: new Map(),
      nodeCostUsd: new Map(),
      totalCostUsd: 0,
      states: new Map(childGraph.nodes.map((n) => [n.id, "pending" as NodeState])),
      approvedTools: [...approved],
      packetEdges: new Set(),
      // Shared by reference: sub-process runs read/write the parent's variables.
      variables,
    };
    const sourceText = await inputFor(node);
    const childGen = await ctx.scheduler({
      runId,
      graph: childGraph,
      plan: childPlan,
      worker,
      budgetUsd: null,
      monthlyBudgetUsd: null,
      monthSpentUsd: 0,
      fallbackModel: opts.fallbackModel,
      startSeq: 0,
      sourceInput: sourceText,
      connectorValues: opts.connectorValues,
      signal: opts.signal,
      now: opts.now,
      sleep: opts.sleep,
      init: childInit,
      // Shared by reference: sub-process runs read/write the parent's variables.
      initialVariables: variables,
      // Skip run.started (the parent already announced the run); the
      // child's run.finished is intercepted below and re-emitted by the
      // parent's own finish.
      resuming: true,
      subprocessDepth: depth + 1,
      storeBinary: opts.storeBinary,
      readArtifact: opts.readArtifact,
      publicUrl: opts.publicUrl,
      permissionConfig: opts.permissionConfig,
      bannedTerms: opts.bannedTerms,
      searchConfig: opts.searchConfig,
      loadProducts: opts.loadProducts,
    });

    let childStatus: Status | undefined;
    let childHaltedId: string | undefined;
    let childHaltedReason: string | undefined;
    for await (const e of childGen) {
      if (e.type === "run.finished") {
        childStatus = e.status;
        childHaltedId = e.haltedNodeId;
        childHaltedReason = e.reason;
        break;
      }
      emit(prefixEvent(e, prefix));
    }
    // Persist the child's state under the prefix (whatever the outcome):
    // a halt must survive a resume so the sub-flow continues in place,
    // and a done child's sink products feed the aggregation below.
    mergeSubInit(prefix, childInit);
    // Shared budget: the child's spend joins the parent's ledger (V1 —
    // the child does not run its own budget check, documented limitation).
    ctx.totalCostUsd += childInit.totalCostUsd;

    if (childStatus === "halted") {
      ctx.haltNodeId = childHaltedId ? prefix + childHaltedId : nodeId;
      ctx.haltReason = childHaltedReason;
      ctx.status = "halted";
      ctx.aborted = true;
      return;
    }
    if (childStatus === "failed" || childStatus === "cancelled" || childStatus === "tripped") {
      if (ctx.aborted) return; // parent abort won the race — let the parent finish it
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error:
          childStatus === "failed"
            ? "子流程执行失败"
            : `子流程中止（${childStatus}）`,
        errorCode: "SUBPROCESS",
      });
      return;
    }

    // Child ctx.finished done: aggregate its sink outputs as this node's
    // product (single sink → its value; multiple sinks → {sinkId: value}).
    const sinks = childGraph.nodes.filter((n) => n.kind === "sink");
    const values = sinks.map((s) => [s.id, artifactValue(prefix + s.id)] as const);
    const content =
      sinks.length === 1
        ? JSON.stringify(values[0]?.[1] ?? null)
        : JSON.stringify(Object.fromEntries(values));
    const artifact: Artifact = {
      id: `${nodeId}-sub-json`,
      kind: "json",
      content,
      mimeType: "application/json",
    };
    artifacts.set(nodeId, [artifact]);
    emit({ type: "artifact.produced", nodeId, attempt, artifact });
    states.set(nodeId, "done");
    const summary = `子流程「${childGraph.name}」完成`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "json");
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `Subprocess 节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
      errorCode: "SUBPROCESS",
    });
  }
  return;
}
