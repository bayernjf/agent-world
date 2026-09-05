import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TEMPLATE_LIST } from "./TemplatePicker";

export interface ManageAnnouncement {
  id: string;
  level: "info" | "warning" | "critical";
  startsAt: number;
  endsAt: number | null;
  createdAt: number;
  titleZh: string;
  titleEn: string;
  bodyZh: string | null;
  bodyEn: string | null;
  /** null = everyone; "graph:<id>" / "template:<id>" = targeted (P3). */
  target: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Tell the announcement bell to re-fetch after a create/update/delete. */
  onChanged: () => void;
}

const LEVELS = ["info", "warning", "critical"] as const;
type Level = (typeof LEVELS)[number];
type TargetKind = "all" | "template" | "graph";
const LEVEL_KEY: Record<Level, string> = {
  info: "announcements:manager.levelInfo",
  warning: "announcements:manager.levelWarning",
  critical: "announcements:manager.levelCritical",
};

/** ms → `<input type="datetime-local">` value in the local timezone. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** `<input type="datetime-local">` value → ms. */
function fromLocalInput(v: string): number {
  return new Date(v).getTime();
}

/**
 * Admin-only announcement manager (design-announcement P2): full list of all
 * announcements (including not-yet-started / expired), plus create / edit /
 * delete forms. Opened from the bell popover; visibility is gated by the
 * server (management endpoints return 403 for non-admins).
 */
