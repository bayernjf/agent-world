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

export type { TriggerConfig } from "@agent-world/core";
import type { Skill } from "@agent-world/core";
import i18n from "../../i18n";
import { billingReturnPath } from "../billingReturn";
import { useSession } from "../../store/session";

/**
 * When a demo account hits a locked capability (403 DEMO_LOCKED) or exhausts
 * its quota (402 DEMO_QUOTA_*), surface the global claim dialog once instead
 * of leaving the user with a raw error toast. Best-effort: never throws.
 */
export function maybeOpenDemoClaim(status: number, text: string): void {
  if (status !== 402 && status !== 403) return;
  try {
    const body = JSON.parse(text) as { code?: string; error?: string };
    if (body.code === "DEMO_LOCKED" || body.error === "demo_forbidden") {
      useSession.getState().openClaim("locked");
    } else if (typeof body.code === "string" && body.code.startsWith("DEMO_QUOTA")) {
      useSession.getState().openClaim("quota");
    }
  } catch {
    /* non-JSON body → nothing to do */
  }
}

export async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    maybeOpenDemoClaim(res.status, text);
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export function authFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: "include" });
}

/**
 * POST a billing endpoint and surface the server's `{error,message}` as a
 * BillingApiError (status + code) so callers can branch on not-configured /
 * no-customer / price-missing instead of parsing status-text strings.
 */
