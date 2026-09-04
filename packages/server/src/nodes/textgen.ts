  import { evaluateTemplate } from "@agent-world/core";
  import type { ContentPart, GraphNode, Usage } from "@agent-world/core";
  import type { NodeRunContext } from "./types.js";
  import {
    BUDGET_WARN,
    VARIABLE_TOOLS,
    collectPromptModules,
    getOutputContract,
    setTextArtifact,
    toMount,
    upstreamBrandTerms,
    upstreamProhibitedTerms,
    validateContract,
    zeroUsage,
  } from "./shared.js";
  import { guardToolCall, isDangerousTool } from "../permissions.js";
  import { HaltRequested } from "../worker.js";
  import { inlineImageUrl, withLayoutDirectives } from "../engine.js";
  import { executeBuiltinTool, resolveTools } from "../skills/registry.js";
  import { notifyHalt } from "../notify.js";
  import { ProviderError } from "../providers/openai-compatible.js";
  import { RETRYABLE } from "./shared.js";
  import { sanitizeError } from "../sanitize.js";

  /**
   * Agent node execution body (migrated from engine.ts runScheduler).
   * Behaviour is byte-identical to the former closure; shared scheduler state
   * arrives via the explicit NodeRunContext.
   */
  export async function textGenNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
    const { approved, artifacts, budgetUsd, emit, fallbackModel, graph, handleVariableTool, imagesFor, inputFor, interpCtx, loopByGate, monthSpentUsd, monthlyBudgetUsd, nodeCostUsd, opts, permCfg, produceArtifacts, reworkNotes, runId, sendPackets, states, worker } = ctx;
  const mounts = (node.textGen?.skills ?? []).map(toMount);
  const promptModules = collectPromptModules(mounts);
  // Prompts interpolate `${nodeId}` / `${item}` like every other template
  // string (loop bodies reference the loop item via ${item}; dogfood
  // tpl-research-loop sent the placeholder to the model verbatim).
  const promptTemplate = node.textGen?.prompt
    ? evaluateTemplate(node.textGen.prompt, interpCtx(nodeId))
    : "";
  const basePrompt = withLayoutDirectives(promptTemplate, node.textGen?.imageDirectives);
  let prompt = promptModules.length
    ? `${basePrompt}\n\n${promptModules.map((p) => `=== 已挂载模块提示 (prompt-module) ===\n${p}`).join("\n\n")}`
    : basePrompt;
  // Engine-level hard constraint: upstream source prohibited/brand terms are
  // always injected into the SYSTEM prompt here, regardless of what the user
  // wrote in the node prompt, so every pipeline (incl. user-customized ones)
  // is constrained at generation time. The gate remains the deterministic
  // backstop. Living in the system prompt also survives input truncation /
  // summarization, unlike appending to the user input body.
  const constraintBlocks: string[] = [];
  const prohibited = upstreamProhibitedTerms(graph, node.id);
  if (prohibited.length > 0) {
    constraintBlocks.push(
      `[硬性约束 — 禁用词] 生成的任何内容中都绝对不能出现以下词语/说法：${prohibited.join("、")}。` +
        `质检按“包含”匹配：任何包含这些字的短语同样被禁止（例如禁用“第一”时，“第一缕阳光”“第一杯咖啡”这类表达也不允许），必须换用不含这些字的说法。`,
    );
  }
  const brandTerms = upstreamBrandTerms(graph, node.id);
  if (brandTerms.length > 0) {
    constraintBlocks.push(`[品牌词] 建议在文案中自然融入以下品牌词，不必全部使用：${brandTerms.join("、")}`);
  }
  if (constraintBlocks.length > 0) {
    prompt = prompt ? `${prompt}\n\n${constraintBlocks.join("\n\n")}` : constraintBlocks.join("\n\n");
  }
  const config = {
    model: node.textGen?.model || fallbackModel,
    prompt,
    skills: node.textGen?.skills ?? [],
    temperature: node.textGen?.temperature ?? 0.7,
    timeoutMs: node.textGen?.timeoutMs ?? 120000,
    inputPolicy: node.textGen?.inputPolicy ?? { mode: "all" as const },
    retry: node.textGen?.retry ?? { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 },
  };
  emit({ type: "node.started", nodeId, attempt });

  let result: { output: string; usage: Usage } | null = null;
  let lastError: { message: string; code?: string } | null = null;
  const maxAttempts = 1 + config.retry.maxRetries;

  for (let tryIdx = 0; tryIdx < maxAttempts; tryIdx++) {
    if (opts.signal?.aborted || ctx.aborted) {
      ctx.aborted = true;
      return;
    }
    try {
      const agentInput = await inputFor(node);
      reworkNotes.delete(nodeId);
      // Variable tools ride along on every agent (safe, no approval needed).
      const tools = [...resolveTools(mounts), ...VARIABLE_TOOLS];
      const rawImageUris = imagesFor(nodeId);
      const referenceImages = opts.readArtifact
        ? await Promise.all(rawImageUris.map((u) => inlineImageUrl(u, opts.readArtifact!)))
        : rawImageUris;
      const content: ContentPart[] | undefined = referenceImages.length
        ? [{ type: "text", text: agentInput }, ...referenceImages.map((u): ContentPart => ({ type: "image", image: u }))]
        : undefined;
      const gen = worker.runTextGen({
        node,
        config,
        attempt,
        input: agentInput,
        images: referenceImages,
        content,
        tools,
        executeTool: async (name, args) => {
          if (name === "set_variable" || name === "get_variable") return handleVariableTool(name, args);
          guardToolCall(name, args, permCfg);
          if (isDangerousTool(name) && !approved.has(name)) {
            throw new HaltRequested(name, nodeId);
          }
          return executeBuiltinTool(name, args);
        },
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
        const chunk = step.value;
        if (chunk.type === "text-delta") {
          emit({ type: "node.delta", nodeId, attempt, text: chunk.text });
        } else if (chunk.type === "reasoning-delta") {
          emit({ type: "node.reasoning", nodeId, attempt, text: chunk.text });
        } else if (chunk.type === "tool-call") {
          emit({
            type: "tool.called",
            nodeId,
            attempt,
            callId: chunk.id,
            name: chunk.name,
            args: chunk.arguments,
          });
        } else if (chunk.type === "tool-result") {
          emit({
            type: "tool.result",
            nodeId,
            attempt,
            callId: chunk.id,
            name: chunk.name,
            result: chunk.result,
            error: chunk.error,
          });
        }
      }
      result = { output, usage: usage ?? zeroUsage() };
      break;
    } catch (err) {
      if (err instanceof HaltRequested) {
        // A dangerous tool was called without prior human approval: halt the
        // run and wait for a decision (4D.7). The node is intentionally left
        // incomplete so a resume re-runs it with the tool now approved.
        ctx.haltNodeId = err.nodeId;
        ctx.haltReason = `dangerous-tool:${err.toolName}`;
        ctx.status = "halted";
        ctx.aborted = true;
        void notifyHalt({ runId, graphId: graph.id, nodeId: err.nodeId, reason: ctx.haltReason });
        return;
      }
      const code = err instanceof ProviderError ? err.code : "UNKNOWN";
      lastError = { message: (err as Error).message, code };
      const canRetry = RETRYABLE.has(code) && tryIdx < maxAttempts - 1;
      if (!canRetry) break;
      await opts.sleep(
        Math.min(config.retry.maxDelayMs, config.retry.baseDelayMs * 2 ** tryIdx),
      );
    }
  }

  // E.3 output-contract: validate the agent's output against a mounted
  // output-contract skill, reworking (reusing the existing rework line) or
  // failing when the contract isn't satisfied.
  if (result) {
    const contract = getOutputContract(mounts);
    if (contract) {
      const contractErr = validateContract(result.output, contract);
      if (contractErr) {
        const loop = loopByGate.get(nodeId);
        const maxRework = loop?.maxAttempts ?? config.retry.maxRetries + 1;
        if (loop && attempt < maxRework) {
          reworkNotes.set(loop.entryId, `输出未满足契约：${contractErr}`);
          emit({
            type: "packet.sent",
            edgeId: loop.edge.id,
            from: nodeId,
            to: loop.entryId,
            summary: `输出未满足契约：${contractErr}`,
            artifactKind: "text",
          });
          for (const bodyId of loop.body) {
            states.set(bodyId, "pending");
            artifacts.set(bodyId, []);
          }
          return;
        }
        states.set(nodeId, "failed");
        emit({
          type: "node.failed",
          nodeId,
          attempt,
          error: `输出未满足契约：${contractErr}`,
          errorCode: "VALIDATION",
        });
        ctx.status = "failed";
        return;
      }
    }
  }

  if (!result) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: sanitizeError(lastError?.message ?? "agent failed with no output"),
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

  // An empty completion is not a product. Providers can answer 200 with no
  // text (openai-compatible falls back to `msg.content ?? ""`, e.g. a
  // tool-call-only turn or a filtered reply); recording that as done handed
  // downstream an empty string to interpolate and still reported the run as
  // done — same class as the media branches fixed in 2797011. Templates that
  // want to tolerate it can attach an error edge.
  if (!result.output.trim()) {
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `模型 ${config.model} 返回了空内容（无正文可交付）`,
      errorCode: "PROVIDER_ERROR",
    });
    ctx.status = "failed";
    return;
  }

  setTextArtifact(artifacts, nodeId, result.output);
  states.set(nodeId, "done");
  emit({ type: "node.finished", nodeId, attempt, output: result.output, usage: result.usage });
  const primaryKind = produceArtifacts(nodeId, result.output, attempt);

  // Cost accounting runs in a single synchronous block so concurrent
  // completions can't race the budget check.
  ctx.totalCostUsd += result.usage.costUsd;
  emit({ type: "power.metered", totalCostUsd: ctx.totalCostUsd, budgetUsd });

  const nodeSpent = (nodeCostUsd.get(nodeId) ?? 0) + result.usage.costUsd;
  nodeCostUsd.set(nodeId, nodeSpent);
  const nodeBudget = node.textGen?.budgetUsd;
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

  if (
    budgetUsd !== null &&
    budgetUsd > 0 &&
    !ctx.budgetWarned &&
    ctx.totalCostUsd >= budgetUsd * BUDGET_WARN
  ) {
    ctx.budgetWarned = true;
    emit({
      type: "power.warning",
      totalCostUsd: ctx.totalCostUsd,
      budgetUsd,
      threshold: BUDGET_WARN,
    });
  }

  if (budgetUsd !== null && ctx.totalCostUsd > budgetUsd) {
    emit({ type: "power.tripped", totalCostUsd: ctx.totalCostUsd, budgetUsd });
    ctx.status = "tripped";
    ctx.aborted = true;
    return;
  }

  // Monthly budget is advisory: warn at 80% and again at 100%, but don't
  // take the line down (a hard monthly trip would strand in-flight runs).
  if (monthlyBudgetUsd !== null && monthlyBudgetUsd > 0) {
    const monthlyTotal = monthSpentUsd + ctx.totalCostUsd;
    if (!ctx.monthlyWarned80 && monthlyTotal >= monthlyBudgetUsd * BUDGET_WARN) {
      ctx.monthlyWarned80 = true;
      emit({
        type: "power.warning",
        totalCostUsd: monthlyTotal,
        budgetUsd: monthlyBudgetUsd,
        threshold: BUDGET_WARN,
        scope: "monthly",
      });
    }
    if (!ctx.monthlyWarned100 && monthlyTotal >= monthlyBudgetUsd) {
      ctx.monthlyWarned100 = true;
      emit({
        type: "power.warning",
        totalCostUsd: monthlyTotal,
        budgetUsd: monthlyBudgetUsd,
        threshold: 1,
        scope: "monthly",
      });
    }
  }

  sendPackets(nodeId, result.output.slice(0, 120), primaryKind);
  }
