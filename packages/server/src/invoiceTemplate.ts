/**
 * HTML invoice template (M3 S3, design-monetization-m3-implementation §S3).
 *
 * Renders a self-contained HTML invoice from an Invoice record. The template
 * is print-friendly (A4) and uses only inline CSS so it works as a standalone
 * download. No external fonts or assets — system font stack only.
 *
 * The instance name comes from APP_NAME env (falls back to "Agent World").
 */
import type { Invoice } from "./invoiceService.js";

const APP_NAME = process.env.APP_NAME ?? "Agent World";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Render an invoice as a standalone HTML document.
 * @param invoice The invoice record
 * @param customerEmail Optional customer email to display
 */
export function renderInvoiceHtml(invoice: Invoice, customerEmail?: string): string {
  const lineItemsRows = invoice.lineItems
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.description)}</td>
        <td class="num">${item.quantity}</td>
        <td class="num">${formatMoney(item.unitPrice)}</td>
        <td class="num">${formatMoney(item.amount)}</td>
      </tr>`,
    )
    .join("");

  const statusLabel =
    invoice.status === "paid"
      ? "PAID"
      : invoice.status === "void"
        ? "VOID"
        : invoice.status === "open"
          ? "OPEN"
          : "DRAFT";

  const statusColor =
    invoice.status === "paid"
      ? "#16a34a"
      : invoice.status === "void"
        ? "#6b7280"
        : invoice.status === "open"
          ? "#d97706"
          : "#6b7280";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${escapeHtml(invoice.id)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1f2937;
      background: #f3f4f6;
      padding: 40px 20px;
    }
    .invoice {
      max-width: 800px;
      margin: 0 auto;
      background: #ffffff;
      padding: 48px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 40px;
      padding-bottom: 24px;
      border-bottom: 2px solid #e5e7eb;
    }
    .seller h1 {
      font-size: 24px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 4px;
    }
    .seller p {
      color: #6b7280;
      font-size: 13px;
    }
    .invoice-meta {
      text-align: right;
    }
    .invoice-meta .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      margin-bottom: 2px;
    }
    .invoice-meta .value {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
      font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
    }
    .status-badge {
      display: inline-block;
      margin-top: 8px;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #ffffff;
      background: ${statusColor};
    }
    .parties {
      display: flex;
      justify-content: space-between;
      margin-bottom: 32px;
    }
    .party {
      flex: 1;
    }
    .party .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      margin-bottom: 8px;
    }
    .party .value {
      color: #1f2937;
    }
    .party .value .email {
      color: #6b7280;
      font-size: 13px;
    }
    .period-info {
      background: #f9fafb;
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 32px;
      display: flex;
      gap: 40px;
    }
    .period-info .item .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      margin-bottom: 2px;
    }
    .period-info .item .value {
      font-weight: 600;
      color: #111827;
    }
    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
    }
    table.items th {
      text-align: left;
      padding: 12px 16px;
      background: #f9fafb;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      border-bottom: 2px solid #e5e7eb;
    }
    table.items td {
      padding: 14px 16px;
      border-bottom: 1px solid #e5e7eb;
      color: #1f2937;
    }
    table.items .num {
      text-align: right;
      font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
    }
    .total-row {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 32px;
    }
    .total-box {
      min-width: 240px;
    }
    .total-box .row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
    }
    .total-box .row.total {
      border-top: 2px solid #e5e7eb;
      padding-top: 12px;
      margin-top: 4px;
      font-size: 18px;
      font-weight: 700;
      color: #111827;
    }
    .total-box .row .label {
      color: #6b7280;
    }
    .total-box .row .value {
      font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
    }
    .notes {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
    }
    .notes .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      margin-bottom: 8px;
    }
    .notes .value {
      color: #4b5563;
      font-size: 13px;
    }
    .footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #9ca3af;
      font-size: 12px;
    }
    @media print {
      body { background: #ffffff; padding: 0; }
      .invoice { box-shadow: none; padding: 24px; }
    }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <div class="seller">
        <h1>${escapeHtml(APP_NAME)}</h1>
        <p>Invoice</p>
      </div>
      <div class="invoice-meta">
        <div class="label">Invoice Number</div>
        <div class="value">${escapeHtml(invoice.id)}</div>
        <div class="status-badge">${statusLabel}</div>
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <div class="label">Billed To</div>
        <div class="value">
          <div>${customerEmail ? escapeHtml(customerEmail) : "User " + escapeHtml(invoice.userId.slice(0, 8))}</div>
          ${customerEmail ? `<div class="email">${escapeHtml(customerEmail)}</div>` : ""}
        </div>
      </div>
      <div class="party" style="text-align: right;">
        <div class="label">Invoice Date</div>
        <div class="value">${formatDate(invoice.createdAt)}</div>
      </div>
    </div>

    <div class="period-info">
      <div class="item">
        <div class="label">Billing Period</div>
        <div class="value">${formatDate(invoice.periodStart)} — ${formatDate(invoice.periodEnd)}</div>
      </div>
      <div class="item">
        <div class="label">Plan</div>
        <div class="value">${escapeHtml(invoice.plan.charAt(0).toUpperCase() + invoice.plan.slice(1))}</div>
      </div>
      ${invoice.paidAt ? `
      <div class="item">
        <div class="label">Paid At</div>
        <div class="value">${formatDate(invoice.paidAt)}</div>
      </div>` : ""}
      ${invoice.paidMethod ? `
      <div class="item">
        <div class="label">Payment Method</div>
        <div class="value">${escapeHtml(invoice.paidMethod)}</div>
      </div>` : ""}
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Qty</th>
          <th class="num">Unit Price</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemsRows}
      </tbody>
    </table>

    <div class="total-row">
      <div class="total-box">
        <div class="row total">
          <span class="label">Total</span>
          <span class="value">${formatMoney(invoice.amountUsd)}</span>
        </div>
      </div>
    </div>

    ${invoice.notes ? `
    <div class="notes">
      <div class="label">Notes</div>
      <div class="value">${escapeHtml(invoice.notes)}</div>
    </div>` : ""}

    <div class="footer">
      This invoice was generated by ${escapeHtml(APP_NAME)}. For questions, contact your instance administrator.
    </div>
  </div>
</body>
</html>`;
}
