import { readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Worker } from "./worker.js";

export interface WorkerPlugin {
  id: string;
  name: string;
  description?: string;
  models?: string[];
  /** Build the Worker instance this plugin contributes. */
  createWorker: () => Worker;
}

export interface WorkerInfo {
  id: string;
  name: string;
  description?: string;
  models?: string[];
  builtin?: boolean;
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
      this.workers.set(p.id, p.createWorker());
      this.info.set(p.id, { id: p.id, name: p.name, description: p.description, models: p.models });
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
      if (isWorkerPlugin(plugin)) out.push(plugin);
    } catch (err) {
      console.warn(`[worker-plugins] failed to load ${entry.name}:`, (err as Error).message);
    }
  }
  return out;
}
