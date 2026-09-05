import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  type AdminUser,
  type AuditItem,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackStatus,
} from "../lib/api";
import { useToast } from "../store/toast";
import Tooltip from "./Tooltip";
import ConfirmDialog from "./ConfirmDialog";

const ROLE_LABEL: Record<string, string> = {
  owner: "modals:adminPanel.roleOwner",
  admin: "modals:adminPanel.roleAdmin",
  user: "modals:adminPanel.roleUser",
};

const AUDIT_PAGE_SIZE = 50;
const FEEDBACK_STATUSES: FeedbackStatus[] = ["open", "acknowledged", "closed"];
const ANNOUNCE_LEVELS = ["info", "warning", "critical"] as const;
const ANNOUNCE_LEVEL_LABEL: Record<(typeof ANNOUNCE_LEVELS)[number], string> = {
  info: "announcements:manager.levelInfo",
  warning: "announcements:manager.levelWarning",
  critical: "announcements:manager.levelCritical",
};
/** Messages folded into the pre-filled announcement body. */
const ANNOUNCE_DIGEST_MAX = 5;
const ANNOUNCE_DIGEST_CHARS = 80;

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
  const showToast = useToast((s) => s.show);
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
  // Feedback → announcement merge (design-feedback P3).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announceForm, setAnnounceForm] = useState({
    titleZh: "",
    titleEn: "",
    bodyZh: "",
    bodyEn: "",
    level: "warning",
    endsAt: "",
  });
  const [announceBusy, setAnnounceBusy] = useState(false);
  const [announceError, setAnnounceError] = useState<string | null>(null);
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
    setSelected(new Set());
    setAnnounceOpen(false);
    setAnnounceError(null);
    if (isOwner) void loadUsers();
    if (isAdmin) void loadAudit();
  }, [open, isOwner, isAdmin, loadUsers, loadAudit]);

  // Refetch when the admin flips the status filter.
  useEffect(() => {
    if (open && isAdmin) void loadFeedback();
  }, [open, isAdmin, loadFeedback]);

  // Escape closes the announce form first, then the panel — unless the confirm
  // dialog is open, in which case ConfirmDialog owns the Escape key.
  useEffect(() => {
    if (!open || confirmTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (announceOpen) {
        setAnnounceOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, confirmTarget, announceOpen, onClose]);

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

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Pre-fill the announce form from the selected batch (design-feedback P3):
   * dominant category + report count in the titles, message digest in the body. */
  const openAnnounceForm = () => {
    const items = feedback.filter((f) => selected.has(f.id));
    if (items.length === 0) return;
    const counts = new Map<FeedbackCategory, number>();
    for (const it of items) {
      counts.set(it.category, (counts.get(it.category) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const count = items.length;
    const digest = items
      .slice(0, ANNOUNCE_DIGEST_MAX)
      .map((it) => `· ${it.message.slice(0, ANNOUNCE_DIGEST_CHARS)}`)
      .join("\n");
    const categoryZh = i18n.t(`feedback:form.categories.${top}`, { lng: "zh" });
    const categoryEn = i18n.t(`feedback:form.categories.${top}`, { lng: "en" });
    setAnnounceForm({
      titleZh: t("feedback:admin.announce.templateTitleZh", {
        category: categoryZh,
        count,
      }),
      titleEn: t("feedback:admin.announce.templateTitleEn", {
        category: categoryEn,
        count,
      }),
      bodyZh: t("feedback:admin.announce.templateBodyZh", { count, items: digest }),
      bodyEn: t("feedback:admin.announce.templateBodyEn", { count, items: digest }),
      level: "warning",
      endsAt: "",
    });
    setAnnounceError(null);
    setAnnounceOpen(true);
  };

  const submitAnnounce = async () => {
    const titleZh = announceForm.titleZh.trim();
    const titleEn = announceForm.titleEn.trim();
    if (!titleZh || !titleEn) {
      setAnnounceError(t("feedback:admin.announce.titleRequired"));
      return;
    }
    setAnnounceBusy(true);
    setAnnounceError(null);
    const ids = [...selected];
    try {
      await api.announceFeedback(ids, {
        titleZh,
        titleEn,
        bodyZh: announceForm.bodyZh.trim() || null,
        bodyEn: announceForm.bodyEn.trim() || null,
        level: announceForm.level as (typeof ANNOUNCE_LEVELS)[number],
        endsAt: announceForm.endsAt ? new Date(announceForm.endsAt).getTime() : null,
      });
      showToast(t("feedback:admin.announce.success", { count: ids.length }));
      setAnnounceOpen(false);
      setSelected(new Set());
      await loadFeedback();
    } catch {
      setAnnounceError(t("feedback:admin.announce.failed"));
    } finally {
      setAnnounceBusy(false);
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
            ) : announceOpen ? (
              <div className="admin-feedback__announce">
                <p className="muted">{t("feedback:admin.announce.hint")}</p>
                <p className="muted">
                  {t("feedback:admin.announce.selected", { count: selected.size })}
                </p>
                <label className="field">
                  <span>{t("feedback:admin.announce.titleZh")}</span>
                  <input
                    value={announceForm.titleZh}
                    onChange={(e) => setAnnounceForm({ ...announceForm, titleZh: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>{t("feedback:admin.announce.titleEn")}</span>
                  <input
                    value={announceForm.titleEn}
                    onChange={(e) => setAnnounceForm({ ...announceForm, titleEn: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>{t("feedback:admin.announce.bodyZh")}</span>
                  <textarea
                    rows={4}
                    value={announceForm.bodyZh}
                    onChange={(e) => setAnnounceForm({ ...announceForm, bodyZh: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>{t("feedback:admin.announce.bodyEn")}</span>
                  <textarea
                    rows={4}
                    value={announceForm.bodyEn}
                    onChange={(e) => setAnnounceForm({ ...announceForm, bodyEn: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>{t("feedback:admin.announce.level")}</span>
                  <select
                    value={announceForm.level}
                    onChange={(e) => setAnnounceForm({ ...announceForm, level: e.target.value })}
                  >
                    {ANNOUNCE_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {t(ANNOUNCE_LEVEL_LABEL[l])}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("feedback:admin.announce.endsAt")}</span>
                  <input
                    type="datetime-local"
                    value={announceForm.endsAt}
                    onChange={(e) => setAnnounceForm({ ...announceForm, endsAt: e.target.value })}
                  />
                </label>
                {announceError && <div className="form-error">{announceError}</div>}
                <div className="admin-feedback__announce-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={announceBusy}
                    onClick={() => setAnnounceOpen(false)}
                  >
                    {t("feedback:admin.announce.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={announceBusy}
                    onClick={() => void submitAnnounce()}
                  >
                    {announceBusy
                      ? t("feedback:admin.announce.submitting")
                      : t("feedback:admin.announce.submit")}
                  </button>
                </div>
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
                        onChange={() => {
                          setSelected(new Set());
                          setFeedbackStatus(s);
                        }}
                      />
                      {s === "all" ? t("feedback:admin.filterAll") : t(`feedback:status.${s}`)}
                    </label>
                  ))}
                  {selected.size > 0 && (
                    <button
                      type="button"
                      className="ghost-btn admin-feedback__announce-btn"
                      onClick={openAnnounceForm}
                    >
                      {t("feedback:admin.announce.button", { count: selected.size })}
                    </button>
                  )}
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
                          <input
                            type="checkbox"
                            className="admin-feedback__select"
                            checked={selected.has(f.id)}
                            aria-label={t("feedback:admin.select")}
                            onChange={() => toggleSelect(f.id)}
                          />
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
