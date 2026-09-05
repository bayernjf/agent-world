import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  type AdminUser,
  type AuditItem,
  type FeedbackItem,
  type FeedbackStatus,
} from "../lib/api";
import Tooltip from "./Tooltip";
import ConfirmDialog from "./ConfirmDialog";

const ROLE_LABEL: Record<string, string> = {
  owner: "modals:adminPanel.roleOwner",
  admin: "modals:adminPanel.roleAdmin",
  user: "modals:adminPanel.roleUser",
};

const AUDIT_PAGE_SIZE = 50;
const FEEDBACK_STATUSES: FeedbackStatus[] = ["open", "acknowledged", "closed"];

interface Props {
  open: boolean;
  me: { id: string; email: string; role?: string } | null;
  onClose: () => void;
}

/** Compress an audit detail payload for one-line display. */
function compactDetail(detail: string | null): string {
  if (!detail) return "—";
  try {
    return JSON.stringify(JSON.parse(detail));
  } catch {
    return detail;
  }
}

/** One-line digest of the whitelisted feedback context for the admin list. */
function contextDigest(
  context: string,
  t: (k: string) => string,
): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(context) as Record<string, unknown>;
  } catch {
    return t("feedback:admin.noContext");
  }
  const parts: string[] = [];
  if (typeof parsed.route === "string" && parsed.route) {
    parts.push(`${t("feedback:admin.contextRoute")}: ${parsed.route}`);
  }
  if (typeof parsed.lastRunId === "string" && parsed.lastRunId) {
    parts.push(`${t("feedback:admin.contextRun")}: ${parsed.lastRunId.slice(0, 8)}`);
  }
  const err = parsed.lastError as { message?: unknown } | undefined;
  if (err && typeof err.message === "string" && err.message) {
    parts.push(`${t("feedback:admin.contextError")}: ${err.message.slice(0, 80)}`);
  }
  return parts.length ? parts.join(" · ") : t("feedback:admin.noContext");
}

