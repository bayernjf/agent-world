import type {
  CompileResult,
  Graph,
  ModelPricing,
  PlanId,
  RunEvent,
  RunTimeline,
  RuntimeState,
  TriggerConfig,
} from "@agent-world/core";
import type { Skill } from "@agent-world/core";
import i18n from "../../i18n";
import { billingReturnPath } from "../billingReturn";
import { authFetch, billingPost, json } from "./types";

import type { Modality, AppConfig, McpServerStatus, ProviderTestResult, CostReport, RunSummary, RunTimelineResponse, RunNodeOutputResponse, PendingReview, ReviewDecision, ReviewDecisionResult, EvalReport, StoredArtifact, ABReport, ABStartResult, BrandTerm, Collaborator, AdminUser, AuditItem, FeedbackItem, FeedbackContext, FeedbackCategory, FeedbackStatus, FeedbackAnnouncement, PlatformProfile, BannedTerm, Product, BrandAsset, BatchJob, ContentPlan, ContentMetric, PerformanceAggregate, ContentCost, ContentCostAggregate, PublishTarget, OperationsOverview, SubscriptionStatus, BillingSession, Invoice, ModelCatalogOverlay, ModelCatalogView, ModelCatalogChange, ModelCatalogImpact,  } from "./types";
import { GraphConflictError, DuplicateGraphNameError } from "./types";

