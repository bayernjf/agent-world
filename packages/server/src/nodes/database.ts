import { DatabaseConfig } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { zeroUsage } from "./shared.js";
import { createSqliteDriver } from "../db-drivers.js";

/**
 * Database node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function databaseNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = DatabaseConfig.parse(node.database ?? {});
    if (!cfg.sql.trim()) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: "数据库节点需要填写 SQL 语句",
        errorCode: "VALIDATION",
      });
      return;
    }
    const driver = createSqliteDriver(cfg.path);
    try {
      driver.setup(cfg.setupSql);
      const result = driver.query(cfg.sql, {
        positional: cfg.positionalParams,
        named: cfg.namedParams,
      });
      if (result.rows !== undefined) {
        const content = JSON.stringify({
          rows: result.rows,
          count: result.rows.length,
          columns: result.columns ?? [],
        });
        const produced: Artifact[] = [
          { id: `${nodeId}-db-json`, kind: "json", content, mimeType: "application/json" },
        ];
        artifacts.set(nodeId, produced);
        for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
        states.set(nodeId, "done");
        const summary = `数据库查询完成：${result.rows.length} 行 × ${(result.columns ?? []).length} 列`;
        emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
        sendPackets(nodeId, summary, "json");
      } else {
        const content = JSON.stringify({
          affectedRows: result.affectedRows ?? 0,
          lastInsertId: result.lastInsertId ?? null,
        });
        const produced: Artifact[] = [
          { id: `${nodeId}-db-json`, kind: "json", content, mimeType: "application/json" },
        ];
        artifacts.set(nodeId, produced);
        for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
        states.set(nodeId, "done");
        const summary = `数据库执行完成：影响 ${result.affectedRows ?? 0} 行`;
        emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
        sendPackets(nodeId, summary, "json");
      }
    } finally {
      driver.close();
    }
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `数据库节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
