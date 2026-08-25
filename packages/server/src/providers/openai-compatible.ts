import type { AgentChunk, AgentResult, Worker } from "../worker.js";
import type { AgentConfig, GraphNode, Usage } from "@agent-world/core";
import { computeCost, modalityOf, normalizeBaseUrl, type ModelPricing, type ProviderConfig } from "../config.js";

export class ProviderError extends Error {
  constructor(
    public readonly code: "TIMEOUT" | "RATE_LIMIT" | "PROVIDER_ERROR" | "AUTH" | "UNKNOWN" | "UNSUPPORTED",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

interface StreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

function mapHttpStatus(status: number): ProviderError["code"] {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "RATE_LIMIT";
  if (status === 408 || status === 524 || status === 504) return "TIMEOUT";
  if (status >= 500) return "PROVIDER_ERROR";
  return "UNKNOWN";
}

/**
 * Build a Usage record from raw provider token usage and a model's price card.
 * Non-token modalities (image/video/audio) report their own `units` counters
 * (images, seconds, characters) — the shared computeCost helper prices whichever
 * dimensions both the usage and the price card provide.
 */
function computeUsage(
  raw: NonNullable<StreamChunk["usage"]>,
  pricing: ModelPricing | undefined,
  units?: Usage["units"],
): Usage {
  const tokensIn = raw.prompt_tokens ?? 0;
  const tokensOut = raw.completion_tokens ?? 0;
  const cachedTokens = raw.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = raw.completion_tokens_details?.reasoning_tokens ?? 0;
  const costUsd = computeCost({ tokensIn, tokensOut, cachedTokens, units }, pricing);
  return { tokensIn, tokensOut, costUsd, cachedTokens, reasoningTokens, ...(units ? { units } : {}) };
}

/**
 * Worker for any OpenAI-compatible Chat Completions API: OpenAI, Volcengine Ark,
 * Agnes, DeepSeek, Moonshot, vLLM, Ollama, etc. one implementation covers them all.
 */
export function openAICompatibleWorker(provider: ProviderConfig): Worker {
  const baseUrl = normalizeBaseUrl(provider.baseUrl ?? "https://api.openai.com/v1");
  const pricingFor = (model: string): ModelPricing | undefined => provider.pricing?.[model];

  async function* streamChat(
    model: string,
    messages: Array<{ role: string; content: string }>,
    config: AgentConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentChunk, AgentResult> {
    if (!provider.apiKey) {
      throw new ProviderError("AUTH", `Missing API key for provider at ${baseUrl}`);
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), config.timeoutMs);
    const onAbort = () => timeoutController.abort();
    signal?.addEventListener("abort", onAbort);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: config.temperature,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: timeoutController.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if ((err as Error).name === "AbortError") {
        throw new ProviderError("TIMEOUT", `Request timed out after ${config.timeoutMs}ms`);
      }
      throw new ProviderError("UNKNOWN", (err as Error).message);
    }

    if (!response.ok || !response.body) {
      clearTimeout(timeout);
      const text = await response.text().catch(() => "");
      throw new ProviderError(
        mapHttpStatus(response.status),
        `HTTP ${response.status}: ${text.slice(0, 300)}`,
        response.status,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let output = "";
    let finalUsage: Usage | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          let parsed: StreamChunk;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            output += delta.content;
            yield { type: "text-delta", text: delta.content };
          }
          if (delta?.reasoning_content) {
            yield { type: "reasoning-delta", text: delta.reasoning_content };
          }
          if (parsed.usage) {
            finalUsage = computeUsage(parsed.usage, pricingFor(model));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new ProviderError("TIMEOUT", `Stream timed out after ${config.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reader.releaseLock();
    }

    const fallback: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
    return { output, usage: finalUsage ?? fallback };
  }

  function buildMessages(node: GraphNode, config: AgentConfig, input: string) {
    const system = config.prompt || `You are a worker in the "${node.name}" plant. Process the input and produce output.`;
    return [
      { role: "system", content: system },
      { role: "user", content: input || "(no input)" },
    ];
  }

  function buildJudgeMessages(criterion: string, output: string) {
    const system =
      "You are a strict quality inspector on an assembly line. " +
      "Given a quality criterion and a produced output, decide if the output passes. " +
      "Respond with valid JSON: {\"passed\": boolean, \"reason\": string}. " +
      "Be concise and specific in the reason.";
    const user = `Criterion:\n${criterion || "(no explicit criterion; judge overall quality)"}\n\nOutput to inspect:\n${output}`;
    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }

  function extractJson(text: string): { passed: boolean; reason: string } {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { passed: false, reason: text.slice(0, 200) };
    try {
      const parsed = JSON.parse(match[0]);
      return {
        passed: Boolean(parsed.passed),
        reason: typeof parsed.reason === "string" ? parsed.reason : JSON.stringify(parsed),
      };
    } catch {
      return { passed: false, reason: text.slice(0, 200) };
    }
  }

  return {
    async *runAgent({ node, config, input, signal }) {
      const model = config.model || "agnes-2.0-flash";
      const modality = modalityOf(provider, model);
      if (modality !== "text") {
        // Phase 1 runtime is text-only. The model can still be configured and
        // tested, but running it through a text assembly node is not supported yet.
        throw new ProviderError(
          "UNSUPPORTED",
          `Model "${model}" is a ${modality} model; text-pipeline execution for ${modality} models is not yet implemented`,
        );
      }
      return yield* streamChat(model, buildMessages(node, config, input), config, signal);
    },

    async judge({ node, output, criterion, signal }) {
      const model = node.agent?.model ?? "agnes-2.0-flash";
      const config: AgentConfig = {
        model,
        prompt: "",
        skills: [],
        temperature: 0,
        timeoutMs: 60000,
        retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
      };
      const gen = streamChat(model, buildJudgeMessages(criterion, output), config, signal);
      let result: AgentResult | null = null;
      while (true) {
        const step = await gen.next();
        if (step.done) {
          result = step.value;
          break;
        }
        // discard deltas; judge verdict comes from final JSON
      }
      return extractJson(result?.output ?? "");
    },
  };
}
