import { type ChildProcess, fork } from "node:child_process";
import path from "node:path";
import { readFile, writeFile, readdir, stat, unlink, mkdir, rm, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Worker } from "./worker.js";
import { loadPermissionConfig, matchDomain } from "./permissions.js";
import { guardedFetch } from "./ssrf.js";

/**
 * Plugin process isolation (4C.7).
 *
 * A worker plugin may declare `isolation: "subprocess"`. Instead of running in
 * the server process, it is forked into its own child process. The parent:
 *   - trims the environment to a safe baseline plus only the keys the plugin
 *     declared (`env`), so accidental secrets are not leaked into the plugin;
 *   - proxies every `fetch` and `fs` access the plugin makes back through the
 *     parent, which enforces the network/fs allowlists (see permissions.ts).
 *
 * The two processes talk over a tiny JSON message protocol on the fork's IPC
 * channel. Streaming `runTextGen` output is collected in the child and replayed
 * in order by the parent (streaming granularity is lost across the boundary,
 * but the result is identical).
 */

const PROXY_ENTRY = new URL("./worker-proxy.mjs", import.meta.url).pathname;
const FS_LOADER_REGISTER = new URL("./fs-loader-register.mjs", import.meta.url).pathname;

/** Env keys that are safe (and usually required) to forward into a plugin. */
const SAFE_ENV_BASE = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "TZ",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "USER",
  "LOGNAME",
  "PWD",
  "NODE_ENV",
];

/**
 * Env keys whose names look like secrets are never forwarded to a plugin just
 * because the plugin declared them (M6). The operator can still expose one
 * explicitly via PLUGIN_ENV_ALLOWLIST (comma-separated exact names).
 */
