import { HaltRequested, type AgentChunk, type AgentResult, type AudioGenArgs, type AudioGenResult, type ImageGenResult, type VideoGenArgs, type VideoGenResult, type Worker } from "../worker.js";
import type { TextGenConfig, ContentPart as MultimodalContent, GraphNode, Usage } from "@agent-world/core";
import { computeCost, endpointFor, modalityOf, normalizeBaseUrl, type ModelPricing, type ProviderConfig } from "../config.js";

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

/** OpenAI-style multimodal content part. Only text and image_url are used today. */
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

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
 * Builds the user message content. When `content` (4.5 multimodal parts) is
 * supplied it is the canonical representation; otherwise we fall back to the
 * legacy `input` + `images` shortcut, flattening images into `image_url` parts.
 */
export function buildUserContent(
  input: string,
  images: string[] = [],
  content?: MultimodalContent[],
): string | ContentPart[] {
  if (content && content.length > 0) {
    return content.map((p) =>
      p.type === "image"
        ? { type: "image_url", image_url: { url: p.image } }
        : { type: "text", text: p.text },
    );
  }
  if (images.length > 0) {
    return [
      { type: "text", text: input || "(no input)" },
      ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    ];
  }
  return input || "(no input)";
}

/** Hard ceiling for a single image generation call, independent of the caller's abort. */
const IMAGE_GEN_TIMEOUT_MS = 120_000;

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
    messages: Array<{ role: string; content: string | ContentPart[] }>,
    config: TextGenConfig,
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
      response = await fetch(`${baseUrl}${endpointFor(provider, model, "text")}`, {
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

  /**
   * Tool-calling loop: send messages + tools to the model, execute any tool
   * calls via the injected executor, feed results back, and repeat until the
   * model produces a text answer. Uses non-streaming completions because tool
   * call arguments must arrive whole; the final text is yielded as deltas.
   */
  async function* runWithTools(
    model: string,
    messages: Array<{ role: string; content: string | ContentPart[] }>,
    config: TextGenConfig,
    tools: NonNullable<Parameters<Worker["runTextGen"]>[0]["tools"]>,
    executeTool: NonNullable<Parameters<Worker["runTextGen"]>[0]["executeTool"]>,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentChunk, AgentResult> {
    if (!provider.apiKey) {
      throw new ProviderError("AUTH", `Missing API key for provider at ${baseUrl}`);
    }

    const toolDefs = tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    type ChatMsg = {
      role: string;
      content: string | ContentPart[] | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      tool_call_id?: string;
    };
    const convo: ChatMsg[] = [...messages] as ChatMsg[];
    let totalIn = 0;
    let totalOut = 0;
    let finalText = "";
    const MAX_ROUNDS = 8;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal?.aborted) throw new ProviderError("TIMEOUT", "Aborted");

      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), config.timeoutMs);
      const onAbort = () => timeoutController.abort();
      signal?.addEventListener("abort", onAbort);

      let res: Response;
      try {
        res = await fetch(`${baseUrl}${endpointFor(provider, model, "text")}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: convo,
            tools: toolDefs,
            temperature: config.temperature,
            stream: false,
          }),
          signal: timeoutController.signal,
        });
      } catch (err) {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        if ((err as Error).name === "AbortError") {
          throw new ProviderError("TIMEOUT", `Request timed out after ${config.timeoutMs}ms`);
        }
        throw new ProviderError("UNKNOWN", (err as Error).message);
      }
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ProviderError(mapHttpStatus(res.status), `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
      }

      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const msg = data.choices?.[0]?.message;
      totalIn += data.usage?.prompt_tokens ?? 0;
      totalOut += data.usage?.completion_tokens ?? 0;

      const toolCalls = msg?.tool_calls ?? [];
      if (toolCalls.length === 0) {
        finalText = msg?.content ?? "";
        if (finalText) yield { type: "text-delta", text: finalText };
        break;
      }

      convo.push({ role: "assistant", content: msg?.content ?? null, tool_calls: toolCalls });

      for (const tc of toolCalls) {
        const callId = tc.id;
        const name = tc.function.name;
        let args: unknown = {};
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = tc.function.arguments;
        }
        yield { type: "tool-call", id: callId, name, arguments: args };

        let result: unknown;
        let toolError: string | undefined;
        try {
          result = await executeTool(name, args);
        } catch (err) {
          // A dangerous tool (unapproved) must halt the run, not be reported as a
          // tool error — re-throw so the engine can intercept it (4D.7).
          if (err instanceof HaltRequested) throw err;
          toolError = (err as Error).message;
          result = { error: toolError };
        }
        yield { type: "tool-result", id: callId, name, result, error: toolError };

        convo.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: callId,
        });
      }
    }

    const usage = computeUsage(
      { prompt_tokens: totalIn, completion_tokens: totalOut },
      pricingFor(model),
    );
    return { output: finalText, usage };
  }

  function buildMessages(node: GraphNode, config: TextGenConfig, input: string, images: string[] = [], content?: MultimodalContent[]) {
    const system = config.prompt || `You are a worker in the "${node.name}" plant. Process the input and produce output.`;
    const userContent = buildUserContent(input, images, content);
    return [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ];
  }

  function buildJudgeMessages(criterion: string, output: string) {
    const system =
      "You are a strict quality inspector on an assembly line. " +
      "Given a quality criterion and a produced output, decide if the output passes. " +
      "Respond with valid JSON: {\"passed\": boolean, \"reason\": string, \"score\": number}. " +
      "score is an integer 0-10 rating overall quality. " +
      "Be concise and specific in the reason.";
    const user = `Criterion:\n${criterion || "(no explicit criterion; judge overall quality)"}\n\nOutput to inspect:\n${output}`;
    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }

  function extractJson(text: string): { passed: boolean; reason: string; score?: number } {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { passed: false, reason: text.slice(0, 200) };
    try {
      const parsed = JSON.parse(match[0]);
      const score = typeof parsed.score === "number" ? Math.round(parsed.score) : undefined;
      return {
        passed: Boolean(parsed.passed),
        reason: typeof parsed.reason === "string" ? parsed.reason : JSON.stringify(parsed),
        ...(score !== undefined ? { score: Math.min(10, Math.max(0, score)) } : {}),
      };
    } catch {
      return { passed: false, reason: text.slice(0, 200) };
    }
  }

  return {
    async *runTextGen({ node, config, input, images, content, tools, executeTool, signal }) {
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
      const messages = buildMessages(node, config, input, images, content);
      if (tools && tools.length > 0 && executeTool) {
        return yield* runWithTools(model, messages, config, tools, executeTool, signal);
      }
      return yield* streamChat(model, messages, config, signal);
    },

    async judge({ node, output, criterion, signal }) {
      const model = node.textGen?.model ?? "agnes-2.0-flash";
      const config: TextGenConfig = {
        model,
        prompt: "",
        skills: [],
        temperature: 0,
        timeoutMs: 60000,
        inputPolicy: { mode: "all" },
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

    async generateImage({ config, input, signal }) {
      const model = config.model || "agnes-image";
      const ASPECT_TO_SIZE: Record<string, string> = {
        "1:1": "1024x1024",
        "3:4": "768x1024",
        "4:3": "1024x768",
        "16:9": "1024x576",
      };
      const size = config.size || (config.aspect ? ASPECT_TO_SIZE[config.aspect] : "1024x1024");
      const n = Math.min(8, Math.max(1, Math.trunc(config.n ?? 1)));
      // Per-node endpoint / key override lets an imageGen node target a different
      // server (e.g. a local SD / ComfyUI OpenAI-compatible endpoint) than chat.
      const endpoint = (config.baseUrl || baseUrl).replace(/\/+$/, "");
      const apiKey = config.apiKey || provider.apiKey;
      if (!apiKey) {
        throw new ProviderError(
          "AUTH",
          "Missing API key for image provider (set provider.apiKey or the node's baseUrl + apiKey)",
        );
      }
      // Timeout independent of the caller's abort so a hung image endpoint cannot
      // block the whole pipeline forever. Combined with the caller signal.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), IMAGE_GEN_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      let res: Response;
      try {
        res = await fetch(`${endpoint}${endpointFor(provider, model, "image")}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, prompt: input, n, size }),
          signal: controller.signal,
        });
      } catch (err) {
        throw new ProviderError("UNKNOWN", (err as Error).message);
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ProviderError(mapHttpStatus(res.status), `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
      }
      const json = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const items = json.data ?? [];
      if (items.length === 0) throw new ProviderError("PROVIDER_ERROR", "image generation returned no data");

      const results: ImageGenResult[] = [];
      for (const item of items) {
        let data: Buffer;
        let mimeType = "image/png";
        if (item.b64_json) {
          data = Buffer.from(item.b64_json, "base64");
        } else if (item.url) {
          const imgRes = await fetch(item.url, { signal: controller.signal });
          if (!imgRes.ok) {
            throw new ProviderError("PROVIDER_ERROR", `failed to fetch generated image: HTTP ${imgRes.status}`);
          }
          data = Buffer.from(await imgRes.arrayBuffer());
          const ct = imgRes.headers.get("content-type");
          if (ct) mimeType = ct;
        } else {
          throw new ProviderError("PROVIDER_ERROR", "image generation response missing image data");
        }
        // Price each generated image via the provider's perImage card so the
        // 电费 meter reflects image spend (defaults to 0 when no price is set).
        const imgCost = computeCost({ units: { images: 1 } }, pricingFor(model));
        results.push({ data, mimeType, usage: { tokensIn: 0, tokensOut: 0, costUsd: imgCost, units: { images: 1 } } });
      }
      return results;
    },

    // Video generation. Provider support varies widely — OpenAI has no public
    // video API and the path is not standardized (gateways expose /videos,
    // /videos/generations, ...). The endpoint comes from endpointFor():
    // provider.endpoints.video override > global default. Supports both sync
    // (returns b64_json/url immediately) and async (returns an id, then poll
    // <video endpoint>/:id) response shapes. Soft-fails via the engine when
    // the worker lacks this method entirely.
    async generateVideo({ config, input, signal }: VideoGenArgs): Promise<VideoGenResult[]> {
      const model = config.model || "video-gen";
      const n = Math.min(4, Math.max(1, Math.trunc(config.n ?? 1)));
      const endpoint = (config.baseUrl || baseUrl).replace(/\/+$/, "");
      const apiKey = config.apiKey || provider.apiKey;
      if (!apiKey) {
        throw new ProviderError("AUTH", "Missing API key for video provider");
      }
      const VIDEO_TIMEOUT_MS = 300_000; // video gen is slow
      const POLL_INTERVAL_MS = 3000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), VIDEO_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const body: Record<string, unknown> = { model, prompt: input, n };
        if (config.duration) body.duration = config.duration;
        if (config.aspect) body.aspect_ratio = config.aspect;
        if (config.size) body.size = config.size;

        const res = await fetch(`${endpoint}${endpointFor(provider, model, "video")}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new ProviderError(mapHttpStatus(res.status), `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
        }
        const json = (await res.json()) as Record<string, unknown>;

        // Async: task was accepted, poll for completion.
        if (json.id && (json.status === "processing" || json.status === "queued" || json.status === "in_progress")) {
          const taskId = json.id as string;
          let videoUrl: string | undefined;
          while (!controller.signal.aborted) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            const pollRes = await fetch(`${endpoint}${endpointFor(provider, model, "video")}/${taskId}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: controller.signal,
            });
            if (!pollRes.ok) continue;
            const pollJson = (await pollRes.json()) as Record<string, unknown>;
            if (pollJson.status === "succeeded" || pollJson.status === "completed") {
              const output = pollJson.output as Array<{ url?: string; b64_json?: string }> | undefined;
              videoUrl = output?.[0]?.url;
              break;
            }
            if (pollJson.status === "failed") {
              throw new ProviderError("PROVIDER_ERROR", `video generation failed: ${String(pollJson.error ?? "")}`);
            }
          }
          if (!videoUrl) throw new ProviderError("PROVIDER_ERROR", "video generation timed out");
          const vidRes = await fetch(videoUrl, { signal: controller.signal });
          if (!vidRes.ok) throw new ProviderError("PROVIDER_ERROR", `failed to fetch video: HTTP ${vidRes.status}`);
          const data = Buffer.from(await vidRes.arrayBuffer());
          const ct = vidRes.headers.get("content-type") || "video/mp4";
          return [{ data, mimeType: ct, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, units: {} } }];
        }

        // Sync: response contains data array with b64_json or url.
        const items = (json.data as Array<{ b64_json?: string; url?: string }> | undefined) ?? [];
        if (items.length === 0) throw new ProviderError("PROVIDER_ERROR", "video generation returned no data");
        const results: VideoGenResult[] = [];
        for (const item of items.slice(0, n)) {
          let data: Buffer;
          if (item.b64_json) {
            data = Buffer.from(item.b64_json, "base64");
          } else if (item.url) {
            const vidRes = await fetch(item.url, { signal: controller.signal });
            if (!vidRes.ok) throw new ProviderError("PROVIDER_ERROR", `failed to fetch video: HTTP ${vidRes.status}`);
            data = Buffer.from(await vidRes.arrayBuffer());
          } else {
            throw new ProviderError("PROVIDER_ERROR", "video response missing data");
          }
          results.push({ data, mimeType: "video/mp4", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, units: {} } });
        }
        return results;
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
    },

    // Audio generation (TTS / music). OpenAI /audio/speech is the most common
    // compatible endpoint — synchronous, returns audio binary directly.
    async generateAudio({ config, input, signal }: AudioGenArgs): Promise<AudioGenResult[]> {
      const model = config.model || "tts-1";
      const n = Math.min(4, Math.max(1, Math.trunc(config.n ?? 1)));
      const endpoint = (config.baseUrl || baseUrl).replace(/\/+$/, "");
      const apiKey = config.apiKey || provider.apiKey;
      if (!apiKey) {
        throw new ProviderError("AUTH", "Missing API key for audio provider");
      }
      const AUDIO_TIMEOUT_MS = 120_000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AUDIO_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const results: AudioGenResult[] = [];
        for (let i = 0; i < n; i++) {
          const res = await fetch(`${endpoint}${endpointFor(provider, model, "audio")}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              input: input || config.prompt || "",
              voice: config.voice || "alloy",
              response_format: config.format || "mp3",
              ...(config.speed != null ? { speed: config.speed } : {}),
            }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new ProviderError(mapHttpStatus(res.status), `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
          }
          const data = Buffer.from(await res.arrayBuffer());
          const ct = res.headers.get("content-type") || `audio/${config.format || "mpeg"}`;
          results.push({ data, mimeType: ct, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, units: {} } });
        }
        return results;
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
    },

    async summarize({ text, maxChars, model, signal }) {
      const m = model || "agnes-2.0-flash";
      const modality = modalityOf(provider, m);
      if (modality !== "text") {
        throw new ProviderError(
          "UNSUPPORTED",
          `Model "${m}" is a ${modality} model; summarization for ${modality} models is not yet implemented`,
        );
      }
      const config: TextGenConfig = {
        model: m,
        prompt: "",
        skills: [],
        temperature: 0,
        timeoutMs: 60000,
        inputPolicy: { mode: "all" },
        retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
      };
      const messages = [
        {
          role: "system",
          content:
            `Compress the following assembly-line context so it fits within about ${maxChars} characters ` +
            "while preserving every key fact, decision, constraint, number, and named entity. " +
            "Output only the compressed text — no preamble, no commentary.",
        },
        { role: "user", content: text },
      ];
      const gen = streamChat(m, messages, config, signal);
      let result: AgentResult | null = null;
      while (true) {
        const step = await gen.next();
        if (step.done) {
          result = step.value;
          break;
        }
      }
      return (result?.output ?? "").trim();
    },
  };
}
