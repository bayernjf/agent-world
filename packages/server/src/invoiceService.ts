/**
 * Invoice service — billing invoice generation, querying, and state management
 * (M3 S1, design-monetization-m3-implementation §S1).
 *
 * The driver only knows rows; this module owns the billing rules:
 *  - one invoice per (user, billing-period), idempotent generation
 *  - amount = plan monthly price (MVP; overage add-ons deferred to S6)
 *  - state machine: draft → open → paid | void
 *  - all state transitions audited (billing.invoice_*)
 *
 * All functions take `db` explicitly (dependency injection) so they are
 * trivially unit-testable with an in-memory driver.
 */
import { randomUUID } from "node:crypto";
import { PLAN_PRICES, isPlanId, type PlanId } from "@agent-world/core";
import { audit } from "./audit.js";
import { currentPeriodStart } from "./subscription.js";
import { currentPeriodEnd, getOrCreateSubscription, planOf } from "./subscriptionService.js";
import type { Db } from "./db.js";
import type { InvoiceRow } from "./sqlite-driver.js";

export type InvoiceStatus = "draft" | "open" | "paid" | "void";

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
  plan: PlanId;
  amountUsd: number;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  paidAt: number | null;
  paidMethod: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Map a raw snake_case row to the camelCase API type. */
export function invoiceFromRow(row: InvoiceRow): Invoice {
  let lineItems: InvoiceLineItem[] = [];
  try {
    lineItems = JSON.parse(row.line_items) as InvoiceLineItem[];
  } catch {
    lineItems = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    subscriptionId: row.subscription_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    plan: (isPlanId(row.plan) ? row.plan : "free") as PlanId,
    amountUsd: row.amount_usd,
    status: row.status as InvoiceStatus,
    lineItems,
    paidAt: row.paid_at,
    paidMethod: row.paid_method,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Generate an invoice for a user's billing period. Idempotent: if an invoice
 * already exists for (userId, periodStart), returns it without creating a new
 * one. Free-tier users get a $0 invoice (record-keeping, no payment needed).
 */
export async function generateInvoice(
  db: Db,
  userId: string,
  periodStart?: number,
): Promise<Invoice> {
  const ps = periodStart ?? currentPeriodStart();
  const existing = await db.findInvoiceByUserAndPeriod(userId, ps);
  if (existing) {
    return invoiceFromRow(existing);
  }

  const sub = await getOrCreateSubscription(db, userId);
  const plan = planOf(sub);
  const price = PLAN_PRICES[plan] ?? 0;
  const periodEnd = sub.currentPeriodEnd;

  const lineItems: InvoiceLineItem[] = [
    {
      description: `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan (monthly)`,
      quantity: 1,
      unitPrice: price,
      amount: price,
    },
  ];

  const now = Date.now();
  const row: InvoiceRow = {
    id: `inv_${randomUUID()}`,
    user_id: userId,
    subscription_id: userId,
    period_start: ps,
    period_end: periodEnd,
    plan,
    amount_usd: price,
    status: "open",
    line_items: JSON.stringify(lineItems),
    paid_at: null,
    paid_method: null,
    stripe_invoice_id: null,
    notes: null,
    created_at: now,
    updated_at: now,
  };

  await db.insertInvoice(row);
  audit(db, userId, "billing.invoice_created", {
    objectType: "invoice",
    objectId: row.id,
    detail: { plan, amountUsd: price, periodStart: ps },
  });

  return invoiceFromRow(row);
}

/**
 * Generate invoices for all users with an active subscription. Used by the
 * monthly cron or the admin "generate all" endpoint. Returns counts.
 */
export async function generateAllInvoices(db: Db, periodStart?: number): Promise<{ created: number; skipped: number }> {
  const ps = periodStart ?? currentPeriodStart();
  // Iterate all registered users (not just subscriptions) so free-tier users
  // also get a $0 invoice record. getOrCreateSubscription lazily lands them
  // on the free tier inside generateInvoice.
  const allUsers = await db.listUsers();
  let created = 0;
  let skipped = 0;
  for (const user of allUsers) {
    const existing = await db.findInvoiceByUserAndPeriod(user.id, ps);
    if (existing) {
      skipped++;
      continue;
    }
    await generateInvoice(db, user.id, ps);
    created++;
  }
  return { created, skipped };
}

/** List all invoices for a user, newest period first. */
export async function listInvoices(db: Db, userId: string): Promise<Invoice[]> {
  const rows = await db.listInvoicesByUser(userId);
  return rows.map(invoiceFromRow);
}

/** Get a single invoice by id. Returns null if not found. */
export async function getInvoice(db: Db, invoiceId: string): Promise<Invoice | null> {
  const row = await db.getInvoice(invoiceId);
  return row ? invoiceFromRow(row) : null;
}

/**
 * Mark an invoice as paid (manual payment path, S4). Writes audit log and
 * announces to the user. Throws if the invoice is already paid or void.
 */
export async function markInvoicePaid(
  db: Db,
  invoiceId: string,
  method: string,
  actorId: string,
  notes?: string,
  ip?: string,
): Promise<Invoice> {
  const existing = await db.getInvoice(invoiceId);
  if (!existing) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }
  if (existing.status === "paid") {
    throw new Error(`Invoice already paid: ${invoiceId}`);
  }
  if (existing.status === "void") {
    throw new Error(`Cannot pay a void invoice: ${invoiceId}`);
  }

  const now = Date.now();
  await db.updateInvoiceStatus(invoiceId, "paid", now, method, notes ?? null);

  audit(db, actorId, "billing.invoice_paid", {
    objectType: "invoice",
    objectId: invoiceId,
    detail: { method, amountUsd: existing.amount_usd, notes: notes ?? null },
    ip,
  });

  const updated = await db.getInvoice(invoiceId);
  if (!updated) throw new Error(`Invoice disappeared after update: ${invoiceId}`);
  return invoiceFromRow(updated);
}

/**
 * Void an invoice (cancel before payment). Writes audit log. Throws if the
 * invoice is already paid (paid invoices cannot be voided; issue a refund
 * instead — deferred).
 */
export async function voidInvoice(
  db: Db,
  invoiceId: string,
  actorId: string,
  reason?: string,
  ip?: string,
): Promise<Invoice> {
  const existing = await db.getInvoice(invoiceId);
  if (!existing) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }
  if (existing.status === "paid") {
    throw new Error(`Cannot void a paid invoice: ${invoiceId} (issue a refund instead)`);
  }
  if (existing.status === "void") {
    return invoiceFromRow(existing);
  }

  await db.updateInvoiceStatus(invoiceId, "void", null, null, reason ?? existing.notes);

  audit(db, actorId, "billing.invoice_voided", {
    objectType: "invoice",
    objectId: invoiceId,
    detail: { reason: reason ?? null, amountUsd: existing.amount_usd },
    ip,
  });

  const updated = await db.getInvoice(invoiceId);
  if (!updated) throw new Error(`Invoice disappeared after update: ${invoiceId}`);
  return invoiceFromRow(updated);
}
