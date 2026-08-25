import type { AgentConfig, GraphNode, Usage } from "@agent-world/core";

/**
 * A streamed chunk from a running agent. Text deltas become node.delta events;
 * reasoning deltas become node.reasoning events; tool-call/tool-result are
 * reserved for Phase 2 skill execution.
 */
export type AgentChunk =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; arguments: string }
  | { type: "tool-result"; id: string; result: unknown };

export interface AgentResult {
  output: string;
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
    signal?: AbortSignal;
  }): AsyncGenerator<AgentChunk, AgentResult>;

  judge(args: {
    node: GraphNode;
    attempt: number;
    input: string;
    output: string;
    criterion: string;
    signal?: AbortSignal;
  }): Promise<{ passed: boolean; reason: string }>;
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
      if (!criterion) {
        return attempt <= failFirst
          ? { passed: false, reason: "Output is too thin — send it back to the forge" }
          : { passed: true, reason: `Accepted on attempt ${attempt} (${input.length} chars)` };
      }
      // Deterministic criterion-aware stand-in: reject until attempts run out,
      // then pass. Real workers let the model judge against criterion.
      return attempt <= failFirst
        ? { passed: false, reason: `Criterion not met: ${criterion.slice(0, 80)}` }
        : { passed: true, reason: `Meets criterion: ${criterion.slice(0, 80)}` };
    },
  };
}
