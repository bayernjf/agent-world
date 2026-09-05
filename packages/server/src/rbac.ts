import type { Db } from "./db.js";

/**
 * Resource-level permission checks (design-rbac.md P1).
 *
 * The graph is the sharing unit: runs/artifacts/versions/triggers inherit
 * their graph's ACL by resolving `graph_id` upward. The resource owner is NOT
 * stored in `resource_access` — it is the owning table's `user_id` — so the
 * table only holds editor/viewer rows granted to collaborators.
 *
 * Execution semantics chosen for P1: operations performed by a collaborator
 * (save/run/resume) execute under the GRAPH OWNER's user id, so the engine's
 * `userId`-keyed state (variables, banned terms, subgraph resolution, run
 * ownership, cost accounting) stays consistent with the owner's context.
 * HTTP-layer audit entries still record the actual operator.
 */

export type ResourceRole = "owner" | "editor" | "viewer";

const ROLE_RANK: Record<ResourceRole, number> = { owner: 3, editor: 2, viewer: 1 };

export function hasAtLeast(role: ResourceRole, min: ResourceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** A user's effective role on a graph: owner (via graphs.user_id) > shared editor/viewer > none. */
export function graphAccessRole(db: Db, userId: string, graphId: string): ResourceRole | null {
  const ownerId = db.graphOwnerId(graphId);
  if (ownerId == null) return null; // unknown graph → no access (callers map to 404)
  if (ownerId === userId) return "owner";
  return db.getResourceAccess("graph", graphId, userId)?.role as ResourceRole | undefined ?? null;
}

/**
 * Resolve the graph's owner for callers that passed the minimum role, or null
 * when the graph is unknown or the user's role is below the minimum. Returned
 * `graphOwnerId` is the user id all owner-scoped engine/db calls must run as.
 */
export function requireGraph(
  db: Db,
  userId: string,
  graphId: string,
  min: ResourceRole,
): { graphOwnerId: string } | null {
  const role = graphAccessRole(db, userId, graphId);
  if (role == null || !hasAtLeast(role, min)) return null;
  return { graphOwnerId: db.graphOwnerId(graphId)! };
}

/**
 * Graphs the user can see: owned + shared to them.
 * Returns a map of graphId → shared role (null marks owned).
 */
export function visibleGraphs(db: Db, userId: string): Map<string, ResourceRole | null> {
  const result = new Map<string, ResourceRole | null>();
  for (const g of db.listGraphs(userId)) result.set(g.id, null);
  for (const row of db.listResourceAccessForUser("graph", userId)) {
    // Skip rows whose graph no longer exists or is already owned (stale ACL).
    if (result.has(row.resource_id)) continue;
    if (db.graphOwnerId(row.resource_id) == null) continue;
    result.set(row.resource_id, row.role as ResourceRole);
  }
  return result;
}

/**
 * A user's effective role on a run, resolved through the run's graph. Runs
 * whose graph was deleted fall back to the legacy `runs.user_id` ownership
 * check so orphaned runs stay visible to whoever started them.
 */
export function runAccessRole(db: Db, userId: string, runId: string): ResourceRole | null {
  const ref = db.getRunGraphRef(runId);
  if (!ref) return null;
  const ownerId = db.graphOwnerId(ref.graphId);
  if (ownerId == null) return ref.userId === userId ? "owner" : null;
  return graphAccessRole(db, userId, ref.graphId);
}

/** Like requireGraph but for a run; returns the run row's owning user id. */
export function requireRun(
  db: Db,
  userId: string,
  runId: string,
  min: ResourceRole,
): { runOwnerId: string } | null {
  const role = runAccessRole(db, userId, runId);
  if (role == null || !hasAtLeast(role, min)) return null;
  return { runOwnerId: db.getRunGraphRef(runId)!.userId };
}

/** A user's effective role on an artifact, resolved through its graph. */
export function artifactAccessRole(db: Db, userId: string, artifactId: string): ResourceRole | null {
  const ref = db.getArtifactGraphRef(artifactId);
  if (!ref) return null;
  // Prefer the artifact's own graph link; older rows (or pre-run uploads) may
  // only carry a run_id, so resolve through the run instead.
  const graphId = ref.graphId || db.getRunGraphRef(ref.runId)?.graphId;
  if (graphId != null) {
    const role = graphAccessRole(db, userId, graphId);
    if (role != null) return role;
  }
  // Fall back to the artifact's own user_id: an upload not yet attached to a
  // shared graph, or an artifact on a graph the user can't otherwise access
  // but that they personally created, still belongs to its creator.
  return ref.userId === userId ? "owner" : null;
}
