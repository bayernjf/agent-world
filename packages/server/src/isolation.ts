import { type ChildProcess, fork } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Worker } from "./worker.js";
import { loadPermissionConfig, matchDomain } from "./permissions.js";

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
 * channel. Streaming `runAgent` output is collected in the child and replayed
 * in order by the parent (streaming granularity is lost across the boundary,
 * but the result is identical).
 */

const PROXY_ENTRY = new URL("./worker-proxy.mjs", import.meta.url).pathname;

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

/** Build the environment a subprocess plugin receives: baseline + declared keys only. */
export function trimEnv(declared?: string[]): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const k of SAFE_ENV_BASE) if (process.env[k] !== undefined) out[k] = process.env[k]!;
  for (const k of declared ?? []) if (process.env[k] !== undefined) out[k] = process.env[k]!;
  return out as NodeJS.ProcessEnv;
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

  private call(method: "runAgent" | "judge" | "generateImage", args: unknown[]): Promise<CallResultMsg> {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.child.send({ dir: "p2c", kind: "call", id, method, args });
    });
  }

  async *runAgent(args: any): AsyncGenerator<any, any, void> {
    const res = (await this.call("runAgent", [args])) as CallResultMsg;
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
      else result = await this.proxyFs(m.payload as { path: string; write?: boolean; data?: string });
    } catch (e) {
      error = (e as Error).message;
    }
    const reply: ProxyResultMsg = { dir: "p2c", kind: "proxy-result", id: m.id, ok: !error, result, error };
    this.child.send(reply);
  }

  private proxyFetch(payload: { url: string; init?: unknown }): Promise<unknown> {
    const host = new URL(payload.url).host;
    const cfg = loadPermissionConfig();
    if (cfg.networkAllow && !matchDomain(host, cfg.networkAllow)) {
      throw new Error(`network access to ${host} is not permitted`);
    }
    return fetch(payload.url, payload.init as RequestInit).then(async (r) => ({
      status: r.status,
      body: await r.text(),
    }));
  }

  private async proxyFs(payload: { path: string; write?: boolean; data?: string }): Promise<unknown> {
    const cfg = loadPermissionConfig();
    if (cfg.fsAllow && !cfg.fsAllow.some((p) => payload.path.startsWith(p))) {
      throw new Error(`filesystem path ${payload.path} is not permitted`);
    }
    if (payload.write) {
      await writeFile(payload.path, payload.data ?? "");
      return undefined;
    }
    return readFile(payload.path, "utf8");
  }
}

/**
 * Fork a plugin entry into an isolated child process. Returns an `IsolatedWorker`
 * that proxies all calls. The plugin entry must be importable by plain Node
 * (`.js` / `.mjs`), since the child does not share the server's TS loader.
 */
export function spawnIsolatedWorker(entryPath: string, pluginId: string, declaredEnv?: string[]): IsolatedWorker {
  const child = fork(PROXY_ENTRY, [], {
    env: { ...trimEnv(declaredEnv), WORKER_PLUGIN_ENTRY: entryPath },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  return new IsolatedWorker(child, pluginId);
}

/** Dispose every isolated child (call on server shutdown). */
export function disposeIsolatedWorkers(): void {
  for (const c of IsolatedWorker.children) c.kill();
  IsolatedWorker.children.clear();
}
