import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * P3 targeted announcements (design-announcement §3.1): entry-point surfaces
 * beyond the bell. `GET /api/announcements` already filters by audience, so
 * whatever lands here is addressed to the current user — these components only
 * decide WHERE it gets an extra appearance:
 *   - `useTemplateAlerts` → a badge on the matching template card
 *     (NewGraphDialog / Onboarding), for "this template is deprecated" notices;
 *   - `GlobalAnnouncementBar` → a notice card in the band under the header,
 *     for untargeted warnings;
 *   - `GraphAnnouncementBar` → the same card scoped to the open pipeline, for
 *     "this graph's schema migrated" notices.
 * Each surface fetches independently: announcements are tiny and low
 * frequency, and a shared cache would only add staleness when the admin
 * publishes mid-session.
 */

export interface TargetedAnnouncement {
  id: string;
  level: "info" | "warning" | "critical";
  titleZh: string;
  titleEn: string;
  bodyZh: string | null;
  bodyEn: string | null;
  target: string | null;
  read: boolean;
}

/** Active announcements as seen by the current user (empty on any failure). */
export function useActiveAnnouncements(): TargetedAnnouncement[] {
  const [items, setItems] = useState<TargetedAnnouncement[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/announcements", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: TargetedAnnouncement[] }) => {
        if (alive) setItems(d.items ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return items;
}

const localTitle = (
  a: TargetedAnnouncement,
  zh: boolean,
): string => (zh ? a.titleZh : a.titleEn) || a.titleZh || a.titleEn;

const localBody = (a: TargetedAnnouncement, zh: boolean): string | null =>
  (zh ? a.bodyZh ?? a.bodyEn : a.bodyEn ?? a.bodyZh) ?? null;

/** The bell owns read state for the dropdown; the extra surfaces post their own. */
function markRead(id: string) {
  fetch(`/api/announcements/${id}/read`, {
    method: "POST",
    credentials: "include",
  }).catch(() => undefined);
}

/** templateId → localized title of its newest active targeted announcement. */
export function useTemplateAlerts(): Record<string, string> {
  const items = useActiveAnnouncements();
  const { i18n } = useTranslation();
  const zh = i18n.language?.startsWith("zh");
  const alerts: Record<string, string> = {};
  for (const a of items) {
    if (!a.target?.startsWith("template:")) continue;
    const id = a.target.slice("template:".length);
    // Server orders newest first; keep the first hit per template.
    if (!alerts[id]) alerts[id] = localTitle(a, zh);
  }
  return alerts;
}

/**
 * Notice card for the strongest unread warning that has no surface of its own.
 * Template- and graph-targeted announcements are excluded because they render
 * on the template card and the graph bar; `user:` targeting (usage alerts) is
 * still a global notice. It used to be a strip pinned to the top edge of the
 * viewport, which covered the header and had no room for the body.
 */
export function GlobalAnnouncementBar() {
  const { t, i18n } = useTranslation();
  const items = useActiveAnnouncements();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const zh = !!i18n.language?.startsWith("zh");

  const notice = items.find(
    (a) =>
      a.level === "warning" &&
      !a.read &&
      !a.target?.startsWith("template:") &&
      !a.target?.startsWith("graph:") &&
      !dismissed.has(a.id),
  );
  if (!notice) return null;
  const body = localBody(notice, zh);

  return (
    <div className={`announcements__banner announcements__banner--${notice.level}`} role="status">
      <span className={`announcements__dot announcements__dot--${notice.level}`} />
      <span className="announcements__banner-label">
        {t("announcements:alerts.globalLabel")}
      </span>
      <span className="announcements__banner-text">
        <span className="announcements__banner-title">{localTitle(notice, zh)}</span>
        {body && <span className="announcements__banner-body">{body}</span>}
      </span>
      <button
        type="button"
        className="chip announcements__banner-dismiss"
        onClick={() => {
          setDismissed((prev) => new Set(prev).add(notice.id));
          markRead(notice.id);
        }}
      >
        {t("announcements:dismiss")}
      </button>
    </div>
  );
}

/**
 * Card shown while the current pipeline is open, for announcements targeted
 * at that graph (`target: "graph:<id>"`). Dismissal is per-announcement and
 * session-local — reopening the graph after navigating away shows it again,
 * matching the bell's dismiss semantics.
 */
export function GraphAnnouncementBar({ graphId }: { graphId: string }) {
  const { t, i18n } = useTranslation();
  const items = useActiveAnnouncements();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const banner = items.find(
    (a) => a.target === `graph:${graphId}` && !dismissed.has(a.id),
  );
  if (!banner) return null;
  const zh = !!i18n.language?.startsWith("zh");
  const body = localBody(banner, zh);

  return (
    <div className={`announcements__banner announcements__banner--${banner.level}`} role="status">
      <span className={`announcements__dot announcements__dot--${banner.level}`} />
      <span className="announcements__banner-label">
        {t("announcements:alerts.graphLabel")}
      </span>
      <span className="announcements__banner-text">
        <span className="announcements__banner-title">{localTitle(banner, zh)}</span>
        {body && <span className="announcements__banner-body">{body}</span>}
      </span>
      <button
        type="button"
        className="chip announcements__banner-dismiss"
        onClick={() => setDismissed((prev) => new Set(prev).add(banner.id))}
      >
        {t("announcements:dismiss")}
      </button>
    </div>
  );
}
