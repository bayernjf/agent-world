import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import TemplatePicker, { TEMPLATE_LIST } from "./TemplatePicker";
import TemplateFieldDialog from "./TemplateFieldDialog";
import Tooltip from "./Tooltip";
import { useTemplateAlerts } from "./AnnouncementAlerts";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with a template id (plus field values when the template declares
   *  fields), or undefined for a blank graph. */
  onPick: (templateId?: string, fieldValues?: Record<string, string>) => void;
}

export default function NewGraphDialog({ open, onClose, onPick }: Props) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<(typeof TEMPLATE_LIST)[number] | null>(
    null,
  );
  // P3 targeting: deprecation-style notices pinned to their template's card.
  const alerts = useTemplateAlerts();

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
        style={{ width: 640 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>{t("modals:newGraph.title")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <p className="form-hint">{t("modals:newGraph.hint")}</p>
          <TemplatePicker
            templates={TEMPLATE_LIST}
            blankFirst
            alerts={alerts}
            onPick={(id) => {
              const tpl = id
                ? TEMPLATE_LIST.find((x) => x.id === id)
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
