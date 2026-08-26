import { useState } from "react";
import type { FormConnector } from "@agent-world/core";

type FormField = FormConnector["fields"][number];

interface Props {
  fields: FormField[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

export default function FormConnectorModal({ fields, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, ""])),
  );
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const missing = fields.filter((f) => f.required && !(values[f.name] ?? "").trim());
    if (missing.length) {
      setErr(`请填写必填项：${missing.map((m) => m.label ?? m.name).join("、")}`);
      return;
    }
    onSubmit(values);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>填写数据源表单</h2>
          <button className="btn btn--ghost btn--icon" onClick={onCancel} title="关闭">
            ×
          </button>
        </div>
        <div className="modal__body">
          <p className="hint">以下字段将作为数据源（Connector）注入 source 节点，再跑整条产线。</p>
          {fields.map((f, i) => (
            <label className="field" key={f.name || i}>
              <span>
                {f.label ?? f.name}
                {f.required ? " *" : ""}
              </span>
              <input
                className="text-input"
                value={values[f.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            </label>
          ))}
          {err && <p className="error-text">{err}</p>}
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn--primary" onClick={submit}>
            开始运行
          </button>
        </div>
      </div>
    </div>
  );
}
