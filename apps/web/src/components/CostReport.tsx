import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type CostReport as Report } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Range = "7d" | "30d" | "all";
type Granularity = "day" | "week" | "month";

/** Key order is what lays the segmented control out. */
const RANGE_KEY: Record<Range, string> = {
  "7d": "modals:reports.range7d",
  "30d": "modals:reports.range30d",
  all: "common.all",
};

const GRAN_KEY: Record<Granularity, string> = {
  day: "modals:costReport.granDay",
  week: "modals:costReport.granWeek",
  month: "modals:costReport.granMonth",
};

/** Smart default granularity based on time range. */
function defaultGranularity(range: Range): Granularity {
  if (range === "7d") return "day";
  if (range === "30d") return "week";
  return "month";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeToBounds(range: Range): { from?: number; to?: number } {
  if (range === "all") return {};
  const days = range === "7d" ? 7 : 30;
  return { from: Date.now() - days * DAY_MS };
}

const fmtUsd = (n: number) => `$${n.toFixed(5)}`;

export default function CostReport({ open, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const fmtInt = (n: number) => n.toLocaleString(i18n.language);
  const [range, setRange] = useState<Range>("30d");
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  // When the range changes, pick a sensible default granularity.
  useEffect(() => {
    setGranularity(defaultGranularity(range));
  }, [range]);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    try {
      const bounds = rangeToBounds(r);
      setReport(await api.costReport(bounds.from, bounds.to));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load(range);
  }, [open, range, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const csvHref = useMemo(() => {
    const b = rangeToBounds(range);
    const qs = new URLSearchParams();
    if (b.from !== undefined) qs.set("from", String(b.from));
    if (b.to !== undefined) qs.set("to", String(b.to));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return `/api/costs.csv${suffix}`;
  }, [range]);

  const chartData = useMemo(() => {
    if (!report)
      return {
        rows: [] as Array<{
          cost_usd: number;
          runs: number;
          day?: string;
          week?: string;
          month?: string;
        }>,
      };
    if (granularity === "week") return { rows: report.byWeek };
    if (granularity === "month") return { rows: report.byMonth };
    return { rows: report.byDay };
  }, [report, granularity]);

  const maxChartCost = useMemo(
    () => Math.max(1, ...chartData.rows.map((d) => d.cost_usd)),
    [chartData],
  );

  const chartLabel = (d: { day?: string; week?: string; month?: string }) => {
    if (granularity === "week") return d.week ? d.week.slice(2) : ""; // 2026-W33 → W33
    if (granularity === "month") return d.month ?? ""; // 2026-08
    return d.day ? d.day.slice(5) : ""; // MM-DD
  };

  const chartKey = (d: { day?: string; week?: string; month?: string }) =>
    d.day ?? d.week ?? d.month ?? "";

  if (!open) return null;

  const totals = report?.totals;
  const reworkCost =
    report?.byAttempt
      .filter((a) => a.attempt > 1)
      .reduce((sum, a) => sum + a.cost_usd, 0) ?? 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:costReport.title")}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="seg">
              {(Object.keys(RANGE_KEY) as Range[]).map((r) => (
                <button
                  key={r}
                  className={`seg__btn ${range === r ? "is-on" : ""}`}
                  onClick={() => setRange(r)}
                >
                  {t(RANGE_KEY[r])}
                </button>
              ))}
            </div>
            <div className="seg">
              {(Object.keys(GRAN_KEY) as Granularity[]).map((g) => (
                <button
                  key={g}
                  className={`seg__btn ${granularity === g ? "is-on" : ""}`}
                  onClick={() => setGranularity(g)}
                >
                  {t(GRAN_KEY[g])}
                </button>
              ))}
            </div>
            <a
              className="chip"
              href={csvHref}
              download
              onClick={(e) => {
                if (!report) e.preventDefault();
              }}
            >
              {t("modals:reports.exportCsv")}
            </a>
            <Tooltip content={t("common.close")}>
              <button className="icon-btn" onClick={onClose}>
                ✕
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="modal__body">
          {loading || !report || !totals ? (
            <p
              className="muted"
              style={{ textAlign: "center", padding: "40px 0" }}
            >
              {loading ? t("modals:reports.loading") : t("common.empty")}
            </p>
          ) : (
            <>
              <div className="cost-stats">
                <div className="cost-stat">
                  <div className="cost-stat__label">
                    {t("modals:costReport.totalCost")}
                  </div>
                  <div className="cost-stat__value cost-stat__value--accent">
                    {fmtUsd(totals.cost_usd)}
                  </div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">
                    {t("modals:reports.runCount")}
                  </div>
                  <div className="cost-stat__value">{totals.runs}</div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">
                    {t("modals:costReport.tokensIn")}
                  </div>
                  <div className="cost-stat__value">
                    {fmtInt(totals.tokens_in)}
                  </div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">
                    {t("modals:costReport.tokensOut")}
                  </div>
                  <div className="cost-stat__value">
                    {fmtInt(totals.tokens_out)}
                  </div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">
                    {t("modals:costReport.cachedTokens")}
                  </div>
                  <div className="cost-stat__value">
                    {fmtInt(totals.cached_tokens)}
                  </div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">
                    {t("modals:costReport.reworkCost")}
                  </div>
                  <div className="cost-stat__value cost-stat__value--warn">
                    {fmtUsd(reworkCost)}
                  </div>
                </div>
              </div>

              {chartData.rows.length > 0 && (
                <section className="cost-section">
                  <h3 className="cost-section__title">
                    {t("modals:costReport.trend", {
                      gran: t(GRAN_KEY[granularity]),
                    })}
                  </h3>
                  <div className="cost-chart">
                    {chartData.rows.map((d) => (
                      <div
                        className="cost-chart__col"
                        key={chartKey(d)}
                        title={t("modals:costReport.barTitle", {
                          key: chartKey(d),
                          cost: fmtUsd(d.cost_usd),
                          runs: d.runs,
                        })}
                      >
                        <div className="cost-chart__bar-wrap">
                          <div
                            className="cost-chart__bar"
                            style={{
                              height: `${Math.max(2, (d.cost_usd / maxChartCost) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="cost-chart__label">{chartLabel(d)}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="cost-section">
                <h3 className="cost-section__title">
                  {t("modals:reports.byGraph")}
                </h3>
                {report.byGraph.length === 0 ? (
                  <p className="muted">{t("common.empty")}</p>
                ) : (
                  <table className="run-table cost-table">
                    <thead>
                      <tr>
                        <th>{t("modals:reports.graph")}</th>
                        <th>{t("modals:reports.runs")}</th>
                        <th className="num">{t("modals:costReport.thInput")}</th>
                        <th className="num">
                          {t("modals:costReport.thOutput")}
                        </th>
                        <th className="num">{t("modals:costReport.thCost")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byGraph.map((g) => (
                        <tr key={g.graph_id}>
                          <td className="run-table__name">{g.graph_name}</td>
                          <td>{g.runs}</td>
                          <td className="num mono">{fmtInt(g.tokens_in)}</td>
                          <td className="num mono">{fmtInt(g.tokens_out)}</td>
                          <td className="num mono">{fmtUsd(g.cost_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="cost-section">
                <h3 className="cost-section__title">
                  {t("modals:costReport.topNodes", { n: report.byNode.length })}
                </h3>
                {report.byNode.length === 0 ? (
                  <p className="muted">{t("common.empty")}</p>
                ) : (
                  <table className="run-table cost-table">
                    <thead>
                      <tr>
                        <th>{t("modals:reports.graph")}</th>
                        <th>{t("modals:costReport.thNode")}</th>
                        <th className="num">
                          {t("modals:costReport.thAttempts")}
                        </th>
                        <th className="num">
                          {t("modals:costReport.thRework")}
                        </th>
                        <th className="num">{t("modals:costReport.thCost")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byNode.map((n, i) => (
                        <tr key={`${n.graph_id}-${n.node_id}`}>
                          <td className="muted">{n.graph_name}</td>
                          <td className="mono">{n.node_name}</td>
                          <td className="num mono">{n.attempts}</td>
                          <td className="num mono">
                            {n.reworks > 0 ? n.reworks : "—"}
                          </td>
                          <td className="num mono">{fmtUsd(n.cost_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
