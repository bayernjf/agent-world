import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PLAN_IDS, PLANS, PLAN_PRICES, type PlanId } from "@agent-world/core";
import { api, type SubscriptionStatus } from "../lib/api";
import { formatBytes, formatCompactNumber, formatDate } from "../i18n/utils";
import UsagePanel from "./UsagePanel";
import InvoiceList from "./InvoiceList";

/** Pure plan comparison table (single source of truth = core PLANS). */
export function PlanComparison({ currentPlan }: { currentPlan: PlanId }) {
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
        </tbody>
      </table>
    </div>
  );
}

/** Settings → billing tab content: current plan card, usage, comparison. */
export default function BillingTab() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [failed, setFailed] = useState(false);

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

  if (failed) return <p className="billing-hint">{t("billing:usage.error")}</p>;
  if (!status) return <p className="billing-hint">{t("billing:usage.loading")}</p>;

  const plan = status.plan;
  const price = PLAN_PRICES[plan];

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
      </div>

      <UsagePanel status={status} />

      <InvoiceList />

      <p className="billing-hint">{t("billing:contactOwner")}</p>

      <PlanComparison currentPlan={plan} />
    </div>
  );
}
