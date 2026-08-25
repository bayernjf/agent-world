import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (templateId: string) => void;
}

export default function NewGraphDialog({ open, onClose, onPick }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    if (open) api.listTemplates().then(setTemplates).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>新建产线</h2>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="modal__body">
          <p className="form-hint">选择一个模板开始，或从空白产线搭建。</p>
          <div className="template-grid">
            {templates.map((t) => (
              <button
                key={t.id}
                className="template-card"
                onClick={() => {
                  onPick(t.id);
                }}
              >
                <span className="template-card__name">{t.name}</span>
                <span className="template-card__desc">{t.description}</span>
                <span className="template-card__cat">{t.category}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
