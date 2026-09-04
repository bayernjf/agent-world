import { TranslateConfig, incoming, nodeById } from "@agent-world/core";
import type { GraphNode, Usage } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { RETRYABLE, setTextArtifact, zeroUsage } from "./shared.js";
import { ProviderError } from "../providers/openai-compatible.js";
import { sanitizeError } from "../sanitize.js";

/**
 * Translate node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function translateNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, budgetUsd, emit, fallbackModel, graph, nodeCostUsd, opts, produceArtifacts, sendPackets, states, worker } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const cfg = TranslateConfig.parse(node.translate ?? {});
  const sources = incoming(graph, nodeId, "flow").map((e) => e.from);
  const sourceId = cfg.source ?? (sources.length === 1 ? sources[0] : undefined);
  if (!sourceId) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: "翻译节点需要唯一上游，或在配置中显式指定数据来源",
      errorCode: "VALIDATION",
    });
    return;
  }
  const arts = artifacts.get(sourceId) ?? [];
  const textArt = arts.find((a) => a.kind === "text");
  const jsonArt = arts.find((a) => a.kind === "json");
  let sourceText = textArt?.content ?? "";
  if (!sourceText && jsonArt) {
    sourceText =
      typeof jsonArt.content === "string" ? jsonArt.content : JSON.stringify(jsonArt.content, null, 2);
  }
  if (!sourceText.trim()) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `上游「${nodeById(graph, sourceId)?.name ?? sourceId}」没有产出可翻译的文本`,
      errorCode: "VALIDATION",
    });
    return;
  }
  const config = {
    model: cfg.model || fallbackModel,
    prompt: [
      `你是专业的翻译引擎。请把用户提供的文本翻译成${cfg.target}。`,
      "要求：忠实原文、不增删内容、不解释不改写；保留原文的换行、编号与段落结构；",
      "直接输出译文本身，不要加任何说明、引号或前后缀。",
    ].join("\n"),
    skills: [],
    temperature: cfg.temperature,
    timeoutMs: 120000,
    inputPolicy: { mode: "all" as const },
    retry: cfg.retry,
  };
  let result: { output: string; usage: Usage } | null = null;
  let lastError: { message: string; code?: string } | null = null;
  const maxAttempts = 1 + config.retry.maxRetries;
  for (let tryIdx = 0; tryIdx < maxAttempts; tryIdx++) {
    if (opts.signal?.aborted || ctx.aborted) {
      ctx.aborted = true;
      return;
    }
    try {
      const gen = worker.runTextGen({
        node,
        config,
        attempt,
        input: sourceText,
        signal: opts.signal,
      });
      let output = "";
      let usage: Usage | null = null;
      while (true) {
        const step = await gen.next();
        if (step.done) {
          output = step.value.output;
          usage = step.value.usage;
          break;
        }
        if (opts.signal?.aborted || ctx.aborted) {
          ctx.aborted = true;
          return;
        }
        if (step.value.type === "text-delta") {
          emit({ type: "node.delta", nodeId, attempt, text: step.value.text });
        }
      }
      result = { output, usage: usage ?? zeroUsage() };
      break;
    } catch (err) {
      const code = err instanceof ProviderError ? err.code : "UNKNOWN";
      lastError = { message: (err as Error).message, code };
      if (!RETRYABLE.has(code) || tryIdx >= maxAttempts - 1) break;
      await opts.sleep(Math.min(config.retry.maxDelayMs, config.retry.baseDelayMs * 2 ** tryIdx));
    }
  }
  if (!result) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: sanitizeError(lastError?.message ?? "翻译调用失败，无输出"),
      errorCode: (lastError?.code as
        | "TIMEOUT"
        | "RATE_LIMIT"
        | "PROVIDER_ERROR"
        | "SCRIPT_ERROR"
        | "AUTH"
        | "VALIDATION"
        | "UNKNOWN"
        | "UNSUPPORTED"
        | undefined) ?? "UNKNOWN",
    });
    ctx.status = "failed";
    return;
  }
  // Same contract as the textGen branch: a 200 with no text is not a
  // translation. Shipping an empty artifact here means the run reports
  // done with nothing translated.
  if (!result.output.trim()) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `模型 ${config.model} 返回了空译文（无正文可交付）`,
      errorCode: "PROVIDER_ERROR",
    });
    ctx.status = "failed";
    return;
  }
  setTextArtifact(artifacts, nodeId, result.output);
  states.set(nodeId, "done");
  emit({ type: "node.finished", nodeId, attempt, output: result.output, usage: result.usage });
  const primaryKind = produceArtifacts(nodeId, result.output, attempt);
  ctx.totalCostUsd += result.usage.costUsd;
  emit({ type: "power.metered", totalCostUsd: ctx.totalCostUsd, budgetUsd });
  const nodeSpent = (nodeCostUsd.get(nodeId) ?? 0) + result.usage.costUsd;
  nodeCostUsd.set(nodeId, nodeSpent);
  const nodeBudget = cfg.budgetUsd;
  if (nodeBudget != null && nodeBudget > 0 && nodeSpent > nodeBudget) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `节点预算 $${nodeBudget.toFixed(4)} 已超出（已花 $${nodeSpent.toFixed(4)}）`,
      errorCode: "BUDGET",
    });
    ctx.status = "failed";
    return;
  }
  sendPackets(nodeId, result.output.slice(0, 120), primaryKind);
}
