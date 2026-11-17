import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-run org attribution (Tier0 org M3 F3.2, step a2).
 *
 * zeus dispatches an org task into agent-world with `usageDimensions` on the
 * run-create body; the hub ledger needs those ids on every usage row to answer
 * "what did this task / position / department cost". The routing worker is a
 * shared singleton, so the ids travel through async context exactly like the
 * per-user identity in user-context.ts.
 */
export interface UsageDimensions {
  /** zeus org task id — the ledger's `task_id`. */
  taskId?: string;
  /** Utilized position id — the ledger's `position_id`. */
  positionId?: string;
  /** Owning department id — the ledger's `department_id`. */
  departmentId?: string;
}

const ALLOWED_KEYS = new Set(["taskId", "positionId", "departmentId"]);
const MAX_LENGTH = 128;

const store = new AsyncLocalStorage<UsageDimensions | undefined>();

export function runAsUsageDimensions<T>(
  dimensions: UsageDimensions | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return dimensions ? store.run(dimensions, fn) : fn();
}

export function currentUsageDimensions(): UsageDimensions | undefined {
  return store.getStore();
}

/**
 * Validate a caller-supplied `usageDimensions` payload. A bad shape is a
 * 400 at the API boundary: silently dropping an id would make the ledger look
 * complete while silently losing the attribution it exists for.
 */
export function parseUsageDimensions(
  value: unknown,
): { ok: true; value?: UsageDimensions } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "usageDimensions must be an object" };
  }
  const dims: UsageDimensions = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: `usageDimensions has unknown field "${key}"` };
    }
    if (typeof entry !== "string" || entry.trim() === "" || entry.length > MAX_LENGTH) {
      return { ok: false, error: `usageDimensions.${key} must be a non-empty string (≤${MAX_LENGTH})` };
    }
    dims[key as keyof UsageDimensions] = entry;
  }
  return { ok: true, value: Object.keys(dims).length > 0 ? dims : undefined };
}
