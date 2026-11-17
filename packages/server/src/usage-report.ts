import { log } from "./logger.js";
import { currentUsageDimensions, type UsageDimensions } from "./usage-context.js";

/**
 * Usage reporting to model-hub (Tier0 org M3 F3.2, step a1).
 *
 * agent-world pulls its hub models through the model-kit projection but calls
 * the gateway with its own key directly, so before this module every model
 * call it made was invisible to the hub ledger: the org cost page could not
 * see the execution arm's spend at all. This reporter posts one row per
 * successful call, mirroring the hub's strict `UsageReportSchema`.
 *
 * Two fields make the row usable:
 * - `assignment_id` lets the hub price the call against the assignment's
 *   model card (without it the ledger keeps tokens but `cost_micros` stays
 *   null);
 * - non-token modalities send `quantity` in the unit the hub bills (images →
 *   count, video → seconds, audio → kilo-characters).
 *
 * Reporting is fire-and-forget: a failed report is logged, never thrown, so a
 * hub outage cannot fail a run.
 */

/** Fallback project label; the token itself is authoritative on the hub. */
const DEFAULT_PROJECT = "agent-world";

/** Same shape the hub validates for `assignment_id`. */
const ASSIGNMENT_ID = /^asn_[a-zA-Z0-9_]+$/;

export interface ModelUsageReport {
  /** Call-site label, e.g. `textgen` / `judge` / `image` / `video` / `audio`. */
  feature: string;
  /** Provider key the call actually went to (e.g. `hub-ark`). */
  provider: string;
  model: string;
  /** Hub assignment id (`asn_...`) when the provider came from the projection. */
  assignmentId?: string | undefined;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  cachedTokens?: number | undefined;
  reasoningTokens?: number | undefined;
  /** Billable units already normalized for the hub (see module doc). */
  quantity?: number | undefined;
  billingSource?: "builtin" | "byok" | undefined;
  /** Set for non-2xx terminals; successful calls leave it at 200. */
  httpStatus?: number | undefined;
}

export interface UsageReportDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Override the per-run org attribution; defaults to the async context. */
  usageDimensions?: UsageDimensions | undefined;
}

/** Reporting is on only when both the hub URL and token are configured. */
export function hubUsageReportingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.MODEL_HUB_URL ?? "").trim() && (env.MODEL_HUB_TOKEN ?? "").trim());
}

/**
 * Build the hub request body. Exported for tests so the wire shape can be
 * asserted against the hub schema without intercepting fetch.
 */
export function buildUsageReportBody(
  input: ModelUsageReport,
  env: NodeJS.ProcessEnv = process.env,
  dimensions: UsageDimensions | undefined = undefined,
): Record<string, unknown> {
  const assignmentId =
    input.assignmentId && ASSIGNMENT_ID.test(input.assignmentId) ? input.assignmentId : null;
  return {
    project: (env.MODEL_HUB_PROJECT ?? "").trim() || DEFAULT_PROJECT,
    feature: input.feature,
    billing_source: input.billingSource ?? "builtin",
    provider: input.provider,
    model: input.model,
    assignment_id: assignmentId,
    input_tokens: input.tokensIn ?? 0,
    output_tokens: input.tokensOut ?? 0,
    cache_read_tokens: input.cachedTokens ?? 0,
    reasoning_tokens: input.reasoningTokens ?? null,
    // Omit rather than send undefined: the hub schema is .strict() and
    // treats absent and null alike for the optional org/quantity fields.
    ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    ...(dimensions?.positionId ? { position_id: dimensions.positionId } : {}),
    ...(dimensions?.departmentId ? { department_id: dimensions.departmentId } : {}),
    ...(dimensions?.taskId ? { task_id: dimensions.taskId } : {}),
    http_status: input.httpStatus ?? 200,
    cached: false,
    ts: new Date().toISOString(),
  };
}

/** Post one usage row; never throws into the caller. */
export function reportModelUsage(input: ModelUsageReport, deps: UsageReportDeps = {}): void {
  const env = deps.env ?? process.env;
  const base = (env.MODEL_HUB_URL ?? "").trim().replace(/\/+$/, "");
  const token = (env.MODEL_HUB_TOKEN ?? "").trim();
  if (!base || !token) return;

  const dimensions =
    "usageDimensions" in deps ? deps.usageDimensions : currentUsageDimensions();
  const body = buildUsageReportBody(input, env, dimensions);
  const f = deps.fetchImpl ?? fetch;
  try {
    void f(`${base}/pub/v1/usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) {
          log.warn("hub usage report rejected", {
            feature: input.feature,
            model: input.model,
            status: res.status,
          });
        }
      })
      .catch((err: unknown) => {
        log.warn("hub usage report failed", {
          feature: input.feature,
          model: input.model,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  } catch (err) {
    // A synchronous throw (e.g. an injected fetch that rejects eagerly) still
    // must not surface into the run.
    log.warn("hub usage report failed", {
      feature: input.feature,
      model: input.model,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
