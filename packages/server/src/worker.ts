import type { TextGenConfig, AudioGenConfig, ContentPart, GraphNode, ImageGenConfig, Usage, VideoGenConfig } from "@agent-world/core";

/** A callable tool exposed to a model, derived from a mounted skill card. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

/** Resolves a tool call to a result. The engine injects a sandboxed implementation. */
export type ToolExecutor = (name: string, args: unknown) => Promise<unknown>;

/**
 * A streamed chunk from a running agent. Text deltas become node.delta events;
 * reasoning deltas become node.reasoning events; tool-call/tool-result stream
 * the multi-round ReAct loop (implemented in openai-compatible.ts runWithTools).
 */
export type AgentChunk =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; arguments: unknown }
  | { type: "tool-result"; id: string; name: string; result: unknown; error?: string };

export interface AgentResult {
  output: string;
  usage: Usage;
}

/** Arguments for a text-to-image generation request. */
export interface ImageGenArgs {
  node: GraphNode;
  config: ImageGenConfig;
  /** The generation prompt, often auto-built from the source brief. */
  input: string;
  signal?: AbortSignal;
}

/** Raw generated image bytes plus metering. */
export interface ImageGenResult {
  data: Buffer;
  mimeType: string;
  usage: Usage;
}

/** Arguments for a text-to-video generation request. */
export interface VideoGenArgs {
  node: GraphNode;
  config: VideoGenConfig;
  input: string;
  signal?: AbortSignal;
}

/** Raw generated video bytes plus metering. */
export interface VideoGenResult {
  data: Buffer;
  mimeType: string;
  /** Duration in seconds, when the provider reports it. */
  durationSec?: number;
  usage: Usage;
}

/** Arguments for a text-to-audio / TTS generation request. */
export interface AudioGenArgs {
  node: GraphNode;
  config: AudioGenConfig;
  input: string;
  signal?: AbortSignal;
}

/** Raw generated audio bytes plus metering. */
export interface AudioGenResult {
  data: Buffer;
  mimeType: string;
  usage: Usage;
}

/**
 * The seam between orchestration and model calls. The engine only knows this
 * interface, so the fake worker used for wiring up the canvas and a real
 * provider-backed worker are drop-in swappable — and tests stay deterministic.
 */
export interface Worker {
  /** Yields streamed chunks, returns the finished artifact plus metered usage. */
  runTextGen(args: {
    node: GraphNode;
    config: TextGenConfig;
    attempt: number;
    input: string;
    /** Reference image URLs (from upstream source nodes) for vision models. */
    images?: string[];
    /**
     * Structured multimodal input (text + image parts). When present it is the
     * canonical representation; `input` + `images` are the legacy shortcut that
     * the engine assembles into `content` automatically (4.5).
     */
    content?: ContentPart[];
    /** Tools available to this agent, derived from its mounted skill cards. */
    tools?: ToolDefinition[];
    /** Executes a tool call. The worker must yield tool-call/tool-result around it. */
    executeTool?: ToolExecutor;
    signal?: AbortSignal;
  }): AsyncGenerator<AgentChunk, AgentResult>;

  judge(args: {
    node: GraphNode;
    attempt: number;
    input: string;
    output: string;
    criterion: string;
    signal?: AbortSignal;
  }): Promise<{ passed: boolean; reason: string; score?: number }>;

  /** Generates one or more images (banner / scene) from a prompt. Used by `imageGen` nodes. */
  generateImage(args: ImageGenArgs): Promise<ImageGenResult[]>;

  /**
   * Generates one or more short video clips from a prompt. Used by `videoGen` nodes.
   * Optional: when absent the engine soft-fails the node (no error, zero usage),
   * so providers without video support still work.
   */
  generateVideo?(args: VideoGenArgs): Promise<VideoGenResult[]>;

  /**
   * Generates audio (TTS / music) from text. Used by `audioGen` nodes.
   * Optional: soft-fails when absent, same as generateVideo.
   */
  generateAudio?(args: AudioGenArgs): Promise<AudioGenResult[]>;

  /**
   * Compresses `text` to roughly `maxChars` characters (LLM rolling summary).
   * Optional: when absent the engine falls back to hard `truncate` for
   * `summary` input policies, so implementers/tests need not provide it.
   */
  summarize?(args: {
    text: string;
    maxChars: number;
    /** Model to summarize with; falls back to the worker's default. */
    model?: string;
    signal?: AbortSignal;
  }): Promise<string>;
}

