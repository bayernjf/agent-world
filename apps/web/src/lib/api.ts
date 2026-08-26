import type { CompileResult, Graph, ModelPricing, RunEvent, RuntimeState } from "@agent-world/core";
import type { Skill } from "@agent-world/core";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export type Modality = "text" | "image" | "video" | "audio" | "embedding";

export interface AppConfig {
  providers: Record<
    string,
    {
      type: string;
      baseUrl?: string;
      apiKey?: string;
      models: string[];
      enabled?: boolean;
      pricing?: Record<string, ModelPricing>;
      modalities?: Record<string, Modality>;
    }
  >;
  defaultModel: string;
  defaultProvider: string;
  modelOrder?: string[];
}

export interface ProviderTestResult {
  ok: boolean;
  status?: number;
  error?: string;
  modality?: string;
  endpoint?: string;
}

export interface CostReport {
  totals: {
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
    cached_tokens: number;
    reasoning_tokens: number;
    runs: number;
  };
  byGraph: Array<{
    graph_id: string;
    graph_name: string;
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
    runs: number;
  }>;
  byNode: Array<{
    graph_id: string;
    graph_name: string;
    node_id: string;
    node_name: string;
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
    attempts: number;
    reworks: number;
  }>;
  byAttempt: Array<{
    attempt: number;
    calls: number;
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
  }>;
  byDay: Array<{
    day: string;
    runs: number;
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
  }>;
}

export interface RunSummary {
  id: string;
  graph_id: string;
  graph_name: string;
  status: string;
  trigger: string;
  budget_usd: number | null;
  started_at: number;
  ended_at: number | null;
}

export class GraphConflictError extends Error {
  serverVersion: number | undefined;
  constructor(message: string, serverVersion?: number) {
    super(message);
    this.name = "GraphConflictError";
    this.serverVersion = serverVersion;
  }
}

export const api = {
  listTemplates: () =>
    fetch("/api/templates").then(
      json<{ id: string; name: string; description: string; category: string }[]>,
    ),

  listSkills: () => fetch("/api/skills").then(json<Skill[]>),

  listGraphs: () =>
    fetch("/api/graphs").then(json<{ id: string; name: string; updated_at: number }[]>),

  getGraph: (id: string) =>
    fetch(`/api/graphs/${id}`).then(json<Graph & { version: number }>),

  saveGraph: (graph: Graph, version?: number | null) =>
    fetch(`/api/graphs/${graph.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(version != null ? { "if-match": String(version) } : {}),
      },
      body: JSON.stringify(graph),
    }).then(async (res) => {
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          serverVersion?: number;
        };
        throw new GraphConflictError(body.message ?? "保存冲突", body.serverVersion);
      }
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      return res.json() as Promise<{ ok: true; version: number }>;
    }),

  createGraph: (opts?: { name?: string; from?: string; template?: string }) =>
    fetch("/api/graphs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    }).then(json<Graph>),

  deleteGraph: (id: string) =>
    fetch(`/api/graphs/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),

  compile: (graph: Graph) =>
    fetch("/api/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(graph),
    }).then(json<CompileResult>),

  startRun: (graphId: string, budgetUsd: number | null, input?: string) =>
    fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graphId, budgetUsd, input }),
    }).then(json<{ runId: string }>),

  cancelRun: (runId: string) =>
    fetch(`/api/runs/${runId}/cancel`, { method: "POST" }).then(json<{ ok: true }>),

  resumeRun: (
    runId: string,
    action: "continue" | "scrap",
    resetFrom?: string,
  ) =>
    fetch(`/api/runs/${runId}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, resetFrom }),
    }).then(json<{ ok: true }>),

  getEvents: (runId: string) =>
    fetch(`/api/runs/${runId}/events`).then(json<{ events: RunEvent[]; state: RuntimeState }>),

  listRuns: (limit = 50, offset = 0) =>
    fetch(`/api/runs?limit=${limit}&offset=${offset}`).then(json<RunSummary[]>),

  deleteRun: (runId: string) =>
    fetch(`/api/runs/${runId}`, { method: "DELETE" }).then(json<{ ok: true }>),

  costReport: (from?: number, to?: number) => {
    const qs = new URLSearchParams();
    if (from !== undefined) qs.set("from", String(from));
    if (to !== undefined) qs.set("to", String(to));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return fetch(`/api/costs${suffix}`).then(json<CostReport>);
  },

  getSettings: () => fetch("/api/settings").then(json<AppConfig>),

  saveSettings: (config: AppConfig) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    }).then(json<{ ok: true; path: string }>),

  testProvider: (
    baseUrl: string,
    apiKey: string,
    model: string,
    providerName?: string,
    modality?: Modality,
  ) =>
    fetch("/api/providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl, apiKey, model, providerName, modality }),
    }).then(json<ProviderTestResult>),
};
