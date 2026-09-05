import { MapConfig, getByPath, incoming, transformJson } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { truncateText, zeroUsage } from "./shared.js";

/**
 * Map node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function mapNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, graph, nodeCtx, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = MapConfig.parse(node.map ?? {});
    const ctx = nodeCtx(nodeId);
    const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
    const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
    if (!sourceId) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: "Map 节点需要恰好一个上游节点（或在设置中指定 source）",
        errorCode: "VALIDATION",
      });
      return;
    }
    let template: unknown;
    try {
      template = JSON.parse(cfg.template);
    } catch {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error:
          "映射模板不是合法的 JSON：模板整体须是 JSON 文档，${...} 占位符请写在字符串值内（如 \"age\": \"${item.age}\"，纯占位符会自动保留数字/对象类型）",
        errorCode: "VALIDATION",
      });
      return;
    }
    const sourceVal = ctx[sourceId];
    let out: unknown;
    if (cfg.iterate) {
      const arr = getByPath(sourceVal, cfg.iterate);
      if (!Array.isArray(arr)) {
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `iterate 路径 "${cfg.iterate}" 解析结果不是数组`,
          errorCode: "VALIDATION",
        });
        return;
      }
      out = arr.map((item) => transformJson(template, { ...ctx, item }));
    } else {
      out = transformJson(template, { ...ctx, item: sourceVal });
    }
    const content = JSON.stringify(out);
    const artifact: Artifact = {
      id: `${nodeId}-map-json`,
      kind: "json",
      content,
      mimeType: "application/json",
    };
    artifacts.set(nodeId, [artifact]);
    emit({ type: "artifact.produced", nodeId, attempt, artifact });
    states.set(nodeId, "done");
    const summary =
      cfg.iterate && Array.isArray(out)
        ? `映射 ${out.length} 项 → ${truncateText(content, 60)}`
        : `映射完成 → ${truncateText(content, 60)}`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "json");
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `Map 节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
