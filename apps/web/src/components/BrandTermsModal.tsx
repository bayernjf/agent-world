import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type BrandTerm } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function BrandTermsModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [terms, setTerms] = useState<BrandTerm[]>([]);
  const [term, setTerm] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTerms(await api.listBrandTerms());
    } catch {
      /* ignore transient failures */
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
    try {
      await api.addBrandTerm(term, note);
      setTerm("");
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:brandTerms.addFailed"));
    }
  };

  const remove = async (id: string) => {
    await api.deleteBrandTerm(id);
    await load();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:brandTerms.title")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <p className="muted">{t("modals:brandTerms.hint")}</p>
          <ul className="brand-list">
            {terms.length === 0 && (
              <li className="muted">{t("modals:brandTerms.empty")}</li>
            )}
            {terms.map((item) => (
              <li key={item.id}>
                <div>
                  <span className="brand-term">{item.term}</span>
                  {item.note && <span className="muted"> — {item.note}</span>}
                </div>
                <button className="ghost-btn" onClick={() => void remove(item.id)}>
                  {t("common.delete")}
                </button>
              </li>
            ))}
          </ul>
          <div className="brand-add">
            <input
              placeholder={t("modals:brandTerms.termPlaceholder")}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
            />
            <input
              placeholder={t("modals:brandTerms.notePlaceholder")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="btn btn--primary btn--sm"
              onClick={() => void add()}
              disabled={!term.trim()}
            >
              {t("common.add")}
            </button>
          </div>
          {error && <div className="error-text">{error}</div>}
        </div>
      </div>
    </div>
  );
}
