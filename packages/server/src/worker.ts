import type { AgentConfig, GraphNode, ImageGenConfig, Usage } from "@agent-world/core";

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
 * reasoning deltas become node.reasoning events; tool-call/tool-result are
 * reserved for Phase 2 skill execution.
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

/**
 * The seam between orchestration and model calls. The engine only knows this
 * interface, so the fake worker used for wiring up the canvas and a real
 * provider-backed worker are drop-in swappable — and tests stay deterministic.
 */
export interface Worker {
  /** Yields streamed chunks, returns the finished artifact plus metered usage. */
  runAgent(args: {
    node: GraphNode;
    config: AgentConfig;
    attempt: number;
    input: string;
    /** Reference image URLs (from upstream source nodes) for vision models. */
    images?: string[];
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

  /** Generates an image (banner / scene) from a prompt. Used by `imageGen` nodes. */
  generateImage(args: ImageGenArgs): Promise<ImageGenResult>;
}

function zeroUsage(): Usage {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
}

/** Deterministic stand-in: no network, no clock, seeded verdicts. */
export function fakeWorker(opts: { failFirstAttempts?: number; chunkDelayMs?: number } = {}): Worker {
  const failFirst = opts.failFirstAttempts ?? 1;
  const delay = opts.chunkDelayMs ?? 90;

  return {
    async *runAgent({ node, attempt, input }) {
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
    // live image backend. Real workers hit the provider's image endpoint.
    async generateImage() {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
        "base64",
      );
      return { data: png, mimeType: "image/png", usage: zeroUsage() };
    },
  };
}