const SENSITIVE_ENV_RE = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i;
export function isSensitiveEnvKey(key: string): boolean {
  return SENSITIVE_ENV_RE.test(key);
}
function operatorEnvAllowlist(): Set<string> {
  return new Set(
    (process.env.PLUGIN_ENV_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Build the environment a subprocess plugin receives: a fixed safe baseline
 * plus only the keys the plugin declared — and even a declared key is stripped
 * when its name looks like a secret unless the operator allowlisted it (M6),
 * so a plugin cannot exfiltrate the host's API keys by declaring them.
 */
export function trimEnv(declared?: string[]): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  const allowSensitive = operatorEnvAllowlist();
  const copy = (k: string): void => {
    if (process.env[k] === undefined) return;
    if (isSensitiveEnvKey(k) && !allowSensitive.has(k)) return;
    out[k] = process.env[k]!;
  };
  for (const k of SAFE_ENV_BASE) copy(k);
  for (const k of declared ?? []) copy(k);
  return out as NodeJS.ProcessEnv;
}

/**
 * Boundary-safe allowlist check (H9). Resolve the lexical path first, then
 * require the target to equal an allowed base or sit strictly inside it. A
 * naive startsWith() lets a sibling such as "/allowed-evil" match base
 * "/allowed"; path.relative makes the directory boundary explicit.
 */
export function isPathAllowed(target: string, allow: readonly string[] | undefined | null): boolean {
  if (!allow || allow.length === 0) return true;
  const resolved = path.resolve(target);
  return allow.some((base) => {
    const b = path.resolve(base);
    if (resolved === b) return true;
    const rel = path.relative(b, resolved);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}

interface CallResultMsg {
  dir: "c2p";
  kind: "call-result";
  id: number;
  ok: boolean;
  events?: unknown[];
  result?: unknown;
  error?: string;
}
interface ProxyMsg {
  dir: "c2p";
  kind: "proxy";
  id: number;
  op: "fetch" | "fs";
  payload: unknown;
}

/** Fs operation payload. `op` selects the operation; legacy {path,write,data} still works. */
type FsPayload =
  | { op: "read"; path: string }
  | { op: "write"; path: string; data: string }
  | { op: "appendFile"; path: string; data: string }
  | { op: "readdir"; path: string }
  | { op: "stat"; path: string }
  | { op: "unlink"; path: string }
  | { op: "mkdir"; path: string }
  | { op: "rm"; path: string }
  | { path: string; write?: boolean; data?: string }; // legacy
interface ProxyResultMsg {
  dir: "p2c";
  kind: "proxy-result";
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}
type ParentInbound = CallResultMsg | ProxyMsg;

/** A `Worker` whose methods run in a forked child process. */
export class IsolatedWorker implements Worker {
  private seq = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  /** Child process ids we have spawned, for cleanup. */
  static readonly children = new Set<ChildProcess>();

  constructor(
    private readonly child: ChildProcess,
    public readonly id: string,
  ) {
    IsolatedWorker.children.add(child);
    child.on("message", (m: ParentInbound) => this.onMessage(m));
    child.on("error", (e) => this.failAll(e));
    child.on("exit", () => this.failAll(new Error("plugin process exited")));
  }

  private onMessage(m: ParentInbound): void {
    if (m.dir !== "c2p") return;
    if (m.kind === "proxy") {
      void this.handleProxy(m);
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.ok) p.resolve(m);
    else p.reject(new Error(m.error ?? "plugin call failed"));
  }

  private failAll(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  private call(method: "runTextGen" | "judge" | "generateImage", args: unknown[]): Promise<CallResultMsg> {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.child.send({ dir: "p2c", kind: "call", id, method, args });
    });
  }

  async *runTextGen(args: any): AsyncGenerator<any, any, void> {
    const res = (await this.call("runTextGen", [args])) as CallResultMsg;
    for (const ev of res.events ?? []) yield ev;
    return res.result;
  }

  async judge(args: any): Promise<any> {
    const res = (await this.call("judge", [args])) as CallResultMsg;
    return res.result;
  }

  async generateImage(args: any): Promise<any> {
    const res = (await this.call("generateImage", [args])) as CallResultMsg;
    return res.result;
  }

  /** Tear down the child process. */
  dispose(): void {
    IsolatedWorker.children.delete(this.child);
    this.child.kill();
  }

  private async handleProxy(m: ProxyMsg): Promise<void> {
    let result: unknown;
    let error: string | undefined;
    try {
      if (m.op === "fetch") result = await this.proxyFetch(m.payload as { url: string; init?: unknown });
      else result = await this.proxyFs(m.payload as FsPayload);
    } catch (e) {
      error = (e as Error).message;
    }
    const reply: ProxyResultMsg = { dir: "p2c", kind: "proxy-result", id: m.id, ok: !error, result, error };
    this.child.send(reply);
  }

  private async proxyFetch(payload: { url: string; init?: unknown }): Promise<unknown> {
    const host = new URL(payload.url).host;
    const cfg = loadPermissionConfig();
    if (cfg.networkAllow && !matchDomain(host, cfg.networkAllow)) {
      throw new Error(`network access to ${host} is not permitted`);
    }
    // Domain allowlists say nothing about where the host resolves — an
    // allowed name can point at an internal address. The guarded egress
    // refuses internal targets (pinned connection, per-hop re-checks).
    const r = await guardedFetch(payload.url);
    return { status: r.status, body: await r.text() };
  }

  /** Enforce the fs allowlist on a path. Throws if the path is not permitted. */
  private checkFsPath(pathName: string): void {
    const cfg = loadPermissionConfig();
    if (!isPathAllowed(pathName, cfg.fsAllow)) {
      throw new Error(`filesystem path ${pathName} is not permitted`);
    }
  }

  private async proxyFs(payload: FsPayload): Promise<unknown> {
    // Legacy format: { path, write?, data? }
    if (!("op" in payload)) {
      this.checkFsPath(payload.path);
      if (payload.write) {
        await writeFile(payload.path, payload.data ?? "");
        return undefined;
      }
      return readFile(payload.path, "utf8");
    }

    this.checkFsPath(payload.path);
    switch (payload.op) {
      case "read":
        return readFile(payload.path, "utf8");
      case "write":
        await writeFile(payload.path, payload.data);
        return undefined;
      case "appendFile":
        await appendFile(payload.path, payload.data);
        return undefined;
      case "readdir":
        return readdir(payload.path);
      case "stat": {
        const s = await stat(payload.path);
        return {
          size: s.size,
          isFile: s.isFile(),
          isDirectory: s.isDirectory(),
          mtimeMs: s.mtimeMs,
          ctimeMs: s.ctimeMs,
        };
      }
      case "unlink":
        await unlink(payload.path);
        return undefined;
      case "mkdir":
        await mkdir(payload.path, { recursive: true });
        return undefined;
      case "rm":
        await rm(payload.path, { recursive: true, force: true });
        return undefined;
      default:
        throw new Error(`unknown fs op: ${(payload as { op: string }).op}`);
    }
  }
}

/**
 * Fork a plugin entry into an isolated child process and wait for it to signal
 * readiness before returning. The child sends `{kind:"ready"}` once its entry
 * is imported and its worker constructed; if it exits/errors first or fails to
 * handshake in time, the promise rejects (H8 fail-closed) instead of returning
 * a half-dead worker that the caller would silently run in the main process.
 */
export async function spawnIsolatedWorker(
  entryPath: string,
  pluginId: string,
  declaredEnv?: string[],
  opts: { handshakeTimeoutMs?: number } = {},
): Promise<IsolatedWorker> {
  const timeoutMs = opts.handshakeTimeoutMs ?? 5000;
  const child = fork(PROXY_ENTRY, [], {
    env: { ...trimEnv(declaredEnv), WORKER_PLUGIN_ENTRY: entryPath },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    // Register the fs-isolation ESM loader so `import fs from 'node:fs/promises'`
    // in arbitrary plugins is intercepted and routed through the allowlist.
    execArgv: ["--import", FS_LOADER_REGISTER],
  });

  return await new Promise<IsolatedWorker>((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("message", onReady);
      child.off("exit", onExit);
      child.off("error", onError);
      if (err) {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        reject(err);
      } else {
        resolve(new IsolatedWorker(child, pluginId));
      }
    };
    const timer = setTimeout(
      () => finish(new Error(`plugin ${pluginId} did not signal ready within ${timeoutMs}ms`)),
      timeoutMs,
    );
    const onReady = (m: unknown): void => {
      if (m && (m as { dir?: string; kind?: string }).dir === "c2p" && (m as { kind?: string }).kind === "ready") {
        finish(null);
      }
    };
    const onExit = (code: number | null): void =>
      finish(new Error(`plugin ${pluginId} exited during startup (exit code ${code ?? "null"})`));
    const onError = (e: Error): void => finish(e);
    child.on("message", onReady);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

/** Dispose every isolated child (call on server shutdown). */
export function disposeIsolatedWorkers(): void {
  for (const c of IsolatedWorker.children) c.kill();
  IsolatedWorker.children.clear();
}
