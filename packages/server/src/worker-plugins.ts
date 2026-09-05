import { readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Worker } from "./worker.js";
import { spawnIsolatedWorker } from "./isolation.js";
import { log } from "./logger.js";

export interface WorkerPlugin {
  id: string;
  name: string;
  description?: string;
  models?: string[];
  /** Build the Worker instance this plugin contributes. */
  createWorker: () => Worker;
  /**
   * 4C.7 — run this plugin in an isolated child process (`"subprocess"`) instead
   * of the server process. Defaults to `"in-process"`.
   */
  isolation?: "in-process" | "subprocess";
  /** Env var names the isolated child is allowed to see (beyond a safe base). */
  env?: string[];
  /** Absolute path to the plugin entry; set by the loader, not the author. */
  entry?: string;
}

export interface WorkerInfo {
  id: string;
  name: string;
  description?: string;
  models?: string[];
  builtin?: boolean;
  /**
   * Isolation mode. "subprocess" forks a gated child (env/network/fs proxied),
   * but this is still *cooperative* isolation — it is not a security sandbox
   * (no seccomp/cgroup/VM boundary; a determined plugin can block the event
   * loop). Stronger isolation needs the container backend (H10, deferred).
   */
  isolation?: "in-process" | "subprocess";
  /** Env var names the isolated child is allowed to see (beyond a safe base). */
  env?: string[];
  /** False when a subprocess plugin failed its startup handshake and was kept disabled (H8). */
  available?: boolean;
  /** Reason the plugin is unavailable. */
  error?: string;
}

/**
 * Holds the built-in worker plus any worker plugins discovered on disk. A run
 * can select a worker by id; an unknown/missing id falls back to the built-in.
 *
 * The whole point of the plugin system: adding a new worker (e.g. to support a
 * different model provider) is just dropping a `*.worker.ts` file in the
 * plugins directory — no edit to the engine or core wiring.
 */
export class WorkerRegistry {
  private readonly workers = new Map<string, Worker>();
  private readonly info = new Map<string, WorkerInfo>();

  constructor(defaultWorker: Worker, private readonly defaultId = "agnes") {
    this.workers.set(this.defaultId, defaultWorker);
    this.info.set(this.defaultId, {
      id: this.defaultId,
      name: "Agnes (built-in)",
      description: "默认路由 worker，覆盖 LLM / 图片 / 工具调用等节点。",
      builtin: true,
    });
  }

  /** Scan `dir` for `*.worker.(ts|js|mjs|cjs)` modules and register their plugins. */
  async loadFrom(dir: string): Promise<WorkerPlugin[]> {
    const plugins = await loadWorkerPlugins(dir);
    for (const p of plugins) {
      this.info.set(p.id, {
        id: p.id,
        name: p.name,
        description: p.description,
        models: p.models,
        isolation: p.isolation ?? "in-process",
        env: p.env,
      });
      if (p.isolation === "subprocess" && p.entry && !p.entry.endsWith(".ts")) {
        try {
          // Awaits the child's ready handshake; rejects on exit/error/timeout.
          const isolated = await spawnIsolatedWorker(p.entry, p.id, p.env);
          this.workers.set(p.id, isolated);
          continue;
        } catch (err) {
          // H8 fail-closed: a plugin that asked for subprocess isolation must
          // NOT silently fall back to running untrusted code in the server
          // process when its child can't start. Keep it disabled (get() falls
          // back to the built-in) and surface the reason in the registry.
          const reason = (err as Error).message;
          log.error("plugin isolation failed; kept disabled (fail-closed)", { id: p.id, error: reason });
          this.info.set(p.id, { ...(this.info.get(p.id) ?? { id: p.id, name: p.name }), available: false, error: reason });
          continue;
        }
      }
      const callTimeoutMs = Number(process.env.PLUGIN_CALL_TIMEOUT_MS) || DEFAULT_PLUGIN_CALL_TIMEOUT_MS;
      this.workers.set(p.id, withPluginTimeout(p.createWorker(), callTimeoutMs));
    }
    return plugins;
  }

  /** Resolve a worker by id, falling back to the built-in when absent. */
  get(id?: string | null): Worker {
    return (id && this.workers.get(id)) || this.workers.get(this.defaultId)!;
  }

  list(): WorkerInfo[] {
    return [...this.info.values()];
  }
}

function isWorkerPlugin(mod: unknown): mod is WorkerPlugin {
  const p = mod as Partial<WorkerPlugin> | undefined;
  return !!p && typeof p.id === "string" && typeof p.createWorker === "function";
}

/** Default ceiling for one in-process plugin Promise call (H10). */
const DEFAULT_PLUGIN_CALL_TIMEOUT_MS = 120_000;

/** Race a promise against a timeout so a hung in-process plugin can't stall the engine (H10). */
function withCallTimeout<T>(label: string, ms: number, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => timer && clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

/**
 * Wrap an in-process plugin so its Promise-returning methods cannot hang
 * forever. runTextGen is an async generator and is left to the engine's
 * AbortController (streaming makes a racing timeout unsafe).
 */
function withPluginTimeout(worker: Worker, ms: number): Worker {
  return {
    ...worker,
    judge: (args) => withCallTimeout("plugin.judge", ms, worker.judge(args)),
    generateImage: (args) => withCallTimeout("plugin.generateImage", ms, worker.generateImage(args)),
    generateVideo: worker.generateVideo
      ? (args) => withCallTimeout("plugin.generateVideo", ms, worker.generateVideo!(args))
      : undefined,
    generateAudio: worker.generateAudio
      ? (args) => withCallTimeout("plugin.generateAudio", ms, worker.generateAudio!(args))
      : undefined,
    summarize: worker.summarize
      ? (args) => withCallTimeout("plugin.summarize", ms, worker.summarize!(args))
      : undefined,
  };
}

/** Discover worker plugins in a directory. Non-fatal if the dir is missing or a plugin throws. */
export async function loadWorkerPlugins(dir: string): Promise<WorkerPlugin[]> {
  const out: WorkerPlugin[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.worker\.(ts|js|mjs|cjs)$/.test(entry.name)) continue;
    try {
      const mod = await import(pathToFileURL(join(dir, entry.name)).href);
      const plugin = mod.plugin ?? mod.default;
      if (isWorkerPlugin(plugin)) out.push({ ...plugin, entry: join(dir, entry.name) });
    } catch (err) {
      log.warn("failed to load plugin entry", { name: entry.name, error: (err as Error).message });
    }
  }
  return out;
}
