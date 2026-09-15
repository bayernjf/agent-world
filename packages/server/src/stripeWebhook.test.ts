import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { openDb, type Db } from "./db.js";
import type { StripeConfig } from "./stripe.js";
import {
  STRIPE_WEBHOOK_NS,
  handleStripeEvent,
  mapStripeStatus,
} from "./stripeWebhook.js";

const config: StripeConfig = {
  secretKey: "sk_test_x",
  webhookSecret: "whsec_x",
  priceIds: { starter: "price_starter", pro: "price_pro", team: "price_team" },
};

let seq = 0;
function event(type: string, object: Record<string, unknown>, id?: string): Stripe.Event {
  seq += 1;
  return { id: id ?? `evt_${seq}`, type, data: { object } } as unknown as Stripe.Event;
}

const PERIOD_START = 1_700_000_000; // unix seconds
const PERIOD_END = 1_702_592_000;

function checkoutEvent(plan = "pro", userId = "u1") {
  return event("checkout.session.completed", {
    customer: "cus_1",
    subscription: "sub_1",
    metadata: { plan, user_id: userId },
  });
}

function paidInvoiceEvent(invoiceId = "in_1") {
  return event("invoice.paid", {
    id: invoiceId,
    customer: "cus_1",
    amount_paid: 2900,
    metadata: null,
    lines: {
      data: [
        {
          period: { start: PERIOD_START, end: PERIOD_END },
          pricing: { price_details: { price: "price_pro", product: "prod_1" } },
        },
      ],
    },
  });
}

function subscriptionEvent(status: string, type = "customer.subscription.updated") {
  return event(type, {
    id: "sub_1",
    customer: "cus_1",
    status,
    metadata: null,
    items: {
      data: [
        {
          price: { id: "price_pro" },
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
        },
      ],
    },
  });
}

describe("mapStripeStatus", () => {
  it("maps Stripe lifecycle states onto the local three-state mirror", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("trialing")).toBe("active");
    expect(mapStripeStatus("past_due")).toBe("past_due");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
    expect(mapStripeStatus("incomplete")).toBe("past_due");
    expect(mapStripeStatus("canceled")).toBe("canceled");
    expect(mapStripeStatus("incomplete_expired")).toBe("canceled");
    expect(mapStripeStatus(undefined)).toBe("active");
  });
});

describe("handleStripeEvent — five-event mirror sync", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-webhook-"));
    db = openDb(join(dir, "aw.sqlite"));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("opens the mirror on checkout.session.completed", async () => {
    const out = await handleStripeEvent(db, checkoutEvent(), config);
    expect(out).toMatchObject({ action: "checkout_completed", userId: "u1", duplicate: false });
    const sub = await db.loadSubscription("u1");
    expect(sub).toMatchObject({
      plan: "pro",
      status: "active",
      provider: "stripe",
      externalId: "sub_1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      stripePriceId: "price_pro",
    });
  });

  it("mirrors a paid invoice and keeps the subscription active", async () => {
    await handleStripeEvent(db, checkoutEvent(), config);
    const out = await handleStripeEvent(db, paidInvoiceEvent(), config);
    expect(out.action).toBe("invoice_paid");

    const sub = await db.loadSubscription("u1");
    expect(sub?.status).toBe("active");
    expect(sub?.currentPeriodStart).toBe(PERIOD_START * 1000);
    expect(sub?.currentPeriodEnd).toBe(PERIOD_END * 1000);

    const invoices = await db.listInvoicesByUser("u1");
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      status: "paid",
      amount_usd: 29,
      paid_method: "stripe",
      stripe_invoice_id: "in_1",
    });
  });

  it("marks the subscription past_due on invoice.payment_failed", async () => {
    await handleStripeEvent(db, checkoutEvent(), config);
    const out = await handleStripeEvent(
      db,
      event("invoice.payment_failed", { id: "in_2", customer: "cus_1", metadata: null }),
      config,
    );
    expect(out.action).toBe("invoice_failed");
    expect((await db.loadSubscription("u1"))?.status).toBe("past_due");
  });

  it("syncs status/period on customer.subscription.updated", async () => {
    await handleStripeEvent(db, checkoutEvent(), config);
    await handleStripeEvent(db, subscriptionEvent("past_due"), config);
    expect((await db.loadSubscription("u1"))?.status).toBe("past_due");
    expect((await db.loadSubscription("u1"))?.currentPeriodEnd).toBe(PERIOD_END * 1000);

    await handleStripeEvent(db, subscriptionEvent("active"), config);
    expect((await db.loadSubscription("u1"))?.status).toBe("active");
  });

  it("cancels but preserves period end on customer.subscription.deleted (cancel-at-term)", async () => {
    await handleStripeEvent(db, checkoutEvent(), config);
    await handleStripeEvent(db, subscriptionEvent("canceled", "customer.subscription.deleted"), config);
    const sub = await db.loadSubscription("u1");
    expect(sub?.status).toBe("canceled");
    expect(sub?.currentPeriodEnd).toBe(PERIOD_END * 1000);
  });

  it("ignores unrelated event types without claiming them", async () => {
    const out = await handleStripeEvent(db, event("customer.updated", {}), config);
    expect(out).toMatchObject({ handled: false, action: "ignored" });
    const again = await handleStripeEvent(db, event("customer.updated", {}, "evt_same"), config);
    expect(again.action).toBe("ignored");
  });

  it("throws when the local user cannot be resolved so Stripe retries", async () => {
    await expect(
      handleStripeEvent(
        db,
        event("customer.subscription.updated", {
          id: "sub_x",
          customer: "cus_unknown",
          status: "active",
          metadata: null,
          items: { data: [] },
        }),
        config,
      ),
    ).rejects.toThrow(/resolvable user/);
  });
});

describe("handleStripeEvent — idempotency", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-webhook-idem-"));
    db = openDb(join(dir, "aw.sqlite"));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips a redelivered event with the same event id (duplicate)", async () => {
    const object = {
      customer: "cus_1",
      subscription: "sub_1",
      metadata: { plan: "pro", user_id: "u1" },
    };
    await handleStripeEvent(db, event("checkout.session.completed", object, "evt_fixed"), config);
    const repeat = await handleStripeEvent(
      db,
      event("checkout.session.completed", object, "evt_fixed"),
      config,
    );
    expect(repeat.duplicate).toBe(true);
    expect(repeat.action).toBe("duplicate");
    expect(await db.getIdempotentRun(STRIPE_WEBHOOK_NS, "evt_fixed")).toBeTruthy();
  });

  it("does not create a second local invoice for the same Stripe invoice id", async () => {
    await handleStripeEvent(db, checkoutEvent(), config);
    await handleStripeEvent(db, paidInvoiceEvent("in_dup"), config);
    // A different event id (redelivery after a crash pre-claim) carrying the same Stripe invoice.
    const second = await handleStripeEvent(db, paidInvoiceEvent("in_dup"), config);
    expect(second.action).toBe("invoice_paid");
    const invoices = await db.listInvoicesByUser("u1");
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.stripe_invoice_id).toBe("in_dup");
  });
});
