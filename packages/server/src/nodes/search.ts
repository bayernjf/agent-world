import { SearchConfig, incoming } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { zeroUsage } from "./shared.js";
import { SearchAuthError, searchWeb } from "../search.js";
import { sanitizeError } from "../sanitize.js";

/**
 * Search node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function searchNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, graph, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = SearchConfig.parse(node.search ?? {});
    let query = cfg.query.trim();
    if (!query) {
      // Fall back to the first upstream text artifact — lets an agent
      // generate the query and a search node execute it.
      const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
      for (const s of sources) {
        const t = (artifacts.get(s) ?? []).find((a) => a.kind === "text")?.content;
        if (t?.trim()) {
          query = t.trim().slice(0, 300);
          break;
        }
      }
    }
    if (!query) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: "没有可用的搜索词（请在配置中填写 query，或连接产出 text 的上游）",
        errorCode: "VALIDATION",
      });
      return;
    }
    let hits: { title: string; url: string; snippet: string }[];
    try {
      // ctx.opts.searchConfig is the user-level service (Settings → 搜索服务):
      // credential fallback beneath node-level fields, and a backend override
      // when the node sits on the keyless duckduckgo default.
      hits = await searchWeb(query, cfg, ctx.opts.searchConfig);
    } catch (err) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `搜索失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
        errorCode: err instanceof SearchAuthError ? "AUTH" : "PROVIDER_ERROR",
      });
      return;
    }
    const listing = hits
      .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ""}`)
      .join("\n\n");
    const output = listing || `没有找到与「${query}」相关的结果`;
    const produced: Artifact[] = [
      { id: `${nodeId}-txt`, kind: "text", content: output, mimeType: "text/plain" },
      {
        id: `${nodeId}-json`,
        kind: "json",
        content: JSON.stringify({ query, provider: cfg.provider, results: hits }, null, 2),
        mimeType: "application/json",
      },
    ];
    artifacts.set(nodeId, produced);
    for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });
    states.set(nodeId, "done");
    const summary = `搜索完成：「${query}」→ ${hits.length} 条结果（${cfg.provider}）`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "text");
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `搜索节点执行出错: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
    });
  }
}
