import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { setPlan } from "./subscriptionService.js";
import {
  generateInvoice,
  generateAllInvoices,
  listInvoices,
  getInvoice,
  markInvoicePaid,
  voidInvoice,
  invoiceFromRow,
  type Invoice,
} from "./invoiceService.js";
import type { InvoiceRow } from "./sqlite-driver.js";

describe("invoiceService", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-inv-"));
    db = openDb(join(dir, "test.sqlite"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates a free-tier invoice with $0 amount", async () => {
    const inv = await generateInvoice(db, "u1");
    expect(inv.plan).toBe("free");
    expect(inv.amountUsd).toBe(0);
    expect(inv.status).toBe("open");
    expect(inv.lineItems).toHaveLength(1);
    expect(inv.lineItems[0].description).toContain("Free");
    expect(inv.paidAt).toBeNull();
  });

  it("generates a pro invoice with $29 amount", async () => {
    await setPlan(db, "u1", "pro", "owner-1");
    const inv = await generateInvoice(db, "u1");
    expect(inv.plan).toBe("pro");
    expect(inv.amountUsd).toBe(29);
    expect(inv.lineItems[0].unitPrice).toBe(29);
    expect(inv.lineItems[0].amount).toBe(29);
  });

  it("is idempotent: same user+period does not duplicate", async () => {
    const first = await generateInvoice(db, "u1");
    const second = await generateInvoice(db, "u1");
    expect(first.id).toBe(second.id);
    const all = await listInvoices(db, "u1");
    expect(all).toHaveLength(1);
  });

  it("listInvoices returns invoices newest first", async () => {
    await setPlan(db, "u1", "pro", "owner-1");
    // Generate for two different periods
    const sepStart = new Date("2026-09-01T00:00:00Z").getTime();
    const octStart = new Date("2026-10-01T00:00:00Z").getTime();
    await generateInvoice(db, "u1", sepStart);
    await generateInvoice(db, "u1", octStart);
    const all = await listInvoices(db, "u1");
    expect(all).toHaveLength(2);
    expect(all[0].periodStart).toBe(octStart);
    expect(all[1].periodStart).toBe(sepStart);
  });

  it("getInvoice returns a single invoice by id", async () => {
    const created = await generateInvoice(db, "u1");
    const fetched = await getInvoice(db, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.plan).toBe("free");
  });

  it("getInvoice returns null for nonexistent id", async () => {
    const fetched = await getInvoice(db, "inv_nonexistent");
    expect(fetched).toBeNull();
  });

  it("markInvoicePaid updates status, paidAt, paidMethod", async () => {
    const inv = await generateInvoice(db, "u1");
    const paid = await markInvoicePaid(db, inv.id, "manual", "owner-1", "bank transfer #123");
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).not.toBeNull();
    expect(paid.paidMethod).toBe("manual");
    expect(paid.notes).toBe("bank transfer #123");
  });

  it("markInvoicePaid throws on already-paid invoice", async () => {
    const inv = await generateInvoice(db, "u1");
    await markInvoicePaid(db, inv.id, "manual", "owner-1");
    await expect(markInvoicePaid(db, inv.id, "manual", "owner-1")).rejects.toThrow(/already paid/);
  });

  it("markInvoicePaid throws on void invoice", async () => {
    const inv = await generateInvoice(db, "u1");
    await voidInvoice(db, inv.id, "owner-1", "duplicate");
    await expect(markInvoicePaid(db, inv.id, "manual", "owner-1")).rejects.toThrow(/void/);
  });

  it("markInvoicePaid throws on nonexistent invoice", async () => {
    await expect(markInvoicePaid(db, "inv_nope", "manual", "owner-1")).rejects.toThrow(/not found/);
  });

  it("voidInvoice updates status to void", async () => {
    const inv = await generateInvoice(db, "u1");
    const voided = await voidInvoice(db, inv.id, "owner-1", "user requested cancel");
    expect(voided.status).toBe("void");
    expect(voided.notes).toBe("user requested cancel");
  });

  it("voidInvoice throws on paid invoice", async () => {
    const inv = await generateInvoice(db, "u1");
    await markInvoicePaid(db, inv.id, "manual", "owner-1");
    await expect(voidInvoice(db, inv.id, "owner-1")).rejects.toThrow(/paid invoice/);
  });

  it("voidInvoice is idempotent on already-void invoice", async () => {
    const inv = await generateInvoice(db, "u1");
    const v1 = await voidInvoice(db, inv.id, "owner-1", "first");
    const v2 = await voidInvoice(db, inv.id, "owner-1", "second");
    expect(v1.status).toBe("void");
    expect(v2.status).toBe("void");
    expect(v2.id).toBe(v1.id);
  });

  it("invoiceFromRow maps snake_case to camelCase and parses line_items JSON", () => {
    const row: InvoiceRow = {
      id: "inv_123",
      user_id: "u1",
      subscription_id: "u1",
      period_start: 1000,
      period_end: 2000,
      plan: "pro",
      amount_usd: 29,
      status: "open",
      line_items: JSON.stringify([{ description: "Pro plan", quantity: 1, unitPrice: 29, amount: 29 }]),
      paid_at: null,
      paid_method: null,
      notes: null,
      created_at: 500,
      updated_at: 600,
    };
    const inv: Invoice = invoiceFromRow(row);
    expect(inv.id).toBe("inv_123");
    expect(inv.userId).toBe("u1");
    expect(inv.periodStart).toBe(1000);
    expect(inv.amountUsd).toBe(29);
    expect(inv.lineItems).toHaveLength(1);
    expect(inv.lineItems[0].description).toBe("Pro plan");
    expect(inv.createdAt).toBe(500);
  });

  it("invoiceFromRow handles malformed line_items JSON gracefully", () => {
    const row: InvoiceRow = {
      id: "inv_123",
      user_id: "u1",
      subscription_id: "u1",
      period_start: 1000,
      period_end: 2000,
      plan: "free",
      amount_usd: 0,
      status: "open",
      line_items: "not json{{{",
      paid_at: null,
      paid_method: null,
      notes: null,
      created_at: 500,
      updated_at: 600,
    };
    const inv = invoiceFromRow(row);
    expect(inv.lineItems).toEqual([]);
  });

  it("generateAllInvoices creates invoices for all registered users", async () => {
    await db.createUser("u1", "u1@test.dev", "hash");
    await db.createUser("u2", "u2@test.dev", "hash");
    await db.createUser("u3", "u3@test.dev", "hash");
    await setPlan(db, "u1", "pro", "owner-1");
    await setPlan(db, "u2", "starter", "owner-1");
    // u3 has no explicit plan → lazily free
    const result = await generateAllInvoices(db);
    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);
    // Second run skips all
    const again = await generateAllInvoices(db);
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(3);
  });

  it("invoice id starts with inv_ prefix", async () => {
    const inv = await generateInvoice(db, "u1");
    expect(inv.id).toMatch(/^inv_/);
  });
});
