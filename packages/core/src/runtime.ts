import type { RunEvent } from "./events.js";

/**
 * Derived state, never edited by hand. Replaying a run is re-reducing the event
 * prefix `seq <= n`, so this must stay pure: no clocks, no fetches, no randomness.
 */
export interface NodeRuntime {
  status: "idle" | "running" | "done" | "failed" | "scrapped";
  attempt: number;
  /** Output text per attempt, keyed by attempt number, for attempt-diffing. */
  outputs: Record<number, string>;
  /** Hidden reasoning/thinking tokens per attempt, when the model emits them. */
  reasoning: Record<number, string>;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number;
  error?: string;
  errorCode?: string;
}

export interface PacketRuntime {
  edgeId: string;
  from: string;
  to: string;
  summary: string;
  /** Sequence number it was emitted at; the canvas animates from this. */
  seq: number;
}

export interface RuntimeState {
  runId: string | null;
  status: "idle" | "running" | "done" | "failed" | "halted" | "tripped" | "cancelled";
  nodes: Record<string, NodeRuntime>;
  packets: PacketRuntime[];
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCachedTokens: number;
  budgetUsd: number | null;
  lastSeq: number;
}

export const initialRuntime: RuntimeState = {
  runId: null,
  status: "idle",
  nodes: {},
  packets: [],
  totalCostUsd: 0,
  totalTokensIn: 0,
  totalTokensOut: 0,
  totalCachedTokens: 0,
  budgetUsd: null,
  lastSeq: -1,
};

function nodeOf(state: RuntimeState, id: string): NodeRuntime {
  return state.nodes[id] ?? {
    status: "idle",
    attempt: 0,
    outputs: {},
    reasoning: {},
    tokensIn: 0,
    tokensOut: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
  };
}

function withNode(state: RuntimeState, id: string, patch: Partial<NodeRuntime>): RuntimeState {
  return { ...state, nodes: { ...state.nodes, [id]: { ...nodeOf(state, id), ...patch } } };
}

export function reduce(state: RuntimeState, event: RunEvent): RuntimeState {
  const next = ((): RuntimeState => {
    switch (event.type) {
      case "run.started":
        return {
          ...initialRuntime,
          runId: event.runId,
          status: "running",
          budgetUsd: event.budgetUsd,
        };

      case "node.started":
        return withNode(state, event.nodeId, { status: "running", attempt: event.attempt });

      case "node.delta": {
        const node = nodeOf(state, event.nodeId);
        const prev = node.outputs[event.attempt] ?? "";
        return withNode(state, event.nodeId, {
          outputs: { ...node.outputs, [event.attempt]: prev + event.text },
        });
      }

      case "node.reasoning": {
        const node = nodeOf(state, event.nodeId);
        const prev = node.reasoning[event.attempt] ?? "";
        return withNode(state, event.nodeId, {
          reasoning: { ...node.reasoning, [event.attempt]: prev + event.text },
        });
      }

      case "node.finished": {
        const node = nodeOf(state, event.nodeId);
        const next = withNode(state, event.nodeId, {
          status: "done",
          outputs: { ...node.outputs, [event.attempt]: event.output },
          tokensIn: node.tokensIn + event.usage.tokensIn,
          tokensOut: node.tokensOut + event.usage.tokensOut,
          cachedTokens: node.cachedTokens + (event.usage.cachedTokens ?? 0),
          reasoningTokens: node.reasoningTokens + (event.usage.reasoningTokens ?? 0),
          costUsd: node.costUsd + event.usage.costUsd,
        });
        return {
          ...next,
          totalTokensIn: state.totalTokensIn + event.usage.tokensIn,
          totalTokensOut: state.totalTokensOut + event.usage.tokensOut,
          totalCachedTokens: state.totalCachedTokens + (event.usage.cachedTokens ?? 0),
        };
      }

      case "node.failed":
        return withNode(state, event.nodeId, {
          status: "failed",
          error: event.error,
          errorCode: event.errorCode,
        });

      case "packet.sent":
        return {
          ...state,
          packets: [
            ...state.packets,
            { edgeId: event.edgeId, from: event.from, to: event.to, summary: event.summary, seq: event.seq },
          ],
        };

      case "gate.verdict":
        return withNode(state, event.nodeId, { status: event.passed ? "done" : "failed" });

      case "gate.exhausted":
        return event.policy === "scrap"
          ? withNode(state, event.nodeId, { status: "scrapped" })
          : state;

      case "power.metered":
        return { ...state, totalCostUsd: event.totalCostUsd, budgetUsd: event.budgetUsd };

      case "power.tripped":
        return { ...state, totalCostUsd: event.totalCostUsd, status: "tripped" };

      case "run.finished":
        return { ...state, status: event.status };
    }
  })();

  return { ...next, lastSeq: event.seq };
}

/** Rebuild state at a point in time — the replay scrubber. */
export function replay(events: RunEvent[], untilSeq = Infinity): RuntimeState {
  return events
    .filter((e) => e.seq <= untilSeq)
    .sort((a, b) => a.seq - b.seq)
    .reduce(reduce, initialRuntime);
}
