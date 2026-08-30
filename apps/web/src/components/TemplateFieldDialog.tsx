import { useState } from "react";
import type { TemplateFieldData } from "./TemplatePicker";

interface Props {
  templateName: string;
  fields: TemplateFieldData[];
  onCancel: () => void;
  /** Receives the raw form values; blank inputs fall back to defaults server-side. */
  onSubmit: (values: Record<string, string>) => void;
}

/**
 * Light parameter form shown when instantiating a template that declares
 * `fields` (e.g. the target URL of an HTTP node). Inputs are prefilled with
 * each field's defaultValue so "just confirm" keeps out-of-box behaviour.
 */
export default function TemplateFieldDialog({ templateName, fields, onCancel, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.defaultValue ?? ""])),
  );

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        // Stop propagation so cancelling this overlay never closes a parent
        // dialog (NewGraphDialog nests it) — cancel only dismisses the form.
        e.stopPropagation();
        onCancel();
      }}
    >
      <div className="modal template-fields" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>模板参数 — {templateName}</h2>
        </div>
        <div className="modal__body">
          <p className="form-hint">按需修改模板参数，保持默认值可直接创建。</p>
          {fields.map((f) => (
            <label key={f.key} className="template-fields__row">
              <span className="template-fields__label">{f.label}</span>
              <input
                className="input"
                type="text"
                value={values[f.key] ?? ""}
                placeholder={f.placeholder ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn--primary" onClick={() => onSubmit(values)}>
            创建产线
          </button>
        </div>
      </div>
    </div>
  );
}
