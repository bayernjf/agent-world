import { TableConfig, applyTableSteps, collectColumns, incoming, rowsToCsv, tableInputFrom } from "@agent-world/core";
import type { Artifact, GraphNode, TableInput } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { zeroUsage } from "./shared.js";

/**
 * Table node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function tableNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, graph, nodeCtx, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = TableConfig.parse(node.table ?? {});
    const ctx = nodeCtx(nodeId);
    const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
    const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
    if (!sourceId) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: "Table 节点需要恰好一个上游节点（或在设置中指定 source）",
        errorCode: "VALIDATION",
      });
      return;
    }
    let input: TableInput;
    try {
      input = tableInputFrom(ctx[sourceId]);
    } catch (err) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
        errorCode: "VALIDATION",
      });
      return;
    }
    const { rows, output } = applyTableSteps(input, cfg.steps);
    const columns = collectColumns(rows);
    const content = JSON.stringify({ rows, count: rows.length, columns });
    const produced: Artifact[] = [
      { id: `${nodeId}-table-json`, kind: "json", content, mimeType: "application/json" },
    ];
    if (output === "csv") {
      produced.push({
        id: `${nodeId}-table-csv`,
        kind: "text",
        content: rowsToCsv(rows, columns),
        mimeType: "text/csv",
      });
    }
    artifacts.set(nodeId, produced);
    for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
    states.set(nodeId, "done");
    const summary = `表格处理完成：${rows.length} 行 × ${columns.length} 列（${output === "csv" ? "CSV" : "JSON"} 输出）`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "json");
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `Table 节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
