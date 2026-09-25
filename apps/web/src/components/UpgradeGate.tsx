import { useTranslation } from "react-i18next";
import { useUpgradeGate, type QuotaMetric } from "../store/upgrade-gate";

interface UpgradeGateProps {
  /** Open Settings on the billing tab. */
  onUpgrade: () => void;
  /** Open Settings on the models tab (BYOK path). */
  onUseCustomModel: () => void;
}

const METRIC_KEYS: Record<QuotaMetric, string> = {
  builtin_model: "builtin_model",
  tokens: "tokens",
  video: "video",
  storage: "storage",
  concurrency: "concurrency",
};

/**
 * The 402 `code` decides the guidance, not just the metric.
 *
 * All three blocks surface as `metric: "builtin_model"`, so keying copy on the
 * metric alone tells someone whose payment failed to "upgrade your plan" — and
 * lands them on a billing tab whose actual button says 更新支付方式 / 重新订阅.
 * These reuse `BillingTab`'s own labels so the modal and the page it opens
 * cannot drift apart.
 */
const INACTIVE_COPY: Record<string, { title: string; body: string; cta: string } | undefined> = {
  PAYMENT_REQUIRED: {
    title: "billing:stripe.pastDueTitle",
    body: "billing:stripe.pastDueBody",
    cta: "billing:stripe.updatePayment",
  },
  SUBSCRIPTION_ENDED: {
    title: "billing:stripe.endedTitle",
    body: "billing:stripe.endedBody",
    cta: "billing:stripe.resubscribe",
  },
};

/**
 * Global 402 modal. The run flow parses a structured subscription 402 via
 * parseQuotaError and pushes it into the upgrade-gate store; this component
 * renders the modal without unmounting the canvas (design M2 §S6).
 */
export default function UpgradeGate({ onUpgrade, onUseCustomModel }: UpgradeGateProps) {
  const { t } = useTranslation();
  const block = useUpgradeGate((s) => s.block);
  const close = useUpgradeGate((s) => s.close);
  if (!block) return null;

  const metricKey = block.metric ? METRIC_KEYS[block.metric] : null;
  const inactive = INACTIVE_COPY[block.code];
  // BYOK users can only hit tokens/storage/concurrency/builtin_model — a video
  // block means a built-in video model, so the custom-model path still applies.
  const showCustomModel = block.metric !== "storage" && block.metric !== "concurrency";

  return (
    <div className="modal-backdrop" onClick={close} data-testid="upgrade-gate">
      <div
        className="modal upgrade-gate__card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>{t(inactive?.title ?? "billing:gate.title")}</h2>
          <button type="button" className="link" onClick={close} aria-label="close">
            ×
          </button>
        </div>
        <div className="modal__body">
          {inactive ? (
            <p className="upgrade-gate__reason">{t(inactive.body)}</p>
          ) : (
            metricKey && <p className="upgrade-gate__reason">{t(`billing:gate.metric.${metricKey}`)}</p>
          )}
        </div>
        <div className="modal__footer upgrade-gate__footer">
          <button type="button" className="btn btn--ghost" onClick={close}>
            {t("billing:gate.close")}
          </button>
          {showCustomModel && (
            <button type="button" className="btn btn--ghost" onClick={onUseCustomModel}>
              {t("billing:gate.useCustomModel")}
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              close();
              onUpgrade();
            }}
          >
            {t(inactive?.cta ?? "billing:gate.upgrade")}
          </button>
        </div>
      </div>
    </div>
  );
}
