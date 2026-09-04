import { ComplianceConfig, checkCompliance, complianceArtifact } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { setTextArtifact, zeroUsage } from "./shared.js";

/**
 * Compliance node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function complianceNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, inputFor, opts, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  try {
    const cfg = ComplianceConfig.parse(node.compliance ?? {});
    const output = await inputFor(node);
    if (!output.trim()) {
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: "合规节点没有收到可校验的文本",
        errorCode: "VALIDATION",
      });
      return;
    }
    // Merge the user's stored banned terms with the node's extra list, so
    // the vocabulary library is honoured without the user re-typing it.
    const extra = [cfg.extraBanned, opts.bannedTerms ?? ""].filter(Boolean).join(",");
    const result = checkCompliance({
      platform: cfg.platform,
      extraBanned: extra,
      autoFix: cfg.autoFix,
      text: output,
    });
    const payload = complianceArtifact(result);
    const jsonArtifact: Artifact = {
      id: `${nodeId}-compliance`,
      kind: "json",
      content: JSON.stringify(payload),
      mimeType: "application/json",
    };
    const produced: Artifact[] = [jsonArtifact];
    // Downstream nodes consume the sanitized text (autoFix on) or the
    // original (autoFix off / no violations).
    const downstreamText = result.sanitized || result.original;
    setTextArtifact(artifacts, nodeId, downstreamText);
    artifacts.set(nodeId, [...produced, ...(artifacts.get(nodeId) ?? [])]);
    for (const a of produced) emit({ type: "artifact.produced", nodeId, attempt, artifact: a });

    if (cfg.failOnViolation && !result.passed) {
      const first = result.violations[0];
      states.set(nodeId, "failed");
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `合规校验未通过（${result.violations.length} 处违规，首条：${first?.rule ?? ""}）`,
        errorCode: "VALIDATION",
      });
      return;
    }

    states.set(nodeId, "done");
    const summary = result.passed
      ? "合规校验通过"
      : `合规校验发现 ${result.violations.length} 处违规（已${cfg.autoFix ? "自动修复" : "标注"}）`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "json");
  } catch (err) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `合规校验节点执行出错: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
