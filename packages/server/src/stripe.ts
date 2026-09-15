/**
 * Stripe billing-gateway wrapper — M3 S6 Step 2
 * (docs/design-monetization-m3-s6-stripe.md §4/§5/§9 Step 2).
 *
 * Stripe is the billing system of record; the local DB is only a mirror. This
 * module wraps the Stripe SDK and nothing else — reuse/create Customer, open a
 * subscription Checkout Session, open the Billing Portal, verify a webhook
 * signature. It never writes the local database (that is the webhook handler's
 * job in api.billing.ts), which keeps every function unit-testable with an
 * injected fake client and no network access.
 *
 * Credentials are platform-scoped (one Stripe account for the whole backend),
 * so they are injected through the environment at deploy time rather than the
 * per-user `settings` table:
 *   STRIPE_SECRET_KEY     sk_test_… / sk_live_…  — master on/off switch
 *   STRIPE_WEBHOOK_SECRET whsec_…                — required only to verify events
 *   STRIPE_PRICE_IDS      {"starter":"price_…","pro":"price_…","team":"price_…"}
 * If an operator later enters these through an admin UI, seal them with
 * at-rest.encryptString before persisting. When the secret key is absent the
 * gateway reports "not configured" instead of crashing at startup, so the rest
 * of the server keeps running (manual billing path) until Stripe is provisioned.
 */
import Stripe from "stripe";
import { isPlanId, type PlanId } from "@agent-world/core";

/** Plans that can be purchased through Stripe. Free has no price. */
export type PaidPlan = Exclude<PlanId, "free">;
export const PAID_PLANS: PaidPlan[] = ["starter", "pro", "team"];

export function isPaidPlan(value: unknown): value is PaidPlan {
  return value === "starter" || value === "pro" || value === "team";
}

/** Raised when a billing action is requested but Stripe is not provisioned. */
export class StripeNotConfiguredError extends Error {
  readonly code = "STRIPE_NOT_CONFIGURED";
  constructor(missing: string[]) {
    super(`Stripe billing is not configured (missing: ${missing.join(", ")})`);
    this.name = "StripeNotConfiguredError";
  }
}

/** Raised when STRIPE_PRICE_IDS has no entry for the requested paid plan. */
export class StripePriceMissingError extends Error {
  readonly code = "STRIPE_PRICE_MISSING";
  constructor(plan: PaidPlan) {
    super(`No Stripe price id is configured for plan "${plan}"`);
    this.name = "StripePriceMissingError";
  }
}

/** Raised when a webhook is missing its signature header or fails verification. */
export class StripeWebhookSignatureError extends Error {
  readonly code = "STRIPE_WEBHOOK_SIGNATURE";
  constructor(detail: string) {
    super(detail);
    this.name = "StripeWebhookSignatureError";
  }
}

/** Raised when STRIPE_PRICE_IDS is present but not valid JSON/object. */
export class StripeConfigMalformedError extends Error {
  readonly code = "STRIPE_CONFIG_MALFORMED";
  constructor(detail: string) {
    super(`STRIPE_PRICE_IDS is malformed: ${detail}`);
    this.name = "StripeConfigMalformedError";
  }
}

export interface StripePriceIds {
  starter?: string;
  pro?: string;
  team?: string;
}

export interface StripeConfig {
  secretKey: string;
  /** Empty string when the webhook signing secret is not yet provisioned. */
  webhookSecret: string;
  priceIds: StripePriceIds;
}

/**
 * Pure config parser, split from process state so tests can feed a fake env.
 * Returns null when the master switch (STRIPE_SECRET_KEY) is absent. Unknown
 * plan keys in STRIPE_PRICE_IDS are ignored; non-string / blank values dropped.
 */
export function parseStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const priceIds: StripePriceIds = {};
  const raw = env.STRIPE_PRICE_IDS?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new StripeConfigMalformedError((err as Error).message);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new StripeConfigMalformedError("expected a JSON object of plan -> price id");
    }
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isPlanId(key) || key === "free") continue;
      if (typeof value === "string" && value.trim()) priceIds[key] = value.trim();
    }
  }
  if (!secretKey) return null;
  return { secretKey, webhookSecret, priceIds };
}

/** Return the parsed config or throw a precise "not configured" error. */
export function requireStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  const missing: string[] = [];
  if (!env.STRIPE_SECRET_KEY?.trim()) missing.push("STRIPE_SECRET_KEY");
  if (missing.length > 0) throw new StripeNotConfiguredError(missing);
  const config = parseStripeConfig(env);
  if (!config) throw new StripeNotConfiguredError(["STRIPE_SECRET_KEY"]);
  return config;
}

