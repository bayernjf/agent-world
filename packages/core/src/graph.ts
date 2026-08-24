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

export const AgentConfig = z.object({
  model: z.string().default("claude-sonnet-5"),
  prompt: z.string().default(""),
  /** Mounted capability ids — tools, output contracts, prompt modules. */
  skills: z.array(z.string()).default([]),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export const GateConfig = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  criterion: z.string().default(""),
  onExhausted: ExhaustedPolicy.default("halt"),
});
export type GateConfig = z.infer<typeof GateConfig>;

export const GraphNode = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  name: z.string().min(1),
  /** Canvas position of the plant's centre, in view units. */
  x: z.number(),
  y: z.number(),
  agent: AgentConfig.optional(),
  gate: GateConfig.optional(),
});
export type GraphNode = z.infer<typeof GraphNode>;

export const GraphEdge = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
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