export const api = {
  listSkills: () => authFetch("/api/skills").then(json<Skill[]>),

  listGraphs: () =>
    authFetch("/api/graphs").then(json<{ id: string; name: string; updated_at: number; sharedRole: string | null }[]>),

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
          throw new DuplicateGraphNameError(
            body.message ?? i18n.t("errors:graph.duplicateNameShort"),
            body.existingId,
          );
        }
        throw new GraphConflictError(
          body.message ?? i18n.t("errors:graph.saveConflict"),
          body.serverVersion,
        );
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
        throw new DuplicateGraphNameError(
          body.message ?? i18n.t("errors:graph.duplicateNameShort"),
          body.existingId,
        );
      }
      throw new Error(`create failed: 409 ${JSON.stringify(body)}`);
    }
    if (!res.ok) throw new Error(`create failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as Graph;
  },

  deleteGraph: (id: string) =>
    authFetch(`/api/graphs/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),

  putParkCoord: (graphId: string, x: number, z: number) =>
    authFetch(`/api/graphs/${graphId}/park-coord`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x, z }),
    }).then(json<{ ok: true }>),

  deleteParkCoord: (graphId: string) =>
    authFetch(`/api/graphs/${graphId}/park-coord`, { method: "DELETE" }).then(json<{ ok: true }>),

  getGraphAccess: (graphId: string) =>
    authFetch(`/api/graphs/${graphId}/access`).then(
      json<{ collaborators: Collaborator[] }>,
    ),

  putGraphAccess: (graphId: string, email: string, role: "editor" | "viewer" | null) =>
    authFetch(`/api/graphs/${graphId}/access`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `access update failed: ${res.status}`);
      }
      return res.json() as Promise<{ ok: true }>;
    }),

  // --- Admin operations (design-rbac P3) ---

  adminListUsers: () =>
    authFetch("/api/admin/users").then(json<{ users: AdminUser[] }>),

  /**
   * Open an account for someone who can't self-register (signup closes after the
   * first account). The server generates the one-time password and returns it
   * exactly here — it is not stored anywhere retrievable, so the caller must
   * show it once and tell the operator to pass it on.
   */
  adminCreateUser: (email: string) =>
    authFetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).then(async (res) => {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        user?: AdminUser;
        oneTimePassword?: string;
      };
      if (!res.ok || !body.user) {
        throw new Error(body.error ?? `create user failed: ${res.status}`);
      }
      return { user: body.user, oneTimePassword: body.oneTimePassword ?? "" };
    }),

  adminSetUserRole: (userId: string, role: "admin" | "user") =>
    authFetch(`/api/admin/users/${userId}/role`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `role update failed: ${res.status}`);
      }
      return res.json() as Promise<{ ok: true; role: "admin" | "user"; unchanged?: boolean }>;
    }),

  // --- M3 S4: admin invoice management (manual payment) ---
  adminListInvoices: () =>
    authFetch("/api/admin/invoices").then(json<{ invoices: Invoice[] }>),

  adminMarkInvoicePaid: (invoiceId: string, method = "manual", notes?: string) =>
    authFetch(`/api/admin/invoices/${invoiceId}/mark-paid`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, notes: notes ?? undefined }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `mark-paid failed: ${res.status}`);
      }
      return res.json() as Promise<{ ok: true; invoice: Invoice }>;
    }),

  adminVoidInvoice: (invoiceId: string, reason?: string) =>
    authFetch(`/api/admin/invoices/${invoiceId}/void`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason ?? undefined }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `void failed: ${res.status}`);
      }
      return res.json() as Promise<{ ok: true; invoice: Invoice }>;
    }),

  listAudit: (opts: { limit?: number; before?: number; userId?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit != null) params.set("limit", String(opts.limit));
    if (opts.before != null) params.set("before", String(opts.before));
    if (opts.userId != null) params.set("userId", String(opts.userId));
    const qs = params.toString();
    return authFetch(qs ? `/api/audit?${qs}` : "/api/audit").then(
      json<{ items: AuditItem[] }>,
    );
  },

  submitFeedback: (
    message: string,
    category: FeedbackCategory,
    context: FeedbackContext,
    attachment?: { data: string; mimeType: string } | null,
  ) =>
    authFetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, category, context, attachment: attachment ?? undefined }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `feedback submit failed: ${res.status}`);
      }
      return res.json() as Promise<{ ok: true; id: string }>;
    }),

  listFeedback: (opts: { status?: FeedbackStatus } = {}) => {
    const qs = opts.status ? `?status=${opts.status}` : "";
    return authFetch(`/api/feedback${qs}`).then(json<{ items: FeedbackItem[] }>);
  },

  updateFeedbackStatus: (id: string, status: FeedbackStatus) =>
    authFetch(`/api/feedback/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `status update failed: ${res.status}`);
      }
      return res.json() as Promise<{ ok: true; status: FeedbackStatus; unchanged?: boolean }>;
    }),

  feedbackAttachmentUrl: (id: string) => `/api/feedback/${id}/attachment`,

  /** Merge a batch of feedback into one announcement; server closes the batch. */
  announceFeedback: (feedbackIds: string[], announcement: FeedbackAnnouncement) =>
    authFetch("/api/feedback/announce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedbackIds, announcement }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `announce failed: ${res.status}`);
      }
      return res.json() as Promise<{ ok: true; announcementId: string; closed: number }>;
    }),

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

  /** G1.2: fork a run at a node — reuse that node + upstream (zero cost), rerun descendants. */
  forkRun: (runId: string, fromNodeId: string) =>
    authFetch(`/api/runs/${runId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromNodeId }),
    }).then(json<{ runId: string }>),

  diagnoseRun: (runId: string) =>
    authFetch(`/api/runs/${runId}/diagnose`, { method: "POST" }).then(
      json<{ diagnosis: string; model: string }>,
    ),

  resumeRun: (
    runId: string,
    action: "continue" | "approve" | "reject" | "edit" | "scrap" | "reattach" | "accept-degraded",
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

  listRuns: (opts: { limit?: number; offset?: number; graphId?: string; status?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts.offset !== undefined) qs.set("offset", String(opts.offset));
    if (opts.graphId) qs.set("graphId", opts.graphId);
    if (opts.status) qs.set("status", opts.status);
    if (opts.q) qs.set("q", opts.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return authFetch(`/api/runs${suffix}`).then(json<{ runs: RunSummary[]; total: number }>);
  },

  runStats: (runId: string) =>
    authFetch(`/api/runs/${runId}/stats`).then(
      json<{ nodes: number; tokensIn: number; tokensOut: number; costUsd: number }>,
    ),

  getRunTimeline: (runId: string) =>
    authFetch(`/api/runs/${runId}/timeline`).then(json<RunTimelineResponse>),
  getRunNodeOutput: (runId: string, nodeId: string, attempt: number) =>
    authFetch(
      `/api/runs/${runId}/nodes/${encodeURIComponent(nodeId)}/attempt/${attempt}/output`,
    ).then(json<RunNodeOutputResponse>),

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
    /** G5.1: when set, arm A uses the live prompt and this done run's input. */
    fromRunId?: string,
  ) =>
    authFetch("/api/runs/ab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        fromRunId
          ? { graphId, targetNodeId, variants, budgetUsd, input, fromRunId }
          : { graphId, targetNodeId, variants, budgetUsd, input },
      ),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ABStartResult>;
    }),

  abReport: (groupId: string) =>
    authFetch(`/api/ab/${groupId}`).then((res) => {
      if (!res.ok)
        throw new Error(
          i18n.t("errors:api.abReportLoadFailed", { status: res.status }),
        );
      return res.json() as Promise<ABReport>;
    }),

  listBrandTerms: () =>
    authFetch("/api/brand-terms").then(async (res) => {
      if (!res.ok) throw new Error(await res.text()); // M24: don't treat 401/500 as success
      return res.json() as Promise<BrandTerm[]>;
    }),

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
    authFetch(`/api/brand-terms/${id}`, { method: "DELETE" }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
    }),

  listPlatforms: () =>
    authFetch("/api/platforms").then(
      json<{ profiles: Record<string, PlatformProfile>; adLawBannedWords: string[] }>,
    ),

  listBannedTerms: () =>
    authFetch("/api/banned-terms").then(async (res) => {
      if (!res.ok) throw new Error(await res.text()); // M24
      return res.json() as Promise<BannedTerm[]>;
    }),

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
    authFetch(`/api/banned-terms/${id}`, { method: "DELETE" }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
    }),

  listProducts: (query = "") => authFetch(`/api/products${query}`).then(json<Product[]>),

  addProduct: (input: {
    sku?: string;
    name: string;
    brand?: string;
    category?: string;
    price?: number | null;
    attributes?: Record<string, unknown>;
    images?: string[];
  }) =>
    authFetch("/api/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<Product>;
    }),

  updateProduct: (
    id: string,
    patch: Partial<{
      sku: string;
      name: string;
      brand: string;
      category: string;
      price: number | null;
      attributes: Record<string, unknown>;
      images: string[];
      status: "active" | "archived";
    }>,
  ) =>
    authFetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<Product>;
    }),

  deleteProduct: (id: string) =>
    authFetch(`/api/products/${id}`, { method: "DELETE" }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
    }),

  importProducts: (csv: string) =>
    authFetch("/api/products/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ imported: number; failed: number; errors: string[]; products: Product[] }>;
    }),

  listBrandAssets: () => authFetch("/api/brand-assets").then(json<BrandAsset[]>),

  addBrandAsset: (input: { type: string; label: string; uri?: string; tags?: string[] }) =>
    authFetch("/api/brand-assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<BrandAsset>;
    }),

  deleteBrandAsset: (id: string) =>
    authFetch(`/api/brand-assets/${id}`, { method: "DELETE" }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
    }),

  listBatches: () => authFetch("/api/batches").then(json<BatchJob[]>),

  getBatch: (id: string) => authFetch(`/api/batches/${id}`).then(json<BatchJob>),

  createBatch: (input: { graphId: string; rows?: Record<string, unknown>[]; csv?: string; concurrency?: number }) =>
    authFetch("/api/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ batchId: string }>;
    }),

  retryBatchItem: (batchId: string, itemId: string) =>
    authFetch(`/api/batches/${batchId}/items/${itemId}/retry`, {
      method: "POST",
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ runId: string }>;
    }),

  listPlans: (from?: number, to?: number) => {
    const query = from != null && to != null ? `?from=${from}&to=${to}` : "";
    return authFetch(`/api/plan${query}`).then(json<ContentPlan[]>);
  },

  createPlan: (input: {
    graphId?: string | null;
    runId?: string | null;
    artifactId?: string | null;
    platform?: string | null;
    title: string;
    scheduledAt: number;
    note?: string | null;
  }) =>
    authFetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ContentPlan>;
    }),

  updatePlan: (id: string, patch: Partial<ContentPlan>) =>
    authFetch(`/api/plan/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ContentPlan>;
    }),

  deletePlan: (id: string) =>
    authFetch(`/api/plan/${id}`, { method: "DELETE" }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
    }),

  listMetrics: () => authFetch("/api/metrics").then(json<ContentMetric[]>),

  insertMetric: (input: Partial<ContentMetric> & { recordedAt?: number }) =>
    authFetch("/api/metrics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ContentMetric>;
    }),

  importMetrics: (csv: string) =>
    authFetch("/api/metrics/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ imported: number }>;
    }),

  aggregatePerformance: (groupBy = "graph_id") =>
    authFetch(`/api/performance?groupBy=${groupBy}`).then(json<PerformanceAggregate[]>),

  /** Operations dashboard overview; `sinceMs` windows counters/cost (optional). */
  operationsOverview: (sinceMs?: number) =>
    authFetch(`/api/operations/overview${sinceMs != null ? `?since=${sinceMs}` : ""}`).then(
      json<OperationsOverview>,
    ),

  listContentCosts: () => authFetch("/api/content-costs").then(json<ContentCost[]>),

  insertContentCost: (input: {
    artifactId?: string | null;
    productId?: string | null;
    platform?: string | null;
    variant?: string | null;
    costUsd?: number;
    gmv?: number;
  }) =>
    authFetch("/api/content-costs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ContentCost>;
    }),

  aggregateContentCosts: (groupBy = "artifact_id") =>
    authFetch(`/api/costs?groupBy=${groupBy}`).then(json<ContentCostAggregate[]>),

  listPublishTargets: () => authFetch("/api/publish-targets").then(json<PublishTarget[]>),

  createPublishTarget: (input: { platform: string; name?: string; provider: string; url: string; token?: string; metricsSecret?: string }) =>
    authFetch("/api/publish-targets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<PublishTarget>;
    }),

  deletePublishTarget: (id: string) =>
    authFetch(`/api/publish-targets/${id}`, { method: "DELETE" }).then(json<{ ok: boolean }>),

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
    authFetch(`/api/graphs/${graphId}/triggers/${triggerId}`, { method: "DELETE" }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
    }),

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

  listMcp: () => authFetch("/api/mcp").then(json<{ operator: unknown[]; user: McpServerStatus[] }>),

  /** Connect or reconnect one of the user's own MCP servers. A failed handshake
   *  answers 502 with the reason in `error`, which is a result to show, not an
   *  exception — hence the manual response read instead of `json()`. */
  connectMcp: async (id: string): Promise<McpServerStatus> => {
    const res = await authFetch(`/api/mcp/${encodeURIComponent(id)}/connect`, { method: "POST" });
    return (await res.json()) as McpServerStatus;
  },

  saveSettings: (config: AppConfig) =>
    authFetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    }).then(json<{ ok: true; path: string }>),

  /** Platform-admin only: the built-in model catalog (design-model-catalog ④).
   *  A 403 is a normal answer for a non-admin, so the caller reads status
   *  rather than throwing — the panel hides itself on it. */
  getModelCatalog: async (): Promise<ModelCatalogView | null> => {
    const res = await authFetch("/api/admin/model-catalog");
    if (!res.ok) return null;
    return (await res.json()) as ModelCatalogView;
  },

  putModelCatalog: async (
    catalog: ModelCatalogOverlay,
  ): Promise<{ ok: true; view: ModelCatalogView; changes: ModelCatalogChange[]; affected: ModelCatalogImpact[]; affectedTruncated: boolean } | { ok: false; error: string }> => {
    const res = await authFetch("/api/admin/model-catalog", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(catalog),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    const body = (await res.json()) as Omit<ModelCatalogView, "changes"> & {
      changes: ModelCatalogChange[];
      affected: ModelCatalogImpact[];
      affectedTruncated: boolean;
    };
    const { changes = [], affected = [], affectedTruncated = false, ...view } = body;
    return { ok: true, view: view as ModelCatalogView, changes, affected, affectedTruncated };
  },

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

  getSubscription: () => authFetch("/api/subscription").then(json<SubscriptionStatus>),

  // M3 S6 A5 — Stripe Checkout / Billing Portal. Both return a hosted URL the
  // caller navigates to (full-page redirect). Same-origin return URLs are sent
  // so the SPA can read ?billing=… on the way back.
  createCheckoutSession: (plan: PlanId) =>
    billingPost<BillingSession>("/api/billing/checkout", {
      plan,
      seats: 1,
      success_url: `${window.location.origin}${billingReturnPath("success")}`,
      cancel_url: `${window.location.origin}${billingReturnPath("cancel")}`,
    }),
  createPortalSession: () =>
    billingPost<BillingSession>("/api/billing/portal", {
      return_url: `${window.location.origin}${billingReturnPath("manage-done")}`,
    }),

  getInvoices: () => authFetch("/api/invoices").then(json<{ invoices: Invoice[] }>),
  getInvoice: (id: string) => authFetch(`/api/invoices/${id}`).then(json<Invoice>),
  downloadInvoice: async (id: string) => {
    const res = await authFetch(`/api/invoices/${id}/download`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice_${id}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

