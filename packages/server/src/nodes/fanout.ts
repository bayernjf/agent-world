import { FanoutConfig, compile } from "@agent-world/core";
import type { GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { buildVariantGraph, buildVariantParams, firstSelectDownstream, prefixEvent, variantLaneIds, zeroUsage } from "./shared.js";
import type { NodeState, SchedulerInit, Status } from "../engine.js";
import { sinkNode } from "../nodes/sink.js";

/**
 * Fanout node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function fanoutNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { approved, artifactValue, artifacts, attempts, budgetUsd, emit, fallbackModel, graph, inputFor, mergeSubInit, monthSpentUsd, monthlyBudgetUsd, nodeCostUsd, opts, packetEdges, plan, produceArtifacts, runId, sendPackets, states, variables, worker } = ctx;
  const cfg: FanoutConfig = node.fanout ?? FanoutConfig.parse({});
  const input = await inputFor(node);
  const variants = buildVariantParams(cfg, opts.fallbackModel);
  const variantIds = variants.map((v) => v.id);
  emit({ type: "node.started", nodeId, attempt });
  emit({ type: "variants.spawned", nodeId, variantIds });

  const selectId = firstSelectDownstream(graph, nodeId);
  if (!selectId) {
    states.set(nodeId, "failed");
    emit({ type: "node.failed", nodeId, attempt, error: "扇出节点缺少下游择优节点", errorCode: "VALIDATION" });
    return;
  }
  const laneIds = variantLaneIds(graph, nodeId, selectId);

  // Each lane runs as an isolated sub-run (same mechanism as a subprocess
  // node): one lane failing only ends that lane, never its siblings.
  const results: Array<{ variant: string; output: string; ok: boolean; error?: string }> = [];
  for (const v of variants) {
    const subGraph = buildVariantGraph(graph, nodeId, selectId, laneIds, v);
    const { plan: subPlan } = compile(subGraph);
    if (!subPlan) {
      results.push({ variant: v.id, output: "", ok: false, error: "泳道子图编译失败" });
      continue;
    }
    const prefix = `${nodeId}#var:${v.id}:`;
    const childInit: SchedulerInit = {
      artifacts: new Map(),
      attempts: new Map(),
      nodeCostUsd: new Map(),
      totalCostUsd: 0,
      states: new Map(subGraph.nodes.map((n) => [n.id, "pending" as NodeState])),
      approvedTools: [...approved],
      packetEdges: new Set(),
      variables,
    };
    const depth = opts.subprocessDepth ?? 0;
    const childGen = await ctx.scheduler({
      runId,
      graph: subGraph,
      plan: subPlan,
      worker,
      budgetUsd: null,
      monthlyBudgetUsd: null,
      monthSpentUsd: 0,
      fallbackModel: opts.fallbackModel,
      startSeq: 0,
      sourceInput: input,
      connectorValues: opts.connectorValues,
      signal: opts.signal,
      now: opts.now,
      sleep: opts.sleep,
      init: childInit,
      initialVariables: variables,
      resuming: true,
      subprocessDepth: depth + 1,
      storeBinary: opts.storeBinary,
      readArtifact: opts.readArtifact,
      publicUrl: opts.publicUrl,
      permissionConfig: opts.permissionConfig,
      bannedTerms: opts.bannedTerms,
      loadProducts: opts.loadProducts,
    });
    let childStatus: Status | undefined;
    for await (const e of childGen) {
      if (e.type === "run.finished") {
        childStatus = e.status;
        break;
      }
      emit(prefixEvent(e, prefix));
    }
    mergeSubInit(prefix, childInit);
    ctx.totalCostUsd += childInit.totalCostUsd;
    const sinkNode = subGraph.nodes.find((n) => n.kind === "sink");
    const output = sinkNode ? artifactValue(prefix + sinkNode.id) : null;
    const text = typeof output === "string" ? output : output == null ? "" : JSON.stringify(output);
    results.push(childStatus === "done" ? { variant: v.id, output: text, ok: true } : { variant: v.id, output: "", ok: false, error: childStatus ?? "failed" });
  }

  const payload = JSON.stringify({ variants: results });
  artifacts.set(nodeId, [{ id: `${nodeId}-variants`, kind: "json", content: payload, mimeType: "application/json" }]);
  states.set(nodeId, "done");
  emit({ type: "node.finished", nodeId, attempt, output: payload, usage: zeroUsage() });
  produceArtifacts(nodeId, payload, attempt);
  sendPackets(nodeId, `${results.length} 条变体`, "json");
}
