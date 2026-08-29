import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";

/**
 * Sandbox helpers for the `code` node. P0 (env + cwd + interpreter) +
 * P1 (rlimit + Node permission model) are implemented in this module.
 * P2 (bwrap/sandbox-exec/container backends) is deferred.
 *
 * For the full design & threat model see docs/design-code-sandbox.md.
 *
 * Honesty boundary the code must preserve:
 *   - Python has NO runtime-level permission model. Its fs/net isolation in
 *     the `rlimit` backend is best-effort; hard guarantees need P2 OS-level
 *     backends (bwrap/sandbox-exec/containers).
 */

const interpreterCache = new Map<"javascript" | "python", string>();
/**
 * Per-interpreter-path cache of the JS permission-gate flag. Node 24 renamed
 * `--experimental-permission` → `--permission` (stable). Node 20 only knows
 * the experimental form. We probe the interpreter once per launch and reuse
 * the result — the right pattern for long-lived server processes.
 */
const nodePermissionGateCache = new Map<string, string>();

function safeSeg(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Resolve interpreter to absolute path, cached cross-run. */
export function resolveInterpreter(language: "javascript" | "python"): string {
  const cached = interpreterCache.get(language);
  if (cached) return cached;
  const cmd = language === "python" ? "python3" : "node";
  const which = platform() === "win32" ? "where" : "which";
  const r = spawnSync(which, [cmd], { encoding: "utf8" });
  let resolved = cmd;
  if (r.status === 0 && r.stdout) {
    const first = r.stdout.trim().split(/\r?\n/)[0]?.trim();
    if (first) resolved = first;
  }
  interpreterCache.set(language, resolved);
  return resolved;
}

/** Per-run isolated temp dir. */
export async function createCodeWorkdir(
  runId: string,
  nodeId: string,
  attempt: number,
): Promise<string> {
  const rawTmp = tmpdir();
  // mkdtemp inside the canonicalized tmpdir so the returned path never
  // traverses a symlink (the /var → /private/var case on macOS). Node's
  // permission model compares resolved paths to grants, so a grant written
  // against the raw (symlink-containing) form would be rejected.
  const canonTmp = realpathSync(rawTmp);
  const prefix = join(canonTmp, `aw-code-${safeSeg(runId)}-${safeSeg(nodeId)}-${attempt}-`);
  const dir = await mkdtemp(prefix);
  return realpathSync(dir);
}

/** Best-effort cleanup of the per-run temp dir. */
export async function cleanupCodeWorkdir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/* ---------------- P1: limits + rlimit wrapper ---------------- */

export interface CodeSandboxLimits {
  cpuSec?: number;               // RLIMIT_CPU seconds
  maxProcs?: number;             // RLIMIT_NPROC (fork bomb)
  maxFileKb?: number;            // RLIMIT_FSIZE KB
  maxFd?: number;                // RLIMIT_NOFILE
  virtualMemoryKb?: number;      // RLIMIT_AS KB via ulimit -v (Linux only)
  nodeMaxOldSpaceMb?: number;    // V8 heap MB (JS only)
}

const MB = 1024;


/**
 * Hard-coded, environment-independent defaults. Environment variables are
 * NOT snapshotted at import time — they are read on every `resolveLimits`
 * call so tests can temporarily override `CODE_LIMIT_*` and production can
 * restart/reload settings without re-importing this module.
 */
export const DEFAULT_SANDBOX_LIMITS: Required<CodeSandboxLimits> = {
  cpuSec: 30,
  maxProcs: 128,
  maxFileKb: 32 * MB,
  maxFd: 256,
  virtualMemoryKb: 2048 * MB,
  nodeMaxOldSpaceMb: 512,
};

function numEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/**
 * Merge per-call user overrides on top of CODE_LIMIT_* env vars (if any) on
 * top of the hard-coded defaults. Env var lookup happens on every call so
 * runtime overrides (and test-time overrides via process.env=) take effect.
 */
export function resolveLimits(user?: CodeSandboxLimits): Required<CodeSandboxLimits> {
  return {
    cpuSec:            user?.cpuSec            ?? numEnv("CODE_LIMIT_CPU_SEC")               ?? DEFAULT_SANDBOX_LIMITS.cpuSec,
    maxProcs:          user?.maxProcs          ?? numEnv("CODE_LIMIT_MAX_PROCS")             ?? DEFAULT_SANDBOX_LIMITS.maxProcs,
    maxFileKb:         user?.maxFileKb         ?? numEnv("CODE_LIMIT_MAX_FILE_KB")           ?? DEFAULT_SANDBOX_LIMITS.maxFileKb,
    maxFd:             user?.maxFd             ?? numEnv("CODE_LIMIT_MAX_FD")                ?? DEFAULT_SANDBOX_LIMITS.maxFd,
    virtualMemoryKb:   user?.virtualMemoryKb   ?? numEnv("CODE_LIMIT_VIRTUAL_MEM_KB")        ?? DEFAULT_SANDBOX_LIMITS.virtualMemoryKb,
    nodeMaxOldSpaceMb: user?.nodeMaxOldSpaceMb ?? numEnv("CODE_LIMIT_NODE_MAX_OLD_SPACE_MB") ?? DEFAULT_SANDBOX_LIMITS.nodeMaxOldSpaceMb,
  };
}

/**
 * Wrap interpreter+args with `bash -c 'ulimit … && exec <interpreter> …'`
 * so POSIX rlimits apply before the user's code runs. `exec` replaces the
 * wrapper shell image so `child.kill()` still delivers directly to the
 * interpreter — no reaper indirection.
 *
 * bash (not /bin/sh): on Ubuntu /bin/sh is dash, whose `ulimit` builtin
 * rejects `-u` (RLIMIT_NPROC) with "Illegal option" — CI on ubuntu-latest
 * broke until the wrapper was pinned to bash.
 */
export function buildRlimitWrapper(params: {
  interpreterPath: string;
  interpreterArgs: string[];
  limits: Required<CodeSandboxLimits>;
}): { command: string; args: [string, string] } {
  const { interpreterPath, interpreterArgs, limits } = params;
  const parts: string[] = [];
  parts.push(`ulimit -t ${limits.cpuSec}`);      // RLIMIT_CPU seconds
  parts.push(`ulimit -u ${limits.maxProcs}`);    // RLIMIT_NPROC
  parts.push(`ulimit -f ${limits.maxFileKb}`);   // RLIMIT_FSIZE KB
  parts.push(`ulimit -n ${limits.maxFd}`);       // RLIMIT_NOFILE
  if (platform() === "linux") {
    // RLIMIT_AS on macOS historically does NOT enforce against malloc.
    // Skip on Darwin; Node JS gets --max-old-space-size instead.
    parts.push(`ulimit -v ${limits.virtualMemoryKb}`);
  }
  parts.push(`exec ${q(interpreterPath)} ${interpreterArgs.map(q).join(" ")}`);
  return { command: "/bin/bash", args: ["-c", parts.join(" && ")] };
}

function q(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/* ---------------- P1: Node --experimental-permission (JS only) ---------------- */

/**
 * JS-specific security flags. No equivalent exists for Python — document
 * that boundary, don't silently pretend otherwise.
 *
 *   --experimental-permission             gate the permission model
 *   --allow-fs-read=<workdir>             temp dir readable
 *   --allow-fs-write=<workdir>            temp dir writable
 *   (omitted --allow-net)                 all network denied by default
 *   --max-old-space-size=<mb>             explicit V8 heap cap
 *
 * fd 0/1/2 (stdin/stdout/stderr) remain usable without any explicit grant.
 */
function probeNodePermissionGate(interpreterPath: string): string {
  const cached = nodePermissionGateCache.get(interpreterPath);
  if (cached) return cached;
  // Try the stable form first (Node ≥ 22.2); fall back to experimental.
  for (const flag of ["--permission", "--experimental-permission"]) {
    const r = spawnSync(interpreterPath, [flag, "-e", "process.exit(0)"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (r.status === 0) {
      nodePermissionGateCache.set(interpreterPath, flag);
      return flag;
    }
  }
  // Neither flag worked — this Node has no permission model. Record "none"
  // so we never re-probe and silently build a permissive argv with no gate.
  // Callers that require a hard guarantee must upgrade their Node version.
  nodePermissionGateCache.set(interpreterPath, "none");
  return "none";
}

/**
 * Build JS-specific permission flags. The permission-gate flag name depends
 * on the Node version that `resolveInterpreter` actually resolved, so we
 * accept the interpreter path and probe it once via spawnSync.
 */
export function buildNodePermissionArgs(params: {
  interpreterPath: string;
  workdir: string;
  limits: Required<CodeSandboxLimits>;
}): string[] {
  const { interpreterPath, workdir, limits } = params;
  const gate = probeNodePermissionGate(interpreterPath);
  const args: string[] = [];
  if (gate !== "none") args.push(gate);
  args.push(`--allow-fs-read=${workdir}`);
  args.push(`--allow-fs-write=${workdir}`);
  args.push(`--max-old-space-size=${limits.nodeMaxOldSpaceMb}`);
  return args;
}

/* ---------------- Combined engine-facing entrypoint ---------------- */

export interface SandboxSpawnPlan {
  command: string;
  args: string[];
  limits: Required<CodeSandboxLimits>;
  wrapped: boolean;
}

/**
 * Produce everything engine.ts's `spawn()` call needs. Env trimming
 * (`trimEnv`) and the `cwd` option are applied at the spawn site because
 * they're `spawn()` options, not argv.
 */
export function planCodeSpawn(opts: {
  language: "javascript" | "python";
  code: string;
  workdir: string;
  limits?: CodeSandboxLimits;
}): SandboxSpawnPlan {
  const limits = resolveLimits(opts.limits);
  const interpreter = resolveInterpreter(opts.language);

  let interpreterArgs: string[];
  if (opts.language === "javascript") {
    interpreterArgs = [
      ...buildNodePermissionArgs({ interpreterPath: interpreter, workdir: opts.workdir, limits }),
      "-e",
      opts.code,
    ];
  } else {
    // Python: no runtime-level fs/net permissions. Rely on the wrapper's
    // ulimit -v (Linux) + P2 OS-level backends for stronger guarantees.
    interpreterArgs = ["-c", opts.code];
  }

  const wrapped = buildRlimitWrapper({
    interpreterPath: interpreter,
    interpreterArgs,
    limits,
  });

  return { command: wrapped.command, args: wrapped.args, limits, wrapped: true };
}
