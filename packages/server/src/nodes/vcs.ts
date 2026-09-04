import { VcsConfig, incoming } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { zeroUsage } from "./shared.js";
import { VcsAuthError, executeVcs } from "../vcs.js";
import { sanitizeError } from "../sanitize.js";

/**
 * Vcs node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function runVcsNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, graph, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = VcsConfig.parse(node.vcs ?? {});
    const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
    const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
    if (cfg.source && !sources.includes(cfg.source)) {
      states.set(nodeId, "failed");
      emit({ type: "node.failed", nodeId, attempt, error: `数据来源 ${cfg.source} 不是上游节点`, errorCode: "VALIDATION" });
      return;
    }
    let body = cfg.body.trim();
    if (!body && (cfg.action === "create_pr" || cfg.action === "comment_issue") && sourceId) {
      const t = (artifacts.get(sourceId) ?? []).find((a) => a.kind === "text")?.content;
      if (t?.trim()) body = t.trim();
    }
    // An empty title used to fall back to the node name ("创建 PR"), so
    // every PR created by the template carried the same meaningless
    // title (dogfood tpl-release-pr). Derive one from the body instead:
    // first non-empty, non-horizontal-rule line, markdown heading marks
    // stripped, clamped to a sane length. Explicit cfg.title still wins.
    let title = cfg.title?.trim();
    if (!title && cfg.action === "create_pr" && body) {
      const line = body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !/^[-=_*]{3,}$/.test(l));
      if (line) title = line.replace(/^#{1,6}\s*/, "").trim().slice(0, 120);
    }
    if (!title) title = node.name || cfg.action;
    let result: { provider: string; action: string; detail: string; data: unknown };
    try {
      result = await executeVcs(cfg, body, title);
    } catch (err) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `VCS 操作失败: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
        errorCode: err instanceof VcsAuthError ? "AUTH" : "PROVIDER_ERROR",
      });
      return;
    }
    const artifact: Artifact = {
      id: `${nodeId}-json`,
      kind: "json",
      content: JSON.stringify(result.data, null, 2),
      mimeType: "application/json",
    };
    artifacts.set(nodeId, [artifact]);
    emit({ type: "artifact.produced", nodeId, attempt, artifact });
    states.set(nodeId, "done");
    const summary = `${result.provider} ${result.action} 完成：${result.detail}`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "json");
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `VCS 节点执行出错: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
    });
  }
}
