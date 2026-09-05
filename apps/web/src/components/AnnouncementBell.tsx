import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AnnouncementManager from "./AnnouncementManager";

export interface AnnouncementItem {
  id: string;
  level: "info" | "warning" | "critical";
  startsAt: number;
  endsAt: number | null;
  createdAt: number;
  titleZh: string;
  titleEn: string;
  bodyZh: string | null;
  bodyEn: string | null;
  read: boolean;
}

/**
 * In-product announcements (design-announcement): a bell in the header with
 * an unread badge, plus level-driven intensity — `warning` renders a
 * dismissable top banner and `critical` a modal that must be acknowledged.
 * Content is bilingual inline (titleZh/titleEn chosen by current locale);
 * the surrounding chrome goes through i18n like every other component.
 */
export default function AnnouncementBell() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [open, setOpen] = useState(false);
  const [dismissedBanner, setDismissedBanner] = useState<Set<string>>(new Set());
  const [acknowledgedCritical, setAcknowledgedCritical] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Only admins get the "manage" action; the server re-checks on every call.
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user && setCanManage(!!d.user.canManageAnnouncements))
      .catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    fetch("/api/announcements", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: AnnouncementItem[] }) => setItems(d.items ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = useCallback((id: string) => {
    fetch(`/api/announcements/${id}/read`, { method: "POST", credentials: "include" }).catch(
      () => undefined,
    );
  }, []);

  const unread = items.filter((a) => !a.read);

  const pick = (a: AnnouncementItem, zh: string | null, en: string | null): string | null =>
    (i18n.language?.startsWith("zh") ? zh : en) ?? zh ?? en;

  const titleOf = (a: AnnouncementItem) => pick(a, a.titleZh, a.titleEn) ?? "";
  const bodyOf = (a: AnnouncementItem) => pick(a, a.bodyZh, a.bodyEn);

  const openItem = (a: AnnouncementItem) => {
    setExpandedId(a.id);
    if (!a.read) {
      markRead(a.id);
      setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, read: true } : x)));
    }
  };

  // The strongest unread critical shows as a modal until acknowledged.
  const critical = items.find(
    (a) => a.level === "critical" && !a.read && !acknowledgedCritical.has(a.id),
  );
  // The strongest unread warning shows as a top banner (dismissable).
  const banner = items.find(
    (a) => a.level === "warning" && !a.read && !dismissedBanner.has(a.id),
  );

  const fmt = (ts: number) => new Date(ts).toLocaleDateString();

  return (
    <div className="announcements" ref={rootRef}>
      <button
        className="chip announcements__bell"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unread.length > 0
            ? t("announcements:nav.withUnread", { n: unread.length })
            : t("announcements:nav.label")
        }
      >
        {t("announcements:nav.label")}
        {unread.length > 0 && <span className="chip__badge">{unread.length}</span>}
      </button>
      {open && (
        <div className="announcements__pop">
          {canManage && (
            <button
              type="button"
              className="announcements__manage"
              onClick={() => {
                setOpen(false);
                setManagerOpen(true);
              }}
            >
              {t("announcements:nav.manage")}
            </button>
          )}
          {items.length === 0 && <div className="announcements__empty">{t("announcements:empty")}</div>}
          {items.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`announcements__item announcements__item--${a.level}${a.read ? " announcements__item--read" : ""}`}
              onClick={() => openItem(a)}
            >
              <span className={`announcements__dot announcements__dot--${a.level}`} />
              <span className="announcements__title">{titleOf(a)}</span>
              <span className="announcements__date">{fmt(a.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
      {expandedId && (() => {
        const a = items.find((x) => x.id === expandedId);
        if (!a) return null;
        const body = bodyOf(a);
        return (
          <div className="modal-backdrop" onClick={() => setExpandedId(null)}>
            <div className="modal announcements__detail" onClick={(e) => e.stopPropagation()}>
              <h3 className="modal__title">{titleOf(a)}</h3>
              <div className="modal__body">
                {body ? (
                  <pre className="announcements__body">{body}</pre>
                ) : (
                  <div className="announcements__empty">{t("announcements:noBody")}</div>
                )}
              </div>
              <div className="announcements__actions">
                <button type="button" className="btn" onClick={() => setExpandedId(null)}>
                  {t("announcements:close")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {banner && (
        <div className={`announcements__banner announcements__banner--warning`}>
          <span className="announcements__dot announcements__dot--warning" />
          <span className="announcements__banner-text">{titleOf(banner)}</span>
          <button
            type="button"
            className="link link--sm"
            onClick={() => {
              setDismissedBanner((prev) => new Set(prev).add(banner.id));
              markRead(banner.id);
              setItems((prev) => prev.map((x) => (x.id === banner.id ? { ...x, read: true } : x)));
            }}
          >
            {t("announcements:dismiss")}
          </button>
        </div>
      )}
      {critical && (
        <div className="modal-backdrop">
          <div className="modal announcements__detail">
            <h3 className="modal__title">{titleOf(critical)}</h3>
            <div className="modal__body">
              {bodyOf(critical) ? (
                <pre className="announcements__body">{bodyOf(critical)}</pre>
              ) : (
                <div className="announcements__empty">{t("announcements:noBody")}</div>
              )}
            </div>
            <div className="announcements__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setAcknowledgedCritical((prev) => new Set(prev).add(critical.id));
                  markRead(critical.id);
                  setItems((prev) => prev.map((x) => (x.id === critical.id ? { ...x, read: true } : x)));
                }}
              >
                {t("announcements:acknowledge")}
              </button>
            </div>
          </div>
        </div>
      )}
      <AnnouncementManager
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        onChanged={load}
      />
    </div>
  );
}
