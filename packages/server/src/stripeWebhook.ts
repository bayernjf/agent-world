/**
 * Stripe webhook → local DB mirror (M3 S6 Step 3;
 * docs/design-monetization-m3-s6-stripe.md §3.4/§4).
 *
 * Stripe is the billing system of record: every local subscription/invoice
 * change here is a mirror of a verified Stripe event. This module is pure
 * orchestration over the driver (no HTTP, no SDK signature verification —
 * those live in stripe.ts / api.billing.ts), so every event path is
 * unit-testable with a temporary database and a hand-built event.
 *
 * Field paths target the pinned Stripe API (2026-08-26.dahlia): a
 * subscription's period/price live on its first item, an invoice line's price
 * lives on pricing.price_details, and an Invoice carries no top-level
 * subscription reference — the local user/subscription is resolved via the
 * Stripe customer (checkout.session.completed mirrors it first).
 *
 * Handled events:
 *   checkout.session.completed      → open the local subscription mirror
 *   invoice.paid                    → keep subscription active + mirror a paid invoice
 *   invoice.payment_failed          → mark subscription past_due
 *   customer.subscription.updated   → sync plan/status/period/stripe ids
 *   customer.subscription.deleted   → mark canceled (service stops only at period end)
 *
 * Idempotency: each Stripe event id is applied at most once. We check before
 * applying and only mark after a successful write, so a crash mid-handler lets
 * Stripe's redelivery re-run safely; the upserts/find-or-create are idempotent
 * as a second line of defence.
 */
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { isPlanId, type PlanId } from "@agent-world/core";
import type { Db } from "./db.js";
import type { InvoiceRow } from "./sqlite-driver.js";
import { isPaidPlan, PAID_PLANS, type PaidPlan, type StripeConfig } from "./stripe.js";

/** Reserved idempotency-key namespace (never a real user UUID). */
export const STRIPE_WEBHOOK_NS = "#stripe-webhook";

type LocalSubStatus = "active" | "past_due" | "canceled";

export interface WebhookOutcome {
  /** False for event types this handler intentionally does not handle. */
  handled: boolean;
  /** True for a redelivered event already applied. */
  duplicate: boolean;
  action:
    | "ignored"
    | "duplicate"
    | "checkout_completed"
    | "invoice_paid"
    | "invoice_failed"
    | "subscription_updated"
    | "subscription_deleted";
  userId?: string;
}

type Metadata = Record<string, string> | null | undefined;

/** Map a Stripe subscription status onto the local three-state mirror. */
export function mapStripeStatus(status: string | undefined | null): LocalSubStatus {
  switch (status) {
    case "trialing":
    case "active":
      return "active";
    case "incomplete":
    case "past_due":
    case "unpaid":
      return "past_due";
    case "incomplete_expired":
    case "canceled":
      return "canceled";
    default:
      return "active";
  }
}

function secToMs(value: number | null | undefined): number | undefined {
  return typeof value === "number" && value > 0 ? value * 1000 : undefined;
}

