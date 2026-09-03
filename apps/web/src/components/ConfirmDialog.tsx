import { useEffect } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className={`modal-confirm ${danger ? "modal-confirm--danger" : ""}`}
        style={{ width: 380, margin: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="modal-confirm__title">{title}</p>
        {description ? <p className="modal-confirm__desc">{description}</p> : null}
        <div className="modal-confirm__actions">
          <button className="btn" onClick={onCancel}>
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            className={`btn ${danger ? "btn--danger" : ""}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
