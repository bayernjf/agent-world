import { z } from "zod";
import type { UsageUnits } from "./pricing.js";
import { Artifact } from "./artifact.js";

/**
 * The event stream is the single source of truth: the engine emits it, the UI
 * reduces it, replay re-reduces a prefix, and the DB stores it verbatim.
 * Four consumers means changing the shape is expensive — hence the version tag.
 */
export const EVENT_SCHEMA_VERSION = 1;

/**
 * `attempt` is part of a node execution's identity, not a mutable counter on the
 * node. Attempt 2 of FORGE is a different execution from attempt 1, with its own
 * input, output and cost. Replay and attempt-diffing both depend on this.
 */
export const NodeRunKey = z.object({
  nodeId: z.string(),
  attempt: z.number().int().min(1),
});
export type NodeRunKey = z.infer<typeof NodeRunKey>;

export const ErrorCode = z.enum([
  "TIMEOUT",
  "RATE_LIMIT",
  "PROVIDER_ERROR",
  "AUTH",
  "VALIDATION",
  "BUDGET",
  "CONNECTOR",
  "UNKNOWN",
  "UNSUPPORTED",
  "SUBPROCESS",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const Usage = z.object({
  tokensIn: z.number().int().min(0),
  tokensOut: z.number().int().min(0),
  /** Metered after the call returns — never charged up front. */
  costUsd: z.number().min(0),
  /** Prompt-cache hit tokens, when the provider reports them. */
  cachedTokens: z.number().int().min(0).optional(),
  /** Reasoning/thinking tokens, when the model emits them separately. */
  reasoningTokens: z.number().int().min(0).optional(),
  /** Non-token usage for image/video/audio models (images, seconds, characters). */
  units: z.record(z.number().min(0)).optional(),
});
export type Usage = z.infer<typeof Usage>;

const base = { seq: z.number().int().min(0), ts: z.number().int() };

export const RunEvent = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("run.started"),
    runId: z.string(),
    graphId: z.string(),
    budgetUsd: z.number().min(0).nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("node.started"),
    ...NodeRunKey.shape,
  }),
  /** Emitted as the model streams visible output text, so the plant can show it. */
  z.object({
    ...base,
    type: z.literal("node.delta"),
    ...NodeRunKey.shape,
    text: z.string(),
  }),
  /** Emitted as the model streams hidden reasoning/thinking tokens, if any. */
  z.object({
    ...base,
    type: z.literal("node.reasoning"),
    ...NodeRunKey.shape,
    text: z.string(),
  }),
  /** The model called a tool. `callId` correlates request/result. */
  z.object({
    ...base,
    type: z.literal("tool.called"),
    ...NodeRunKey.shape,
    callId: z.string(),
    name: z.string(),
    args: z.unknown(),
  }),
  /** A tool call returned (or errored). Result is JSON-serializable. */
  z.object({
    ...base,
    type: z.literal("tool.result"),
    ...NodeRunKey.shape,
    callId: z.string(),
    name: z.string(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("node.finished"),
    ...NodeRunKey.shape,
    output: z.string(),
    usage: Usage,
  }),
  z.object({
    ...base,
    type: z.literal("node.failed"),
    ...NodeRunKey.shape,
    error: z.string(),
    errorCode: ErrorCode.optional(),
  }),
  /** A node skipped because an upstream predecessor failed (cascade). Distinct from pending — the UI can show "skipped" instead of "waiting". */
  z.object({
    ...base,
    type: z.literal("node.skipped"),
    ...NodeRunKey.shape,
    /** Why the node was skipped (e.g. upstream failed). */
    reason: z.string().optional(),
  }),
  /** A work packet moving along a pipe. The truck animation is this event, not decoration. */
  z.object({
    ...base,
    type: z.literal("packet.sent"),
    edgeId: z.string(),
    from: z.string(),
    to: z.string(),
    /** Preview of the payload; the full artifact lives on the node run. */
    summary: z.string(),
    /** The primary artifact carried by this packet, when typed. */
    artifactId: z.string().optional(),
    /** Kind of the carried artifact, for truck rendering. */
    artifactKind: Artifact.shape.kind.optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  /** A node produced a typed artifact (image, video, audio, file, json, ...). */
  z.object({
    ...base,
    type: z.literal("artifact.produced"),
    nodeId: z.string(),
    attempt: z.number().int().min(1).optional(),
    artifact: Artifact,
  }),
  z.object({
    ...base,
    type: z.literal("gate.verdict"),
    ...NodeRunKey.shape,
    passed: z.boolean(),
    reason: z.string(),
    /** Optional 0-10 quality score from the judge, surfaced in the eval report. */
    score: z.number().min(0).max(10).optional(),
    /**
     * Human-in-the-loop decision, when this verdict was produced by an operator
     * rather than the model judge (4.7). Absent for automatic model verdicts.
     */
    decision: z.enum(["approved", "rejected", "edited"]).optional(),
    /** Operator id / name who made the decision. */
    by: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("gate.exhausted"),
    nodeId: z.string(),
    attempts: z.number().int().min(1),
    policy: z.enum(["pass", "scrap", "halt"]),
  }),
  z.object({
    ...base,
    type: z.literal("power.metered"),
    totalCostUsd: z.number().min(0),
    budgetUsd: z.number().min(0).nullable(),
  }),
  /** Budget warning threshold crossed (80%) — advisory, does not stop the line. */
  z.object({
    ...base,
    type: z.literal("power.warning"),
    totalCostUsd: z.number().min(0),
    budgetUsd: z.number().min(0),
    threshold: z.number().min(0).max(1),
    /** "run" (default) warns against the per-run budget; "monthly" against the monthly cap. */
    scope: z.enum(["run", "monthly"]).optional(),
  }),
  /** Budget ceiling hit — the whole plant trips offline. */
  z.object({
    ...base,
    type: z.literal("power.tripped"),
    totalCostUsd: z.number().min(0),
    budgetUsd: z.number().min(0),
  }),
  z.object({
    ...base,
    type: z.literal("tool.approved"),
    tool: z.string(),
  }),
  /** A `human` node paused the run waiting for an operator decision. */
  z.object({
    ...base,
    type: z.literal("human.review"),
    ...NodeRunKey.shape,
    /** Upstream text shown to the operator as the pending review. */
    content: z.string(),
  }),
  /** The operator decided on a paused `human` node. */
  z.object({
    ...base,
    type: z.literal("human.decision"),
    ...NodeRunKey.shape,
    decision: z.enum(["approved", "edited", "rejected"]),
  }),
  z.object({
    ...base,
    type: z.literal("run.finished"),
    runId: z.string(),
    status: z.enum(["done", "failed", "halted", "tripped", "cancelled"]),
    /** When the run halted waiting for a human decision, which gate and why. */
    haltedNodeId: z.string().optional(),
    reason: z.string().optional(),
  }),
]);
export type RunEvent = z.infer<typeof RunEvent>;

export type RunEventType = RunEvent["type"];

/**
 * An event before it gets stamped with ordering. Distributive so each union
 * member keeps its own required fields instead of collapsing to their intersection.
 */
export type DraftEvent = {
  [K in RunEventType]: Omit<Extract<RunEvent, { type: K }>, "seq" | "ts">;
}[RunEventType];

export const EventEnvelope = z.object({
  version: z.literal(EVENT_SCHEMA_VERSION),
  event: RunEvent,
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

export function envelope(event: RunEvent): EventEnvelope {
  return { version: EVENT_SCHEMA_VERSION, event };
}
