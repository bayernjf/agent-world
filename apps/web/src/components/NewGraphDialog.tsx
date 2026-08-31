import { useEffect, useState } from "react";
import TemplatePicker, { TEMPLATE_LIST } from "./TemplatePicker";
import TemplateFieldDialog from "./TemplateFieldDialog";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with a template id (plus field values when the template declares
   *  fields), or undefined for a blank graph. */
  onPick: (templateId?: string, fieldValues?: Record<string, string>) => void;
}

export default function NewGraphDialog({ open, onClose, onPick }: Props) {
  const [pending, setPending] = useState<(typeof TEMPLATE_LIST)[number] | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setPending(null);
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>新建产线</h2>
          <Tooltip content="关闭">
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <p className="form-hint">从空白产线开始搭建，或选择一个模板。</p>
          <TemplatePicker
            templates={TEMPLATE_LIST}
            blankFirst
            onPick={(id) => {
              const tpl = id
                ? TEMPLATE_LIST.find((t) => t.id === id)
                : undefined;
              // Templates with declared fields get a parameter form first.
              if (tpl && tpl.fields.length > 0) setPending(tpl);
              else onPick(id);
            }}
          />
        </div>
      </div>

      {pending && (
        <TemplateFieldDialog
          templateName={pending.name}
          fields={pending.fields}
          onCancel={() => setPending(null)}
          onSubmit={(values) => {
            setPending(null);
            onPick(pending.id, values);
          }}
        />
      )}
    </div>
  );
}