let cachedClient: Stripe | null = null;

/**
 * Lazily build the singleton Stripe client. `apiVersion` is deliberately left
 * unset so the SDK pins its own tested API version ("2026-08-26.dahlia" in
 * stripe@22.x); passing a literal here would drift on every SDK upgrade.
 */
export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;
  const config = requireStripeConfig();
  cachedClient = new Stripe(config.secretKey, {
    appInfo: { name: "agent-world", version: "0.2.0" },
  });
  return cachedClient;
}

/** Test/config-reload seam: drop the cached client so the next get rebuilds it. */
export function resetStripeClient(): void {
  cachedClient = null;
}

export interface FindOrCreateCustomerArgs {
  /** Mirrored stripe_customer_id, when the user already has a Customer. */
  existingCustomerId?: string | null;
  /** Local user id, stamped into Customer.metadata for reverse lookup. */
  userId: string;
  email?: string | null;
  name?: string | null;
}

/**
 * Return the user's Stripe Customer, creating one on first use. A stored id
 * that points at a deleted Customer is treated as missing and re-created.
 */
export async function findOrCreateCustomer(
  client: Stripe,
  args: FindOrCreateCustomerArgs,
): Promise<{ customer: Stripe.Customer; created: boolean }> {
  if (args.existingCustomerId) {
    const existing = await client.customers.retrieve(args.existingCustomerId);
    if (!("deleted" in existing) || existing.deleted !== true) {
      return { customer: existing, created: false };
    }
  }
  const customer = await client.customers.create({
    email: args.email ?? undefined,
    name: args.name ?? undefined,
    metadata: { user_id: args.userId },
  });
  return { customer, created: true };
}

export interface SubscriptionCheckoutArgs {
  customerId: string;
  plan: PaidPlan;
  /** Team seats (owner counts as one); 1 for single-seat plans. */
  seats?: number;
  successUrl: string;
  cancelUrl: string;
  userId: string;
}

export interface SessionUrl {
  id: string;
  url: string;
}

/** Open a mode=subscription Checkout Session for one paid plan. */
export async function createSubscriptionCheckout(
  client: Stripe,
  args: SubscriptionCheckoutArgs,
  config: StripeConfig = requireStripeConfig(),
): Promise<SessionUrl> {
  const price = config.priceIds[args.plan];
  if (!price) throw new StripePriceMissingError(args.plan);
  const quantity = args.seats && args.seats > 1 ? args.seats : 1;
  const session = await client.checkout.sessions.create({
    mode: "subscription",
    customer: args.customerId,
    line_items: [{ price, quantity }],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    // Stamped twice (session + resulting subscription) so every webhook can
    // be routed back to the local user and plan without extra lookups.
    metadata: { plan: args.plan, user_id: args.userId },
    subscription_data: { metadata: { plan: args.plan, user_id: args.userId } },
  });
  if (!session.url) throw new Error("Stripe Checkout Session was created without a URL");
  return { id: session.id, url: session.url };
}

/** Open a Billing Portal Session (manage card, cancel, view invoices). */
export async function createCustomerPortal(
  client: Stripe,
  args: { customerId: string; returnUrl: string },
): Promise<SessionUrl> {
  const session = await client.billingPortal.sessions.create({
    customer: args.customerId,
    return_url: args.returnUrl,
  });
  return { id: session.id, url: session.url };
}

/**
 * Verify and parse a webhook payload using the Stripe-Signature header. Throws
 * Stripe's signature error (mapped to HTTP 400 by the caller) on any mismatch.
 * Accepts the raw request body (string or Buffer) — never a re-serialized body,
 * which would invalidate the signature.
 */
export function verifyWebhookEvent(
  client: Stripe,
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  config: StripeConfig = requireStripeConfig(),
): Stripe.Event {
  if (!config.webhookSecret) {
    throw new StripeNotConfiguredError(["STRIPE_WEBHOOK_SECRET"]);
  }
  if (!signatureHeader) {
    throw new StripeWebhookSignatureError("Missing Stripe-Signature header");
  }
  try {
    return client.webhooks.constructEvent(rawBody, signatureHeader, config.webhookSecret);
  } catch (err) {
    // Normalize the SDK's signature error so the API layer maps one type to 400.
    throw new StripeWebhookSignatureError((err as Error).message);
  }
}
