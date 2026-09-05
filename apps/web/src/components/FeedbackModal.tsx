import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type FeedbackCategory, type FeedbackContext } from "../lib/api";
import { getLastError } from "../lib/lastError";
import { useRun } from "../store/run";
import { useToast } from "../store/toast";

interface Props {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES: FeedbackCategory[] = ["bug", "feature", "ux", "other"];
const ATTACHMENT_MAX = 1_000_000; // 1MB decoded, mirrors the server limit
const ATTACHMENT_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

interface Attachment {
  /** base64 without the data: prefix */
  data: string;
  mimeType: string;
  previewUrl: string;
}

/**
 * In-product feedback form (design-feedback P1): one-line message + category +
 * paste-to-attach screenshot + opt-in diagnostics. The server re-applies the
 * context whitelist, so a tampered client cannot smuggle settings through.
 */
export default function FeedbackModal({ open, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const showToast = useToast((s) => s.show);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [withDiagnostics, setWithDiagnostics] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setMessage("");
    setCategory("bug");
    setAttachment(null);
    setWithDiagnostics(true);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Revoke the preview blob when it is replaced/removed or on unmount.
  useEffect(() => {
    return () => {
      if (attachment) URL.revokeObjectURL(attachment.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment]);

  const acceptFile = (file: File) => {
    if (!ATTACHMENT_MIMES.has(file.type)) {
      setError(t("feedback:form.screenshotInvalid"));
      return;
    }
    if (file.size > ATTACHMENT_MAX) {
      setError(t("feedback:form.screenshotTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const m = /^data:([^;]+);base64,(.*)$/s.exec(result);
      if (!m) return;
      setAttachment((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { mimeType: m[1]!, data: m[2]!, previewUrl: URL.createObjectURL(file) };
      });
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  // Paste-to-attach: the screenshot habit from feedback-workflow.md, productized.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        acceptFile(file);
        return;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setError(t("feedback:form.messageRequired"));
      return;
    }
    // §3.2 whitelist: route/UA/locale always; lastRunId/lastError only with the
    // user's consent (checkbox, default on — transparency principle).
    const context: FeedbackContext = {
      route: window.location.pathname,
      userAgent: navigator.userAgent,
      locale: i18n.language,
    };
    if (withDiagnostics) {
      const runId = useRun.getState().runId;
      if (runId) context.lastRunId = runId;
      const err = getLastError();
      if (err) context.lastError = err;
    }
    setBusy(true);
    setError(null);
    try {
      await api.submitFeedback(
        trimmed,
        category,
        context,
        attachment ? { data: attachment.data, mimeType: attachment.mimeType } : null,
      );
      showToast(t("feedback:form.submitted"));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("feedback:form.submitFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal feedback-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("feedback:form.title")}</h2>
        </div>
        <form className="modal__body" onSubmit={submit}>
          <label className="field">
            <span>{t("feedback:form.messageLabel")}</span>
            <textarea
              rows={3}
              value={message}
              placeholder={t("feedback:form.messagePlaceholder")}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              autoFocus
            />
          </label>

          <div className="field">
            <span>{t("feedback:form.categoryLabel")}</span>
            <div className="feedback-modal__categories" role="radiogroup">
              {CATEGORIES.map((cat) => (
                <label key={cat} className="feedback-modal__category">
                  <input
                    type="radio"
                    name="feedback-category"
                    value={cat}
                    checked={category === cat}
                    onChange={() => setCategory(cat)}
                  />
                  {t(`feedback:form.categories.${cat}`)}
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <span>{t("feedback:form.screenshotLabel")}</span>
            {attachment ? (
              <div className="feedback-modal__attach">
                <img src={attachment.previewUrl} alt={t("feedback:admin.attachmentAlt")} />
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    URL.revokeObjectURL(attachment.previewUrl);
                    setAttachment(null);
                  }}
                >
                  {t("feedback:form.screenshotRemove")}
                </button>
              </div>
            ) : (
              <p className="feedback-modal__hint muted">{t("feedback:form.screenshotHint")}</p>
            )}
          </div>

          <label className="feedback-modal__diag">
            <input
              type="checkbox"
              checked={withDiagnostics}
              onChange={(e) => setWithDiagnostics(e.target.checked)}
            />
            <span>
              {t("feedback:form.diagnosticsLabel")}
              <small className="muted">{t("feedback:form.diagnosticsHint")}</small>
            </span>
          </label>

          {error && <p className="feedback-modal__error">{error}</p>}

          <div className="feedback-modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              {t("feedback:form.cancel")}
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? t("feedback:form.submitting") : t("feedback:form.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
