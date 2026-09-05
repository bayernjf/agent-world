/**
 * Security audit log (design-audit-log.md, P1/P2).
 *
 * Records WHO did WHAT to their account/settings/graphs at the route layer —
 * the piece the `events` table (run timeline) deliberately does not cover.
 *
 * Contract (red line): `detail` carries field NAMES and counts only, never
 * values. A provider key change is recorded as the field path
 * ("providers.my.apiKey"), not the old or new secret — not even the masked
 * one, which would be mistaken for the real value in a forensic read.
 *
 * Writes are best-effort: an audit failure must never break the business
 * request, so errors are logged loudly (via the structured logger) and
 * swallowed. The table itself is append-only — there is no UPDATE/DELETE
 * path in this codebase.
 */
import { randomUUID } from "node:crypto";
import { log } from "./logger.js";

interface AuditDb {
  insertAudit(entry: {
    id: string;
    userId: string;
    action: string;
    objectType?: string;
    objectId?: string;
    detail?: string;
    ip?: string;
  }): void;
}

export interface AuditOptions {
  objectType?: string;
  objectId?: string;
  /** Field names / counts only — values must never ride along. */
  detail?: unknown;
  ip?: string;
}

export function audit(
  db: AuditDb,
  userId: string,
  action: string,
  opts: AuditOptions = {},
): void {
  try {
    db.insertAudit({
      id: randomUUID(),
      userId,
      action,
      objectType: opts.objectType,
      objectId: opts.objectId,
      detail: opts.detail === undefined ? undefined : JSON.stringify(opts.detail),
      ip: opts.ip,
    });
  } catch (err) {
    // Auditing must not take the request down with it, but a silent audit
    // gap is itself a compliance incident — make the failure loud.
    log.error("audit write failed", { action, userId, error: String(err) });
  }
}

/**
 * Diff two configs into audit-safe field paths, e.g.
 * `["providers.my.apiKey", "searchConfig.provider", "defaultModel"]`.
 * Recurses through plain objects (depth-capped) so nested credentials report
 * as their full path; scalars, arrays and type-mismatched slots compare by
 * JSON and report at their own path. Paths only — values never ride along.
 */
export function changedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  walk(before ?? {}, after, "", out, 0);
  return out;
}

const MAX_DEPTH = 4;

function walk(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  prefix: string,
  out: string[],
  depth: number,
): void {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const va = a[key];
    const vb = b[key];
    if (JSON.stringify(va) === JSON.stringify(vb)) continue;
    if (depth < MAX_DEPTH && isPlainObject(va) && isPlainObject(vb)) {
      walk(va, vb, path, out, depth + 1);
      continue;
    }
    out.push(path);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
