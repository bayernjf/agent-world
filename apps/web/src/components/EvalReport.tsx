import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type EvalReport as Report } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
  graphId?: string;
}

type Range = "7d" | "30d" | "all";

/** Key order is what lays the segmented control out. */
const RANGE_KEY: Record<Range, string> = {
  "7d": "modals:reports.range7d",
  "30d": "modals:reports.range30d",
  all: "common.all",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeToBounds(range: Range): { from?: number; to?: number } {
  if (range === "all") return {};
  const days = range === "7d" ? 7 : 30;
  return { from: Date.now() - days * DAY_MS };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const fmtScore = (n: number) => (n > 0 ? n.toFixed(1) : "—");
const fmtDuration = (ms: number) => {
  if (!ms) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
};

function passTone(rate: number): string {
  if (rate >= 0.9) return "good";
  if (rate >= 0.6) return "warn";
  return "bad";
}

export default function EvalReport({ open, onClose, graphId }: Props) {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>("30d");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (r: Range) => {
      setLoading(true);
      try {
        const bounds = rangeToBounds(r);
        setReport(await api.evalReport({ graphId, ...bounds }));
      } finally {
        setLoading(false);
      }
    },
    [graphId],
  );

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

  const maxPass = useMemo(
    () =>
      report ? Math.max(0.0001, ...report.byDay.map((d) => d.passRate)) : 1,
    [report],
  );

  const promptsByGraph = useMemo(() => {
    const map = new Map<string, NonNullable<Report>["byPrompt"]>();
    for (const p of report?.byPrompt ?? []) {
      const arr = map.get(p.graph_id) ?? [];
      arr.push(p);
      map.set(p.graph_id, arr);
    }
    return map;
  }, [report]);

  if (!open) return null;

  const totals = report?.totals;

  const evalCsvHref = (() => {
    const p = new URLSearchParams();
    if (graphId) p.set("graphId", graphId);
    const b = rangeToBounds(range);
    if (b.from !== undefined) p.set("from", String(b.from));
    if (b.to !== undefined) p.set("to", String(b.to));
    return `/api/eval.csv?${p.toString()}`;
  })();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:evalReport.title")}</h2>
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
            <a className="btn" href={evalCsvHref}>
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
                    {t("modals:reports.passRate")}
                  </div>
                  <div
                    className={`cost-stat__value cost-stat__value--${passTone(totals.passRate)}`}
                  >
                    {pct(totals.passRate)}
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
                    {t("modals:evalReport.passedOverTotal")}
                  </div>
                  <div className="cost-stat__value">
                    {totals.passed}/{totals.runs}
                  </div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">
                    {t("modals:reports.avgRework")}
                  </div>
                  <div className="cost-stat__value">
                    {totals.avgRework.toFixed(2)}
                  </div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">
                    {t("modals:reports.avgDuration")}
                  </div>
                  <div className="cost-stat__value">
                    {fmtDuration(totals.avgDurationMs)}
                  </div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">
                    {t("modals:evalReport.avgScoreStat")}
                  </div>
                  <div className="cost-stat__value">
                    {fmtScore(totals.avgScore)}
                  </div>
                </div>
              </div>

              {report.byDay.length > 0 && (
                <section className="cost-section">
                  <h3 className="cost-section__title">
                    {t("modals:evalReport.dailyTrend")}
                  </h3>
                  <div className="cost-chart">
                    {report.byDay.map((d) => (
                      <div
                        className="cost-chart__col"
                        key={d.day}
                        title={t("modals:evalReport.barTitle", {
                          day: d.day,
                          rate: pct(d.passRate),
                          passed: d.passed,
                          runs: d.runs,
                        })}
                      >
                        <div className="cost-chart__bar-wrap">
                          <div
                            className={`cost-chart__bar cost-chart__bar--${passTone(d.passRate)}`}
                            style={{
                              height: `${Math.max(2, (d.passRate / maxPass) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="cost-chart__label">
                          {d.day.slice(5)}
                        </div>
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
                        <th className="num">{t("modals:reports.runs")}</th>
                        <th className="num">{t("modals:reports.passRate")}</th>
                        <th className="num">{t("modals:reports.avgRework")}</th>
                        <th className="num">{t("modals:reports.avgDuration")}</th>
                        <th className="num">{t("modals:reports.avgScore")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byGraph.map((g) => (
                        <tr key={g.graph_id}>
                          <td className="run-table__name">{g.graph_name}</td>
                          <td>{g.runs}</td>
                          <td
                            className={`num mono eval-rate--${passTone(g.passRate)}`}
                          >
                            {pct(g.passRate)}
                          </td>
                          <td className="num mono">{g.avgRework.toFixed(2)}</td>
                          <td className="num mono">
                            {fmtDuration(g.avgDurationMs)}
                          </td>
                          <td className="num mono">{fmtScore(g.avgScore)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="cost-section">
                <h3 className="cost-section__title">
                  {t("modals:evalReport.promptVersions")}
                </h3>
                <p className="muted cost-section__hint">
                  {t("modals:evalReport.promptVersionsHint")}
                </p>
                {report.byPrompt.length === 0 ? (
                  <p className="muted">{t("common.empty")}</p>
                ) : (
                  <table className="run-table cost-table">
                    <thead>
                      <tr>
                        <th>{t("modals:reports.graph")}</th>
                        <th>{t("modals:evalReport.thVersion")}</th>
                        <th className="num">{t("modals:reports.runs")}</th>
                        <th className="num">{t("modals:reports.passRate")}</th>
                        <th className="num">{t("modals:reports.avgRework")}</th>
                        <th className="num">{t("modals:reports.avgDuration")}</th>
                        <th className="num">{t("modals:reports.avgScore")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...promptsByGraph.entries()].flatMap(([gid, rows]) =>
                        rows.map((p) => (
                          <tr key={`${gid}-${p.fingerprint}`}>
                            <td className="run-table__name">{p.graph_name}</td>
                            <td className="mono">
                              {p.version}
                              <span className="muted"> · {p.fingerprint}</span>
                            </td>
                            <td>{p.runs}</td>
                            <td
                              className={`num mono eval-rate--${passTone(p.passRate)}`}
                            >
                              {pct(p.passRate)}
                            </td>
                            <td className="num mono">
                              {p.avgRework.toFixed(2)}
                            </td>
                            <td className="num mono">
                              {fmtDuration(p.avgDurationMs)}
                            </td>
                            <td className="num mono">{fmtScore(p.avgScore)}</td>
                          </tr>
                        )),
                      )}
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
