import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FormConnector } from "@agent-world/core";
import Tooltip from "./Tooltip";

type FormField = FormConnector["fields"][number];

interface Props {
  fields: FormField[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

export default function FormConnectorModal({
  fields,
  onSubmit,
  onCancel,
}: Props) {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, ""])),
  );
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const missing = fields.filter(
      (f) => f.required && !(values[f.name] ?? "").trim(),
    );
    if (missing.length) {
      const list = new Intl.ListFormat(i18n.language, { type: "conjunction" });
      setErr(
        t("modals:formConnector.missingRequired", {
          fields: list.format(missing.map((m) => m.label ?? m.name)),
        }),
      );
      return;
    }
    onSubmit(values);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:formConnector.title")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="btn btn--ghost btn--icon" onClick={onCancel}>
              ×
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <p className="hint">{t("modals:formConnector.hint")}</p>
          {fields.map((f, i) => (
            <label className="field" key={f.name || i}>
              <span>
                {f.label ?? f.name}
                {f.required ? " *" : ""}
              </span>
              <input
                className="text-input"
                value={values[f.name] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.name]: e.target.value }))
                }
              />
            </label>
          ))}
          {err && <p className="error-text">{err}</p>}
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button className="btn btn--primary" onClick={submit}>
            {t("modals:formConnector.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
