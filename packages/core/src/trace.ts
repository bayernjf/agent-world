import type { RunEvent } from "./events.js";

/**
 * Step-level run trace (competitor painpoint G1): a read-only, deterministic
 * projection of the event stream into a per-node / per-attempt timeline.
 *
 * It is a pure function over `RunEvent[]` (the same events the engine emits,
 * the UI reduces, and the DB stores), so it needs no DB and is fully unit
 * testable. The server exposes it via GET /api/runs/:id/timeline; the heavy
 * `output` text is reduced to a preview here (full output stays behind the
 * existing per-node surfaces).
 */

export type TimelineAttemptStatus =
  | "running"
  | "reviewing"
  | "done"
  | "failed"
  | "skipped";

export interface TimelineGate {
  passed: boolean;
  reason: string;
  score: number | null;
}

export interface TimelineAttempt {
  attempt: number;
  variant: string;
  status: TimelineAttemptStatus;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  outputPreview: string | null;
  outputTruncated: boolean;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string | null;
  score: number | null;
  gate: TimelineGate | null;
  error: string | null;
  errorCode: string | null;
  toolCalls: number;
  artifacts: number;
}

export interface TimelineNode {
  nodeId: string;
  /** Attempts in first-seen order. */
  attempts: TimelineAttempt[];
  firstStartedAt: number | null;
  /** Terminal status of the latest attempt, or the live status while running. */
  status: TimelineAttemptStatus;
}

export interface TimelineBudget {
  budgetUsd: number | null;
  totalCostUsd: number | null;
  tripped: boolean;
  /** 80% (or other threshold) warnings, in occurrence order. */
  warnings: number;
}

