/** Billing, metering and durable remote-job half of the shared driver body
 * (audit P2 follow-up split out of driver-body.ts). Subscriptions mirror
 * Stripe, the usage ledger and invoices are local records, and remote_jobs are
 * the G4 durable handles — all of it changes for commercial reasons, not for
 * account/graph reasons, so it lives on its own file. */
import { EVENT_SCHEMA_VERSION, type RunEvent } from "@agent-world/core";
import { openDocString } from "./at-rest.js";
import type { InvoiceRow } from "./sqlite-schema.js";
import type { Executor } from "./sqlite-driver.js";
import type { createStatements } from "./driver-statements.js";
import type { NewRemoteJob, RemoteJob } from "./db.js";

  // M3 S6: subscription rows carry Stripe mirror columns (local DB is a mirror
  // of Stripe, the billing system of record). One mapper keeps the camelCase
  // API shape identical across load/list/find callers.
  type SubscriptionRow = {
    user_id?: string;
    plan: string;
    status: string;
    provider: string | null;
    external_id: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    stripe_price_id: string | null;
    current_period_start: number;
    current_period_end: number;
  };

  const mapSubscriptionRow = (r: SubscriptionRow) => ({
    plan: r.plan,
    status: r.status,
    provider: r.provider,
    externalId: r.external_id,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    stripePriceId: r.stripe_price_id,
    currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end,
  });
  // G4 remote_jobs snake_case row -> camelCase RemoteJob (meta_json is plain JSON).
  type RemoteJobRow = {
    id: string;
    user_id: string;
    run_id: string;
    graph_id: string;
    node_id: string;
    attempt: number;
    kind: string;
    provider: string | null;
    remote_job_id: string;
    state: string;
    submitted_at: number;
    last_polled_at: number | null;
    finished_at: number | null;
    error_code: string | null;
    meta_json: string | null;
  };
  const mapRemoteJob = (r: RemoteJobRow): RemoteJob => ({
    id: r.id,
    userId: r.user_id,
    runId: r.run_id,
    graphId: r.graph_id,
    nodeId: r.node_id,
    attempt: r.attempt,
    kind: r.kind as RemoteJob["kind"],
    provider: r.provider,
    remoteJobId: r.remote_job_id,
    state: r.state as RemoteJob["state"],
    submittedAt: r.submitted_at,
    lastPolledAt: r.last_polled_at,
    finishedAt: r.finished_at,
    errorCode: r.error_code,
    meta: r.meta_json ? (JSON.parse(r.meta_json) as Record<string, unknown>) : null,
  });

