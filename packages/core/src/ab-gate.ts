import type { Graph, GraphNode } from "./graph.js";
import type { RunTimeline } from "./trace.js";

/**
 * A/B gate projection (design-ab-testing §5.2, competitor painpoint G5).
 *
 * A/B prompt experiments compare variants of one textGen node, but the signal
 * users actually care about is the verdict of the quality gate *downstream* of
 * that node. These helpers are pure and read-only: they walk the graph and fold
 * the run timeline, never mutate the graph, and never invent a verdict that the
 * event stream does not contain.
 */

/**
 * Node kinds that (re)generate or rewrite the artifact flowing through them.
 * When one sits on the path between the A/B target and the downstream gate, the
 * gate score is no longer a pure function of the target prompt, so cross-arm
 * comparability is weakened and the UI flags it (it still shows the score).
 */
const CONTENT_MUTATING_KINDS = new Set<GraphNode["kind"]>([
  "textGen",
  "imageGen",
  "videoGen",
  "audioGen",
  "generic",
  "translate",
]);

export interface DownstreamGate {
  gateNodeId: string;
  /**
   * True when a content-mutating node (other than the target itself and the
   * gate) lies on the shortest forward path from target to gate.
   */
  mutatesInBetween: boolean;
}

/**
 * Find the nearest gate reachable from `targetNodeId` along forward `flow`
 * edges. BFS gives the shortest path. `rework` edges loop back upstream and
 * `error` edges branch only on failure, so neither is followed when locating
 * the happy-path gate. Returns null when no gate is downstream.
 */
export function findDownstreamGate(
  graph: Graph,
  targetNodeId: string,
): DownstreamGate | null {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const flowOut = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind !== "flow") continue;
    const list = flowOut.get(e.from);
    if (list) list.push(e.to);
    else flowOut.set(e.from, [e.to]);
  }

  const visited = new Set<string>();
  const queue: Array<{ id: string; mutated: boolean }> = (
    flowOut.get(targetNodeId) ?? []
  ).map((id) => ({ id, mutated: false }));

  while (queue.length > 0) {
    const { id, mutated } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;
    if (node.kind === "gate") {
      return { gateNodeId: id, mutatesInBetween: mutated };
    }
    const nextMutated = mutated || CONTENT_MUTATING_KINDS.has(node.kind);
    for (const nxt of flowOut.get(id) ?? []) {
      if (!visited.has(nxt)) queue.push({ id: nxt, mutated: nextMutated });
    }
  }
  return null;
}

/** One gate verdict per rework attempt, in attempt order. */
export interface GateVerdictSnapshot {
  attempt: number;
  passed: boolean;
  score: number | null;
  reason: string;
}

export interface GateVerdictProjection {
  gateNodeId: string;
  /**
   * Final verdict across rework attempts. Null when the gate exists but the run
   * produced no `gate.verdict` event (gate never ran / run stopped upstream).
   */
  passed: boolean | null;
  /** Final 0-10 judge score, or null when the judge gave no score. */
  score: number | null;
  reason: string | null;
  /** Configured quality bar (`gate.minScore`), or null when unset. */
  minScore: number | null;
  /** Whether the final score clears `minScore`; null when either is absent. */
  meetsBar: boolean | null;
  mutatesInBetween: boolean;
  history: GateVerdictSnapshot[];
}

/**
 * Project the downstream gate's final verdict for one A/B arm run.
 *
 * Returns null when the target has no downstream gate ("no quality station").
 * A non-null result with `passed === null` means the gate exists but gave no
 * verdict this run; callers render that as a distinct empty state rather than
 * treating it as a failure.
 */
export function projectGateVerdict(
  graph: Graph,
  timeline: RunTimeline,
  targetNodeId: string,
): GateVerdictProjection | null {
  const downstream = findDownstreamGate(graph, targetNodeId);
  if (!downstream) return null;

  const gateNode = graph.nodes.find((n) => n.id === downstream.gateNodeId);
  const minScore = gateNode?.gate?.minScore ?? null;

  const tlNode = timeline.nodes.find(
    (n) => n.nodeId === downstream.gateNodeId,
  );
  const history: GateVerdictSnapshot[] = [];
  if (tlNode) {
    for (const at of tlNode.attempts) {
      if (at.gate) {
        history.push({
          attempt: at.attempt,
          passed: at.gate.passed,
          score: at.gate.score,
          reason: at.gate.reason,
        });
      }
    }
  }

  // buildTimeline folds every verdict for a given attempt, keeping the last
  // one, and attempts are in first-seen order, so the last snapshot is the
  // final verdict across all rework attempts.
  const finalVerdict = history[history.length - 1] ?? null;
  const score = finalVerdict?.score ?? null;
  const meetsBar =
    score != null && minScore != null ? score >= minScore : null;

  return {
    gateNodeId: downstream.gateNodeId,
    passed: finalVerdict?.passed ?? null,
    score,
    reason: finalVerdict?.reason ?? null,
    minScore,
    meetsBar,
    mutatesInBetween: downstream.mutatesInBetween,
    history,
  };
}
