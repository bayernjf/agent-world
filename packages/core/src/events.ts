import { z } from "zod";

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
  "UNKNOWN",
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
  /** A work packet moving along a pipe. The truck animation is this event, not decoration. */
  z.object({
    ...base,
    type: z.literal("packet.sent"),
    edgeId: z.string(),
    from: z.string(),
    to: z.string(),
    /** Preview of the payload; the full artifact lives on the node run. */
    summary: z.string(),
    /** Reserved for future artifact/Packet layering. */
    artifactId: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("gate.verdict"),
    ...NodeRunKey.shape,
    passed: z.boolean(),
    reason: z.string(),
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
  /** Budget ceiling hit — the whole plant trips offline. */
  z.object({
    ...base,
    type: z.literal("power.tripped"),
    totalCostUsd: z.number().min(0),
    budgetUsd: z.number().min(0),
  }),
  z.object({
    ...base,
    type: z.literal("run.finished"),
    runId: z.string(),
    status: z.enum(["done", "failed", "halted", "tripped", "cancelled"]),
  }),
]);
export type RunEvent = z.infer<typeof RunEvent>;

export type RunEventType = RunEvent["type"];

/**
 * An event before the engine stamps ordering onto it. Distributive so each union
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
