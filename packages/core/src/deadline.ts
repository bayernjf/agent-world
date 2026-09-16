/**
 * Long-task deadline helpers (competitor painpoint G4, step G4.1).
 *
 * Pure functions for per-node timeout on long-running media nodes
 * (image/video generation). The engine wiring (G4.2: marking a node `degraded`
 * and resuming rather than failing the whole run) is a separate step; these
 * helpers are engine-agnostic and fully unit tested in isolation.
 */

/**
 * Whether a task that started at `startedAt` (epoch ms) has exceeded
 * `timeoutMs` by time `now` (epoch ms).
 *
 * A null / undefined / non-positive timeout means "no deadline" → never timed
 * out, so callers can pass an unset node timeout safely.
 */
export function isTimedOut(
  startedAt: number,
  now: number,
  timeoutMs: number | null | undefined,
): boolean {
  if (timeoutMs == null || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return false;
  return now - startedAt >= timeoutMs;
}

/**
 * Milliseconds left before the deadline (clamped at 0 once expired).
 * Returns Infinity when no timeout is configured.
 */
export function remainingMs(
  startedAt: number,
  now: number,
  timeoutMs: number | null | undefined,
): number {
  if (timeoutMs == null || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return Infinity;
  return Math.max(0, startedAt + timeoutMs - now);
}

/** Absolute deadline timestamp (epoch ms), or null when no timeout configured. */
export function deadlineAt(startedAt: number, timeoutMs: number | null | undefined): number | null {
  if (timeoutMs == null || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  return startedAt + timeoutMs;
}
