import type { Graph, RunEvent } from "@agent-world/core";
import type { Db } from "./db.js";
import type { ResumeAction } from "./run.js";

/**
 * Cross-run review queue (F2). A `human` node, an exhausted `gate` with
 * `onExhausted: "halt"` and a dangerous-tool halt all park a run in `halted`;
 * before this, the only way to find them was to open each run one by one.
 */

/** Why a run is waiting, derived from the engine's halt reason prefix. */
export type ReviewKind = "human" | "tool" | "gate";

/** Preview cap: a pending review can be a whole document, and the queue lists many. */
export const PREVIEW_CHARS = 1200;

export interface PendingReview {
  runId: string;
  graphId: string;
  graphName: string;
  /** Node the run is parked on; null only if the log predates halt recording. */
  nodeId: string | null;
  nodeName: string | null;
  kind: ReviewKind;
  reason: string | null;
  /** Text awaiting the decision (a `human` node's upstream output). */
  content: string | null;
  contentTruncated: boolean;
  /** Judge's last verdict reason, for gate halts. */
  detail: string | null;
  /** Tool name to approve, for dangerous-tool halts. */
  tool: string | null;
  startedAt: number;
  haltedAt: number;
  waitingMs: number;
  trigger: string;
  abGroup: string | null;
  abArm: string | null;
}

export function classifyHalt(reason: string | null): ReviewKind {
  if (!reason) return "gate";
  if (reason.startsWith("human:")) return "human";
  if (reason.startsWith("dangerous-tool:")) return "tool";
  return "gate";
}

function preview(text: string): { content: string; truncated: boolean } {
  return text.length > PREVIEW_CHARS
    ? { content: text.slice(0, PREVIEW_CHARS), truncated: true }
    : { content: text, truncated: false };
}

/**
 * Halted runs the caller can decide on, longest-waiting first.
 *
 * The halted node/reason normally come from the `runs` columns (migration 20).
 * Runs that halted before it carry NULL, so those are resolved from the event
 * log instead of silently dropping off the queue.
 */
export function listPendingReviews(
  db: Db,
  userId: string,
  opts: { limit?: number; offset?: number; graphId?: string; now?: number } = {},
): { reviews: PendingReview[]; total: number } {
  const now = opts.now ?? Date.now();
  const { rows, total } = db.pendingReviews(userId, opts);

  const reviews = rows.map((row): PendingReview => {
    const events: RunEvent[] = db.events(row.id);
    let nodeId = row.halted_node_id;
    let reason = row.halted_reason;
    if (!nodeId || !reason) {
      for (const e of events) {
        if (e.type === "run.finished" && e.status === "halted") {
          nodeId = e.haltedNodeId ?? nodeId;
          reason = e.reason ?? reason;
        }
      }
    }

    let reviewContent: string | null = null;
    let detail: string | null = null;
    for (const e of events) {
      if (!("nodeId" in e) || e.nodeId !== nodeId) continue;
      // Later events win: a rework loop can park the same node more than once.
      if (e.type === "human.review") reviewContent = e.content;
      if (e.type === "gate.verdict") detail = e.reason;
    }

    const run = db.getRun(row.id, userId);
    let nodeName: string | null = null;
    if (run && nodeId) {
      const graph = JSON.parse(run.snapshot) as Graph;
      nodeName = graph.nodes?.find((n) => n.id === nodeId)?.name ?? null;
    }

    const kind = classifyHalt(reason);
    const shown = reviewContent ? preview(reviewContent) : null;
    return {
      runId: row.id,
      graphId: row.graph_id,
      graphName: row.graph_name,
      nodeId,
      nodeName,
      kind,
      reason: kind === "human" && reason ? reason.slice("human:".length) : reason,
      content: shown?.content ?? null,
      contentTruncated: shown?.truncated ?? false,
      detail,
      tool: kind === "tool" && reason ? reason.slice("dangerous-tool:".length) : null,
      startedAt: row.started_at,
      haltedAt: row.halted_at,
      waitingMs: Math.max(now - row.halted_at, 0),
      trigger: row.trigger,
      abGroup: row.ab_group,
      abArm: row.ab_arm,
    };
  });

  return { reviews, total };
}

export interface ReviewDecision {
  runId: string;
  action: ResumeAction;
  editOutput?: Record<string, string>;
  approveTools?: string[];
}

export const DECISION_ACTIONS: readonly ResumeAction[] = [
  "continue",
  "approve",
  "reject",
  "edit",
  "scrap",
];

/** Hard cap so one request can't dispatch an unbounded number of runs. */
export const MAX_DECISIONS_PER_CALL = 50;

/**
 * Parse a batch-decide body. Returns the decisions, or a Chinese error message
 * describing the first problem (400-shaped) — the caller answers per-item
 * failures with 200 + results, so only a malformed body is a hard error.
 */
export function parseDecisions(body: unknown): { decisions?: ReviewDecision[]; error?: string } {
  if (!Array.isArray(body)) return { error: "请求体必须是决策数组" };
  if (body.length === 0) return { error: "至少需要一条决策" };
  if (body.length > MAX_DECISIONS_PER_CALL) {
    return { error: `单次最多处理 ${MAX_DECISIONS_PER_CALL} 条决策，当前 ${body.length} 条` };
  }
  const decisions: ReviewDecision[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const item = body[i] as Record<string, unknown> | null;
    if (!item || typeof item !== "object") return { error: `第 ${i + 1} 条决策不是对象` };
    if (typeof item.runId !== "string" || item.runId.length === 0) {
      return { error: `第 ${i + 1} 条决策缺少 runId` };
    }
    if (typeof item.action !== "string" || !DECISION_ACTIONS.includes(item.action as ResumeAction)) {
      return {
        error: `第 ${i + 1} 条决策的 action 非法（可选：${DECISION_ACTIONS.join(" / ")}）`,
      };
    }
    const editOutput =
      item.editOutput && typeof item.editOutput === "object" && !Array.isArray(item.editOutput)
        ? (item.editOutput as Record<string, string>)
        : undefined;
    const approveTools = Array.isArray(item.approveTools)
      ? item.approveTools.filter((t): t is string => typeof t === "string")
      : undefined;
    decisions.push({
      runId: item.runId,
      action: item.action as ResumeAction,
      ...(editOutput ? { editOutput } : {}),
      ...(approveTools ? { approveTools } : {}),
    });
  }
  return { decisions };
}
