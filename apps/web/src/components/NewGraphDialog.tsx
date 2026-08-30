import { useEffect } from "react";
import TemplatePicker, { TEMPLATE_LIST } from "./TemplatePicker";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with a template id, or undefined for a blank graph. */
  onPick: (templateId?: string) => void;
}

export default function NewGraphDialog({ open, onClose, onPick }: Props) {
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
          <TemplatePicker templates={TEMPLATE_LIST} onPick={onPick} />
          <button className="btn new-graph__blank" onClick={() => onPick(undefined)}>
            从空白产线开始
          </button>
        </div>
      </div>
    </div>
  );
}
