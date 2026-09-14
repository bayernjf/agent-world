import { useTranslation } from "react-i18next";
import type { SubscriptionStatus } from "../lib/api";
import { formatBytes, formatCompactNumber, formatNumber } from "../i18n/utils";

/** Ratio → bar colour token. >=100% alert, 80–100% warn, else ok. */
export function meterColor(ratio: number): string {
  if (ratio >= 1) return "var(--alert)";
  if (ratio >= 0.8) return "var(--warn)";
  return "var(--ok)";
}

function clampPct(ratio: number): number {
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

interface MeterProps {
  id: string;
  label: string;
  usedText: string;
  /** 0..1+ fill ratio; Infinity when the plan grants no quota (free tier). */
  ratio: number;
  /** A zero-limit dimension (free built-in tokens / video) renders as a full, muted bar. */
  zeroLimit?: boolean;
}

function Meter({ id, label, usedText, ratio, zeroLimit }: MeterProps) {
  const pct = zeroLimit ? 100 : clampPct(ratio);
  const color = zeroLimit ? "var(--ink-faint)" : meterColor(ratio);
  return (
    <div className="usage-meter" data-testid={`usage-${id}`}>
      <div className="usage-meter__head">
        <span className="usage-meter__label">{label}</span>
        <span className="usage-meter__value">{usedText}</span>
      </div>
      <div
        className="usage-meter__track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="usage-meter__fill"
          data-testid={`usage-${id}-fill`}
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function UsagePanel({ status }: { status: SubscriptionStatus }) {
  const { t } = useTranslation();
  const u = status.usage;

  const tokenRatio = u.tokensLimit > 0 ? u.tokensNormalized / u.tokensLimit : Infinity;
  const videoRatio = u.videoLimit > 0 ? u.videoSegments / u.videoLimit : Infinity;
  const storageRatio = u.storageLimit > 0 ? u.storageBytes / u.storageLimit : Infinity;
  const concurrencyRatio = u.concurrentLimit > 0 ? u.activeRuns / u.concurrentLimit : Infinity;

  return (
    <div className="usage-panel">
      <h3 className="label">{t("billing:usage.title")}</h3>

      <Meter
        id="tokens"
        label={t("billing:usage.tokens")}
        usedText={
          u.tokensLimit > 0
            ? t("billing:usage.usedOfLimit", {
                used: formatCompactNumber(u.tokensNormalized),
                limit: formatCompactNumber(u.tokensLimit),
              })
            : formatCompactNumber(u.tokensNormalized)
        }
        ratio={tokenRatio}
        zeroLimit={u.tokensLimit === 0}
      />

      <Meter
        id="video"
        label={t("billing:usage.video")}
        usedText={
          u.videoLimit > 0
            ? t("billing:usage.usedOfLimit", { used: u.videoSegments, limit: u.videoLimit })
            : t("billing:usage.segments", { count: u.videoSegments })
        }
        ratio={videoRatio}
        zeroLimit={u.videoLimit === 0}
      />

      <Meter
        id="storage"
        label={t("billing:usage.storage")}
        usedText={
          u.storageLimit > 0
            ? t("billing:usage.usedOfLimit", {
                used: formatBytes(u.storageBytes),
                limit: formatBytes(u.storageLimit),
              })
            : formatBytes(u.storageBytes)
        }
        ratio={storageRatio}
      />

      <Meter
        id="concurrency"
        label={t("billing:usage.concurrency")}
        usedText={t("billing:usage.usedOfLimit", {
          used: formatNumber(u.activeRuns),
          limit: formatNumber(u.concurrentLimit),
        })}
        ratio={concurrencyRatio}
      />
    </div>
  );
}