export async function billingPost<T>(path: string, body: unknown): Promise<T> {
  const res = await authFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code = "billing_error";
    let message = `billing request failed: ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: string; message?: string; code?: string };
      if (errBody?.error) code = errBody.error;
      if (errBody?.message) message = errBody.message;
      if (errBody?.code === "DEMO_LOCKED" || errBody?.error === "demo_forbidden") {
        useSession.getState().openClaim("locked");
      }
    } catch {
      /* non-JSON error body keeps the generic code/message */
    }
    throw new BillingApiError(res.status, code, message);
  }
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
      endpoints?: Partial<Record<Modality, string>>;
      source?: "builtin" | "custom";
    }
  >;
  defaultModel: string;
  defaultProvider: string;
  modelOrder?: string[];
  monthlyBudgetUsd?: number | null;
  /** User-level web search service for `search` nodes (node config wins, env is last).
   *  Credentials are bound per provider so switching the active backend never
   *  re-assigns or loses another source's key; the flat fields are legacy. */
  searchConfig?: {
    provider?: string;
    tavily?: { apiKey?: string };
    serpapi?: { apiKey?: string };
    google?: { apiKey?: string; cx?: string };
    apiKey?: string;
    cx?: string;
  };
  /** Remote MCP servers the user connected. Header values arrive redacted; the
   *  server treats a masked value echoed back as "unchanged". */
  mcpServers?: UserMcpServer[];
  /** Data-only skill cards the user authored. */
  skillCards?: UserSkillCard[];
}

export interface UserMcpServer {
  id: string;
  name?: string;
  transport: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface McpServerStatus {
  id: string;
  name?: string;
  transport: "http" | "sse";
  url: string;
  connected: boolean;
  toolCount: number;
  toolNames: string[];
  error?: string;
  connectedAt?: number;
}

/** A user-authored card. Only the three data kinds exist: their payload IS the
 *  data, so nothing executes. `tool` kind would run code and is server-refused. */
export type UserSkillCard =
  | { id: string; name: string; description?: string; kind: "prompt-module"; prompt: string }
  | { id: string; name: string; description?: string; kind: "judge"; criterion: string }
  | {
      id: string;
      name: string;
      description?: string;
      kind: "output-contract";
      fields: { name: string; type: "string" | "number" | "boolean" | "object" | "array"; required: boolean }[];
    };

export type UserSkillCardKind = UserSkillCard["kind"];

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
  byModel: Array<{
    model: string;
    calls: number;
    runs: number;
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
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
  /** Models whose price card is blank or partial — their cost above is too low. */
  unpricedModels: Array<{
    provider: string;
    model: string;
    modality: string;
    level: "none" | "partial";
    missing: string[];
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

/** GET /api/runs/:id/timeline — run metadata plus the step-level trace (G1). */
export interface RunTimelineResponse {
  run: {
    id: string;
    graphId: string;
    status: string;
    trigger: string;
    startedAt: number;
    endedAt: number | null;
    budgetUsd: number | null;
    haltedNodeId: string | null;
    haltedReason: string | null;
    /** Starting input the run was seeded with (G5.1 prompt-compare sampling). */
    input: string;
  };
  /** nodeId → name/kind resolved from the run snapshot (best-effort). */
  nodeMeta: Record<string, { name: string | null; kind: string | null }>;
  timeline: RunTimeline;
}

/** GET /api/runs/:id/nodes/:nodeId/attempt/:attempt/output — full node output (G1). */
export interface RunNodeOutputResponse {
  nodeId: string;
  attempt: number;
  variant: string;
  output: string;
}

/** A run parked on a human decision, across every pipeline (F2 review queue). */
export interface PendingReview {
  runId: string;
  graphId: string;
  graphName: string;
  /** Null only for runs whose log predates halt recording. */
  nodeId: string | null;
  nodeName: string | null;
  kind: "human" | "tool" | "gate" | "degraded";
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

/**
 * G5.2: projection of the nearest downstream quality gate's final verdict for
 * an A/B arm. `null` gate on the arm means no gate exists downstream; a gate
 * with `passed === null` means the gate ran but produced no verdict yet.
 */
export interface GateVerdictProjection {
  gateNodeId: string;
  passed: boolean | null;
  score: number | null;
  reason: string | null;
  minScore: number | null;
  meetsBar: boolean | null;
  /** A content-mutating node sits between the target and the gate. */
  mutatesInBetween: boolean;
  history: Array<{ attempt: number; passed: boolean; score: number | null; reason: string }>;
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
  gate: GateVerdictProjection | null;
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

export interface Collaborator {
  userId: string;
  email: string | null;
  role: string;
  createdAt: number;
}

/** An account row in the owner's admin panel (design-rbac P3). */
export interface AdminUser {
  id: string;
  email: string;
  role: "owner" | "admin" | "user";
  createdAt: string;
}

/** One security audit row (design-rbac P3). email is null for unknown actors. */
export interface AuditItem {
  id: string;
  user_id: string;
  email: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  detail: string | null;
  ip: string | null;
  created_at: number;
}

/** One user feedback row (design-feedback). context is the whitelisted JSON. */
export interface FeedbackItem {
  id: string;
  user_id: string;
  email: string | null;
  message: string;
  category: "bug" | "feature" | "ux" | "other";
  context: string;
  has_attachment: number;
  status: "open" | "acknowledged" | "closed";
  created_at: number;
}

/** Client-collected diagnostics, whitelisted server-side (design-feedback §3.2). */
export interface FeedbackContext {
  route: string;
  userAgent: string;
  locale: string;
  lastRunId?: string;
  lastError?: { message: string; lineno: number };
}

export type FeedbackCategory = FeedbackItem["category"];
export type FeedbackStatus = FeedbackItem["status"];

/** Announcement payload for the feedback → announcement merge (design-feedback P3). */
export interface FeedbackAnnouncement {
  titleZh: string;
  titleEn: string;
  bodyZh?: string | null;
  bodyEn?: string | null;
  level: "info" | "warning" | "critical";
  startsAt?: number;
  endsAt?: number | null;
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

/** A reusable product row from the F4 product library. */
export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number | null;
  attributes: Record<string, unknown>;
  images: string[];
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

/** A reusable brand material (logo/image/snippet/guideline). */
export interface BrandAsset {
  id: string;
  type: string;
  label: string;
  uri: string;
  tags: string[];
  createdAt: number;
}

/** A batch run job (F5). */
export interface BatchJob {
  id: string;
  graphId: string;
  status: "pending" | "running" | "done" | "partial" | "failed" | "cancelled";
  total: number;
  succeeded: number;
  failed: number;
  sourceName: string | null;
  createdAt: number;
  finishedAt: number | null;
  items?: BatchItem[];
}

/** One row of a batch job (F5). */
export interface BatchItem {
  id: string;
  batchId: string;
  rowIndex: number;
  input: Record<string, unknown>;
  runId: string | null;
  status: "pending" | "running" | "done" | "failed";
  outputSummary: string | null;
  artifactIds: string[];
  error: string | null;
}

/** A scheduled content item on the F8 calendar. */
export interface ContentPlan {
  id: string;
  graphId: string | null;
  runId: string | null;
  artifactId: string | null;
  platform: string | null;
  title: string;
  scheduledAt: number;
  status: "draft" | "pending_review" | "scheduled" | "published" | "failed";
  publishedUrl: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

/** One performance metric row (F6). */
export interface ContentMetric {
  id: string;
  graphId: string | null;
  runId: string | null;
  nodeId: string | null;
  variant: string | null;
  artifactId: string | null;
  productId: string | null;
  platform: string | null;
  externalContentId: string | null;
  impressions: number;
  clicks: number;
  conversions: number;
  gmv: number;
  adSpend: number;
  recordedAt: number;
}

/** Aggregated performance bucket. */
export interface PerformanceAggregate {
  group: string;
  impressions: number;
  clicks: number;
  conversions: number;
  gmv: number;
  adSpend: number;
}

/** A content-level cost snapshot (F9). */
export interface ContentCost {
  id: string;
  artifactId: string | null;
  productId: string | null;
  platform: string | null;
  variant: string | null;
  costUsd: number;
  gmv: number;
  roi: number;
  capturedAt: number;
}

/** Content-level cost/GMV/ROI aggregate bucket. */
export interface ContentCostAggregate {
  group: string;
  costUsd: number;
  gmv: number;
  roi: number;
}

/** An open-channel publish target (F7-B). */
export interface PublishTarget {
  id: string;
  platform: string;
  name: string | null;
  provider: string;
  config?: { url?: string; token?: string; metricsSecret?: string };
}

/** Per-graph run rollup for the operations dashboard (RTS phase A). */
export interface OperationsGraphSummary {
  graphId: string;
  graphName: string | null;
  /** RTS stage-B B3: resolved template category ("自定义" when not from a template). */
  category?: string;
  /** RTS stage-B B3: halted runs awaiting human review (badge count). */
  pendingReview?: number;
  /** RTS stage-B B1: manual macro-park override (null = frontend auto-layout). */
  parkX?: number | null;
  parkZ?: number | null;
  totalRuns: number;
  running: number;
  halted: number;
  done: number;
  failed: number;
  tripped: number;
  cancelled: number;
  lastRunId: string | null;
  lastStatus: string | null;
  lastStartedAt: number | null;
  lastEndedAt: number | null;
  costUsd: number;
  /** RTS stage-C C6: F6 effect metrics (all zero when nothing recorded). */
  metrics?: ParkGraphMetrics;
}

/** F6 effect metrics for one park factory (RTS stage-C C6). */
export interface ParkGraphMetrics {
  impressions: number;
  clicks: number;
  conversions: number;
  gmv: number;
  adSpend: number;
}

/** Cross-graph totals of the operations overview. */
export interface OperationsTotals {
  totalRuns: number;
  running: number;
  halted: number;
  done: number;
  failed: number;
  tripped: number;
  cancelled: number;
  costUsd: number;
  /** RTS stage-C C4: current calendar-month spend/tokens and the global cap. */
  monthCostUsd: number;
  tokensIn: number;
  tokensOut: number;
  monthlyBudgetUsd: number | null;
}

/**
 * A material-flow edge between two factories at L0 park scale (RTS stage C1).
 * Direction = goods flow: fromGraphId produces, toGraphId consumes.
 */
export interface CrossGraphEdge {
  fromGraphId: string;
  toGraphId: string;
  via: "subprocess" | "event";
  /** Subprocess node id (via subprocess) or trigger id (via event). */
  refId: string;
}

/** GET /api/operations/overview response (RTS phase A2, crossEdges in stage C1). */
export interface OperationsOverview {
  generatedAt: number;
  since: number | null;
  totals: OperationsTotals;
  graphs: OperationsGraphSummary[];
  nextRuns: Record<string, Record<string, number | null>>;
  /** RTS stage-C C1: edges between the caller's visible factories. */
  crossEdges?: CrossGraphEdge[];
  /** RTS stage-C C5: scheduled content within the next 48h for the schedule axis. */
  plans?: ContentPlan[];
  /** RTS stage-C C5/C7: per-graph cron summary (existence / enabled / next active fire). */
  cronState?: Record<string, { hasCron: boolean; enabled: boolean; nextAt: number | null }>;
}

export interface SubscriptionUsage {
  tokensIn: number;
  tokensOut: number;
  tokensNormalized: number;
  tokensLimit: number;
  runs: number;
  videoSegments: number;
  videoLimit: number;
  storageBytes: number;
  storageLimit: number;
  activeRuns: number;
  concurrentLimit: number;
}

export interface SubscriptionStatus {
  plan: "free" | "starter" | "pro" | "team";
  status: string;
  provider: string | null;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  usage: SubscriptionUsage;
}

/** A Stripe-hosted Checkout/Billing Portal session (M3 S6 A5). */
export interface BillingSession {
  id: string;
  url: string;
}

/**
 * Billing endpoint failure carrying the server's machine-readable code so the
 * UI can branch (e.g. 503 stripe_not_configured → fall back to manual contact).
 */
export class BillingApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BillingApiError";
  }
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface Invoice {
  id: string;
  userId: string;
  subscriptionId: string;
  periodStart: number;
  periodEnd: number;
  plan: "free" | "starter" | "pro" | "team";
  amountUsd: number;
  status: "draft" | "open" | "paid" | "void";
  lineItems: InvoiceLineItem[];
  paidAt: number | null;
  paidMethod: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

/** One built-in tier as the catalog endpoint describes it: the editable fields
 *  plus `hasKey`, and never a credential or endpoint value. */
export interface CatalogProviderView {
  type: string;
  models: string[];
  modalities: Record<string, Modality>;
  pricing: Record<string, ModelPricing>;
  enabled: boolean;
  hasKey: boolean;
}

/** What an operator may send: exactly the four overridable fields per provider. */
export interface ModelCatalogOverlay {
  [provider: string]: {
    models?: string[];
    modalities?: Record<string, Modality>;
    pricing?: Record<string, ModelPricing>;
    enabled?: boolean;
  };
}

export interface ModelCatalogView {
  providers: Record<string, CatalogProviderView>;
  overlay: ModelCatalogOverlay;
  code: Record<string, CatalogProviderView>;
  gaps: Array<{ provider: string; model: string; modality: Modality; level: string; missing: string[] }>;
}

export interface ModelCatalogChange {
  provider: string;
  added: string[];
  removed: string[];
  modalityEdited: string[];
  priceEdited: string[];
  enabledChanged: boolean;
}

export interface ModelCatalogImpact {
  graphId: string;
  graphName: string;
  models: string[];
  nodes: string[];
}

