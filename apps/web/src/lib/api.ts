import type { CompileResult, Graph, ModelPricing, RunEvent, RuntimeState } from "@agent-world/core";

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

export const api = {
  getGraph: (id: string) => fetch(`/api/graphs/${id}`).then(json<Graph>),

  saveGraph: (graph: Graph) =>
    fetch(`/api/graphs/${graph.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(graph),
    }).then(json<{ ok: true }>),

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

  resumeRun: (runId: string, action: "continue" | "scrap") =>
    fetch(`/api/runs/${runId}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).then(json<{ ok: true }>),

  getEvents: (runId: string) =>
    fetch(`/api/runs/${runId}/events`).then(json<{ events: RunEvent[]; state: RuntimeState }>),

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
