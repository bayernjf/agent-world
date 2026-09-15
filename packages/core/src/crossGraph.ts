import type { Graph } from "./graph.js";

/**
 * Cross-factory (cross-graph) material relations for the L0 industrial park
 * (RTS stage C1). A single graph is one factory; inside a factory nodes are
 * wired by edges, while BETWEEN factories material flows through exactly two
 * statically-declarable mechanisms already present in the graph schema:
 *
 *  - `subprocess` node (`node.subprocess.graphId`): the graph calls another
 *    saved graph as a sub-flow; the sub-flow's sinks feed this graph, so
 *    material flows from the sub-flow factory to this one.
 *  - `event` trigger (`trigger.eventSource = { kind: "graph", id }`): this
 *    graph starts when the referenced graph finishes, consuming its output,
 *    so material flows from the referenced factory to this one.
 *
 * `eventSource.kind === "artifact"` references a single artifact rather than a
 * factory and is therefore not a factory-to-factory edge.
 *
 * This module is a pure DERIVED VIEW: it never mutates a graph and adds nothing
 * to the persisted schema, so a legacy single-factory graph (no subprocess node,
 * no graph-event trigger) simply yields zero edges — byte-level compatible.
 */

/** How one factory consumes another factory's output. */
export type CrossGraphVia = "subprocess" | "event";

/**
 * A directed material-flow edge between two factories. Direction follows the
 * goods: `fromGraphId` produces, `toGraphId` consumes.
 */
export interface CrossGraphEdge {
  /** Upstream factory that produces the material. */
  fromGraphId: string;
  /** Downstream factory that consumes it. */
  toGraphId: string;
  /** Which mechanism carries the relation. */
  via: CrossGraphVia;
  /**
   * Where the reference lives inside the consuming graph: the subprocess
   * node id (via "subprocess") or the trigger id (via "event").
   */
  refId: string;
}

/** One external graph a single graph consumes, with the reference site. */
export interface ExternalGraphRef {
  /** The referenced (upstream) graph id. */
  targetGraphId: string;
  via: CrossGraphVia;
  refId: string;
}

/**
 * Statically enumerate the external factories ONE graph consumes.
 * Self references (a graph calling/triggering itself) are excluded here;
 * mutual recursion between two distinct graphs is preserved as two edges.
 */
export function externalGraphRefs(graph: Graph): ExternalGraphRef[] {
  const out: ExternalGraphRef[] = [];

  for (const node of graph.nodes) {
    if (node.kind !== "subprocess") continue;
    const target = node.subprocess?.graphId;
    if (target && target !== graph.id) {
      out.push({ targetGraphId: target, via: "subprocess", refId: node.id });
    }
  }

  for (const trigger of graph.triggers ?? []) {
    if (trigger.type !== "event") continue;
    const source = trigger.eventSource;
    if (source && source.kind === "graph" && source.id && source.id !== graph.id) {
      out.push({ targetGraphId: source.id, via: "event", refId: trigger.id });
    }
  }

  return out;
}

export interface BuildCrossGraphEdgesOptions {
  /**
   * When true, drop edges whose upstream factory is not among the supplied
   * graphs (a reference to a deleted / inaccessible graph). Default false:
   * dangling references are kept so callers can surface them as broken links.
   */
  internalOnly?: boolean;
}

/**
 * Build the de-duplicated set of factory-to-factory edges for a collection of
 * graphs. Each external reference becomes an edge directed upstream → this.
 */
export function buildCrossGraphEdges(
  graphs: readonly Graph[],
  options: BuildCrossGraphEdgesOptions = {},
): CrossGraphEdge[] {
  const known = new Set(graphs.map((g) => g.id));
  const seen = new Set<string>();
  const edges: CrossGraphEdge[] = [];

  for (const graph of graphs) {
    for (const ref of externalGraphRefs(graph)) {
      if (options.internalOnly && !known.has(ref.targetGraphId)) continue;
      const edge: CrossGraphEdge = {
        fromGraphId: ref.targetGraphId,
        toGraphId: graph.id,
        via: ref.via,
        refId: ref.refId,
      };
      const key = `${edge.fromGraphId}|${edge.toGraphId}|${edge.via}|${edge.refId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(edge);
    }
  }

  return edges;
}

/** The upstream factory ids a given factory consumes (incoming material). */
export function upstreamGraphIds(
  graphId: string,
  edges: readonly CrossGraphEdge[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.toGraphId !== graphId) continue;
    if (seen.has(edge.fromGraphId)) continue;
    seen.add(edge.fromGraphId);
    out.push(edge.fromGraphId);
  }
  return out;
}

/** The downstream factory ids that consume a given factory's output. */
export function downstreamGraphIds(
  graphId: string,
  edges: readonly CrossGraphEdge[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.fromGraphId !== graphId) continue;
    if (seen.has(edge.toGraphId)) continue;
    seen.add(edge.toGraphId);
    out.push(edge.toGraphId);
  }
  return out;
}
