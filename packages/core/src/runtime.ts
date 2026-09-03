import type { RunEvent } from "./events.js";
import type { Artifact } from "./artifact.js";
import { addUnits, type UsageUnits } from "./pricing.js";

/**
 * Derived state, never edited by hand. Replaying a run is re-reducing the event
 * prefix `seq <= n`, so this must stay pure: no clocks, no fetches, no randomness.
 */
export interface NodeRuntime {
  status: "idle" | "running" | "done" | "failed" | "skipped" | "scrapped";
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
  /** Aggregated non-token usage (images, seconds, characters) across attempts. */
  units: UsageUnits;
  /** Tool calls made during this node's execution, newest last. */
  toolCalls: ToolCallRecord[];
  /** Typed artifacts produced by this node across all attempts. */
  artifacts: Artifact[];
  error?: string;
  errorCode?: string;
  /** Last gate verdict (passed/reason/score), for gate nodes only. */
  lastVerdict?: { passed: boolean; reason: string; score?: number; attempt: number };
  /** Epoch ms when the current attempt started (node.started). */
  startedAt?: number;
  /** Epoch ms when the current attempt finished (node.finished / node.failed). */
  finishedAt?: number;
  /** Upstream text awaiting an operator decision on a paused `human` node. */
  pendingReview?: string;
}

export interface ToolCallRecord {
  callId: string;
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
  attempt: number;
}

export interface PacketRuntime {
  edgeId: string;
  from: string;
  to: string;
  summary: string;
  /** Kind of the carried artifact, for truck rendering. */
  artifactKind?: Artifact["kind"];
  /** Sequence number it was emitted at; the canvas animates from this. */
  seq: number;
}

/** A single failure recorded during a run (node error, gate scrap, budget trip). */
export interface FailureRecord {
  kind: "node" | "gate" | "budget";
  nodeId?: string;
  attempt?: number;
  errorCode?: string;
  error: string;
  /** Event sequence the failure was recorded at. */
  seq: number;
  ts: number;
}

export interface RuntimeState {
  runId: string | null;
  status: "idle" | "running" | "done" | "failed" | "halted" | "tripped" | "cancelled";
  /** When the run halted waiting for a human decision, which gate triggered it. */
  haltedNodeId?: string;
  /** Why the run halted (4D.7 dangerous-tool / 4.7 gate policy), surfaced to the UI. */
  reason?: string;
  /** Tools the operator has approved for execution this run (4D.7 dangerous-action halt). */
  approvedTools: string[];
  nodes: Record<string, NodeRuntime>;
  packets: PacketRuntime[];
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCachedTokens: number;
  /** Aggregated non-token usage across the whole run. */
  totalUnits: UsageUnits;
  budgetUsd: number | null;
  lastSeq: number;
  /** True once the 80% per-run budget warning has fired. */
  budgetWarned: boolean;
  /** True once the monthly budget warning has fired (advisory, cross-run). */
  monthlyBudgetWarned: boolean;
  /** Append-only history of failures for this run, oldest first. */
  failures: FailureRecord[];
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
  totalUnits: {},
  budgetUsd: null,
  lastSeq: -1,
  budgetWarned: false,
  monthlyBudgetWarned: false,
  failures: [],
  reason: undefined,
  approvedTools: [],
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
    units: {},
    toolCalls: [],
    artifacts: [],
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
        return withNode(state, event.nodeId, { status: "running", attempt: event.attempt, startedAt: event.ts, finishedAt: undefined });

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

      case "tool.called": {
        const node = nodeOf(state, event.nodeId);
        const record: ToolCallRecord = {
          callId: event.callId,
          name: event.name,
          args: event.args,
          attempt: event.attempt,
        };
        return withNode(state, event.nodeId, {
          toolCalls: [...node.toolCalls, record],
        });
      }

      case "tool.result": {
        const node = nodeOf(state, event.nodeId);
        const toolCalls = node.toolCalls.map((t) =>
          t.callId === event.callId
            ? { ...t, result: event.result, error: event.error }
            : t,
        );
        return withNode(state, event.nodeId, { toolCalls });
      }

      case "artifact.produced": {
        const node = nodeOf(state, event.nodeId);
        return withNode(state, event.nodeId, {
          artifacts: [...node.artifacts, event.artifact],
        });
      }

