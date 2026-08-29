import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * P0 sandbox helpers for the `code` node. They give the user's arbitrary
 * JavaScript / Python script a minimal, isolated execution context:
 *   - an absolute, cached interpreter path (not a PATH the script could poison);
 *   - a per-run working directory it can write to, cleaned up afterwards.
 * Env minimalism is handled by `trimEnv` in isolation.ts, applied at the call
 * site in engine.ts (P0 keeps the concern split: this module owns the process
 * + filesystem shape, engine.ts owns the env allowlist).
 */

const interpreterCache = new Map<"javascript" | "python", string>();

/** Make a run/node id safe to embed in a temp directory name. */
function safeSeg(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Resolve the interpreter for a language to an absolute path, cached across runs. */
export function resolveInterpreter(language: "javascript" | "python"): string {
  const cached = interpreterCache.get(language);
  if (cached) return cached;
  const cmd = language === "python" ? "python3" : "node";
  const which = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(which, [cmd], { encoding: "utf8" });
  let resolved = cmd; // fall back to relying on PATH if resolution fails
  if (r.status === 0 && r.stdout) {
    const first = r.stdout.trim().split(/\r?\n/)[0]?.trim();
    if (first) resolved = first;
  }
  interpreterCache.set(language, resolved);
  return resolved;
}

/** Create an isolated per-run temp directory under the system tmpdir. */
export async function createCodeWorkdir(runId: string, nodeId: string, attempt: number): Promise<string> {
  const prefix = join(tmpdir(), `aw-code-${safeSeg(runId)}-${safeSeg(nodeId)}-${attempt}-`);
  return mkdtemp(prefix);
}

/** Remove the run's temp directory (best effort, never throws). */
export async function cleanupCodeWorkdir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