/**
 * Thrown by a tool call when the tool is flagged dangerous and has not yet been
 * approved by a human. The engine's `executeTool` closure throws it; workers must
 * let it propagate (NOT catch it as a normal tool error) so the engine can halt
 * the run and request human approval (4D.7 dangerous-action halt).
 */
export class HaltRequested extends Error {
  constructor(public readonly toolName: string, public readonly nodeId: string) {
    super(`dangerous tool "${toolName}" blocked pending human approval`);
    this.name = "HaltRequested";
  }
}

function zeroUsage(): Usage {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
}

/** Deterministic stand-in: no network, no clock, seeded verdicts. */
export function fakeWorker(opts: { failFirstAttempts?: number; chunkDelayMs?: number } = {}): Worker {
  const failFirst = opts.failFirstAttempts ?? 1;
  const delay = opts.chunkDelayMs ?? 90;

  return {
    async *runTextGen({ node, attempt, input }) {
      const chunks = [
        `[${node.name}] attempt ${attempt}`,
        ` consuming ${input.length} chars of input`,
        ` -> producing artifact`,
      ];
      for (const c of chunks) {
        await new Promise((r) => setTimeout(r, delay));
        yield { type: "text-delta", text: c };
      }
      const tokensIn = Math.max(1, Math.ceil(input.length / 4));
      const tokensOut = Math.max(1, Math.ceil(chunks.join("").length / 4));
      return {
        output: chunks.join(""),
        usage: {
          tokensIn,
          tokensOut,
          costUsd: (tokensIn * 3 + tokensOut * 15) / 1_000_000,
        },
      };
    },

    async judge({ attempt, input, criterion }) {
      await new Promise((r) => setTimeout(r, delay));
      // Deterministic score: a failing attempt scores low, an accepted one high.
      // Lets the eval report compare quality across prompt versions.
      const score = attempt <= failFirst ? 3 : 9;
      if (!criterion) {
        return attempt <= failFirst
          ? { passed: false, reason: "Output is too thin — send it back to the forge", score }
          : { passed: true, reason: `Accepted on attempt ${attempt} (${input.length} chars)`, score };
      }
      // Deterministic criterion-aware stand-in: reject until attempts run out,
      // then pass. Real workers let the model judge against criterion.
      return attempt <= failFirst
        ? { passed: false, reason: `Criterion not met: ${criterion.slice(0, 80)}`, score }
        : { passed: true, reason: `Meets criterion: ${criterion.slice(0, 80)}`, score };
    },

    // Deterministic 1x1 PNG placeholder so canvas wiring + tests work without a
    // live image backend. Real workers hit the provider's image endpoint. Honors
    // `n` so the engine can exercise multi-image fan-out.
    async generateImage({ config }: ImageGenArgs) {
      const n = Math.min(8, Math.max(1, Math.trunc(config.n ?? 1)));
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
        "base64",
      );
      return Array.from({ length: n }, () => ({
        data: png,
        mimeType: "image/png",
        usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { images: 1 } },
      }));
    },

    // Deterministic placeholder video (tiny mp4-ish buffer) so canvas wiring +
    // tests work without a live video backend. Honors `n`.
    async generateVideo({ config }: VideoGenArgs) {
      const n = Math.min(4, Math.max(1, Math.trunc(config.n ?? 1)));
      const placeholder = Buffer.from(`fake-video-${config.model ?? "default"}`);
      return Array.from({ length: n }, (_, i) => ({
        data: placeholder,
        mimeType: "video/mp4",
        durationSec: config.duration ?? 5,
        usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { seconds: config.duration ?? 5 } },
      }));
    },

    // Deterministic placeholder audio (tiny mp3-ish buffer) for TTS / music nodes.
    async generateAudio({ config }: AudioGenArgs) {
      const n = Math.min(4, Math.max(1, Math.trunc(config.n ?? 1)));
      const placeholder = Buffer.from(`fake-audio-${config.voice ?? "default"}`);
      const mime = config.format === "wav" ? "audio/wav" : config.format === "opus" ? "audio/ogg" : "audio/mpeg";
      return Array.from({ length: n }, () => ({
        data: placeholder,
        mimeType: mime,
        usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, units: {} },
      }));
    },

    // Deterministic stand-in: keep head+tail and mark as summarized so tests can
    // assert the summary path was taken. Real workers hit the model.
    async summarize({ text, maxChars }) {
      if (text.length <= maxChars) return text;
      const keep = Math.max(20, Math.floor(maxChars / 2));
      return `[[SUMMARY of ${text.length} chars, target ${maxChars}]] ${text.slice(0, keep)} … ${text.slice(-keep)}`;
    },
  };
}
