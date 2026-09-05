import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Collaborator } from "../lib/api";
import Tooltip from "./Tooltip";

const SHARED_ROLE_LABEL: Record<string, string> = {
  editor: "modals:collaborators.roleEditor",
  viewer: "modals:collaborators.roleViewer",
};

interface Props {
  open: boolean;
  graphId: string;
  graphName: string;
  onClose: () => void;
}

export default function CollaboratorsModal({ open, graphId, graphName, onClose }: Props) {
  const { t } = useTranslation();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getGraphAccess(graphId);
      setCollaborators(data.collaborators);
    } catch {
      setError(t("modals:collaborators.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [graphId, t]);

  useEffect(() => {
    if (!open) return;
    void load();
    setEmail("");
    setRole("viewer");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, load]);

  if (!open) return null;

  const add = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.putGraphAccess(graphId, email.trim(), role);
      setEmail("");
      await load();
    } catch (e) {
      setError(t("modals:collaborators.addFailed", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (collabEmail: string) => {
    setError(null);
    try {
      await api.putGraphAccess(graphId, collabEmail, null);
      await load();
    } catch (e) {
      setError(t("modals:collaborators.removeFailed", { message: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:collaborators.title", { name: graphName })}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <p className="muted">{t("modals:collaborators.hint")}</p>
          {loading ? (
            <p className="muted">{t("modals:collaborators.loading")}</p>
          ) : (
            <ul className="collab-list">
              {collaborators.length === 0 && (
                <li className="muted">{t("modals:collaborators.empty")}</li>
              )}
              {collaborators.map((c) => (
                <li key={c.userId} className="collab-row">
                  <span className="collab-row__email">{c.email ?? "—"}</span>
                  <span className={`collab-row__role collab-row__role--${c.role}`}>
                    {(() => {
                      const labelKey = SHARED_ROLE_LABEL[c.role];
                      return labelKey ? t(labelKey) : c.role;
                    })()}
                  </span>
                  <button
                    className="ghost-btn"
                    onClick={() => void remove(c.email ?? "")}
                  >
                    {t("modals:collaborators.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="collab-add">
            <input
              className="input collab-add__email"
              placeholder={t("modals:collaborators.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && email.trim()) void add();
              }}
            />
            <select
              className="input collab-add__role"
              value={role}
              onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
            >
              <option value="viewer">{t("modals:collaborators.roleViewer")}</option>
              <option value="editor">{t("modals:collaborators.roleEditor")}</option>
            </select>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => void add()}
              disabled={!email.trim() || busy}
            >
              {busy ? t("modals:collaborators.adding") : t("modals:collaborators.add")}
            </button>
          </div>
          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="modal__footer">
          <button className="btn" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
