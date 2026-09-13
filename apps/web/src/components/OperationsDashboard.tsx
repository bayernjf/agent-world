import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber, formatDateTime, formatTime } from "../i18n/utils";
import { api, type OperationsOverview } from "../lib/api";
import { runStatusLabel } from "../lib/run-status";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Hub links to the sibling operations views (RTS phase A5). */
  onOpenReviews?: () => void;
  onOpenCalendar?: () => void;
  onOpenPerformance?: () => void;
  /** Drill into the latest run of a pipeline. */
  onOpenRun?: (runId: string) => void;
  /** RTS stage-B: leave the modal and open the L0 3D macro park. */
  onEnterPark?: () => void;
}

type Window = "today" | "all";

const POLL_MS = 15_000;

/** Start of the local day in epoch ms (the "today" window). */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Compact USD formatting — run costs are often sub-cent. */
function fmtCost(n: number): string {
  if (n === 0) return "0";
  return n < 0.01 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`;
}

/** Relative time, past (last run) or future (next cron). */
function relTime(ts: number, now: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  const hr = Math.round(abs / 3_600_000);
  const day = Math.round(abs / 86_400_000);
  const future = diff > 0;
  if (min < 1) return t("modals:operations.ago.justNow");
  if (min < 60) return t(future ? "modals:operations.ago.futureMinutes" : "modals:operations.ago.minutes", { n: min });
  if (hr < 24) return t(future ? "modals:operations.ago.futureHours" : "modals:operations.ago.hours", { n: hr });
  return t(future ? "modals:operations.ago.futureDays" : "modals:operations.ago.days", { n: day });
}

/** Health class for a pipeline card, worst state wins. */
function cardHealth(g: OperationsOverview["graphs"][number]): string {
  if (g.failed > 0 || g.tripped > 0) return "ops-card--danger";
  if (g.halted > 0) return "ops-card--warn";
  if (g.running > 0) return "ops-card--running";
  return "ops-card--idle";
}

/** RTS phase A4: cross-pipeline operations workbench (flat, pre-3D). */
export default function OperationsDashboard({
  open,
  onClose,
  onOpenReviews,
  onOpenCalendar,
  onOpenPerformance,
  onOpenRun,
  onEnterPark,
}: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<OperationsOverview | null>(null);
  const [win, setWin] = useState<Window>("today");
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const since = win === "today" ? startOfToday() : undefined;
      setData(await api.operationsOverview(since));
      setNow(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    }
  }, [win]);

  useEffect(() => {
    if (!open) return;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, load]);

  const attention = useMemo(
    () => (data ? data.graphs.filter((g) => g.failed > 0 || g.tripped > 0) : []),
    [data],
  );

  if (!open) return null;

  const totals = data?.totals;
  const terminalCount = totals ? totals.done + totals.failed + totals.tripped + totals.cancelled : 0;
  const successRate = terminalCount > 0 && totals ? Math.round((totals.done / terminalCount) * 100) : null;

  const summaryCells: Array<{ key: string; value: string; tone?: string }> = totals
    ? [
        { key: "total", value: formatNumber(totals.totalRuns) },
        { key: "running", value: String(totals.running), tone: totals.running > 0 ? "ops-tone--info" : undefined },
        { key: "halted", value: String(totals.halted), tone: totals.halted > 0 ? "ops-tone--warn" : undefined },
        { key: "done", value: String(totals.done), tone: totals.done > 0 ? "ops-tone--success" : undefined },
        { key: "failed", value: String(totals.failed), tone: totals.failed > 0 ? "ops-tone--danger" : undefined },
        { key: "tripped", value: String(totals.tripped), tone: totals.tripped > 0 ? "ops-tone--danger" : undefined },
        { key: "cancelled", value: String(totals.cancelled) },
        { key: "cost", value: fmtCost(totals.costUsd) },
        { key: "successRate", value: successRate == null ? "—" : `${successRate}%` },
      ]
    : [];

  const go = (fn?: () => void) => () => {
    if (!fn) return;
    onClose();
    fn();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide ops" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2>{t("modals:operations.title")}</h2>
            <span className="ops-subtitle">{t("modals:operations.subtitle")}</span>
          </div>
          <div className="ops-header-actions">
            <div className="seg">
              <button
                className={`seg__btn${win === "today" ? " is-on" : ""}`}
                onClick={() => setWin("today")}
              >
                {t("modals:operations.windowToday")}
              </button>
              <button
                className={`seg__btn${win === "all" ? " is-on" : ""}`}
                onClick={() => setWin("all")}
              >
                {t("modals:operations.windowAll")}
              </button>
            </div>
            <button
              className="btn btn--sm"
              onClick={() => {
                onEnterPark?.();
                onClose();
              }}
            >
              {t("park:title")}
            </button>
            <button className="btn btn--sm" onClick={() => void load()}>
              {t("modals:operations.refresh")}
            </button>
            <Tooltip content={t("common.close")}>
              <button className="icon-btn" onClick={onClose}>
                ✕
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="modal__body">
          {error && <div className="error-text">{error}</div>}

          {/* Hub links to the other operations views */}
          <div className="ops-links">
            <button className="ops-link" onClick={go(onOpenReviews)}>
              {t("modals:operations.links.reviews")}
              {totals && totals.halted > 0 && <span className="ops-badge ops-badge--warn">{totals.halted}</span>}
            </button>
            <button className="ops-link" onClick={go(onOpenCalendar)}>
              {t("modals:operations.links.calendar")}
            </button>
            <button className="ops-link" onClick={go(onOpenPerformance)}>
              {t("modals:operations.links.performance")}
            </button>
            {data && (
              <span className="ops-generated">
                {t("modals:operations.generatedAt", { time: formatTime(data.generatedAt) })}
              </span>
            )}
          </div>

          {/* Summary strip */}
          <div className="ops-summary">
            {summaryCells.map((c) => (
              <div key={c.key} className="ops-stat">
                <span className="ops-stat__label">{t(`modals:operations.summary.${c.key}`)}</span>
                <span className={`ops-stat__value ${c.tone ?? ""}`}>{c.value}</span>
              </div>
            ))}
          </div>

          {/* Attention list */}
          {attention.length > 0 && (
            <section className="ops-attention">
              <h3 className="ops-section-title">{t("modals:operations.attentionTitle")}</h3>
              <div className="ops-attention-list">
                {attention.map((g) => (
                  <button
                    key={g.graphId}
                    className="ops-attention-item"
                    disabled={!g.lastRunId || !onOpenRun}
                    onClick={() => g.lastRunId && onOpenRun?.(g.lastRunId)}
                    title={g.lastRunId ? t("modals:operations.graph.openRun") : undefined}
                  >
                    <span className="ops-attention-name">{g.graphName ?? g.graphId}</span>
                    {g.failed > 0 && <span className="ops-tone--danger">{t("modals:operations.summary.failed")} {g.failed}</span>}
                    {g.tripped > 0 && <span className="ops-tone--danger">{t("modals:operations.summary.tripped")} {g.tripped}</span>}
                    {g.lastStartedAt != null && (
                      <span className="ops-attention-time">{relTime(g.lastStartedAt, now, t)}</span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Pipeline cards */}
          {data && data.graphs.length === 0 && <p className="muted">{t("modals:operations.empty")}</p>}
          <div className="ops-grid">
            {(data?.graphs ?? []).map((g) => {
              const nextMap = data?.nextRuns[g.graphId];
              const nextTs = nextMap ? Math.min(...Object.values(nextMap).filter((v): v is number => v != null)) : null;
              const chips: Array<{ key: string; n: number; cls: string }> = [
                { key: "running", n: g.running, cls: "ops-chip--info" },
                { key: "halted", n: g.halted, cls: "ops-chip--warn" },
                { key: "done", n: g.done, cls: "ops-chip--success" },
                { key: "failed", n: g.failed, cls: "ops-chip--danger" },
                { key: "tripped", n: g.tripped, cls: "ops-chip--danger" },
                { key: "cancelled", n: g.cancelled, cls: "ops-chip--muted" },
              ].filter((c) => c.n > 0);
              return (
                <article key={g.graphId} className={`ops-card ${cardHealth(g)}`}>
                  <header className="ops-card__head">
                    <span className="ops-card__name" title={g.graphName ?? g.graphId}>
                      {g.graphName ?? g.graphId}
                    </span>
                    <span className={`ops-badge ${g.lastStatus ? `ops-status--${g.lastStatus}` : "ops-status--idle"}`}>
                      {g.lastStatus ? runStatusLabel(g.lastStatus) : t("modals:operations.status.idle")}
                    </span>
                  </header>

                  <div className="ops-card__chips">
                    {chips.length === 0 && <span className="muted">{t("modals:operations.graph.never")}</span>}
                    {chips.map((c) => (
                      <span key={c.key} className={`ops-chip ${c.cls}`}>
                        {t(`modals:operations.summary.${c.key}`)} {c.n}
                      </span>
                    ))}
                  </div>

                  <footer className="ops-card__foot">
                    <span className="ops-card__meta">
                      {t("modals:operations.graph.runs", { n: g.totalRuns })} · {t("modals:operations.graph.cost")}{" "}
                      {fmtCost(g.costUsd)}
                    </span>
                    <span className="ops-card__time">
                      {g.lastStartedAt != null ? (
                        <span title={formatDateTime(g.lastStartedAt)}>
                          {t("modals:operations.graph.lastRun")} {relTime(g.lastStartedAt, now, t)}
                        </span>
                      ) : (
                        <span className="muted">{t("modals:operations.graph.never")}</span>
                      )}
                      {nextTs != null && (
                        <span className="ops-card__next" title={formatDateTime(nextTs)}>
                          {t("modals:operations.graph.nextRun")} {relTime(nextTs, now, t)}
                        </span>
                      )}
                    </span>
                    {g.lastRunId && onOpenRun && (
                      <button
                        className="btn btn--sm ops-card__open"
                        onClick={() => onOpenRun(g.lastRunId!)}
                      >
                        {t("modals:operations.graph.openRun")}
                      </button>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
