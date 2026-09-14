/**
 * M3 S6 Step 4/5 — Stripe billing HTTP routes
 * (docs/design-monetization-m3-s6-stripe.md §3.4/§4/§5).
 *
 * Mounted at /api/billing:
 *   POST /checkout  — authenticated; open a mode=subscription Checkout Session
 *   POST /portal    — authenticated; open the Billing Portal (needs a customer)
 *   POST /webhook   — UNAUTHENTICATED by cookie; verified by Stripe signature
 *
 * Stripe stays the billing system of record: these routes only trigger Stripe
 * actions (checkout/portal) or hand verified events to stripeWebhook.ts; they
 * never mutate subscription state directly. The webhook reads the RAW request
 * body (never a re-serialized copy, which would break signature verification).
 */
import { Hono } from "hono";
import type { Db } from "./db.js";
import { log } from "./logger.js";
import { getOrCreateSubscription, planOf } from "./subscriptionService.js";
import { handleStripeEvent } from "./stripeWebhook.js";
import {
  StripeNotConfiguredError,
  StripePriceMissingError,
  StripeWebhookSignatureError,
  createCustomerPortal,
  createSubscriptionCheckout,
  findOrCreateCustomer,
  getStripeClient,
  isPaidPlan,
  requireStripeConfig,
  verifyWebhookEvent,
} from "./stripe.js";

type BillingVars = { Variables: { userId: string } };

export interface BillingRouterOptions {
  /** Used to validate success/cancel/return URLs are same-origin. */
  publicUrl: string;
}

/** Only allow redirect URLs on the same origin as the app (no open redirect). */
function sameOriginUrl(input: unknown, fallback: string): string {
  if (typeof input === "string" && input.length > 0 && input.length <= 2048) {
    try {
      if (new URL(input).origin === new URL(fallback).origin) return input;
    } catch {
      /* malformed URL → fall back */
    }
  }
  return fallback;
}

type ErrorStatus = 400 | 409 | 500 | 503;
function errorStatus(err: unknown): { status: ErrorStatus; code: string } {
  if (err instanceof StripeWebhookSignatureError) return { status: 400, code: "invalid_signature" };
  if (err instanceof StripeNotConfiguredError) return { status: 503, code: "stripe_not_configured" };
  if (err instanceof StripePriceMissingError) return { status: 400, code: "price_missing" };
  return { status: 500, code: "billing_error" };
}

export function billingRouter(db: Db, options: BillingRouterOptions): Hono<BillingVars> {
  const r = new Hono<BillingVars>();
  const billingSettingsUrl = `${options.publicUrl.replace(/\/$/, "")}/settings/billing`;

  // --- POST /api/billing/checkout -----------------------------------------
  r.post("/checkout", async (c) => {
    const userId = c.get("userId");
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "bad_request", message: "invalid JSON body" }, 400);
    }
    const plan = body.plan;
    if (!isPaidPlan(plan)) {
      return c.json({ error: "invalid_plan", message: "plan must be one of starter/pro/team" }, 400);
    }
    const seatsRaw = Number(body.seats);
    const seats = Number.isFinite(seatsRaw) ? Math.min(10, Math.max(1, Math.trunc(seatsRaw))) : 1;
    const successUrl = sameOriginUrl(body.success_url, billingSettingsUrl);
    const cancelUrl = sameOriginUrl(body.cancel_url, billingSettingsUrl);

    try {
      const config = requireStripeConfig();
      const client = getStripeClient();
      // Ensure a row exists, then reload the full mirror (with Stripe ids).
      await getOrCreateSubscription(db, userId);
      const sub = await db.loadSubscription(userId);
      if (!sub) return c.json({ error: "subscription_init_failed" }, 500);
      const user = await db.findUserById(userId);

      const { customer } = await findOrCreateCustomer(client, {
        existingCustomerId: sub.stripeCustomerId ?? undefined,
        userId,
        email: user?.email ?? undefined,
      });
      // Mirror the customer id immediately so /portal works even if checkout
      // is abandoned; plan/status stay as-is until a webhook confirms payment.
      if (sub.stripeCustomerId !== customer.id) {
        await db.saveSubscription(userId, planOf(sub), sub.status, {
          provider: sub.provider ?? "manual",
          stripeCustomerId: customer.id,
          stripeSubscriptionId: sub.stripeSubscriptionId ?? undefined,
          stripePriceId: sub.stripePriceId ?? undefined,
          periodStart: sub.currentPeriodStart,
          periodEnd: sub.currentPeriodEnd,
        });
      }

      const session = await createSubscriptionCheckout(
        client,
        { customerId: customer.id, plan, seats, successUrl, cancelUrl, userId },
        config,
      );
      return c.json({ id: session.id, url: session.url });
    } catch (err) {
      const { status, code } = errorStatus(err);
      if (status >= 500 && code === "billing_error") log.error("stripe checkout failed", { userId, err: String(err) });
      return c.json({ error: code, message: (err as Error).message }, status);
    }
  });

  // --- POST /api/billing/portal -------------------------------------------
  r.post("/portal", async (c) => {
    const userId = c.get("userId");
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      /* portal body is optional */
    }
    try {
      const sub = await db.loadSubscription(userId);
      if (!sub?.stripeCustomerId) {
        return c.json({ error: "no_stripe_customer", message: "complete a checkout first" }, 409);
      }
      const client = getStripeClient();
      const returnUrl = sameOriginUrl(body.return_url, billingSettingsUrl);
      const session = await createCustomerPortal(client, {
        customerId: sub.stripeCustomerId,
        returnUrl,
      });
      return c.json({ id: session.id, url: session.url });
    } catch (err) {
      const { status, code } = errorStatus(err);
      if (status >= 500 && code === "billing_error") log.error("stripe portal failed", { userId, err: String(err) });
      return c.json({ error: code, message: (err as Error).message }, status);
    }
  });

  // --- POST /api/billing/webhook (signature-authenticated, no cookie) -----
  r.post("/webhook", async (c) => {
    // RAW body is mandatory: re-serializing JSON would invalidate the signature.
    const rawBody = await c.req.raw.text();
    const signature = c.req.header("stripe-signature");
    try {
      const config = requireStripeConfig();
      const client = getStripeClient();
      const event = verifyWebhookEvent(client, rawBody, signature, config);
      const outcome = await handleStripeEvent(db, event, config);
      return c.json({ received: true, ...outcome });
    } catch (err) {
      if (err instanceof StripeWebhookSignatureError) {
        return c.json({ error: "invalid_signature" }, 400);
      }
      if (err instanceof StripeNotConfiguredError) {
        return c.json({ error: "stripe_not_configured" }, 503);
      }
      // A resolvable-user/ordering failure returns 500 so Stripe retries later.
      log.error("stripe webhook handling failed", { err: String(err) });
      return c.json({ error: "webhook_failed" }, 500);
    }
  });

  return r;
}
