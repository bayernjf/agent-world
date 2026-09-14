import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Invoice } from "../lib/api";
import { formatDate } from "../i18n/utils";

const STATUS_LABEL_KEY: Record<Invoice["status"], string> = {
  draft: "billing:invoices.statusDraft",
  open: "billing:invoices.statusOpen",
  paid: "billing:invoices.statusPaid",
  void: "billing:invoices.statusVoid",
};

const STATUS_CLASS: Record<Invoice["status"], string> = {
  draft: "invoice-status--draft",
  open: "invoice-status--open",
  paid: "invoice-status--paid",
  void: "invoice-status--void",
};

/** Invoice detail modal (M3 S2). Shows line items, payment info, notes. */
function InvoiceDetailModal({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  if (!invoice) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("billing:invoices.detail.title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("billing:invoices.detail.close")}>
            ✕
          </button>
        </div>
        <div className="modal__body">
          <dl className="invoice-detail__grid">
            <dt>{t("billing:invoices.detail.invoiceId")}</dt>
            <dd className="mono">{invoice.id}</dd>

            <dt>{t("billing:invoices.detail.plan")}</dt>
            <dd>{t(`billing:plans.${invoice.plan}`)}</dd>

            <dt>{t("billing:invoices.period")}</dt>
            <dd>
              {formatDate(invoice.periodStart, i18n.language)} — {formatDate(invoice.periodEnd, i18n.language)}
            </dd>

            <dt>{t("billing:invoices.amount")}</dt>
            <dd>
              {invoice.amountUsd === 0 ? t("billing:plans.priceFree") : `$${invoice.amountUsd.toFixed(2)}`}
            </dd>

            <dt>{t("billing:invoices.status")}</dt>
            <dd>
              <span className={`invoice-status ${STATUS_CLASS[invoice.status]}`}>
                {t(STATUS_LABEL_KEY[invoice.status])}
              </span>
            </dd>

            {invoice.paidAt && (
              <>
                <dt>{t("billing:invoices.detail.paidAt")}</dt>
                <dd>{formatDate(invoice.paidAt, i18n.language)}</dd>
              </>
            )}

            {invoice.paidMethod && (
              <>
                <dt>{t("billing:invoices.detail.paidMethod")}</dt>
                <dd>{invoice.paidMethod}</dd>
              </>
            )}

            {invoice.notes && (
              <>
                <dt>{t("billing:invoices.detail.notes")}</dt>
                <dd>{invoice.notes}</dd>
              </>
            )}
          </dl>

          <h3 className="invoice-detail__section-title">{t("billing:invoices.detail.lineItems")}</h3>
          <table className="invoice-detail__items">
            <thead>
              <tr>
                <th>{t("billing:invoices.detail.plan")}</th>
                <th className="num">{t("billing:invoices.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item, idx) => (
                <tr key={idx}>
                  <td>
                    {item.description}
                    {item.quantity > 1 && ` × ${item.quantity}`}
                  </td>
                  <td className="num">${item.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{t("billing:invoices.amount")}</th>
                <th className="num">${invoice.amountUsd.toFixed(2)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Billing invoice history list (M3 S2). Fetches /api/invoices on mount. */
export default function InvoiceList() {
  const { t, i18n } = useTranslation();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getInvoices()
      .then((res) => alive && setInvoices(res.invoices))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return <p className="billing-hint">{t("billing:invoices.error")}</p>;
  if (!invoices) return <p className="billing-hint">{t("billing:invoices.loading")}</p>;

  return (
    <div className="invoice-list">
      <h3 className="label">{t("billing:invoices.title")}</h3>

      {invoices.length === 0 ? (
        <p className="billing-hint">{t("billing:invoices.empty")}</p>
      ) : (
        <table className="invoice-list__table">
          <thead>
            <tr>
              <th>{t("billing:invoices.period")}</th>
              <th>{t("billing:invoices.detail.plan")}</th>
              <th className="num">{t("billing:invoices.amount")}</th>
              <th>{t("billing:invoices.status")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>
                  {formatDate(inv.periodStart, i18n.language)} — {formatDate(inv.periodEnd, i18n.language)}
                </td>
                <td>{t(`billing:plans.${inv.plan}`)}</td>
                <td className="num">
                  {inv.amountUsd === 0 ? t("billing:plans.priceFree") : `$${inv.amountUsd.toFixed(2)}`}
                </td>
                <td>
                  <span className={`invoice-status ${STATUS_CLASS[inv.status]}`}>
                    {t(STATUS_LABEL_KEY[inv.status])}
                  </span>
                </td>
                <td>
                  <button className="btn btn--ghost" onClick={() => setSelected(inv)}>
                    {t("billing:invoices.viewDetail")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <InvoiceDetailModal invoice={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