export function createBillingMethods(
  exec: Executor,
  stmts: ReturnType<typeof createStatements>,
) {
  return {
    // ---- Monetization (design-monetization §5): subscription + usage ledger ----
    async loadSubscription(userId: string):
      Promise<ReturnType<typeof mapSubscriptionRow> | undefined> {
      const row = await exec.get(stmts.getSubscription, [userId]) as SubscriptionRow | undefined;
      return row ? mapSubscriptionRow(row) : undefined;
    },
    async listAllSubscriptions(): Promise<
      Array<{ userId: string } & ReturnType<typeof mapSubscriptionRow>>
    > {
      const rows = await exec.all(stmts.listAllSubscriptions, []) as SubscriptionRow[];
      return rows.map((r) => ({ userId: r.user_id!, ...mapSubscriptionRow(r) }));
    },
    /** M3 S6: resolve a local subscription from its Stripe customer id (webhook path). */
    async findSubscriptionByStripeCustomer(customerId: string):
      Promise<({ userId: string } & ReturnType<typeof mapSubscriptionRow>) | undefined> {
      const row = await exec.get(stmts.findSubscriptionByStripeCustomer, [customerId]) as SubscriptionRow | undefined;
      return row ? { userId: row.user_id!, ...mapSubscriptionRow(row) } : undefined;
    },
    /** M3 S6: resolve a local subscription from its Stripe subscription id (webhook path). */
    async findSubscriptionByStripeSubscription(stripeSubscriptionId: string):
      Promise<({ userId: string } & ReturnType<typeof mapSubscriptionRow>) | undefined> {
      const row = await exec.get(stmts.findSubscriptionByStripeSubscription, [stripeSubscriptionId]) as SubscriptionRow | undefined;
      return row ? { userId: row.user_id!, ...mapSubscriptionRow(row) } : undefined;
    },
    async saveSubscription(
      userId: string,
      plan: string,
      status: string,
      opts: {
        provider?: string;
        externalId?: string;
        stripeCustomerId?: string;
        stripeSubscriptionId?: string;
        stripePriceId?: string;
        periodStart?: number;
        periodEnd?: number;
      } = {},
    ) {
      const now = Date.now();
      const periodStart = opts.periodStart ?? now;
      const periodEnd = opts.periodEnd ?? now + 30 * 24 * 60 * 60 * 1000;
      await exec.run(stmts.upsertSubscription, [
        userId, plan, status,
        opts.provider ?? null, opts.externalId ?? null,
        opts.stripeCustomerId ?? null, opts.stripeSubscriptionId ?? null, opts.stripePriceId ?? null,
        periodStart, periodEnd, now, now,
      ]);
    },
    async usageFor(userId: string, metric: string, periodStart: number): Promise<number> {
      return (await exec.get(stmts.usageForMetric, [userId, periodStart, metric]) as { total: number }).total;
    },
    async accumulateUsage(userId: string, periodStart: number, metric: string, amount: number) {
      await exec.run(stmts.accumulateUsage, [userId, periodStart, metric, amount, Date.now()]);
    },
    async activeRuns(userId: string): Promise<number> {
      return (await exec.get(stmts.countActiveRuns, [userId]) as { n: number }).n;
    },
    /**
     * Auto-scrap halted runs that exceeded `cutoffMs` without a human decision.
     * Event-stream-consistent: appends a `run.finished(failed)` event per run
     * (replaying it yields the same terminal state), then flips the row to
     * failed while preserving `halted_node_id`/`halted_reason` for audit.
     * Returns how many runs were scrapped.
     */
    async scrapStaleHaltedRuns(userId: string, cutoffMs: number): Promise<number> {
      const stale = await exec.all(stmts.listStaleHaltedRuns, [userId, cutoffMs]) as Array<{ id: string; ended_at: number }>;
      if (stale.length === 0) return 0;
      let scrapped = 0;
      const now = Date.now();
      for (const run of stale) {
        const { seq } = await exec.get(stmts.maxSeq, [run.id]) as { seq: number };
        const event: RunEvent = {
          type: "run.finished",
          runId: run.id,
          status: "failed",
          reason: "Scrapped: halted run exceeded TTL without a human decision",
          seq: seq + 1,
          ts: now,
        };
        await exec.run(stmts.insertEvent, [run.id, event.seq, now, EVENT_SCHEMA_VERSION, event.type, JSON.stringify(event)]);
        await exec.run(stmts.scrapStaleHaltedRun, [now, run.id, userId]);
        scrapped += 1;
      }
      return scrapped;
    },
    /** Idempotent usage overwrite (backfill path); accumulateUsage is the online path. */
    async setUsage(userId: string, periodStart: number, metric: string, amount: number) {
      await exec.run(stmts.setUsage, [userId, periodStart, metric, amount, Date.now()]);
    },
    async listUsageLedger(periodStart: number): Promise<Array<{ userId: string; periodStart: number; metric: string; amount: number }>> {
      const rows = await exec.all(stmts.listUsageLedger, [periodStart]) as Array<{ user_id: string; period_start: number; metric: string; amount: number }>;
      return rows.map((r) => ({ userId: r.user_id, periodStart: r.period_start, metric: r.metric, amount: r.amount }));
    },
    // M3 billing invoices (design-monetization-m3 S1).
    async getInvoice(invoiceId: string): Promise<InvoiceRow | undefined> {
      const row = await exec.get(stmts.getInvoice, [invoiceId]) as InvoiceRow | undefined;
      return row;
    },
    async listInvoicesByUser(userId: string): Promise<InvoiceRow[]> {
      const rows = await exec.all(stmts.listInvoicesByUser, [userId]) as unknown as InvoiceRow[];
      return rows;
    },
    async findInvoiceByUserAndPeriod(userId: string, periodStart: number): Promise<InvoiceRow | undefined> {
      const row = await exec.get(stmts.findInvoiceByUserAndPeriod, [userId, periodStart]) as InvoiceRow | undefined;
      return row;
    },
    /** M3 S6: resolve a local invoice from its Stripe invoice id (invoice.paid webhook). */
    async findInvoiceByStripeInvoice(stripeInvoiceId: string): Promise<InvoiceRow | undefined> {
      const row = await exec.get(stmts.findInvoiceByStripeInvoice, [stripeInvoiceId]) as InvoiceRow | undefined;
      return row;
    },
    async insertInvoice(inv: InvoiceRow): Promise<void> {
      await exec.run(stmts.insertInvoice, [
        inv.id, inv.user_id, inv.subscription_id, inv.period_start, inv.period_end,
        inv.plan, inv.amount_usd, inv.status, inv.line_items, inv.paid_at ?? null,
        inv.paid_method ?? null, inv.stripe_invoice_id ?? null, inv.notes ?? null,
        inv.created_at, inv.updated_at,
      ]);
    },
    async updateInvoiceStatus(invoiceId: string, status: string, paidAt: number | null, paidMethod: string | null, notes: string | null): Promise<void> {
      await exec.run(stmts.updateInvoiceStatus, [status, paidAt, paidMethod, notes, Date.now(), invoiceId]);
    },
    // --- G4 long-running remote jobs (design-step-trace-and-robustness §3.5) ---
    /** Record a newly submitted provider job. Idempotent on (provider, remote_job_id):
     *  a redelivered submit is ignored. Rows with a NULL provider do not dedupe
     *  (SQLite/PG treat NULLs as distinct), which is intended. */
    async insertRemoteJob(job: NewRemoteJob): Promise<void> {
      await exec.run(stmts.insertRemoteJob, [
        job.id, job.userId, job.runId, job.graphId, job.nodeId, job.attempt,
        job.kind, job.provider, job.remoteJobId,
        job.state ?? "submitted", job.submittedAt ?? Date.now(),
        job.meta ? JSON.stringify(job.meta) : null,
      ]);
    },
    /** The still-open (submitted/running) job for a node attempt, newest first, so
     *  a resume/reattach never re-submits. Null when no open job exists. */
    async getOpenRemoteJob(runId: string, nodeId: string, attempt: number): Promise<RemoteJob | null> {
      const row = await exec.get(stmts.getOpenRemoteJob, [runId, nodeId, attempt]) as RemoteJobRow | undefined;
      return row ? mapRemoteJob(row) : null;
    },
    /** Advance state and stamp last_polled_at while polling (e.g. submitted->running). */
    async touchRemoteJob(id: string, state: RemoteJob["state"], lastPolledAt?: number): Promise<void> {
      await exec.run(stmts.touchRemoteJob, [state, lastPolledAt ?? Date.now(), id]);
    },
    /** Move a job to a terminal state (succeeded/failed/lost), stamping finished_at. */
    async finishRemoteJob(id: string, state: "succeeded" | "failed" | "lost", errorCode?: string | null): Promise<void> {
      await exec.run(stmts.finishRemoteJob, [state, Date.now(), errorCode ?? null, id]);
    },
    /** G4 admin/ops listing across users. Open jobs (submitted/running) are
     *  returned oldest-first by default so stuck in-flight renders surface
     *  first; pass openOnly:false for the most recent jobs in any state. Limit
     *  is clamped to [1,500]. Inherited unchanged by the PG driver. */
    async listRemoteJobs(
      limit: number,
      opts: { openOnly?: boolean } = {},
    ): Promise<RemoteJob[]> {
      const truncated = Number.isFinite(limit) ? Math.trunc(limit) : 100;
      const bounded = Math.min(Math.max(truncated, 1), 500);
      const rows = (await exec.all(
        opts.openOnly === false ? stmts.listAllRemoteJobs : stmts.listOpenRemoteJobs,
        [bounded],
      )) as RemoteJobRow[];
      return rows.map(mapRemoteJob);
    },
    /**
     * Count distinct given nodes that finished successfully within a run.
     * Used for video-segment metering: one successful videoGen node = one segment
     * (retries share the node id, so DISTINCT avoids counting attempts).
     */
    async countDoneNodes(runId: string, nodeIds: string[]): Promise<number> {
      if (nodeIds.length === 0) return 0;
      const placeholders = nodeIds.map(() => "?").join(",");
      const row = await exec.get(
        `SELECT COUNT(DISTINCT node_id) AS n FROM node_runs WHERE run_id = ? AND status = 'done' AND node_id IN (${placeholders})`,
        [runId, ...nodeIds],
      ) as { n: number };
      return row.n;
    },
    /** Live storage usage snapshot: total artifact bytes owned by a user. */
    async sumArtifactBytes(userId: string): Promise<number> {
      return (await exec.get(stmts.sumArtifactBytes, [userId]) as { total: number }).total;
    },
    /** Finished runs since an epoch (snapshot included for video-node detection), for backfill. */
    async listFinishedRunsSince(since: number): Promise<Array<{ id: string; userId: string; startedAt: number; snapshot: string }>> {
      const rows = await exec.all(stmts.listFinishedRunsSince, [since]) as Array<{ id: string; user_id: string; started_at: number; snapshot: string }>;
      return rows.map((r) => ({ id: r.id, userId: r.user_id, startedAt: r.started_at, snapshot: openDocString(r.snapshot) }));
    },
  };
}
