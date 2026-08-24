import type { AgentConfig, GraphNode, Usage } from "@agent-world/core";

/**
 * The seam between orchestration and model calls. The engine only knows this
 * interface, so the fake worker used for wiring up the canvas and a real
 * provider-backed worker are drop-in swappable — and tests stay deterministic.
 */
export interface Worker {
  /** Yields streamed text, returns the finished artifact plus metered usage. */
  runAgent(args: {
    node: GraphNode;
    config: AgentConfig;
    attempt: number;
    input: string;
  }): AsyncGenerator<string, { output: string; usage: Usage }, void>;

  judge(args: {
    node: GraphNode;
    attempt: number;
    input: string;
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
      let output = "";
      for (const c of chunks) {
        await new Promise((r) => setTimeout(r, delay));
        output += c;
        yield c;
      }
      const tokensIn = Math.max(1, Math.ceil(input.length / 4));
      const tokensOut = Math.max(1, Math.ceil(output.length / 4));
      return {
        output,
        usage: {
          tokensIn,
          tokensOut,
          costUsd: (tokensIn * 3 + tokensOut * 15) / 1_000_000,
        },
      };
    },

    async judge({ attempt, input }) {
      await new Promise((r) => setTimeout(r, delay));
      return attempt <= failFirst
        ? { passed: false, reason: "Output is too thin — send it back to the forge" }
        : { passed: true, reason: `Accepted on attempt ${attempt} (${input.length} chars)` };
    },
  };
}
