import { Graph } from "@agent-world/core";
import { z } from "zod";

/**
 * Structural guard for persisted graph snapshots (engine-written JSON; audit
 * P3).
 *
 * Snapshots must NOT be validated with the strict `Graph` schema: persisted
 * snapshots may predate schema fields (e.g. a trigger row without `id`) or
 * carry fields newer than the schema, and `Graph`'s zod default strips unknown
 * keys — either would silently drop or reject data on resume/fork/seal paths.
 * This schema only requires the one field every snapshot must have (`nodes`),
 * and preserves every other field untouched.
 */
export const GraphSnapshot = z
  .object({
    nodes: z.array(z.unknown()),
  })
  .passthrough();

/** Narrow an already-parsed snapshot value to `Graph` (reference-preserving). */
export function graphFromUnknown(v: unknown): Graph {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new TypeError("graph snapshot is not an object");
  }
  GraphSnapshot.parse(v);
  return v as Graph;
}

/** Parse a persisted graph snapshot string; throws on corrupt JSON/shape. */
export function parseGraphSnapshot(raw: string): Graph {
  return graphFromUnknown(JSON.parse(raw));
}

/**
 * Lightweight read of a snapshot's node names (run timeline / diagnosis).
 * Same passthrough rationale: only node ids/name/kind are consumed here.
 */
export const SnapshotLikeSchema = z
  .object({
    nodes: z
      .array(
        z.object({ id: z.string(), name: z.string().optional(), kind: z.string().optional() }),
      )
      .optional(),
  })
  .passthrough()
  .nullable();
export type SnapshotLike = z.infer<typeof SnapshotLikeSchema>;