export interface RunTimeline {
  /** Nodes in the order they first appeared in the event stream. */
  nodes: TimelineNode[];
  totals: {
    nodes: number;
    done: number;
    failed: number;
    skipped: number;
    running: number;
    reviewing: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  budget: TimelineBudget;
}

/** Default preview cap for a node's textual output. */
export const OUTPUT_PREVIEW_LEN = 280;

/** Reduce potentially-large node output to a preview, flagging truncation. */
export function summarizeOutput(
  output: string,
  maxLen: number = OUTPUT_PREVIEW_LEN,
): { preview: string; truncated: boolean } {
  if (output.length <= maxLen) return { preview: output, truncated: false };
  return { preview: output.slice(0, maxLen), truncated: true };
}

/** Attempts are built incrementally while folding the event stream. */
type MutableAttempt = TimelineAttempt;

function attemptKey(nodeId: string, attempt: number, variant: string): string {
  return `${nodeId}#${variant}#${attempt}`;
}

/**
 * Build the step-level timeline from a run's event stream. Pure and total:
 * unknown / out-of-order events are ignored rather than throwing, so a corrupt
 * tail never hides the rest of the trace.
 */
export function buildTimeline(events: RunEvent[]): RunTimeline {
  const order: string[] = [];
  const nodes = new Map<string, TimelineNode>();
  const attempts = new Map<string, MutableAttempt>();

  const ensureNode = (nodeId: string): TimelineNode => {
    let node = nodes.get(nodeId);
    if (!node) {
      node = {
        nodeId,
        attempts: [],
        firstStartedAt: null,
        status: "running",
      };
      nodes.set(nodeId, node);
      order.push(nodeId);
    }
    return node;
  };

  const ensureAttempt = (
    nodeId: string,
    attempt: number,
    variant: string | undefined,
  ): { node: TimelineNode; at: MutableAttempt } => {
    const node = ensureNode(nodeId);
    const v = variant ?? "main";
    const key = attemptKey(nodeId, attempt, v);
    let at = attempts.get(key);
    if (!at) {
      at = {
        attempt,
        variant: v,
        status: "running",
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        outputPreview: null,
        outputTruncated: false,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        model: null,
        score: null,
        gate: null,
        error: null,
        errorCode: null,
        toolCalls: 0,
        artifacts: 0,
      };
      attempts.set(key, at);
      node.attempts.push(at);
    }
    return { node, at };
  };

  const budget: TimelineBudget = {
    budgetUsd: null,
    totalCostUsd: null,
    tripped: false,
    warnings: 0,
  };

  for (const e of events) {
    switch (e.type) {
      case "run.started":
        budget.budgetUsd = e.budgetUsd;
        break;
      case "node.started": {
        const { node, at } = ensureAttempt(e.nodeId, e.attempt, e.variant);
        if (at.startedAt == null) at.startedAt = e.ts;
        if (node.firstStartedAt == null) node.firstStartedAt = e.ts;
        break;
      }
      case "node.finished": {
        const { node, at } = ensureAttempt(e.nodeId, e.attempt, e.variant);
        if (at.startedAt == null) at.startedAt = e.ts;
        at.finishedAt = e.ts;
        at.durationMs = at.startedAt != null ? e.ts - at.startedAt : null;
        at.status = "done";
        const sum = summarizeOutput(e.output);
        at.outputPreview = sum.preview;
        at.outputTruncated = sum.truncated;
        at.tokensIn = e.usage.tokensIn;
        at.tokensOut = e.usage.tokensOut;
        at.costUsd = e.usage.costUsd;
        at.model = e.usage.model ?? null;
        node.status = "done";
        break;
      }
      case "node.failed": {
        const { node, at } = ensureAttempt(e.nodeId, e.attempt, e.variant);
        if (at.startedAt == null) at.startedAt = e.ts;
        at.finishedAt = e.ts;
        at.durationMs = at.startedAt != null ? e.ts - at.startedAt : null;
        at.status = "failed";
        at.error = e.error;
        at.errorCode = e.errorCode ?? null;
        node.status = "failed";
        break;
      }
      case "node.skipped": {
        const { node, at } = ensureAttempt(e.nodeId, e.attempt, e.variant);
        at.status = "skipped";
        node.status = "skipped";
        break;
      }
      case "human.review": {
        const { node, at } = ensureAttempt(e.nodeId, e.attempt, e.variant);
        at.status = "reviewing";
        node.status = "reviewing";
        break;
      }
      case "gate.verdict": {
        const { at } = ensureAttempt(e.nodeId, e.attempt, e.variant);
        at.gate = { passed: e.passed, reason: e.reason, score: e.score ?? null };
        if (typeof e.score === "number") at.score = e.score;
        break;
      }
      case "tool.called": {
        const { at } = ensureAttempt(e.nodeId, e.attempt, e.variant);
        at.toolCalls += 1;
        break;
      }
      case "artifact.produced": {
        if (e.attempt != null) {
          const { at } = ensureAttempt(e.nodeId, e.attempt, e.variant);
          at.artifacts += 1;
        } else {
          ensureNode(e.nodeId);
        }
        break;
      }
      case "power.metered":
        budget.totalCostUsd = e.totalCostUsd;
        break;
      case "power.warning":
        budget.warnings += 1;
        break;
      case "power.tripped":
        budget.tripped = true;
        budget.totalCostUsd = e.totalCostUsd;
        break;
      default:
        // node.delta / node.reasoning / tool.result / packet.sent / variants.* /
        // human.decision / run.finished do not change the step projection.
        break;
    }
  }

  const timelineNodes = order.map((id) => nodes.get(id)!);
  const totals = { nodes: 0, done: 0, failed: 0, skipped: 0, running: 0, reviewing: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  for (const n of timelineNodes) {
    totals.nodes += 1;
    if (n.status === "done") totals.done += 1;
    else if (n.status === "failed") totals.failed += 1;
    else if (n.status === "skipped") totals.skipped += 1;
    else if (n.status === "reviewing") totals.reviewing += 1;
    else totals.running += 1;
    // Count each node once for tokens/cost using its terminal (last) attempt,
    // so retries of the same node are not double-counted.
    const last = n.attempts[n.attempts.length - 1];
    if (last) {
      totals.tokensIn += last.tokensIn;
      totals.tokensOut += last.tokensOut;
      totals.costUsd += last.costUsd;
    }
  }

  return { nodes: timelineNodes, totals, budget };
}
