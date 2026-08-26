import type {
  CompileResult,
  Graph,
  ModelPricing,
  RunEvent,
  RuntimeState,
  TriggerConfig,
} from "@agent-world/core";

export type { TriggerConfig } from "@agent-world/core";
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
  monthlyBudgetUsd?: number | null;
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

export interface EvalSummary {
  runs: number;
  passed: number;
  passRate: number;
  avgRework: number;
  avgDurationMs: number;
}
export interface EvalReport {
  totals: EvalSummary;
  byGraph: Array<EvalSummary & { graph_id: string; graph_name: string }>;
  byDay: Array<EvalSummary & { day: string }>;
  byPrompt: Array<
    EvalSummary & { graph_id: string; graph_name: string; version: string; fingerprint: string }
  >;
}

export interface StoredArtifact {
  id: string;
  runId: string;
  nodeId: string;
  attempt: number | null;
  kind: "text" | "image" | "video" | "audio" | "file" | "json" | "uri";
  mimeType: string | null;
  label: string | null;
  sizeBytes: number;
  storage: "inline" | "uri" | "local";
  uri: string | null;
  createdAt: number;
}

export interface ABArmReport {
  arm: string;
  target: string | null;
  prompt: string | null;
  runs: number;
  done: number;
  passed: number;
  passRate: number;
  avgRework: number;
  avgDurationMs: number;
  avgScore: number;
  avgCost: number;
}

export interface ABReport {
  groupId: string;
  arms: ABArmReport[];
  recommendedArm: string | null;
}

export interface ABStartResult {
  abGroup: string;
  arms: Array<{ arm: string; runId: string; prompt: string }>;
}

export interface BrandTerm {
  id: string;
  term: string;
  note: string;
  createdAt: number;
}

export const api = {
  listTemplates: () =>
    fetch("/api/templates").then(
      json<
        {
          id: string;
          name: string;
          description: string;
          category: string;
          nodes: { id: string; kind: string; x: number; y: number }[];
          edges: { from: string; to: string; kind?: string }[];
        }[]
      >,
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

  startRun: (
    graphId: string,
    budgetUsd: number | null,
    input?: string,
    connectorValues?: Record<string, string>,
  ) =>
    fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graphId, budgetUsd, input, connectorValues }),
    }).then(json<{ runId: string }>),

  cancelRun: (runId: string) =>
    fetch(`/api/runs/${runId}/cancel`, { method: "POST" }).then(json<{ ok: true }>),

  resumeRun: (
    runId: string,
    action: "continue" | "approve" | "reject" | "edit" | "scrap",
    resetFrom?: string,
    editOutput?: Record<string, string>,
    approveTools?: string[],
  ) =>
    fetch(`/api/runs/${runId}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, resetFrom, editOutput, approveTools }),
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

  evalReport: (opts: { graphId?: string; from?: number; to?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.graphId) qs.set("graphId", opts.graphId);
    if (opts.from !== undefined) qs.set("from", String(opts.from));
    if (opts.to !== undefined) qs.set("to", String(opts.to));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return fetch(`/api/eval${suffix}`).then(json<EvalReport>);
  },

  startAB: (
    graphId: string,
    targetNodeId: string,
    variants: string[],
    budgetUsd: number | null,
    input: string,
  ) =>
    fetch("/api/runs/ab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graphId, targetNodeId, variants, budgetUsd, input }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ABStartResult>;
    }),

  abReport: (groupId: string) =>
    fetch(`/api/ab/${groupId}`).then((res) => {
      if (!res.ok) throw new Error(`A/B 报表加载失败：${res.status}`);
      return res.json() as Promise<ABReport>;
    }),

  listBrandTerms: () => fetch("/api/brand-terms").then((res) => res.json() as Promise<BrandTerm[]>),

  addBrandTerm: (term: string, note = "") =>
    fetch("/api/brand-terms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term, note }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<BrandTerm>;
    }),

  deleteBrandTerm: (id: string) =>
    fetch(`/api/brand-terms/${id}`, { method: "DELETE" }).then(() => undefined),

  listTriggers: (graphId: string) =>
    fetch(`/api/graphs/${graphId}/triggers`).then(json<TriggerConfig[]>),

  createTrigger: (graphId: string, trigger: TriggerConfig) =>
    fetch(`/api/graphs/${graphId}/triggers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(trigger),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<TriggerConfig>;
    }),

  deleteTrigger: (graphId: string, triggerId: string) =>
    fetch(`/api/graphs/${graphId}/triggers/${triggerId}`, { method: "DELETE" }).then(() => undefined),

  fireTrigger: (graphId: string, triggerId: string) =>
    fetch(`/api/graphs/${graphId}/triggers/${triggerId}/fire`, { method: "POST" }).then(
      json<{ runId: string }>,
    ),

  triggerNextRuns: (graphId: string) =>
    fetch(`/api/graphs/${graphId}/triggers/next-runs`).then(json<Record<string, number | null>>),

  listArtifacts: (limit = 100, offset = 0) =>
    fetch(`/api/artifacts?limit=${limit}&offset=${offset}`).then(json<StoredArtifact[]>),

  listRunArtifacts: (runId: string) =>
    fetch(`/api/runs/${runId}/artifacts`).then(json<StoredArtifact[]>),

  uploadArtifact: (file: File) => {
    return fetch(`/api/artifacts/upload?label=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    }).then((res) => {
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      return res.json() as Promise<StoredArtifact>;
    });
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
