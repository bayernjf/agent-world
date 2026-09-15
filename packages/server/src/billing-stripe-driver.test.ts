import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InvoiceRow } from "./sqlite-driver.js";
import { openDb, type Db } from "./db.js";

/**
 * M3 S6 Step 1 (design-monetization-m3-s6-stripe §2): the local DB is a mirror
 * of Stripe. These tests pin the subscription/ininvoice Stripe mirror columns
 * end-to-end through the driver (save → load → find), plus backward
 * compatibility for rows written without Stripe ids (manual billing path).
 */
describe("subscription Stripe mirror columns (migration 39 driver)", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-stripe-driver-"));
    db = openDb(join(dir, "aw.sqlite"));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips Stripe customer/subscription/price ids through save+load", async () => {
    await db.saveSubscription("u1", "pro", "active", {
      provider: "stripe",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_456",
      stripePriceId: "price_pro",
    });
    const loaded = await db.loadSubscription("u1");
    expect(loaded).toMatchObject({
      plan: "pro",
      status: "active",
      provider: "stripe",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_456",
      stripePriceId: "price_pro",
    });
  });

  it("defaults Stripe columns to null on the legacy manual path", async () => {
    await db.saveSubscription("u2", "free", "active", { provider: "manual" });
    const loaded = await db.loadSubscription("u2");
    expect(loaded).toMatchObject({
      plan: "free",
      provider: "manual",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
    });
  });

  it("resolves a subscription by Stripe customer id and subscription id", async () => {
    await db.saveSubscription("u3", "starter", "active", {
      stripeCustomerId: "cus_abc",
      stripeSubscriptionId: "sub_xyz",
      stripePriceId: "price_starter",
    });
    const byCustomer = await db.findSubscriptionByStripeCustomer("cus_abc");
    expect(byCustomer?.userId).toBe("u3");
    expect(byCustomer?.stripeSubscriptionId).toBe("sub_xyz");
    const bySub = await db.findSubscriptionByStripeSubscription("sub_xyz");
    expect(bySub?.userId).toBe("u3");
    expect(bySub?.stripeCustomerId).toBe("cus_abc");
    expect(await db.findSubscriptionByStripeCustomer("cus_missing")).toBeUndefined();
  });

  it("overwrites Stripe mirror columns on upsert", async () => {
    await db.saveSubscription("u4", "starter", "active", {
      stripeCustomerId: "cus_first",
      stripeSubscriptionId: "sub_first",
      stripePriceId: "price_starter",
    });
    await db.saveSubscription("u4", "pro", "active", {
      stripeCustomerId: "cus_first",
      stripeSubscriptionId: "sub_second",
      stripePriceId: "price_pro",
    });
    const loaded = await db.loadSubscription("u4");
    expect(loaded?.plan).toBe("pro");
    expect(loaded?.stripeSubscriptionId).toBe("sub_second");
    expect(loaded?.stripePriceId).toBe("price_pro");
    // Still exactly one row for the user (upsert, not insert).
    const all = await db.listAllSubscriptions();
    expect(all.filter((s) => s.userId === "u4")).toHaveLength(1);
  });

  it("exposes Stripe columns in listAllSubscriptions", async () => {
    await db.saveSubscription("u5", "team", "active", {
      stripeCustomerId: "cus_t",
      stripeSubscriptionId: "sub_t",
      stripePriceId: "price_team",
    });
    const row = (await db.listAllSubscriptions()).find((s) => s.userId === "u5");
    expect(row?.stripeCustomerId).toBe("cus_t");
    expect(row?.stripePriceId).toBe("price_team");
  });
});

describe("invoice Stripe invoice id mirror (migration 39 driver)", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-stripe-inv-"));
    db = openDb(join(dir, "aw.sqlite"));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function invoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
    const now = Date.now();
    return {
      id: "inv_local_1",
      user_id: "u1",
      subscription_id: "u1",
      period_start: now,
      period_end: now + 30 * 24 * 60 * 60 * 1000,
      plan: "pro",
      amount_usd: 29,
      status: "open",
      line_items: "[]",
      paid_at: null,
      paid_method: null,
      stripe_invoice_id: null,
      notes: null,
      created_at: now,
      updated_at: now,
      ...overrides,
    };
  }

  it("round-trips stripe_invoice_id and resolves by it (webhook reconciliation)", async () => {
    await db.insertInvoice(invoice({ stripe_invoice_id: "in_stripe_1", paid_method: "stripe" }));
    const found = await db.findInvoiceByStripeInvoice("in_stripe_1");
    expect(found?.id).toBe("inv_local_1");
    expect(found?.stripe_invoice_id).toBe("in_stripe_1");
    const byPk = await db.getInvoice("inv_local_1");
    expect(byPk?.stripe_invoice_id).toBe("in_stripe_1");
  });

  it("keeps manual invoices with a null stripe_invoice_id", async () => {
    await db.insertInvoice(invoice({ id: "inv_local_2", paid_method: "manual" }));
    expect(await db.findInvoiceByStripeInvoice("in_nope")).toBeUndefined();
    const row = await db.getInvoice("inv_local_2");
    expect(row?.stripe_invoice_id).toBeNull();
    expect(row?.paid_method).toBe("manual");
  });
});
