/** Billing route domain (audit P2-2 split from index.ts). */
import { billingRouter } from "../api.billing.js";
import { getOrCreateSubscription, currentUsage } from "../subscriptionService.js";
import { isPlanId, PLANS } from "../plans.js";
import { listInvoices, getInvoice } from "../invoiceService.js";
import { renderInvoiceHtml } from "../invoiceTemplate.js";
import { Hono } from "hono";
import type { RouteContext } from "./ctx.js";

export function registerBillingRoutes(
  app: Hono<{ Variables: { userId: string } }>,
  ctx: RouteContext,
): void {
  const { db, PUBLIC_URL } = ctx;

app.get("/api/subscription", async (c) => {
  const userId = c.get("userId");
  const [sub, usage, activeRuns] = await Promise.all([
    getOrCreateSubscription(db, userId),
    currentUsage(db, userId),
    db.activeRuns(userId),
  ]);
  const planId = isPlanId(sub.plan) ? sub.plan : "free";
  const quota = PLANS[planId];
  return c.json({
    plan: planId,
    status: sub.status,
    provider: sub.provider,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    usage: {
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      tokensNormalized: usage.normalizedTokens,
      tokensLimit: quota.tokens,
      runs: usage.runs,
      videoSegments: usage.videoSegments,
      videoLimit: quota.videoSegments,
      storageBytes: usage.storageBytes,
      storageLimit: quota.storageBytes,
      activeRuns,
      concurrentLimit: quota.concurrentRuns,
    },
  });
});

// --- M3 S2: invoices API (billing history) --------------------------------
app.get("/api/invoices", async (c) => {
  const userId = c.get("userId");
  const invoices = await listInvoices(db, userId);
  return c.json({ invoices });
});

app.get("/api/invoices/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const invoice = await getInvoice(db, id);
  if (!invoice) return c.json({ error: "not_found" }, 404);
  // Users can only see their own invoices
  if (invoice.userId !== userId) return c.json({ error: "forbidden" }, 403);
  return c.json(invoice);
});

app.get("/api/invoices/:id/download", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const invoice = await getInvoice(db, id);
  if (!invoice) return c.json({ error: "not_found" }, 404);
  if (invoice.userId !== userId) return c.json({ error: "forbidden" }, 403);
  const user = await db.findUserById(userId);
  const html = renderInvoiceHtml(invoice, user?.email);
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="invoice_${invoice.id}.html"`);
  return c.body(html);
});

// --- M3 S6: Stripe billing routes (checkout / portal / signature webhook) -
app.route("/api/billing", billingRouter(db, { publicUrl: PUBLIC_URL }));
}