function customerIdOf(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

function refIdOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

function priceIdOf(value: string | Stripe.Price | null | undefined): string | undefined {
  return refIdOf(value);
}

function metaUserId(meta: Metadata): string | undefined {
  const v = meta?.user_id;
  return typeof v === "string" && v ? v : undefined;
}

function metaPlan(meta: Metadata): PaidPlan | undefined {
  const v = meta?.plan;
  return v && isPaidPlan(v) ? v : undefined;
}

/** Reverse-lookup the local plan for a Stripe price id via the config map. */
function planFromPrice(config: StripeConfig, priceId: string | undefined): PaidPlan | undefined {
  if (!priceId) return undefined;
  for (const plan of PAID_PLANS) {
    if (config.priceIds[plan] === priceId) return plan;
  }
  return undefined;
}

function existingPlan(plan: string | undefined): PlanId {
  return plan && isPlanId(plan) ? plan : "free";
}

/** Period/price of a subscription live on its first item (dahlia). */
function firstItem(sub: Stripe.Subscription): Stripe.SubscriptionItem | undefined {
  return sub.items?.data?.[0];
}

interface SyncArgs {
  userId: string;
  customerId: string;
  subscriptionId: string;
  plan: PlanId;
  status: LocalSubStatus;
  priceId?: string;
  periodStart?: number;
  periodEnd?: number;
}

/** Upsert the local subscription mirror, preserving fields Stripe omitted. */
async function syncSubscription(db: Db, args: SyncArgs): Promise<void> {
  const existing = await db.loadSubscription(args.userId);
  await db.saveSubscription(args.userId, args.plan, args.status, {
    provider: "stripe",
    externalId: args.subscriptionId,
    stripeCustomerId: args.customerId,
    stripeSubscriptionId: args.subscriptionId,
    stripePriceId: args.priceId ?? existing?.stripePriceId ?? undefined,
    periodStart: args.periodStart ?? existing?.currentPeriodStart,
    periodEnd: args.periodEnd ?? existing?.currentPeriodEnd,
  });
}

async function onCheckoutCompleted(db: Db, event: Stripe.Event, config: StripeConfig): Promise<WebhookOutcome> {
  const session = event.data.object as Stripe.Checkout.Session;
  const customerId = customerIdOf(session.customer);
  const subscriptionId = refIdOf(session.subscription);
  const localByCustomer = customerId ? await db.findSubscriptionByStripeCustomer(customerId) : undefined;
  const userId = metaUserId(session.metadata) ?? localByCustomer?.userId;
  if (!userId) throw new Error("checkout.session.completed without resolvable user_id");
  if (!customerId || !subscriptionId) {
    throw new Error("checkout.session.completed without customer/subscription");
  }
  // createSubscriptionCheckout stamps metadata.plan; fall back to existing plan.
  const existing = await db.loadSubscription(userId);
  const plan = metaPlan(session.metadata) ?? existingPlan(existing?.plan);
  await syncSubscription(db, {
    userId,
    customerId,
    subscriptionId,
    plan,
    status: "active",
    priceId: isPaidPlan(plan) ? config.priceIds[plan] : existing?.stripePriceId ?? undefined,
  });
  return { handled: true, duplicate: false, action: "checkout_completed", userId };
}

async function onInvoicePaid(db: Db, event: Stripe.Event, config: StripeConfig): Promise<WebhookOutcome> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = customerIdOf(invoice.customer);
  const local = customerId ? await db.findSubscriptionByStripeCustomer(customerId) : undefined;
  const userId = metaUserId(invoice.metadata) ?? local?.userId;
  if (!userId) throw new Error("invoice.paid without resolvable user");
  if (!customerId) throw new Error("invoice.paid without customer");
  const subscriptionId = local?.stripeSubscriptionId;
  if (!subscriptionId) throw new Error("invoice.paid before checkout.session.completed mirror");

  // Mirror-level dedupe: one local invoice per Stripe invoice id.
  if (invoice.id) {
    const already = await db.findInvoiceByStripeInvoice(invoice.id);
    if (already) {
      return { handled: true, duplicate: false, action: "invoice_paid", userId };
    }
  }

  const line = invoice.lines?.data?.[0];
  const priceId = priceIdOf(line?.pricing?.price_details?.price);
  const existing = await db.loadSubscription(userId);
  const plan = metaPlan(invoice.metadata) ?? planFromPrice(config, priceId) ?? existingPlan(existing?.plan);
  const periodStart = secToMs(line?.period?.start) ?? existing?.currentPeriodStart;
  const periodEnd = secToMs(line?.period?.end) ?? existing?.currentPeriodEnd;
  const amountUsd = typeof invoice.amount_paid === "number" ? invoice.amount_paid / 100 : 0;

  await syncSubscription(db, {
    userId,
    customerId,
    subscriptionId,
    plan,
    status: "active",
    priceId,
    periodStart,
    periodEnd,
  });

  const now = Date.now();
  const description = `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan (monthly, Stripe)`;
  const row: InvoiceRow = {
    id: `inv_${randomUUID()}`,
    user_id: userId,
    subscription_id: userId,
    period_start: periodStart ?? now,
    period_end: periodEnd ?? now,
    plan,
    amount_usd: amountUsd,
    status: "paid",
    line_items: JSON.stringify([{ description, quantity: 1, unitPrice: amountUsd, amount: amountUsd }]),
    paid_at: now,
    paid_method: "stripe",
    stripe_invoice_id: invoice.id ?? null,
    notes: null,
    created_at: now,
    updated_at: now,
  };
  await db.insertInvoice(row);
  return { handled: true, duplicate: false, action: "invoice_paid", userId };
}

