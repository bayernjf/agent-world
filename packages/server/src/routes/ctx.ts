/** Shared execution context for route-domain modules (audit P2-2 split).
 *  index.ts bootstraps these singletons and passes them to each register fn;
 *  route modules no longer import the server entry (no import cycle). */
import type { Db } from "../db.js";
import type { ArtifactStore } from "../artifact-store.js";
import type { SQLiteMemoryBackend, NoopMemoryBackend } from "../memory.js";
import type { WorkerRegistry } from "../worker-plugins.js";
import type { TriggerService } from "../triggers.js";
import type { TriggerScheduler } from "../scheduler.js";
import type { DemoFeature } from "../demo.js";
import type { routingWorker } from "../providers/index.js";
import type { RunEvent } from "@agent-world/core";

export interface RouteContext {
  db: Db;
  live: Map<string, { events: RunEvent[]; done: boolean; controller: AbortController }>;
  artifacts: ArtifactStore;
  memory: SQLiteMemoryBackend | NoopMemoryBackend;
  worker: ReturnType<typeof routingWorker>;
  workerRegistry: WorkerRegistry;
  triggers: TriggerService;
  scheduler: TriggerScheduler;
  PUBLIC_URL: string;
  MAX_PROXY_RESPONSE_BYTES: number;
  /** 403 for a demo account on a locked route (closes over db). */
  blockDemo: (c: any, feature: DemoFeature) => Promise<Response | null>;
}
