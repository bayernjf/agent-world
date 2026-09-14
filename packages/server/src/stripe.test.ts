import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  createCustomerPortal,
  createSubscriptionCheckout,
  findOrCreateCustomer,
  getStripeClient,
  isPaidPlan,
  parseStripeConfig,
  PAID_PLANS,
  requireStripeConfig,
  resetStripeClient,
  StripeConfigMalformedError,
  StripeNotConfiguredError,
  StripePriceMissingError,
  StripeWebhookSignatureError,
  verifyWebhookEvent,
  type StripeConfig,
} from "./stripe.js";

const CONFIG: StripeConfig = {
  secretKey: "sk_test_secret",
  webhookSecret: "whsec_test",
  priceIds: { starter: "price_starter", pro: "price_pro", team: "price_team" },
};

/** Minimal Stripe client surface used by the wrapper — no network anywhere. */
function makeFakeClient() {
  const customers = { retrieve: vi.fn(), create: vi.fn() };
  const checkout = { sessions: { create: vi.fn() } };
  const billingPortal = { sessions: { create: vi.fn() } };
  const webhooks = { constructEvent: vi.fn() };
  const client = { customers, checkout, billingPortal, webhooks } as unknown as Stripe;
  return { client, customers, checkout, billingPortal, webhooks };
}

describe("stripe config parsing", () => {
  it("recognises exactly the three paid plans", () => {
    expect(PAID_PLANS).toEqual(["starter", "pro", "team"]);
    expect(isPaidPlan("pro")).toBe(true);
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan("nope")).toBe(false);
  });

  it("returns null when the secret key (master switch) is absent", () => {
    expect(parseStripeConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(parseStripeConfig({ STRIPE_WEBHOOK_SECRET: "whsec_x" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("parses secret + webhook + price ids and ignores free/unknown keys", () => {
    const cfg = parseStripeConfig({
      STRIPE_SECRET_KEY: " sk_test_x ",
      STRIPE_WEBHOOK_SECRET: " whsec_x ",
      STRIPE_PRICE_IDS: JSON.stringify({
        starter: "price_s",
        pro: "price_p",
        team: "price_t",
        free: "should_be_ignored",
        mystery: "also_ignored",
        blank: "   ",
      }),
    } as NodeJS.ProcessEnv);
    expect(cfg).not.toBeNull();
    expect(cfg!.secretKey).toBe("sk_test_x");
    expect(cfg!.webhookSecret).toBe("whsec_x");
    expect(cfg!.priceIds).toEqual({ starter: "price_s", pro: "price_p", team: "price_t" });
  });

  it("works with a secret key but no price map / webhook secret", () => {
    const cfg = parseStripeConfig({ STRIPE_SECRET_KEY: "sk_test_x" } as NodeJS.ProcessEnv);
    expect(cfg!.webhookSecret).toBe("");
    expect(cfg!.priceIds).toEqual({});
  });

  it("throws on malformed STRIPE_PRICE_IDS", () => {
    expect(() =>
      parseStripeConfig({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_IDS: "{not json" } as NodeJS.ProcessEnv),
    ).toThrow(StripeConfigMalformedError);
    expect(() =>
      parseStripeConfig({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_IDS: "[1,2]" } as NodeJS.ProcessEnv),
    ).toThrow(StripeConfigMalformedError);
  });

  it("requireStripeConfig throws a precise not-configured error", () => {
    try {
      requireStripeConfig({} as NodeJS.ProcessEnv);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StripeNotConfiguredError);
      expect((err as StripeNotConfiguredError).code).toBe("STRIPE_NOT_CONFIGURED");
      expect((err as Error).message).toContain("STRIPE_SECRET_KEY");
    }
  });
});

describe("getStripeClient singleton", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    resetStripeClient();
    process.env.STRIPE_SECRET_KEY = "sk_test_singleton";
  });
  afterEach(() => {
    resetStripeClient();
    process.env = saved;
  });

  it("throws when unconfigured, then builds and caches a client", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => getStripeClient()).toThrow(StripeNotConfiguredError);
    process.env.STRIPE_SECRET_KEY = "sk_test_singleton";
    const a = getStripeClient();
    const b = getStripeClient();
    expect(a).toBe(b);
  });
});

