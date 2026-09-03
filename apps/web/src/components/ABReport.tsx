import { useCallback, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api, type ABReport as Report } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  groupId: string;
  onClose: () => void;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const fmtDuration = (ms: number) => {
  if (!ms) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
};
const fmtCost = (c: number) => (c ? `$${c.toFixed(4)}` : "$0");
const passTone = (rate: number) =>
  rate >= 0.9 ? "good" : rate >= 0.6 ? "warn" : "bad";

export default function ABReport({ open, groupId, onClose }: Props) {
  const { t } = useTranslation();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.abReport(groupId));
    } catch {
      /* keep previous report on transient failure */
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (!open || !groupId) return;
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [open, groupId, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const allDone =
    report != null &&
    report.arms.length > 0 &&
    report.arms.every((a) => a.done === a.runs && a.runs > 0);
  const winner = report?.arms.find((a) => a.arm === report.recommendedArm);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:abReport.title")}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => void load()}
              disabled={loading}
            >
              {t("common.refresh")}
            </button>
            <Tooltip content={t("common.close")}>
              <button className="icon-btn" onClick={onClose}>
                ✕
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="modal__body">
          {!report ? (
            <p
              className="muted"
              style={{ textAlign: "center", padding: "40px 0" }}
            >
              {t("modals:reports.loading")}
            </p>
          ) : report.arms.length === 0 ? (
            <p className="muted">{t("modals:abReport.empty")}</p>
          ) : (
            <>
              <p className="muted">
                <Trans
                  i18nKey="modals:abReport.groupLine"
                  values={{ id: report.groupId }}
                  components={{ mono: <span className="mono" /> }}
                />
                {!allDone && t("modals:abReport.partial")}
              </p>
              <table className="run-table abtable">
                <thead>
                  <tr>
                    <th>{t("modals:abReport.arm")}</th>
                    <th>{t("modals:abReport.promptVariant")}</th>
                    <th className="num">{t("modals:reports.runs")}</th>
                    <th className="num">{t("modals:reports.passRate")}</th>
                    <th className="num">{t("modals:abReport.qualityScore")}</th>
                    <th className="num">{t("modals:reports.avgRework")}</th>
                    <th className="num">{t("modals:reports.avgDuration")}</th>
                    <th className="num">{t("modals:abReport.avgCost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.arms.map((a) => {
                    const running = a.done < a.runs;
                    const isWinner = a.arm === report.recommendedArm;
                    return (
                      <tr key={a.arm} className={isWinner ? "winner" : ""}>
                        <td className="ab-arm">
                          <span className="ab-arm__label">{a.arm}</span>
                          {isWinner && (
                            <span className="ab-badge is-winner">
                              {t("modals:abReport.recommended")}
                            </span>
                          )}
                          <span
                            className={`ab-badge ${running ? "is-running" : a.done > 0 ? "is-done" : ""}`}
                          >
                            {running
                              ? t("modals:abReport.running", {
                                  done: a.done,
                                  runs: a.runs,
                                })
                              : a.done > 0
                                ? t("modals:abReport.done")
                                : t("modals:abReport.noRuns")}
                          </span>
                        </td>
                        <td className="ab-prompt">{a.prompt ?? "—"}</td>
                        <td>{a.runs}</td>
                        <td
                          className={`num mono eval-rate--${passTone(a.passRate)}`}
                        >
                          {pct(a.passRate)}
                        </td>
                        <td className="num mono">{a.avgScore.toFixed(2)}</td>
                        <td className="num mono">{a.avgRework.toFixed(2)}</td>
                        <td className="num mono">
                          {fmtDuration(a.avgDurationMs)}
                        </td>
                        <td className="num mono">{fmtCost(a.avgCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {winner && allDone && (
                <div className="ab-winner-note">
                  <Trans
                    i18nKey="modals:abReport.winnerNote"
                    values={{ arm: winner.arm, rate: pct(winner.passRate) }}
                    components={{ strong: <strong /> }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
