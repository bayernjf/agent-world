import { ParallelConfig, getByPath, incoming } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { truncateText, zeroUsage } from "./shared.js";

/**
 * Parallel node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function parallelNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, graph, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = ParallelConfig.parse(node.parallel ?? {});
    const ins = incoming(graph, nodeId, "flow");
    const values: unknown[] = [];
    const byId: Record<string, unknown> = {};
    for (const e of ins) {
      const arts = artifacts.get(e.from) ?? [];
      const json = arts.find((a) => a.kind === "json");
      let val: unknown = null;
      if (json?.content) {
        try {
          val = JSON.parse(json.content);
        } catch {
          val = json.content;
        }
      } else {
        const text = arts.find((a) => a.kind === "text");
        val = text?.content ?? "";
      }
      if (cfg.pick) {
        const picked = getByPath(val, cfg.pick);
        if (picked !== undefined) val = picked;
      }
      values.push(val);
      byId[e.from] = val;
    }
    const out = cfg.asObject ? byId : values;
    const content = JSON.stringify(out);
    const artifact: Artifact = {
      id: `${nodeId}-parallel-json`,
      kind: "json",
      content,
      mimeType: "application/json",
    };
    artifacts.set(nodeId, [artifact]);
    emit({ type: "artifact.produced", nodeId, attempt, artifact });
    states.set(nodeId, "done");
    const summary = `聚合 ${ins.length} 个分支 → ${truncateText(content, 60)}`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "json");
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `Parallel 节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