describe("findOrCreateCustomer", () => {
  it("creates a customer with user_id metadata when none exists", async () => {
    const { client, customers } = makeFakeClient();
    customers.create.mockResolvedValue({ id: "cus_new" });
    const { customer, created } = await findOrCreateCustomer(client, { userId: "u1", email: "a@b.c" });
    expect(customers.retrieve).not.toHaveBeenCalled();
    expect(customers.create).toHaveBeenCalledWith({ email: "a@b.c", name: undefined, metadata: { user_id: "u1" } });
    expect(created).toBe(true);
    expect((customer as { id: string }).id).toBe("cus_new");
  });

  it("reuses an existing live customer and does not create", async () => {
    const { client, customers } = makeFakeClient();
    customers.retrieve.mockResolvedValue({ id: "cus_old", deleted: undefined });
    const { created } = await findOrCreateCustomer(client, {
      userId: "u1",
      existingCustomerId: "cus_old",
    });
    expect(customers.retrieve).toHaveBeenCalledWith("cus_old");
    expect(customers.create).not.toHaveBeenCalled();
    expect(created).toBe(false);
  });

  it("re-creates when the stored customer was deleted", async () => {
    const { client, customers } = makeFakeClient();
    customers.retrieve.mockResolvedValue({ id: "cus_gone", deleted: true });
    customers.create.mockResolvedValue({ id: "cus_fresh" });
    const { customer, created } = await findOrCreateCustomer(client, {
      userId: "u1",
      existingCustomerId: "cus_gone",
    });
    expect(customers.create).toHaveBeenCalledTimes(1);
    expect(created).toBe(true);
    expect((customer as { id: string }).id).toBe("cus_fresh");
  });
});

describe("createSubscriptionCheckout", () => {
  const base = {
    customerId: "cus_1",
    successUrl: "https://app/success",
    cancelUrl: "https://app/cancel",
    userId: "u1",
  };

  it("opens a subscription checkout with the plan price and metadata", async () => {
    const { client, checkout } = makeFakeClient();
    checkout.sessions.create.mockResolvedValue({ id: "cs_1", url: "https://checkout/1" });
    const out = await createSubscriptionCheckout(client, { ...base, plan: "pro" }, CONFIG);
    const params = checkout.sessions.create.mock.calls[0]![0];
    expect(params.mode).toBe("subscription");
    expect(params.customer).toBe("cus_1");
    expect(params.line_items).toEqual([{ price: "price_pro", quantity: 1 }]);
    expect(params.metadata).toEqual({ plan: "pro", user_id: "u1" });
    expect(params.subscription_data.metadata).toEqual({ plan: "pro", user_id: "u1" });
    expect(out).toEqual({ id: "cs_1", url: "https://checkout/1" });
  });

  it("uses seat count as quantity for the team plan", async () => {
    const { client, checkout } = makeFakeClient();
    checkout.sessions.create.mockResolvedValue({ id: "cs_t", url: "https://checkout/t" });
    await createSubscriptionCheckout(client, { ...base, plan: "team", seats: 4 }, CONFIG);
    const params = checkout.sessions.create.mock.calls[0]![0];
    expect(params.line_items).toEqual([{ price: "price_team", quantity: 4 }]);
  });

  it("throws when no price id is configured for the plan", async () => {
    const { client } = makeFakeClient();
    await expect(
      createSubscriptionCheckout(client, { ...base, plan: "starter" }, { ...CONFIG, priceIds: {} }),
    ).rejects.toBeInstanceOf(StripePriceMissingError);
  });

  it("throws when Stripe returns a session without a URL", async () => {
    const { client, checkout } = makeFakeClient();
    checkout.sessions.create.mockResolvedValue({ id: "cs_x", url: null });
    await expect(createSubscriptionCheckout(client, { ...base, plan: "pro" }, CONFIG)).rejects.toThrow(
      /without a URL/,
    );
  });
});

describe("createCustomerPortal", () => {
  it("opens a portal session with customer and return url", async () => {
    const { client, billingPortal } = makeFakeClient();
    billingPortal.sessions.create.mockResolvedValue({ id: "bps_1", url: "https://portal/1" });
    const out = await createCustomerPortal(client, { customerId: "cus_1", returnUrl: "https://app/back" });
    expect(billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://app/back",
    });
    expect(out).toEqual({ id: "bps_1", url: "https://portal/1" });
  });
});

describe("verifyWebhookEvent", () => {
  it("throws not-configured when the webhook secret is absent", () => {
    const { client } = makeFakeClient();
    expect(() =>
      verifyWebhookEvent(client, "body", "t=1,v1=s", { ...CONFIG, webhookSecret: "" }),
    ).toThrow(StripeNotConfiguredError);
  });

  it("throws a signature error when the header is missing", () => {
    const { client, webhooks } = makeFakeClient();
    expect(() => verifyWebhookEvent(client, "body", null, CONFIG)).toThrow(StripeWebhookSignatureError);
    expect(webhooks.constructEvent).not.toHaveBeenCalled();
  });

  it("returns the parsed event on a valid signature", () => {
    const { client, webhooks } = makeFakeClient();
    const event = { id: "evt_1", type: "invoice.paid" } as unknown as Stripe.Event;
    webhooks.constructEvent.mockReturnValue(event);
    const out = verifyWebhookEvent(client, Buffer.from("raw"), "t=1,v1=s", CONFIG);
    expect(webhooks.constructEvent).toHaveBeenCalledWith(Buffer.from("raw"), "t=1,v1=s", "whsec_test");
    expect(out).toBe(event);
  });

  it("wraps an SDK signature failure into a normalized error", () => {
    const { client, webhooks } = makeFakeClient();
    webhooks.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching");
    });
    expect(() => verifyWebhookEvent(client, "body", "bad", CONFIG)).toThrow(StripeWebhookSignatureError);
  });
});