export default function AdminPanel({ open, me, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const isOwner = me?.role === "owner";
  const isAdmin = me?.role === "owner" || me?.role === "admin";
  const [tab, setTab] = useState<"users" | "audit" | "feedback">("audit");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditDone, setAuditDone] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus | "all">("all");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ user: AdminUser; role: "admin" | "user" } | null>(
    null,
  );

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const data = await api.adminListUsers();
      setUsers(data.users);
    } catch {
      setUsersError(t("modals:adminPanel.loadUsersFailed"));
    } finally {
      setUsersLoading(false);
    }
  }, [t]);

  const loadAudit = useCallback(async (before?: number) => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const data = await api.listAudit({ limit: AUDIT_PAGE_SIZE, before });
      setAudit((prev) => (before ? [...prev, ...data.items] : data.items));
      setAuditDone(data.items.length < AUDIT_PAGE_SIZE);
    } catch {
      setAuditError(t("modals:adminPanel.loadAuditFailed"));
    } finally {
      setAuditLoading(false);
    }
  }, [t]);

  const loadFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    setFeedbackError(null);
    try {
      const data = await api.listFeedback(
        feedbackStatus === "all" ? {} : { status: feedbackStatus },
      );
      setFeedback(data.items);
    } catch {
      setFeedbackError(t("feedback:admin.loadFailed"));
    } finally {
      setFeedbackLoading(false);
    }
  }, [t, feedbackStatus]);

  // Fresh data each time the panel opens. Admins land on the audit tab —
  // the user list is the owner's exclusive view (design-rbac P3). The
  // feedback tab (design-feedback P2) is visible to owner and admin alike.
  useEffect(() => {
    if (!open) return;
    setTab(isOwner ? "users" : "audit");
    setConfirmTarget(null);
    setRoleError(null);
    setAudit([]);
    setAuditDone(false);
    if (isOwner) void loadUsers();
    if (isAdmin) void loadAudit();
  }, [open, isOwner, isAdmin, loadUsers, loadAudit]);

  // Refetch when the admin flips the status filter.
  useEffect(() => {
    if (open && isAdmin) void loadFeedback();
  }, [open, isAdmin, loadFeedback]);

  // Escape closes the panel — unless the confirm dialog is open, in which
  // case ConfirmDialog owns the Escape key.
  useEffect(() => {
    if (!open || confirmTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, confirmTarget, onClose]);

  if (!open) return null;

  const applyRole = async () => {
    if (!confirmTarget) return;
    setRoleBusy(true);
    setRoleError(null);
    try {
      await api.adminSetUserRole(confirmTarget.user.id, confirmTarget.role);
      setConfirmTarget(null);
      await loadUsers();
    } catch {
      setRoleError(t("modals:adminPanel.roleUpdateFailed"));
    } finally {
      setRoleBusy(false);
    }
  };

  const setFeedbackRowStatus = async (id: string, status: FeedbackStatus) => {
    // Optimistic flip; reload on failure so the UI never drifts from the DB.
    const prev = feedback;
    setFeedback((rows) => rows.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      await api.updateFeedbackStatus(id, status);
    } catch {
      setFeedback(prev);
      setFeedbackError(t("feedback:admin.statusFailed"));
    }
  };

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div
          className="modal admin-panel"
          style={{ width: 680 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal__header">
            <h2>{t("modals:adminPanel.title")}</h2>
            <Tooltip content={t("common.close")}>
              <button className="icon-btn" onClick={onClose}>
                ✕
              </button>
            </Tooltip>
          </div>
          <div className="modal__body">
            <div className="admin-panel__tabs">
              {isOwner && (
                <button
                  type="button"
                  className={`admin-panel__tab ${tab === "users" ? "is-on" : ""}`}
                  onClick={() => setTab("users")}
                >
                  {t("modals:adminPanel.tabUsers")}
                </button>
              )}
              <button
                type="button"
                className={`admin-panel__tab ${tab === "audit" ? "is-on" : ""}`}
                onClick={() => setTab("audit")}
              >
                {t("modals:adminPanel.tabAudit")}
              </button>
              <button
                type="button"
                className={`admin-panel__tab ${tab === "feedback" ? "is-on" : ""}`}
                onClick={() => setTab("feedback")}
              >
                {t("feedback:admin.title")}
              </button>
            </div>

            {tab === "users" ? (
              <div>
                <p className="muted">{t("modals:adminPanel.usersHint")}</p>
                {usersLoading ? (
                  <p className="muted">{t("modals:adminPanel.loading")}</p>
                ) : usersError ? (
                  <div className="form-error">{usersError}</div>
                ) : users.length === 0 ? (
                  <p className="muted">{t("modals:adminPanel.emptyUsers")}</p>
                ) : (
                  <ul className="admin-user-list">
                    {users.map((u) => (
                      <li key={u.id} className="admin-user-list__row">
                        <span className="admin-user-list__email" title={u.email}>
                          {u.email}
                        </span>
                        <span className={`admin-user__role admin-user__role--${u.role}`}>
                          {ROLE_LABEL[u.role] ? t(ROLE_LABEL[u.role]!) : u.role}
                        </span>
                        <span className="admin-user-list__created">
                          {new Date(u.createdAt).toLocaleDateString(i18n.language)}
                        </span>
                        {u.role === "owner" ? (
                          <span className="admin-user-list__spacer" />
                        ) : u.role === "admin" ? (
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={roleBusy}
                            onClick={() => setConfirmTarget({ user: u, role: "user" })}
                          >
                            {t("modals:adminPanel.revokeAdmin")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={roleBusy}
                            onClick={() => setConfirmTarget({ user: u, role: "admin" })}
                          >
                            {t("modals:adminPanel.grantAdmin")}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {roleError && <div className="form-error">{roleError}</div>}
              </div>
            ) : tab === "audit" ? (
              <div>
                <p className="muted">{t("modals:adminPanel.auditHint")}</p>
                {auditError ? (
                  <div className="form-error">{auditError}</div>
                ) : audit.length === 0 ? (
                  <p className="muted">
                    {auditLoading
                      ? t("modals:adminPanel.loading")
                      : t("modals:adminPanel.emptyAudit")}
                  </p>
                ) : (
                  <ul className="admin-audit">
                    {audit.map((a) => (
                      <li key={a.id} className="admin-audit__row">
                        <span className="admin-audit__time">
                          {new Date(a.created_at).toLocaleString(i18n.language)}
                        </span>
                        <span
                          className="admin-audit__email"
                          title={a.email ?? undefined}
                        >
                          {a.email ?? t("modals:adminPanel.unknownUser")}
                        </span>
                        <span className="admin-audit__action">{a.action}</span>
                        <span className="admin-audit__detail" title={a.detail ?? undefined}>
                          {compactDetail(a.detail)}
                        </span>
                        <span className="admin-audit__ip">{a.ip ?? "—"}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {audit.length > 0 && (
                  <div className="admin-audit__more">
                    {auditDone ? (
                      <span className="muted">{t("modals:adminPanel.noMore")}</span>
                    ) : (
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={auditLoading}
                        onClick={() => void loadAudit(audit.at(-1)?.created_at)}
                      >
                        {auditLoading
                          ? t("modals:adminPanel.loading")
                          : t("modals:adminPanel.loadMore")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="admin-feedback__filters">
                  {(["all", ...FEEDBACK_STATUSES] as const).map((s) => (
                    <label key={s} className="feedback-modal__category">
                      <input
                        type="radio"
                        name="feedback-status-filter"
                        checked={feedbackStatus === s}
                        onChange={() => setFeedbackStatus(s)}
                      />
                      {s === "all" ? t("feedback:admin.filterAll") : t(`feedback:status.${s}`)}
                    </label>
                  ))}
                </div>
                {feedbackError && <div className="form-error">{feedbackError}</div>}
                {feedback.length === 0 ? (
                  <p className="muted">
                    {feedbackLoading ? t("modals:adminPanel.loading") : t("feedback:admin.empty")}
                  </p>
                ) : (
                  <ul className="admin-feedback">
                    {feedback.map((f) => (
                      <li key={f.id} className="admin-feedback__row">
                        <div className="admin-feedback__head">
                          <span className="admin-feedback__email" title={f.email ?? undefined}>
                            {f.email ?? t("feedback:admin.unknownUser")}
                          </span>
                          <span
                            className={`admin-feedback__category admin-feedback__category--${f.category}`}
                          >
                            {t(`feedback:form.categories.${f.category}`)}
                          </span>
                          <span className="admin-feedback__time">
                            {new Date(f.created_at).toLocaleString(i18n.language)}
                          </span>
                          <select
                            className="admin-feedback__status"
                            value={f.status}
                            aria-label={t("feedback:admin.title")}
                            onChange={(e) =>
                              void setFeedbackRowStatus(f.id, e.target.value as FeedbackStatus)
                            }
                          >
                            {FEEDBACK_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {t(`feedback:status.${s}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="admin-feedback__message">{f.message}</p>
                        <p className="admin-feedback__context">{contextDigest(f.context, t)}</p>
                        {!!f.has_attachment && (
                          <img
                            className="admin-feedback__attachment"
                            src={api.feedbackAttachmentUrl(f.id)}
                            alt={t("feedback:admin.attachmentAlt")}
                            loading="lazy"
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmTarget !== null}
        title={
          confirmTarget?.role === "admin"
            ? t("modals:adminPanel.grantConfirmTitle")
            : t("modals:adminPanel.revokeConfirmTitle")
        }
        description={
          confirmTarget
            ? confirmTarget.role === "admin"
              ? t("modals:adminPanel.grantConfirmDesc", { email: confirmTarget.user.email })
              : t("modals:adminPanel.revokeConfirmDesc", { email: confirmTarget.user.email })
            : ""
        }
        confirmLabel={
          confirmTarget?.role === "admin"
            ? t("modals:adminPanel.grantAdmin")
            : t("modals:adminPanel.revokeAdmin")
        }
        danger={confirmTarget?.role === "user"}
        onConfirm={() => void applyRole()}
        onCancel={() => setConfirmTarget(null)}
      />
    </>
  );
}
