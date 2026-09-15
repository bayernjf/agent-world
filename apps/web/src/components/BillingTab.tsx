import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PLAN_IDS, PLANS, PLAN_PRICES, type PlanId } from "@agent-world/core";
import { api, BillingApiError, type SubscriptionStatus } from "../lib/api";
import { formatBytes, formatCompactNumber, formatDate } from "../i18n/utils";
import { useToast } from "../store/toast";
import UsagePanel from "./UsagePanel";
import InvoiceList from "./InvoiceList";

// --- Pure decision helpers (exported for unit tests) -----------------------

/** What the action row shows for one plan column in the comparison table. */
export type PlanColumnState =
  | { kind: "current" }
  | { kind: "upgrade" }
  | { kind: "downgrade-in-portal" }
  | { kind: "none" };

export function planColumnState(
  id: PlanId,
  ctx: { currentPlan: PlanId; provider: string | null; stripeUnavailable: boolean },
): PlanColumnState {
  if (id === ctx.currentPlan) return { kind: "current" };
  if (ctx.stripeUnavailable) return { kind: "none" };
  // Self-serve checkout is upgrade-only (strictly higher price); downgrades and
  // plan changes for existing Stripe subscribers happen in the Billing Portal.
  if (PLAN_PRICES[id] > PLAN_PRICES[ctx.currentPlan]) return { kind: "upgrade" };
  return ctx.provider === "stripe" ? { kind: "downgrade-in-portal" } : { kind: "none" };
}

/** Primary manage action shown on the current-plan card. */
export type PrimaryManageAction = "portal" | "update-payment" | "resubscribe" | null;

export function primaryManageAction(
  plan: PlanId,
  provider: string | null,
  status: string,
  stripeUnavailable: boolean,
): PrimaryManageAction {
  if (stripeUnavailable || plan === "free" || provider !== "stripe") return null;
  if (status === "past_due") return "update-payment";
  if (status === "canceled") return "resubscribe";
  if (status === "active" || status === "trialing") return "portal";
  return null;
}

/** Map a server billing error code to the i18n key shown in the toast. */
export function billingErrorKey(code: string): string {
  if (code === "price_missing") return "billing:stripe.errPriceMissing";
  if (code === "no_stripe_customer") return "billing:stripe.errNoCustomer";
  return "billing:stripe.errGeneric";
}