async function onInvoiceFailed(db: Db, event: Stripe.Event): Promise<WebhookOutcome> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = customerIdOf(invoice.customer);
  const local = customerId ? await db.findSubscriptionByStripeCustomer(customerId) : undefined;
  const userId = metaUserId(invoice.metadata) ?? local?.userId;
  if (!userId) throw new Error("invoice.payment_failed without resolvable user");
  if (!customerId) throw new Error("invoice.payment_failed without customer");
  const subscriptionId = local?.stripeSubscriptionId;
  if (!subscriptionId) throw new Error("invoice.payment_failed without mirrored subscription");

  const existing = await db.loadSubscription(userId);
  await syncSubscription(db, {
    userId,
    customerId,
    subscriptionId,
    plan: existingPlan(existing?.plan),
    status: "past_due",
    priceId: existing?.stripePriceId ?? undefined,
    periodStart: existing?.currentPeriodStart,
    periodEnd: existing?.currentPeriodEnd,
  });
  return { handled: true, duplicate: false, action: "invoice_failed", userId };
}

async function onSubscriptionUpdated(db: Db, event: Stripe.Event, config: StripeConfig): Promise<WebhookOutcome> {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = customerIdOf(sub.customer);
  const local = customerId ? await db.findSubscriptionByStripeCustomer(customerId) : undefined;
  const userId = metaUserId(sub.metadata) ?? local?.userId;
  if (!userId) throw new Error("customer.subscription.updated without resolvable user");
  if (!customerId) throw new Error("customer.subscription.updated without customer");

  const item = firstItem(sub);
  const priceId = priceIdOf(item?.price);
  const existing = await db.loadSubscription(userId);
  const plan = metaPlan(sub.metadata) ?? planFromPrice(config, priceId) ?? existingPlan(existing?.plan);
  await syncSubscription(db, {
    userId,
    customerId,
    subscriptionId: sub.id,
    plan,
    status: mapStripeStatus(sub.status),
    priceId,
    periodStart: secToMs(item?.current_period_start) ?? existing?.currentPeriodStart,
    periodEnd: secToMs(item?.current_period_end) ?? existing?.currentPeriodEnd,
  });
  return { handled: true, duplicate: false, action: "subscription_updated", userId };
}

async function onSubscriptionDeleted(db: Db, event: Stripe.Event, config: StripeConfig): Promise<WebhookOutcome> {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = customerIdOf(sub.customer);
  const local = customerId ? await db.findSubscriptionByStripeCustomer(customerId) : undefined;
  const userId = metaUserId(sub.metadata) ?? local?.userId;
  if (!userId) throw new Error("customer.subscription.deleted without resolvable user");
  if (!customerId) throw new Error("customer.subscription.deleted without customer");

  const item = firstItem(sub);
  const priceId = priceIdOf(item?.price);
  const existing = await db.loadSubscription(userId);
  const plan = metaPlan(sub.metadata) ?? planFromPrice(config, priceId) ?? existingPlan(existing?.plan);
  // Keep current_period_end: access continues until period end (cancel-at-term).
  await syncSubscription(db, {
    userId,
    customerId,
    subscriptionId: sub.id,
    plan,
    status: "canceled",
    priceId,
    periodStart: secToMs(item?.current_period_start) ?? existing?.currentPeriodStart,
    periodEnd: secToMs(item?.current_period_end) ?? existing?.currentPeriodEnd,
  });
  return { handled: true, duplicate: false, action: "subscription_deleted", userId };
}

/**
 * Apply one verified Stripe event to the local mirror. Returns the outcome;
 * unknown event types are reported as ignored (still acked to Stripe). Throws
 * when an event's local user cannot be resolved, so Stripe retries.
 */
export async function handleStripeEvent(
  db: Db,
  event: Stripe.Event,
  config: StripeConfig,
): Promise<WebhookOutcome> {
  if (await db.getIdempotentRun(STRIPE_WEBHOOK_NS, event.id)) {
    return { handled: true, duplicate: true, action: "duplicate" };
  }

  let outcome: WebhookOutcome;
  switch (event.type) {
    case "checkout.session.completed":
      outcome = await onCheckoutCompleted(db, event, config);
      break;
    case "invoice.paid":
      outcome = await onInvoicePaid(db, event, config);
      break;
    case "invoice.payment_failed":
      outcome = await onInvoiceFailed(db, event);
      break;
    case "customer.subscription.updated":
      outcome = await onSubscriptionUpdated(db, event, config);
      break;
    case "customer.subscription.deleted":
      outcome = await onSubscriptionDeleted(db, event, config);
      break;
    default:
      return { handled: false, duplicate: false, action: "ignored" };
  }

  await db.claimIdempotencyKey(STRIPE_WEBHOOK_NS, event.id, event.id);
  return outcome;
}
