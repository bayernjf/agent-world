import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { openDb, type Db } from "./db.js";

// Mock only the network-touching Stripe wrapper surface; keep the real value
// guards, error classes and webhook verification/handling logic.
vi.mock("./stripe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe.js")>();
  const fakeClient = {
    customers: {
      retrieve: vi.fn(),
      create: vi.fn(async () => ({ id: "cus_new" })),
    },
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
  };
  return {
    ...actual,
    getStripeClient: () => fakeClient,
    requireStripeConfig: () => ({
      secretKey: "sk_test",
      webhookSecret: "whsec_test",
      priceIds: { starter: "price_starter", pro: "price_pro", team: "price_team" },
    }),
  };
});

import { billingRouter } from "./api.billing.js";
import { getStripeClient } from "./stripe.js";

const PUBLIC_URL = "http://localhost:8791";
const USER = "user_billing";

function fakeStripe() {
  return getStripeClient() as unknown as {
    customers: { retrieve: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    checkout: { sessions: { create: ReturnType<typeof vi.fn> } };
    billingPortal: { sessions: { create: ReturnType<typeof vi.fn> } };
    webhooks: { constructEvent: ReturnType<typeof vi.fn> };
  };
}

function buildApp(db: Db, userId: string | undefined = USER) {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.use("*", async (c, next) => {
    if (userId) c.set("userId", userId);
    await next();
  });
  app.route("/api/billing", billingRouter(db, { publicUrl: PUBLIC_URL }));
  return app;
}

describe("billing routes — /checkout", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-billing-"));
    db = openDb(join(dir, "aw.sqlite"));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("rejects an invalid plan with 400", async () => {
    const app = buildApp(db);
    const res = await app.request("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "free" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_plan" });
  });

  it("opens a checkout session and mirrors the Stripe customer id", async () => {
    const client = fakeStripe();
    client.checkout.sessions.create.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" });

    const app = buildApp(db);
    const res = await app.request("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plan: "pro",
        success_url: "https://evil.com/x", // cross-origin → must be replaced
        cancel_url: `${PUBLIC_URL}/settings/billing`,
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "cs_1", url: "https://stripe.test/cs_1" });

    // Customer id mirrored before payment so /portal works later.
    const sub = await db.loadSubscription(USER);
    expect(sub?.stripeCustomerId).toBe("cus_new");

    // Cross-origin success_url was rejected in favour of the same-origin fallback.
    const args = client.checkout.sessions.create.mock.calls[0]?.[0];
    expect(args.success_url).toBe(`${PUBLIC_URL}/settings/billing`);
  });
});

describe("billing routes — /portal", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-portal-"));
    db = openDb(join(dir, "aw.sqlite"));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("returns 409 when the user has no Stripe customer yet", async () => {
    const app = buildApp(db);
    const res = await app.request("/api/billing/portal", { method: "POST", body: "{}" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "no_stripe_customer" });
  });

  it("opens a portal session for a known customer", async () => {
    await db.saveSubscription(USER, "pro", "active", {
      provider: "stripe",
      stripeCustomerId: "cus_known",
      stripeSubscriptionId: "sub_1",
    });
    const client = fakeStripe();
    client.billingPortal.sessions.create.mockResolvedValue({ id: "bps_1", url: "https://stripe.test/portal" });

    const app = buildApp(db);
    const res = await app.request("/api/billing/portal", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: "https://stripe.test/portal" });
  });
});

describe("billing routes — /webhook", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-wh-route-"));
    db = openDb(join(dir, "aw.sqlite"));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("returns 400 when the Stripe-Signature header is missing", async () => {
    const app = buildApp(db, undefined); // webhook needs no cookie user
    const res = await app.request("/api/billing/webhook", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_signature" });
  });

  it("verifies the signature then applies the event to the mirror", async () => {
    const client = fakeStripe();
    const event = {
      id: "evt_route_1",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_route",
          subscription: "sub_route",
          metadata: { plan: "pro", user_id: USER },
        },
      },
    } as unknown as Stripe.Event;
    client.webhooks.constructEvent.mockReturnValue(event);

    const app = buildApp(db, undefined);
    const res = await app.request("/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=sig" },
      body: JSON.stringify(event),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      received: true,
      handled: true,
      action: "checkout_completed",
      userId: USER,
    });
    const sub = await db.loadSubscription(USER);
    expect(sub).toMatchObject({ plan: "pro", status: "active", stripeSubscriptionId: "sub_route" });
  });
});
