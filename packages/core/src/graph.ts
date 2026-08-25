import { z } from "zod";

/**
 * A gate's `fail` edge points backwards, so the graph is not a DAG. The invariant
 * that keeps it executable: dropping every rework edge must leave a DAG, and each
 * rework edge must land on an ancestor of its gate within that DAG.
 */
export const NodeKind = z.enum(["source", "agent", "gate", "sink"]);
export type NodeKind = z.infer<typeof NodeKind>;

export const EdgeKind = z.enum(["flow", "rework"]);
export type EdgeKind = z.infer<typeof EdgeKind>;

/** What a gate does once it has burned through `maxAttempts` without passing. */
export const ExhaustedPolicy = z.enum(["pass", "scrap", "halt"]);
export type ExhaustedPolicy = z.infer<typeof ExhaustedPolicy>;

/**
 * Technical-failure retry. Distinct from rework: rework is a quality rejection
 * (bumps attempt number), retry is a transient infra fault (does not).
 */
export const RetryPolicy = z.object({
  maxRetries: z.number().int().min(0).max(10).default(2),
  baseDelayMs: z.number().int().min(0).default(1000),
  maxDelayMs: z.number().int().min(0).default(30000),
});
export type RetryPolicy = z.infer<typeof RetryPolicy>;

export const AgentConfig = z.object({
  model: z.string().default("agnes-2.0-flash"),
  prompt: z.string().default(""),
  /** Mounted capability ids — tools, output contracts, prompt modules. */
  skills: z.array(z.string()).default([]),
  temperature: z.number().min(0).max(2).default(0.7),
  timeoutMs: z.number().int().min(1000).default(120000),
  /** Optional per-node hard ceiling in USD across all attempts. */
  budgetUsd: z.number().min(0).nullable().optional(),
  retry: RetryPolicy.default({ maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 }),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export const GateConfig = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  criterion: z.string().default(""),
  onExhausted: ExhaustedPolicy.default("halt"),
});
export type GateConfig = z.infer<typeof GateConfig>;

export const SourceConfig = z.object({
  /** Reserved for future connectors (file/api/database/webhook). */
  connector: z
    .object({
      type: z.string(),
      config: z.record(z.unknown()).default({}),
    })
    .optional(),
  /** Future: expected input schema for this source. */
  inputSchema: z.unknown().optional(),
});
export type SourceConfig = z.infer<typeof SourceConfig>;

export const GraphNode = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  name: z.string().min(1),
  /** Canvas position of the plant's centre, in view units. */
  x: z.number(),
  y: z.number(),
  agent: AgentConfig.optional(),
  gate: GateConfig.optional(),
  source: SourceConfig.optional(),
});
export type GraphNode = z.infer<typeof GraphNode>;

export const GraphEdge = z.object({
  id: z.string().min(1),
  from: z.string(),
  to: z.string(),
  kind: EdgeKind,
});
export type GraphEdge = z.infer<typeof GraphEdge>;

export const Graph = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
});
export type Graph = z.infer<typeof Graph>;

export function nodeById(graph: Graph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

export function outgoing(graph: Graph, id: string, kind?: EdgeKind): GraphEdge[] {
  return graph.edges.filter((e) => e.from === id && (!kind || e.kind === kind));
}

export function incoming(graph: Graph, id: string, kind?: EdgeKind): GraphEdge[] {
  return graph.edges.filter((e) => e.to === id && (!kind || e.kind === kind));
}
