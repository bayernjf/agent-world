import { SelectConfig, getByPath } from "@agent-world/core";
import type { GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { firstFanoutUpstream, setTextArtifact, upstreamBrandTerms, zeroUsage } from "./shared.js";

/**
 * Select node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function selectNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, graph, opts, produceArtifacts, sendPackets, states, worker } = ctx;
  const cfg: SelectConfig = node.select ?? SelectConfig.parse({});
  const fanoutId = firstFanoutUpstream(graph, nodeId);
  if (!fanoutId) {
    states.set(nodeId, "failed");
    emit({ type: "node.failed", nodeId, attempt, error: "择优节点缺少上游扇出节点", errorCode: "VALIDATION" });
    return;
  }
  const raw = artifacts.get(fanoutId) ?? [];
  const summaryArt = raw.find((a) => a.kind === "json");
  let variants: Array<{ variant: string; output: string; ok: boolean; error?: string }> = [];
  try {
    variants = (JSON.parse(summaryArt?.content ?? "{}") as { variants: typeof variants }).variants ?? [];
  } catch {
    variants = [];
  }
  const failed = variants.filter((v) => !v.ok).map((v) => v.variant);
  const alive = variants.filter((v) => v.ok);

  // Failure semantics: zero surviving lanes → select fails loudly, never
  // "chooses 0 of an empty set" (the 2797011 class).
  if (alive.length === 0) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `全部变体泳道均失败，无法择优${failed.length ? `（失败：${failed.join("、")}）` : ""}`,
      errorCode: "SUBPROCESS",
    });
    return;
  }

  // Rank by the configured mode (llm_score via the shared judge channel,
  // or a deterministic rule).
  let ranking: Array<{ variant: string; score: number; reason: string }>;
  if (cfg.mode === "rule") {
    const field = cfg.rule?.field ?? "length";
    const desc = cfg.rule?.desc ?? true;
    ranking = alive
      .map((a) => {
        let score = 0;
        if (field === "length") score = a.output.length;
        else if (field === "brandCoverage") {
          const terms = upstreamBrandTerms(graph, nodeId);
          const hits = terms.filter((t) => a.output.includes(t));
          score = terms.length ? hits.length / terms.length : 0;
        } else {
          try {
            const val = getByPath(JSON.parse(a.output), cfg.rule?.path ?? "");
            score = typeof val === "number" ? val : String(val ?? "").length;
          } catch {
            score = 0;
          }
        }
        return { variant: a.variant, score, reason: `规则排序 ${field}` };
      })
      .sort((x, y) => (desc ? y.score - x.score : x.score - y.score));
  } else {
    ranking = [];
    for (const a of alive) {
      const verdict = await worker.judge({
        node,
        attempt,
        input: a.output,
        output: a.output,
        criterion: cfg.rubric || "请根据文案质量、卖点表达、可读性综合打分（0-10）",
        signal: opts.signal,
      });
      ranking.push({ variant: a.variant, score: verdict.score ?? 0, reason: verdict.reason });
    }
    ranking.sort((x, y) => y.score - x.score);
  }

  const topK = Math.min(cfg.topK, ranking.length);
  const chosen = ranking.slice(0, topK).map((r) => r.variant);
  emit({
    type: "variants.ranked",
    nodeId,
    ranking,
    chosen,
    ...(failed.length ? { failed } : {}),
  });

  const chosenEntries = ranking.slice(0, topK).map((r) => {
    const a = alive.find((x) => x.variant === r.variant);
    return { variant: r.variant, score: r.score, reason: r.reason, content: a?.output ?? "" };
  });
  const output =
    cfg.topK === 1 && chosenEntries.length === 1
      ? chosenEntries[0]!.content
      : JSON.stringify(chosenEntries, null, 2);
  setTextArtifact(artifacts, nodeId, output);
  states.set(nodeId, "done");
  emit({ type: "node.started", nodeId, attempt });
  emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
  produceArtifacts(nodeId, output, attempt);
  sendPackets(nodeId, output.slice(0, 120), "text");
}