/** Pure plan comparison table (single source of truth = core PLANS). */
export function PlanComparison({
  currentPlan,
  provider,
  stripeUnavailable,
  busyPlan,
  onUpgrade,
}: {
  currentPlan: PlanId;
  provider: string | null;
  stripeUnavailable: boolean;
  busyPlan: PlanId | null;
  onUpgrade: (plan: PlanId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="plan-comparison">
      <h3 className="label">{t("billing:plans.compareTitle")}</h3>
      <table className="plan-comparison__table">
        <thead>
          <tr>
            <th></th>
            {PLAN_IDS.map((id) => (
              <th key={id} className={id === currentPlan ? "is-current" : undefined}>
                {t(`billing:plans.${id}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t("billing:plans.priceLabel")}</td>
            {PLAN_IDS.map((id) => (
              <td key={id} className={id === currentPlan ? "is-current" : undefined}>
                {PLAN_PRICES[id] === 0
                  ? t("billing:plans.priceFree")
                  : t("billing:plans.pricePerMonth", { price: PLAN_PRICES[id] })}
              </td>
            ))}
          </tr>
          <tr>
            <td>{t("billing:plans.tokensQuota")}</td>
            {PLAN_IDS.map((id) => (
              <td key={id} className={id === currentPlan ? "is-current" : undefined}>
                {PLANS[id].tokens === 0 ? "—" : formatCompactNumber(PLANS[id].tokens)}
              </td>
            ))}
          </tr>
          <tr>
            <td>{t("billing:plans.videoQuota")}</td>
            {PLAN_IDS.map((id) => (
              <td key={id} className={id === currentPlan ? "is-current" : undefined}>
                {PLANS[id].videoSegments === 0 ? "—" : PLANS[id].videoSegments}
              </td>
            ))}
          </tr>
          <tr>
            <td>{t("billing:plans.storageQuota")}</td>
            {PLAN_IDS.map((id) => (
              <td key={id} className={id === currentPlan ? "is-current" : undefined}>
                {formatBytes(PLANS[id].storageBytes)}
              </td>
            ))}
          </tr>
          <tr>
            <td>{t("billing:plans.concurrencyQuota")}</td>
            {PLAN_IDS.map((id) => (
              <td key={id} className={id === currentPlan ? "is-current" : undefined}>
                {PLANS[id].concurrentRuns}
              </td>
            ))}
          </tr>
          <tr>
            <td>{t("billing:stripe.actionRow")}</td>
            {PLAN_IDS.map((id) => {
              const col = planColumnState(id, { currentPlan, provider, stripeUnavailable });
              const busy = busyPlan === id;
              return (
                <td key={id} className={id === currentPlan ? "is-current" : undefined}>
                  {col.kind === "current" && (
                    <span className="plan-comparison__current">{t("billing:stripe.currentColumn")}</span>
                  )}
                  {col.kind === "upgrade" && (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={busyPlan !== null}
                      onClick={() => onUpgrade(id)}
                    >
                      {busy ? t("billing:stripe.redirecting") : t("billing:stripe.upgradeTo", { plan: t(`billing:plans.${id}`) })}
                    </button>
                  )}
                  {col.kind === "downgrade-in-portal" && (
                    <span className="plan-comparison__hint">{t("billing:stripe.downgradeHint")}</span>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Settings → billing tab content: current plan card, usage, comparison. */
export default function BillingTab() {
  const { t, i18n } = useTranslation();
  const showToast = useToast((s) => s.show);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [failed, setFailed] = useState(false);
  // Stripe is disabled on this instance once a billing call returns 503.
  const [stripeUnavailable, setStripeUnavailable] = useState(false);
  // In-flight action, used to disable buttons and show a redirecting label.
  const [busyPlan, setBusyPlan] = useState<PlanId | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getSubscription()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const handleError = (err: unknown) => {
    if (err instanceof BillingApiError && err.code === "stripe_not_configured") {
      // No Stripe key on this server → silently fall back to manual contact.
      setStripeUnavailable(true);
      return;
    }
    const code = err instanceof BillingApiError ? err.code : "";
    showToast(t(billingErrorKey(code)), { ttlMs: 6000 });
  };

  const handleUpgrade = async (plan: PlanId) => {
    if (busyPlan !== null) return;
    setBusyPlan(plan);
    try {
      const session = await api.createCheckoutSession(plan);
      window.location.assign(session.url);
    } catch (err) {
      setBusyPlan(null);
      handleError(err);
    }
  };

  const handlePortal = async () => {
    if (portalBusy) return;
    setPortalBusy(true);
    try {
      const session = await api.createPortalSession();
      window.location.assign(session.url);
    } catch (err) {
      setPortalBusy(false);
      handleError(err);
    }
  };

  if (failed) return <p className="billing-hint">{t("billing:usage.error")}</p>;
  if (!status) return <p className="billing-hint">{t("billing:usage.loading")}</p>;

  const plan = status.plan;
  const price = PLAN_PRICES[plan];
  const manage = primaryManageAction(plan, status.provider, status.status, stripeUnavailable);
  const pastDue = status.provider === "stripe" && status.status === "past_due" && !stripeUnavailable;

  return (
    <div className="billing-tab">
      <div className="billing-current">
        <div>
          <div className="billing-current__plan">
            {t(`billing:plans.${plan}`)}
            <span className="billing-current__badge">{t("billing:plans.current")}</span>
          </div>
          <div className="billing-current__meta">
            {price === 0
              ? t("billing:freeForever")
              : t("billing:plans.pricePerMonth", { price })}
            {" · "}
            {t("billing:renewsAt", { date: formatDate(status.currentPeriodEnd, i18n.language) })}
          </div>
        </div>
        {manage && (
          <div className="billing-actions">
            {manage === "portal" && (
              <button type="button" className="btn btn--secondary" disabled={portalBusy} onClick={() => void handlePortal()}>
                {portalBusy ? t("billing:stripe.redirecting") : t("billing:stripe.manageSubscription")}
              </button>
            )}
            {manage === "update-payment" && (
              <button type="button" className="btn btn--primary" disabled={portalBusy} onClick={() => void handlePortal()}>
                {portalBusy ? t("billing:stripe.redirecting") : t("billing:stripe.updatePayment")}
              </button>
            )}
            {manage === "resubscribe" && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={busyPlan !== null}
                onClick={() => void handleUpgrade(plan)}
              >
                {busyPlan === plan ? t("billing:stripe.redirecting") : t("billing:stripe.resubscribe")}
              </button>
            )}
          </div>
        )}
      </div>

      {pastDue && (
        <div className="billing-warning" role="alert">
          <strong>{t("billing:stripe.pastDueTitle")}</strong>
          <span>{t("billing:stripe.pastDueBody")}</span>
        </div>
      )}

      <UsagePanel status={status} />

      <InvoiceList />

      {stripeUnavailable && <p className="billing-hint">{t("billing:contactOwner")}</p>}

      <PlanComparison
        currentPlan={plan}
        provider={status.provider}
        stripeUnavailable={stripeUnavailable}
        busyPlan={busyPlan}
        onUpgrade={(p) => void handleUpgrade(p)}
      />
    </div>
  );
}
