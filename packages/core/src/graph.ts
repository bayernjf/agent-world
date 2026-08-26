import { z } from "zod";
import { SkillMount } from "./skill.js";

/**
 * A gate's `fail` edge points backwards, so the graph is not a DAG. The invariant
 * that keeps it executable: dropping every rework edge must leave a DAG, and each
 * rework edge must land on an ancestor of its gate within that DAG.
 */
export const NodeKind = z.enum(["source", "agent", "gate", "sink", "imageGen"]);
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

/**
 * Controls how upstream artifacts are assembled into this agents input.
 * - all: concatenate every upstream output (default)
 * - last: only the most recent upstream output (sequential pipelines)
 * - truncate: concatenate but cap at maxChars, keeping the tail (most recent)
 */
export const InputPolicy = z.object({
  mode: z.enum(["all", "last", "truncate"]).default("all"),
  maxChars: z.number().int().min(500).optional(),
});
export type InputPolicy = z.infer<typeof InputPolicy>;

export const AgentConfig = z.object({
  model: z.string().default("agnes-2.0-flash"),
  prompt: z.string().default(""),
  /** Mounted capability cards — tools, output contracts, prompt modules. */
  skills: z
    .array(z.union([z.string(), SkillMount]))
    .default([])
    .transform((arr) =>
      arr.map((s) => (typeof s === "string" ? { id: s, config: {}, enabled: true } : s)),
    ),
  temperature: z.number().min(0).max(2).default(0.7),
  timeoutMs: z.number().int().min(1000).default(120000),
  /** How to assemble input from upstream outputs. Defaults to concatenating all. */
  inputPolicy: InputPolicy.default({ mode: "all" }),
  /** Optional per-node hard ceiling in USD across all attempts. */
  budgetUsd: z.number().min(0).nullable().optional(),
  retry: RetryPolicy.default({ maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 }),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

/** Configuration for an `imageGen` node: calls a text-to-image model to produce
 *  a banner / scene image when the source lacks real product photos. */
export const ImageGenConfig = z.object({
  model: z.string().min(1),
  prompt: z.string().optional(),
  size: z.string().optional(),
  /** How many images to produce (1-8). Each becomes its own artifact. */
  n: z.number().int().min(1).max(8).default(1),
  /** Optional per-node endpoint override, e.g. a local SD / ComfyUI OpenAI-compatible server. */
  baseUrl: z.string().optional(),
  /** Optional per-node API key override. Falls back to the provider's key. */
  apiKey: z.string().optional(),
});
export type ImageGenConfig = z.infer<typeof ImageGenConfig>;

export const GateConfig = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  criterion: z.string().default(""),
  onExhausted: ExhaustedPolicy.default("halt"),
  /**
   * Optional quality bar (0-10). When set and the judge returns a score below
   * it, the gate fails regardless of the boolean verdict — this is how a quality
   * score "links back" into the gate decision and feeds the eval report.
   */
  minScore: z.number().min(0).max(10).optional(),
  /**
   * Optional brand-term coverage bar (0-1). When set, the gate computes how
   * many of the upstream brand terms appear in the artifact and fails (sending
   * it back upstream to rewrite) if coverage is below this threshold.
   */
  minBrandCoverage: z.number().min(0).max(1).optional(),
});
export type GateConfig = z.infer<typeof GateConfig>;

export const SourceConfig = z.object({
  /** Reference image URLs fed to vision-capable downstream agents. */
  images: z.array(z.string()).optional(),
  /** Product name / short title used in generated content. */
  productName: z.string().optional(),
  /** Brand or shop name. */
  brand: z.string().optional(),
  /** Target audience, e.g. "20-30岁通勤女生". */
  audience: z.string().optional(),
  /** Price positioning, e.g. "中端 99-199 元". */
  priceRange: z.string().optional(),
  /** Desired tone, e.g. "真诚种草、口语化". */
  tone: z.string().optional(),
  /** Comma/newline separated words or claims that must not appear. */
  prohibited: z.string().optional(),
  /** Comma/newline separated brand words the writer should weave in. */
  brandTerms: z.string().optional(),
  /** Free-form extra notes for the writers. */
  notes: z.string().optional(),
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
  imageGen: ImageGenConfig.optional(),
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