export default function AnnouncementManager({ open, onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ManageAnnouncement[]>([]);
  // null = list, "new" = create form, an id = edit form.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    id: "",
    titleZh: "",
    titleEn: "",
    bodyZh: "",
    bodyEn: "",
    level: "info",
    startsAt: "",
    endsAt: "",
    targetKind: "all" as TargetKind,
    targetTemplate: "",
    targetGraph: "",
  });
  const [status, setStatus] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ManageAnnouncement | null>(null);

  const load = useCallback(() => {
    fetch("/api/announcements/manage", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: ManageAnnouncement[] }) => setItems(d.items ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (open) {
      setEditing(null);
      setStatus("");
      setDeleteTarget(null);
      load();
    }
  }, [open, load]);

  const openForm = (a: ManageAnnouncement | null) => {
    if (a) {
      const m = /^(graph|template):(.+)$/.exec(a.target ?? "");
      setForm({
        id: a.id,
        titleZh: a.titleZh,
        titleEn: a.titleEn,
        bodyZh: a.bodyZh ?? "",
        bodyEn: a.bodyEn ?? "",
        level: a.level,
        startsAt: toLocalInput(a.startsAt),
        endsAt: a.endsAt ? toLocalInput(a.endsAt) : "",
        // Rows with an unrecognized target (pre-P3 legacy) fall back to
        // "everyone"; saving normalizes the row to NULL.
        targetKind: m ? (m[1] as TargetKind) : "all",
        targetTemplate: m?.[1] === "template" ? m[2]! : "",
        targetGraph: m?.[1] === "graph" ? m[2]! : "",
      });
      setEditing(a.id);
    } else {
      setForm({
        id: "",
        titleZh: "",
        titleEn: "",
        bodyZh: "",
        bodyEn: "",
        level: "info",
        startsAt: toLocalInput(Date.now()),
        endsAt: "",
        targetKind: "all",
        targetTemplate: "",
        targetGraph: "",
      });
      setEditing("new");
    }
  };

  const save = async () => {
    let target: string | null = null;
    if (form.targetKind === "template" && form.targetTemplate) {
      target = `template:${form.targetTemplate}`;
    } else if (form.targetKind === "graph" && form.targetGraph.trim()) {
      target = `graph:${form.targetGraph.trim()}`;
    }
    const payload = {
      titleZh: form.titleZh.trim(),
      titleEn: form.titleEn.trim(),
      bodyZh: form.bodyZh.trim() || null,
      bodyEn: form.bodyEn.trim() || null,
      level: form.level,
      startsAt: fromLocalInput(form.startsAt),
      endsAt: form.endsAt ? fromLocalInput(form.endsAt) : null,
      target,
    };
    setStatus("");
    try {
      const res = form.id
        ? await fetch(`/api/announcements/${form.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          })
        : await fetch("/api/announcements", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus(t("announcements:manager.saved"));
      setEditing(null);
      load();
      onChanged();
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setStatus(String(e));
    }
  };

  const del = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/announcements/${deleteTarget.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) return;
      setDeleteTarget(null);
      load();
      onChanged();
    } catch {
      /* ignore transient failures */
    }
  };

  if (!open) return null;

  const title = (a: ManageAnnouncement) => a.titleZh || a.titleEn;

  /** Short audience label for the list rows, e.g. "模板定向 · tpl-x" or "产线定向 · g-abc…". */
  const targetLabel = (a: ManageAnnouncement): string | null => {
    const m = /^(graph|template):(.+)$/.exec(a.target ?? "");
    if (!m) return null;
    if (m[1] === "template") {
      const name = TEMPLATE_LIST.find((tpl) => tpl.id === m[2])?.name ?? m[2];
      return `${t("announcements:manager.badgeTemplate")} · ${name}`;
    }
    const id = m[2]!;
    return `${t("announcements:manager.badgeGraph")} · ${id.slice(0, 12)}${id.length > 12 ? "…" : ""}`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal announcement-manager" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("announcements:manager.title")}</h2>
          <button className="link" onClick={onClose}>
            {t("announcements:close")}
          </button>
        </div>
        <div className="modal__body">
          {editing === null ? (
            <>
              <div className="announcement-manager__toolbar">
                <span className="muted">{t("announcements:manager.list")}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => openForm(null)}>
                  {t("announcements:manager.new")}
                </button>
              </div>
              {items.length === 0 ? (
                <div className="announcements__empty">{t("announcements:manager.noItems")}</div>
              ) : (
                <div className="announcement-manager__list">
                  {items.map((a) => (
                    <div key={a.id} className="announcement-manager__row">
                      <span className={`announcements__dot announcements__dot--${a.level}`} />
                      <span className="announcement-manager__title">
                        {t(LEVEL_KEY[a.level])} · {title(a)}
                      </span>
                      {targetLabel(a) && (
                        <span className="announcement-manager__target">
                          {targetLabel(a)}
                        </span>
                      )}
                      <span className="announcements__date">
                        {new Date(a.startsAt).toLocaleDateString()}
                      </span>
                      <button className="link link--sm" onClick={() => openForm(a)}>
                        {t("announcements:manager.edit")}
                      </button>
                      <button
                        className="link link--sm link--danger"
                        onClick={() => setDeleteTarget(a)}
                      >
                        {t("announcements:manager.delete")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="announcement-manager__form">
              <label className="field">
                <span>{t("announcements:manager.titleZh")}</span>
                <input
                  value={form.titleZh}
                  onChange={(e) => setForm({ ...form, titleZh: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("announcements:manager.titleEn")}</span>
                <input
                  value={form.titleEn}
                  onChange={(e) => setForm({ ...form, titleEn: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("announcements:manager.bodyZh")}</span>
                <textarea
                  value={form.bodyZh}
                  onChange={(e) => setForm({ ...form, bodyZh: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("announcements:manager.bodyEn")}</span>
                <textarea
                  value={form.bodyEn}
                  onChange={(e) => setForm({ ...form, bodyEn: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("announcements:manager.level")}</span>
                <select
                  className="select"
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: e.target.value })}
                >
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {t(LEVEL_KEY[l])}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("announcements:manager.startsAt")}</span>
                <input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("announcements:manager.endsAt")}</span>
                <input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                />
                <small className="muted">{t("announcements:manager.endsAtHint")}</small>
              </label>
              <label className="field">
                <span>{t("announcements:manager.target")}</span>
                <select
                  className="select"
                  value={form.targetKind}
                  onChange={(e) =>
                    setForm({ ...form, targetKind: e.target.value as TargetKind })
                  }
                >
                  <option value="all">{t("announcements:manager.targetAll")}</option>
                  <option value="template">
                    {t("announcements:manager.targetTemplate")}
                  </option>
                  <option value="graph">{t("announcements:manager.targetGraph")}</option>
                </select>
                <small className="muted">{t("announcements:manager.targetHint")}</small>
              </label>
              {form.targetKind === "template" && (
                <label className="field">
                  <span>{t("announcements:manager.targetTemplateSelect")}</span>
                  <select
                    className="select"
                    value={form.targetTemplate}
                    onChange={(e) => setForm({ ...form, targetTemplate: e.target.value })}
                  >
                    <option value="">{t("announcements:manager.targetTemplateChoose")}</option>
                    {TEMPLATE_LIST.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} · {tpl.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {form.targetKind === "graph" && (
                <label className="field">
                  <span>{t("announcements:manager.targetGraphId")}</span>
                  <input
                    value={form.targetGraph}
                    onChange={(e) => setForm({ ...form, targetGraph: e.target.value })}
                    placeholder="g-…"
                    autoComplete="off"
                  />
                  <small className="muted">{t("announcements:manager.targetGraphHint")}</small>
                </label>
              )}
              {status && <p className="diag diag--ok">{status}</p>}
              <div className="announcement-manager__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>
                  {t("announcements:manager.cancel")}
                </button>
                <button className="btn btn--sm" onClick={save}>
                  {form.id
                    ? t("announcements:manager.save")
                    : t("announcements:manager.create")}
                </button>
              </div>
            </div>
          )}
        </div>
        {deleteTarget && (
          <div className="modal-confirm modal-confirm--danger" onClick={(e) => e.stopPropagation()}>
            <p className="modal-confirm__title">
              {t("announcements:manager.deleteConfirm")}
            </p>
            <p className="modal-confirm__desc">{title(deleteTarget)}</p>
            <div className="modal-confirm__actions">
              <button className="btn btn--ghost btn--sm" onClick={() => setDeleteTarget(null)}>
                {t("announcements:manager.cancel")}
              </button>
              <button className="btn btn--sm btn--danger" onClick={del}>
                {t("announcements:manager.delete")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}