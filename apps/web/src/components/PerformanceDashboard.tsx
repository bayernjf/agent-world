import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type ContentMetric, type PerformanceAggregate } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
}

const GROUP_OPTIONS = [
  { value: "graph_id", key: "graph" },
  { value: "platform", key: "platform" },
  { value: "product_id", key: "product" },
  { value: "artifact_id", key: "artifact" },
] as const;

function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function ratio(n: number, d: number): string {
  if (!d) return "—";
  return (n / d).toFixed(2);
}

/** F6: performance dashboard — content effect metrics with a funnel and aggregation. */
export default function PerformanceDashboard({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<ContentMetric[]>([]);
  const [aggregates, setAggregates] = useState<PerformanceAggregate[]>([]);
  const [groupBy, setGroupBy] = useState("graph_id");
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    platform: "",
    externalContentId: "",
    impressions: "0",
    clicks: "0",
    conversions: "0",
    gmv: "0",
    adSpend: "0",
  });

  const load = useCallback(async () => {
    try {
      setMetrics(await api.listMetrics());
      setAggregates(await api.aggregatePerformance(groupBy));
    } catch {
      /* ignore transient failures */
    }
  }, [groupBy]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, load]);

  const totals = useMemo(() => {
    const sum = (f: (m: ContentMetric) => number) => metrics.reduce((acc, m) => acc + f(m), 0);
    const impressions = sum((m) => m.impressions);
    const clicks = sum((m) => m.clicks);
    const conversions = sum((m) => m.conversions);
    const gmv = sum((m) => m.gmv);
    const adSpend = sum((m) => m.adSpend);
    return { impressions, clicks, conversions, gmv, adSpend };
  }, [metrics]);

  if (!open) return null;

  const addMetric = async () => {
    setError(null);
    const n = (s: string) => (s.trim() === "" ? 0 : Number(s));
    try {
      await api.insertMetric({
        platform: form.platform || null,
        externalContentId: form.externalContentId || null,
        impressions: n(form.impressions),
        clicks: n(form.clicks),
        conversions: n(form.conversions),
        gmv: n(form.gmv),
        adSpend: n(form.adSpend),
      });
      setForm({ platform: "", externalContentId: "", impressions: "0", clicks: "0", conversions: "0", gmv: "0", adSpend: "0" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:performance.addFailed"));
    }
  };

  const importCsv = async () => {
    setError(null);
    if (!csv.trim()) return;
    try {
      const r = await api.importMetrics(csv);
      setCsv("");
      await load();
      void r;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:performance.importFailed"));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:performance.title")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <div className="perf-cards">
            <div className="perf-card">
              <span className="perf-card__label">{t("modals:performance.impressions")}</span>
              <span className="perf-card__value">{totals.impressions.toLocaleString()}</span>
            </div>
            <div className="perf-card">
              <span className="perf-card__label">{t("modals:performance.clicks")}</span>
              <span className="perf-card__value">{totals.clicks.toLocaleString()}</span>
            </div>
            <div className="perf-card">
              <span className="perf-card__label">{t("modals:performance.conversions")}</span>
              <span className="perf-card__value">{totals.conversions.toLocaleString()}</span>
            </div>
            <div className="perf-card">
              <span className="perf-card__label">{t("modals:performance.ctr")}</span>
              <span className="perf-card__value">{pct(totals.clicks, totals.impressions)}</span>
            </div>
            <div className="perf-card">
              <span className="perf-card__label">{t("modals:performance.cvr")}</span>
              <span className="perf-card__value">{pct(totals.conversions, totals.clicks)}</span>
            </div>
            <div className="perf-card">
              <span className="perf-card__label">{t("modals:performance.gmv")}</span>
              <span className="perf-card__value">¥{totals.gmv.toLocaleString()}</span>
            </div>
            <div className="perf-card">
              <span className="perf-card__label">{t("modals:performance.adSpend")}</span>
              <span className="perf-card__value">¥{totals.adSpend.toLocaleString()}</span>
            </div>
            <div className="perf-card">
              <span className="perf-card__label">{t("modals:performance.roi")}</span>
              <span className="perf-card__value">{ratio(totals.gmv, totals.adSpend)}</span>
            </div>
          </div>

          <div className="perf-toolbar">
            <label className="field field--inline">
              <span>{t("modals:performance.groupBy")}</span>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                {GROUP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(`modals:performance.groupBy${o.key.charAt(0).toUpperCase()}${o.key.slice(1)}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <table className="product-table">
            <thead>
              <tr>
                <th>{t("modals:performance.group")}</th>
                <th>{t("modals:performance.impressions")}</th>
                <th>{t("modals:performance.clicks")}</th>
                <th>{t("modals:performance.conversions")}</th>
                <th>{t("modals:performance.gmv")}</th>
                <th>{t("modals:performance.adSpend")}</th>
                <th>{t("modals:performance.roi")}</th>
              </tr>
            </thead>
            <tbody>
              {aggregates.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {t("modals:performance.empty")}
                  </td>
                </tr>
              )}
              {aggregates.map((a) => (
                <tr key={a.group || "(none)"}>
                  <td>{a.group || t("modals:performance.ungrouped")}</td>
                  <td>{a.impressions.toLocaleString()}</td>
                  <td>{a.clicks.toLocaleString()}</td>
                  <td>{a.conversions.toLocaleString()}</td>
                  <td>¥{a.gmv.toLocaleString()}</td>
                  <td>¥{a.adSpend.toLocaleString()}</td>
                  <td>{ratio(a.gmv, a.adSpend)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="perf-form">
            <p className="muted">{t("modals:performance.addHint")}</p>
            <div className="product-add">
              <input placeholder={t("modals:performance.platformPh")} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} />
              <input placeholder={t("modals:performance.externalPh")} value={form.externalContentId} onChange={(e) => setForm({ ...form, externalContentId: e.target.value })} />
              <input type="number" placeholder={t("modals:performance.impressions")} value={form.impressions} onChange={(e) => setForm({ ...form, impressions: e.target.value })} />
              <input type="number" placeholder={t("modals:performance.clicks")} value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} />
              <input type="number" placeholder={t("modals:performance.conversions")} value={form.conversions} onChange={(e) => setForm({ ...form, conversions: e.target.value })} />
              <input type="number" placeholder={t("modals:performance.gmv")} value={form.gmv} onChange={(e) => setForm({ ...form, gmv: e.target.value })} />
              <input type="number" placeholder={t("modals:performance.adSpend")} value={form.adSpend} onChange={(e) => setForm({ ...form, adSpend: e.target.value })} />
              <button className="btn btn--primary btn--sm" onClick={() => void addMetric()}>
                {t("common.add")}
              </button>
            </div>

            <div className="csv-import">
              <textarea rows={3} placeholder={t("modals:performance.csvPh")} value={csv} onChange={(e) => setCsv(e.target.value)} />
              <button className="btn btn--sm" onClick={() => void importCsv()} disabled={!csv.trim()}>
                {t("modals:performance.importCsv")}
              </button>
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}
        </div>
      </div>
    </div>
  );
}
