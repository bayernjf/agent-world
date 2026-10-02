/**
 * Unknown-safe narrowers shared across route/engine boundaries (audit P3).
 * Concentrates `as` in one boundary file instead of scattering type
 * assertions through business code.
 */

/** Error → human message (unknown-safe). */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Narrow an unknown to a plain object record (no mutation). */
export function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Best-effort HTTP status on an error object (HTTPException-style). */
export function errorStatus(err: unknown): number | undefined {
  return err !== null && typeof err === "object" && "status" in err && typeof err.status === "number"
    ? err.status
    : undefined;
}

/** AbortError check (AbortSignal.timeout / controller.abort paths). */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