      case "node.finished": {
        const node = nodeOf(state, event.nodeId);
        const nodeUnits = addUnits(node.units, event.usage.units);
        const next = withNode(state, event.nodeId, {
          status: "done",
          outputs: { ...node.outputs, [event.attempt]: event.output },
          tokensIn: node.tokensIn + event.usage.tokensIn,
          tokensOut: node.tokensOut + event.usage.tokensOut,
          cachedTokens: node.cachedTokens + (event.usage.cachedTokens ?? 0),
          reasoningTokens: node.reasoningTokens + (event.usage.reasoningTokens ?? 0),
          costUsd: node.costUsd + event.usage.costUsd,
          units: nodeUnits,
          finishedAt: event.ts,
        });
        return {
          ...next,
          totalTokensIn: state.totalTokensIn + event.usage.tokensIn,
          totalTokensOut: state.totalTokensOut + event.usage.tokensOut,
          totalCachedTokens: state.totalCachedTokens + (event.usage.cachedTokens ?? 0),
          totalUnits: addUnits(state.totalUnits, event.usage.units),
        };
      }

      case "node.failed":
        return {
          ...withNode(state, event.nodeId, {
            status: "failed",
            error: event.error,
            errorCode: event.errorCode,
            finishedAt: event.ts,
          }),
          failures: [
            ...state.failures,
            {
              kind: "node",
              nodeId: event.nodeId,
              attempt: event.attempt,
              errorCode: event.errorCode,
              error: event.error,
              seq: event.seq,
              ts: event.ts,
            },
          ],
        };

      case "node.skipped":
        return withNode(state, event.nodeId, { status: "skipped", finishedAt: event.ts });

      case "human.review":
        return withNode(state, event.nodeId, { pendingReview: event.content });

      case "human.decision":
        return withNode(state, event.nodeId, {
          status: event.decision === "rejected" ? "failed" : "done",
          finishedAt: event.ts,
          pendingReview: undefined,
        });

      case "packet.sent":
        return {
          ...state,
          packets: [
            ...state.packets,
            {
              edgeId: event.edgeId,
              from: event.from,
              to: event.to,
              summary: event.summary,
              artifactKind: event.artifactKind,
              seq: event.seq,
            },
          ],
        };

      case "gate.verdict":
        return withNode(state, event.nodeId, {
          status: event.passed ? "done" : "failed",
          lastVerdict: {
            passed: event.passed,
            reason: event.reason,
            score: event.score,
            attempt: event.attempt,
          },
        });

      case "gate.exhausted":
        if (event.policy === "scrap") {
          return {
            ...withNode(state, event.nodeId, { status: "scrapped" }),
            failures: [
              ...state.failures,
              {
                kind: "gate",
                nodeId: event.nodeId,
                attempt: event.attempts,
                error: "质检返工次数已耗尽，整条产线报废",
                seq: event.seq,
                ts: event.ts,
              },
            ],
          };
        }
        return state;

      case "power.warning":
        if (event.scope === "monthly") {
          return { ...state, monthlyBudgetWarned: true };
        }
        return {
          ...state,
          totalCostUsd: event.totalCostUsd,
          budgetUsd: event.budgetUsd,
          budgetWarned: true,
        };

      case "power.metered":
        return { ...state, totalCostUsd: event.totalCostUsd, budgetUsd: event.budgetUsd };

      case "power.tripped":
        return {
          ...state,
          totalCostUsd: event.totalCostUsd,
          status: "tripped",
          failures: [
            ...state.failures,
            {
              kind: "budget",
              error: `电费超出预算 $${event.budgetUsd.toFixed(5)}，全厂停机`,
              seq: event.seq,
              ts: event.ts,
            },
          ],
        };

      case "tool.approved":
        return { ...state, approvedTools: [...state.approvedTools, event.tool] };

      case "run.finished":
        return {
          ...state,
          status: event.status,
          haltedNodeId: event.haltedNodeId ?? state.haltedNodeId,
          reason: event.reason ?? state.reason,
        };

      // F1 variant-lane events are informational (fanout/select publish their
      // own node.* lifecycle via the standard keys) — the reducer treats them
      // as no-ops, and any unknown future event falls through to state too.
      case "variants.spawned":
      case "variants.ranked":
      default:
        return state;
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
