import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type PublishTarget } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** F7-B: manage open-channel publish targets (webhook-based middle tier). */
export default function PublishTargets({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [targets, setTargets] = useState<PublishTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ platform: "", name: "", provider: "webhook", url: "", token: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTargets(await api.listPublishTargets());
    } catch {
      /* ignore transient failures */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, load]);

  if (!open) return null;

  const add = async () => {
    setError(null);
    if (!form.platform || !form.url) {
      setError(t("modals:publishTargets.missingFields"));
      return;
    }
    try {
      await api.createPublishTarget({
        platform: form.platform,
        name: form.name || undefined,
        provider: form.provider,
        url: form.url,
        token: form.token || undefined,
      });
      setForm({ platform: "", name: "", provider: "webhook", url: "", token: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:publishTargets.addFailed"));
    }
  };

  const remove = async (id: string) => {
    await api.deletePublishTarget(id);
    await load();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:publishTargets.title")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <p className="muted">{t("modals:publishTargets.hint")}</p>

          <table className="product-table">
            <thead>
              <tr>
                <th>{t("modals:publishTargets.platform")}</th>
                <th>{t("modals:publishTargets.name")}</th>
                <th>{t("modals:publishTargets.provider")}</th>
                <th>{t("modals:publishTargets.url")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="muted">{t("modals:publishTargets.loading")}</td>
                </tr>
              )}
              {!loading && targets.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">{t("modals:publishTargets.empty")}</td>
                </tr>
              )}
              {targets.map((tg) => (
                <tr key={tg.id}>
                  <td>{tg.platform}</td>
                  <td>{tg.name ?? "—"}</td>
                  <td>{tg.provider}</td>
                  <td className="muted">{tg.config?.url ?? ""}</td>
                  <td>
                    <button className="btn btn--sm" onClick={() => void remove(tg.id)}>
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="perf-form">
            <p className="muted">{t("modals:publishTargets.addHint")}</p>
            <div className="product-add">
              <input placeholder={t("modals:publishTargets.platform")} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} />
              <input placeholder={t("modals:publishTargets.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder={t("modals:publishTargets.urlPh")} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              <input placeholder={t("modals:publishTargets.token")} value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
              <button className="btn btn--primary btn--sm" onClick={() => void add()}>
                {t("common.add")}
              </button>
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}
        </div>
      </div>
    </div>
  );
}
