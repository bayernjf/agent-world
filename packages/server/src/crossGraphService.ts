import { buildCrossGraphEdges, type CrossGraphEdge, type Graph } from "@agent-world/core";

/** Loads one graph doc through the Db abstraction (sqlite/postgres behind it). */
export type CrossGraphLoader = (
  id: string,
) => Promise<(Graph & { version?: number }) | null>;

/**
 * Derive the material-flow edges BETWEEN the factories visible to one user
 * (RTS stage C1). Graph docs are loaded on demand through the Db abstraction;
 * `internalOnly` drops any edge whose upstream factory is outside
 * `visibleIds`, so a user can never learn of another tenant's graph by seeing
 * a dangling cross edge.
 *
 * Missing / unparsable docs are skipped rather than failing the whole overview:
 * the park view must still render when a single graph is corrupt.
 */
export async function loadCrossGraphEdges(
  visibleIds: readonly string[],
  load: CrossGraphLoader,
): Promise<CrossGraphEdge[]> {
  const graphs: Graph[] = [];
  for (const id of visibleIds) {
    try {
      const graph = await load(id);
      if (graph) graphs.push(graph);
    } catch {
      // best-effort: a single unreadable doc must not break the park overview
    }
  }
  return buildCrossGraphEdges(graphs, { internalOnly: true });
}
