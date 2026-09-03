import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  variables: Record<string, unknown> | undefined;
  onClose: () => void;
  onSave: (vars: Record<string, unknown>) => void;
}

/**
 * Edits the graph's default variables (key → JSON value). Runtime writes from
 * `set_variable` (persisted per-run) override these; `${var.xxx}` reads them.
 */
export default function VariablesModal({
  open,
  variables,
  onClose,
  onSave,
}: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(
      Object.entries(variables ?? {}).map(([k, v]) => ({
        key: k,
        value: JSON.stringify(v) ?? "",
      })),
    );
    setError(null);
  }, [open, variables]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const setRow = (i: number, patch: Partial<{ key: string; value: string }>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const commit = () => {
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      const key = r.key.trim();
      if (!key) continue;
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        setError(t("modals:variables.duplicateKey", { key }));
        return;
      }
      const text = r.value.trim();
      if (text === "") {
        setError(t("modals:variables.missingValue", { key }));
        return;
      }
      try {
        out[key] = JSON.parse(text);
      } catch {
        setError(t("modals:variables.invalidJson", { key }));
        return;
      }
    }
    onSave(out);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>{t("modals:variables.title")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <p className="form-hint">
            <Trans i18nKey="modals:variables.hint" components={{ code: <code /> }} />
          </p>
          <div className="var-table">
            <div className="var-table__head">
              <span>{t("modals:variables.key")}</span>
              <span>{t("modals:variables.value")}</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div className="var-table__row" key={i}>
                <input
                  className="input var-table__key"
                  value={r.key}
                  placeholder={t("modals:variables.keyPlaceholder")}
                  onChange={(e) => setRow(i, { key: e.target.value })}
                />
                <input
                  className="input var-table__value"
                  value={r.value}
                  placeholder={t("modals:variables.valuePlaceholder")}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                />
                <button
                  className="icon-btn icon-btn--danger"

                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            className="chip"
            onClick={() => setRows((rs) => [...rs, { key: "", value: "" }])}
          >
            {t("modals:variables.addVariable")}
          </button>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal__footer">
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn--primary" onClick={commit}>
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
