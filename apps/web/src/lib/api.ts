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

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: "include" });
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
      endpoints?: Partial<Record<Modality, string>>;
      source?: "builtin" | "custom";
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
  byWeek: Array<{
    week: string;
    runs: number;
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
  }>;
  byMonth: Array<{
    month: string;
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

/** A run parked on a human decision, across every pipeline (F2 review queue). */
export interface PendingReview {
  runId: string;
  graphId: string;
  graphName: string;
  /** Null only for runs whose log predates halt recording. */
  nodeId: string | null;
  nodeName: string | null;
  kind: "human" | "tool" | "gate";
  reason: string | null;
  /** Text awaiting the decision, already trimmed to a server-side preview. */
  content: string | null;
  contentTruncated: boolean;
  /** Judge's verdict reason, for gate halts. */
  detail: string | null;
  /** Tool name to approve, for dangerous-action halts. */
  tool: string | null;
  startedAt: number;
  haltedAt: number;
  waitingMs: number;
  trigger: string;
  abGroup: string | null;
  abArm: string | null;
}

export type ReviewAction = "continue" | "approve" | "reject" | "edit" | "scrap";

export interface ReviewDecision {
  runId: string;
  action: ReviewAction;
  editOutput?: Record<string, string>;
  approveTools?: string[];
}

/**
 * Per-item outcome of a batch decision. The endpoint answers 200 even when some
 * items fail (not found / still active), so each has to be checked individually.
 */
export type ReviewDecisionResult =
  | { runId: string; ok: true; action: ReviewAction }
  | { runId: string; ok: false; status: number; error: string };

export class GraphConflictError extends Error {
  serverVersion: number | undefined;
  constructor(message: string, serverVersion?: number) {
    super(message);
    this.name = "GraphConflictError";
    this.serverVersion = serverVersion;
  }
}

export class DuplicateGraphNameError extends Error {
  existingId: string | undefined;
  constructor(message: string, existingId?: string) {
    super(message);
    this.name = "DuplicateGraphNameError";
    this.existingId = existingId;
  }
}

export interface EvalSummary {
  runs: number;
  passed: number;
  passRate: number;
  avgRework: number;
  avgDurationMs: number;
  avgScore: number;
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
  graphId?: string | null;
  role?: "source" | "intermediate" | "final" | null;
  graphName?: string | null;
  kind: "text" | "image" | "video" | "audio" | "file" | "json" | "uri";
  mimeType: string | null;
  label: string | null;
  sizeBytes: number;
  storage: "inline" | "uri" | "local";
  uri: string | null;
  createdAt: number;
}

/**
 * Resolve an image URL for same-origin rendering. External http(s) URLs are
 * routed through the server-side `/api/proxy` endpoint (which bypasses browser
 * hotlink/CORS blocks); local `/api/...` and `data:` URIs are used directly.
 * Absolute URLs that point at our own artifact store are normalized back to a
 * same-origin path so the auth cookie is attached (the proxy would self-fetch
 * and get a 401). Returns null when there is no URL to render.
 */
export function proxyImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const ownArtifact = url.match(/^https?:\/\/[^/]+(\/api\/artifacts\/[^?#]+)/i);
  if (ownArtifact) return ownArtifact[1]!;
  if (/^https?:\/\//i.test(url)) return `/api/proxy?url=${encodeURIComponent(url)}`;
  return url;
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

/** A platform's publishing profile (F3 compliance). */
export interface PlatformProfile {
  id: string;
  label: string;
  titleMax: number;
  bodyMax: number;
  hashtag: { prefix: string; max: number };
  imageRatios: string[];
  bannedWords: string[];
  required: string[];
}

export interface BannedTerm {
  id: string;
  term: string;
  note: string;
  createdAt: number;
}

export const api = {
  listSkills: () => authFetch("/api/skills").then(json<Skill[]>),

  listGraphs: () =>
    authFetch("/api/graphs").then(json<{ id: string; name: string; updated_at: number }[]>),

  getGraph: (id: string) =>
    authFetch(`/api/graphs/${id}`).then(json<Graph & { version: number }>),

  saveGraph: (graph: Graph, version?: number | null) =>
    authFetch(`/api/graphs/${graph.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(version != null ? { "if-match": String(version) } : {}),
      },
      body: JSON.stringify(graph),
    }).then(async (res) => {
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          serverVersion?: number;
          existingId?: string;
        };
        if (body.error === "duplicate_name") {
          throw new DuplicateGraphNameError(body.message ?? "产线名重复", body.existingId);
        }
        throw new GraphConflictError(body.message ?? "保存冲突", body.serverVersion);
      }
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      return res.json() as Promise<{ ok: true; version: number }>;
    }),

  createGraph: async (opts?: {
    name?: string;
    from?: string;
    template?: string;
    fieldValues?: Record<string, string>;
  }) => {
    const res = await authFetch("/api/graphs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    });
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        existingId?: string;
      };
      if (body.error === "duplicate_name") {
        throw new DuplicateGraphNameError(body.message ?? "产线名重复", body.existingId);
      }
      throw new Error(`create failed: 409 ${JSON.stringify(body)}`);
    }
    if (!res.ok) throw new Error(`create failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as Graph;
  },

  deleteGraph: (id: string) =>
    authFetch(`/api/graphs/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),

  compile: (graph: Graph) =>
    authFetch("/api/compile", {
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
    authFetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graphId, budgetUsd, input, connectorValues }),
    }).then(json<{ runId: string }>),

  cancelRun: (runId: string) =>
    authFetch(`/api/runs/${runId}/cancel`, { method: "POST" }).then(json<{ ok: true }>),

  rerunRun: (runId: string) =>
    authFetch(`/api/runs/${runId}/rerun`, { method: "POST" }).then(json<{ runId: string }>),

  resumeRun: (
    runId: string,
    action: "continue" | "approve" | "reject" | "edit" | "scrap",
    resetFrom?: string,
    editOutput?: Record<string, string>,
    approveTools?: string[],
  ) =>
    authFetch(`/api/runs/${runId}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, resetFrom, editOutput, approveTools }),
    }).then(json<{ ok: true }>),

  /** Every run of the caller parked on a human decision, longest-waiting first. */
  listPendingReviews: (opts: { limit?: number; offset?: number; graphId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts.offset !== undefined) qs.set("offset", String(opts.offset));
    if (opts.graphId) qs.set("graphId", opts.graphId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return authFetch(`/api/reviews/pending${suffix}`).then(
      json<{ reviews: PendingReview[]; total: number }>,
    );
  },

  decideReviews: (decisions: ReviewDecision[]) =>
    authFetch("/api/reviews/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decisions),
    }).then(json<{ ok: true; results: ReviewDecisionResult[] }>),

  getEvents: (runId: string) =>
    authFetch(`/api/runs/${runId}/events`).then(json<{ events: RunEvent[]; state: RuntimeState }>),

  listRuns: (opts: { limit?: number; offset?: number; graphId?: string; status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts.offset !== undefined) qs.set("offset", String(opts.offset));
    if (opts.graphId) qs.set("graphId", opts.graphId);
    if (opts.status) qs.set("status", opts.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return authFetch(`/api/runs${suffix}`).then(json<{ runs: RunSummary[]; total: number }>);
  },

  runStats: (runId: string) =>
    authFetch(`/api/runs/${runId}/stats`).then(
      json<{ nodes: number; tokensIn: number; tokensOut: number; costUsd: number }>,
    ),

  deleteRun: (runId: string) =>
    authFetch(`/api/runs/${runId}`, { method: "DELETE" }).then(json<{ ok: true }>),

  costReport: (from?: number, to?: number) => {
    const qs = new URLSearchParams();
    if (from !== undefined) qs.set("from", String(from));
    if (to !== undefined) qs.set("to", String(to));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return authFetch(`/api/costs${suffix}`).then(json<CostReport>);
  },

  evalReport: (opts: { graphId?: string; from?: number; to?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.graphId) qs.set("graphId", opts.graphId);
    if (opts.from !== undefined) qs.set("from", String(opts.from));
    if (opts.to !== undefined) qs.set("to", String(opts.to));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return authFetch(`/api/eval${suffix}`).then(json<EvalReport>);
  },

  startAB: (
    graphId: string,
    targetNodeId: string,
    variants: string[],
    budgetUsd: number | null,
    input: string,
  ) =>
    authFetch("/api/runs/ab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graphId, targetNodeId, variants, budgetUsd, input }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ABStartResult>;
    }),

  abReport: (groupId: string) =>
    authFetch(`/api/ab/${groupId}`).then((res) => {
      if (!res.ok) throw new Error(`A/B 报表加载失败：${res.status}`);
      return res.json() as Promise<ABReport>;
    }),

  listBrandTerms: () => authFetch("/api/brand-terms").then((res) => res.json() as Promise<BrandTerm[]>),

  addBrandTerm: (term: string, note = "") =>
    authFetch("/api/brand-terms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term, note }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<BrandTerm>;
    }),

  deleteBrandTerm: (id: string) =>
    authFetch(`/api/brand-terms/${id}`, { method: "DELETE" }).then(() => undefined),

  listPlatforms: () =>
    authFetch("/api/platforms").then(
      json<{ profiles: Record<string, PlatformProfile>; adLawBannedWords: string[] }>,
    ),

  listBannedTerms: () =>
    authFetch("/api/banned-terms").then((res) => res.json() as Promise<BannedTerm[]>),

  addBannedTerm: (term: string, note = "") =>
    authFetch("/api/banned-terms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term, note }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<BannedTerm>;
    }),

  deleteBannedTerm: (id: string) =>
    authFetch(`/api/banned-terms/${id}`, { method: "DELETE" }).then(() => undefined),

  listTriggers: (graphId: string) =>
    authFetch(`/api/graphs/${graphId}/triggers`).then(json<TriggerConfig[]>),

  createTrigger: (graphId: string, trigger: TriggerConfig) =>
    authFetch(`/api/graphs/${graphId}/triggers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(trigger),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<TriggerConfig>;
    }),

  deleteTrigger: (graphId: string, triggerId: string) =>
    authFetch(`/api/graphs/${graphId}/triggers/${triggerId}`, { method: "DELETE" }).then(() => undefined),

  fireTrigger: (graphId: string, triggerId: string) =>
    authFetch(`/api/graphs/${graphId}/triggers/${triggerId}/fire`, { method: "POST" }).then(
      json<{ runId: string }>,
    ),

  triggerNextRuns: (graphId: string) =>
    authFetch(`/api/graphs/${graphId}/triggers/next-runs`).then(json<Record<string, number | null>>),

  listArtifacts: (limit = 100, offset = 0) =>
    authFetch(`/api/artifacts?limit=${limit}&offset=${offset}`).then(json<StoredArtifact[]>),

  listRunArtifacts: (runId: string) =>
    authFetch(`/api/runs/${runId}/artifacts`).then(json<StoredArtifact[]>),

  runGraph: (runId: string) =>
    authFetch(`/api/runs/${runId}/graph`).then(json<Graph>),

  uploadArtifact: (file: File) => {
    return authFetch(`/api/artifacts/upload?label=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    }).then((res) => {
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      return res.json() as Promise<StoredArtifact>;
    });
  },

  getSettings: () => authFetch("/api/settings").then(json<AppConfig>),

  saveSettings: (config: AppConfig) =>
    authFetch("/api/settings", {
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
    authFetch("/api/providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl, apiKey, model, providerName, modality }),
    }).then(json<ProviderTestResult>),
};
