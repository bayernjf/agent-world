import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type BatchJob } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** F5: batch jobs — create from a CSV list, watch per-row progress, retry failures. */
export default function BatchManager({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [batches, setBatches] = useState<BatchJob[]>([]);
  const [graphs, setGraphs] = useState<{ id: string; name: string }[]>([]);
  const [graphId, setGraphId] = useState("");
  const [csv, setCsv] = useState("");
  const [concurrency, setConcurrency] = useState(2);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<BatchJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBatches(await api.listBatches());
      if (expanded) setDetail(await api.getBatch(expanded));
    } catch {
      /* ignore transient failures */
    }
  }, [expanded]);

  useEffect(() => {
    if (!open) return;
    void load();
    void api.listGraphs().then((g) => setGraphs(g.map((x) => ({ id: x.id, name: x.name }))));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const timer = setInterval(() => void load(), 2000);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearInterval(timer);
    };
  }, [open, onClose, load]);

  if (!open) return null;

  const create = async () => {
    setError(null);
    if (!graphId) return setError(t("modals:batchManager.graphRequired"));
    if (!csv.trim()) return setError(t("modals:batchManager.csvRequired"));
    try {
      const { batchId } = await api.createBatch({ graphId, csv, concurrency });
      setCsv("");
      setExpanded(batchId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:batchManager.createFailed"));
    }
  };

  const retry = async (batchId: string, itemId: string) => {
    try {
      await api.retryBatchItem(batchId, itemId);
      await load();
    } catch {
      /* ignore */
    }
  };

  const statusKey = (s: string) => t(`modals:batchManager.status.${s}`);
  const itemStatusKey = (s: string) => t(`modals:batchManager.itemStatus.${s}`);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:batchManager.title")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <p className="muted">{t("modals:batchManager.hint")}</p>

          <div className="batch-create">
            <select value={graphId} onChange={(e) => setGraphId(e.target.value)}>
              <option value="">{t("modals:batchManager.graphPh")}</option>
              {graphs.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <label className="field field--inline">
              <span>{t("modals:batchManager.concurrencyLabel")}</span>
              <input
                type="number"
                min={1}
                max={8}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
              />
            </label>
            <textarea
              rows={3}
              placeholder={t("modals:batchManager.csvPh")}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
            <button className="btn btn--primary btn--sm" onClick={() => void create()}>
              {t("modals:batchManager.create")}
            </button>
          </div>

          {error && <div className="error-text">{error}</div>}

          <ul className="batch-list">
            {batches.length === 0 && <li className="muted">{t("modals:batchManager.empty")}</li>}
            {batches.map((b) => (
              <li key={b.id} className="batch-row">
                <button className="batch-row__head" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                  <span className={`batch-status batch-status--${b.status}`}>{statusKey(b.status)}</span>
                  <span>
                    {t("modals:batchManager.progress", { succeeded: b.succeeded, failed: b.failed, total: b.total })}
                  </span>
                  <span className="muted">{new Date(b.createdAt).toLocaleString()}</span>
                </button>
                {expanded === b.id && (
                  <div className="batch-items">
                    {detail && detail.id === b.id && detail.items && (
                      <table className="product-table">
                        <thead>
                          <tr>
                            <th>{t("modals:batchManager.rowIndexHeader")}</th>
                            <th>{t("modals:batchManager.inputLabel")}</th>
                            <th>{t("modals:batchManager.statusLabel")}</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.map((it) => (
                            <tr key={it.id}>
                              <td>#{it.rowIndex + 1}</td>
                              <td className="muted">{JSON.stringify(it.input)}</td>
                              <td className={it.status === "failed" ? "error-text" : ""}>
                                {itemStatusKey(it.status)}
                                {it.error && <span className="muted"> — {it.error}</span>}
                              </td>
                              <td>
                                {it.status === "failed" && (
                                  <button className="ghost-btn" onClick={() => void retry(b.id, it.id)}>
                                    {t("modals:batchManager.retry")}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
