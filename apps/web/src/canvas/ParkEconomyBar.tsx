/**
 * ParkEconomyBar — RTS stage-C C4 account-wide economy HUD for the L0 park.
 *
 * Sits as an HTML overlay above CanvasPark (not a 3D object): current calendar
 * month spend, in/out token usage and a remaining-budget bar. All numbers come
 * from the operations overview totals — no separate accounting path (the bar
 * must agree with the cost report and the per-run power meter).
 */
import { useTranslation } from "react-i18next";
import { formatNumber } from "../i18n/utils";
import type { OperationsTotals } from "../lib/api";

/** Same cost formatting as OperationsDashboard (sub-cent precision when tiny). */
function num(n: number | null | undefined): number {
  return typeof n === "number" && isFinite(n) ? n : 0;
}

export function fmtCost(n: number | null | undefined): string {
  const v = num(n);
  if (v > 0 && v < 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

/** Compact token counts (1.2k / 3.4M), full number below 1000. */
export function fmtTokens(n: number | null | undefined): string {
  const v = num(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return formatNumber(v);
}

export default function ParkEconomyBar({ totals }: { totals: OperationsTotals | null | undefined }) {
  const { t } = useTranslation();
  if (!totals) return null;

  const budget = num(totals.monthlyBudgetUsd);
  const cost = num(totals.monthCostUsd);
  const ratio = budget > 0 ? cost / budget : null;
  const pct = ratio === null ? 0 : Math.min(100, ratio * 100);
  const tone = ratio === null ? "" : ratio >= 1 ? "is-over" : ratio >= 0.8 ? "is-warn" : "is-ok";

  return (
    <div className="park-economy" data-testid="park-economy">
      <div className="park-economy__item">
        <span className="park-economy__label">{t("park:economy.monthCost")}</span>
        <span className="park-economy__value park-economy__value--cost">
          {fmtCost(totals.monthCostUsd)}
        </span>
      </div>
      <div className="park-economy__item">
        <span className="park-economy__label">{t("park:economy.tokens")}</span>
        <span className="park-economy__value">
          {t("park:economy.tokensInOut", { in: fmtTokens(totals.tokensIn), out: fmtTokens(totals.tokensOut) })}
        </span>
      </div>
      {ratio !== null && (
        <div className={`park-economy__budget ${tone}`} data-testid="park-economy-budget">
          <div className="park-economy__budget-head">
            <span className="park-economy__label">{t("park:economy.budget")}</span>
            <span className="park-economy__pct">{pct.toFixed(0)}%</span>
          </div>
          <div className="park-economy__bar">
            <div className="park-economy__fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="park-economy__budget-foot">
            {t("park:economy.budgetLeft", { left: fmtCost(Math.max(0, budget - cost)) })}
          </div>
        </div>
      )}
    </div>
  );
}
