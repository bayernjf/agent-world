import type { GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { ARTIFACT_URL_NOTE, collectJudgeCriteria, detectProhibited, setTextArtifact, toMount, upstreamBrandTerms, upstreamProhibitedTerms } from "./shared.js";
import { prohibitedHitsWithContext } from "./prohibited.js";
import { notifyHalt } from "../notify.js";

/** Fallback for workers that don't return usage from judge() (e.g. older mocks). */
const zeroUsage = () => ({ tokensIn: 0, tokensOut: 0, costUsd: 0 });

/**
 * Gate node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function gateNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, attempts, emit, graph, inputFor, loopByGate, opts, reworkNotes, runId, sendPackets, states, worker } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const output = await inputFor(node);
  const equipped = collectJudgeCriteria((node.gate?.skills ?? []).map(toMount), ctx.opts.userSkills);
  const criterion =
    (node.gate?.criterion ?? "") +
    (equipped.length ? "\n\n附加判据：\n" + equipped.map((c) => "- " + c).join("\n") : "") +
    ARTIFACT_URL_NOTE;
  const modelVerdict = await worker.judge({
    node,
    attempt,
    input: output,
    output,
    criterion,
    signal: opts.signal,
  });

  // Hard rule: any prohibited term declared on an upstream source must
  // never pass, regardless of what the model judge decides. Deterministic
  // so forbidden copy is always caught even if the model slips it in.
  const prohibitedHits = detectProhibited(output, upstreamProhibitedTerms(graph, nodeId));

  // Brand-term coverage: how many of the upstream brand words actually
  // appear in the artifact. An optional gate threshold fails the gate
  // (and triggers a rewrite) when coverage is too low.
  const brandAll = upstreamBrandTerms(graph, nodeId);
  const brandHits = brandAll.filter((t) => output.includes(t));
  const brandCoverage = brandAll.length ? brandHits.length / brandAll.length : 1;
  const minBrand = node.gate?.minBrandCoverage;

  const minScore = node.gate?.minScore;
  const belowScore =
    minScore != null && modelVerdict.score != null && modelVerdict.score < minScore;
  const belowBrand = minBrand != null && brandCoverage < minBrand;

  let verdict = modelVerdict;
  if (prohibitedHits.length > 0) {
    // Actionable rework feedback: name every offending term, how many times
    // each occurs, and the exact enclosing clause for each located hit.
    // Varying the note per attempt matters — with a deterministic endpoint, an
    // identical rework note produces identical input and the model regenerates
    // the same violating copy forever. Naming ALL occurrences (not just the
    // first) keeps the model from fixing one spot only to fail the next gate on
    // the rest and burning the rework budget until the line halts with no output.
    const located = prohibitedHitsWithContext(output, prohibitedHits);
    const termCounts = located.hits
      .map((h) => (h.count > 1 ? `${h.term}×${h.count}` : h.term))
      .join("、");
    const snippets = located.hits.flatMap((h) => h.snippets.map((s) => `「${h.term}」${s}`));
    const where = snippets.length ? ` 出现位置：${snippets.join("；")}。` : "";
    verdict = {
      passed: false,
      reason:
        `命中禁用词共 ${located.total} 处（${termCounts}），第 ${attempt} 次质检。${where}` +
        "请逐句改写上述句子，彻底移除这些词及任何包含它们的短语（质检按“包含”匹配，含该字的词组同样违规），并通读全文确认没有其它遗漏处，已退回上游重写",
      score: modelVerdict.score,
      usage: modelVerdict.usage ?? zeroUsage(),
    };
  } else if (belowBrand) {
    verdict = {
      passed: false,
      reason: `品牌词覆盖率 ${Math.round(brandCoverage * 100)}% 低于门槛 ${Math.round(minBrand! * 100)}%（已退回上游重写）`,
      score: modelVerdict.score,
      usage: modelVerdict.usage ?? zeroUsage(),
    };
  } else if (belowScore) {
    verdict = {
      passed: false,
      reason: `质量分 ${modelVerdict.score} 低于门槛 ${minScore}（已退回上游重写）`,
      score: modelVerdict.score,
      usage: modelVerdict.usage ?? zeroUsage(),
    };
  }

  emit({
    type: "gate.verdict",
    nodeId,
    attempt,
    passed: verdict.passed,
    reason: verdict.reason,
    ...(verdict.score != null ? { score: verdict.score } : {}),
  });

  if (verdict.passed) {
    const artifact = setTextArtifact(artifacts, nodeId, output);
    states.set(nodeId, "done");
    // A failed gate emits node.failed, but a passing one used to slip
    // through with only gate.verdict — no node.finished and no
    // artifact.produced in the timeline, unlike every other node kind
    // (dogfood tpl-recipe). Announce both for observability parity.
    emit({ type: "artifact.produced", nodeId, attempt, artifact });
    emit({ type: "node.finished", nodeId, attempt, output: verdict.reason, usage: modelVerdict.usage ?? zeroUsage() });
    sendPackets(nodeId, verdict.reason, "text");
    return;
  }

  const loop = loopByGate.get(nodeId);
  if (!loop) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: verdict.reason,
      errorCode: "VALIDATION",
    });
    ctx.status = "failed";
    return;
  }

  if (attempt >= loop.maxAttempts) {
    const policy = node.gate?.onExhausted ?? "halt";
    emit({ type: "gate.exhausted", nodeId, attempts: attempt, policy });
    if (policy === "pass") {
      const artifact = setTextArtifact(artifacts, nodeId, output);
      states.set(nodeId, "done");
      emit({ type: "artifact.produced", nodeId, attempt, artifact });
      emit({ type: "node.finished", nodeId, attempt, output: verdict.reason, usage: modelVerdict.usage ?? zeroUsage() });
      sendPackets(nodeId, verdict.reason, "text");
      return;
    }
    states.set(nodeId, "failed");
    ctx.status = policy === "halt" ? "halted" : "failed";
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: verdict.reason,
      errorCode: "VALIDATION",
    });
    if (policy === "halt") {
      ctx.haltNodeId = nodeId;
      ctx.haltReason = verdict.reason;
      void notifyHalt({ runId, graphId: graph.id, nodeId, reason: verdict.reason });
    }
    ctx.aborted = true;
    return;
  }

  // Rework: reset the loop body so it welds again, and tell the entry why.
  reworkNotes.set(loop.entryId, verdict.reason);
  emit({
    type: "packet.sent",
    edgeId: loop.edge.id,
    from: nodeId,
    to: loop.entryId,
    summary: verdict.reason,
    artifactKind: "text",
  });
  for (const bodyId of loop.body) {
    states.set(bodyId, "pending");
    artifacts.set(bodyId, []);
  }
  return;
}
