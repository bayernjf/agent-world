import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type ContentPlan } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const; // Sun..Sat
const PLATFORMS = ["taobao", "xiaohongshu", "douyin", "wechat", "custom"] as const;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** F8: content calendar — a month grid of scheduled publishing plans. */
export default function CalendarView({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [plans, setPlans] = useState<ContentPlan[]>([]);
  const [editing, setEditing] = useState<{ date: Date; plan: ContentPlan | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getTime();
      const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59).getTime();
      setPlans(await api.listPlans(from, to));
    } catch {
      /* ignore transient failures */
    }
  }, [cursor]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, load]);

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const offset = first.getDay(); // 0 = Sunday
    const cells: (Date | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const plansByDay = useMemo(() => {
    const map = new Map<number, ContentPlan[]>();
    for (const p of plans) {
      const key = startOfDay(new Date(p.scheduledAt)).getTime();
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [plans]);

  if (!open) return null;

  const monthLabel = `${cursor.getFullYear()} / ${cursor.getMonth() + 1}`;

  const navMonth = (delta: number) => {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  };

  const statusKey = (s: string) => t(`modals:calendar.status.${s}`);
  const weekdayKey = (d: number) => t(`modals:calendar.weekdays.${d}`);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:calendar.title")}</h2>
          <div className="calendar-nav">
            <button className="icon-btn" onClick={() => navMonth(-1)}>
              ‹
            </button>
            <span className="calendar-month">{monthLabel}</span>
            <button className="icon-btn" onClick={() => navMonth(1)}>
              ›
            </button>
          </div>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <div className="calendar-grid calendar-grid--header">
            {WEEKDAYS.map((d) => (
              <div key={d} className="calendar-cell calendar-cell--header">
                {weekdayKey(d)}
              </div>
            ))}
          </div>
          <div className="calendar-grid">
            {grid.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} className="calendar-cell calendar-cell--empty" />;
              const key = startOfDay(day).getTime();
              const dayPlans = plansByDay.get(key) ?? [];
              return (
                <button
                  key={key}
                  className="calendar-cell"
                  onClick={() => setEditing({ date: day, plan: null })}
                >
                  <span className="calendar-cell__day">{day.getDate()}</span>
                  {dayPlans.map((p) => (
                    <span
                      key={p.id}
                      className={`calendar-chip calendar-chip--${p.status}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing({ date: day, plan: p });
                      }}
                    >
                      {p.title || statusKey(p.status)}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {editing && (
        <PlanDrawer
          date={editing.date}
          plan={editing.plan}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function PlanDrawer({
  date,
  plan,
  onClose,
  onSaved,
}: {
  date: Date;
  plan: ContentPlan | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(plan?.title ?? "");
  const [platform, setPlatform] = useState(plan?.platform ?? "xiaohongshu");
  const [time, setTime] = useState(() => {
    const d = plan ? new Date(plan.scheduledAt) : new Date(date.setHours(9, 0, 0, 0));
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [note, setNote] = useState(plan?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!title.trim()) return setError(t("modals:calendar.titleRequired"));
    const scheduledAt = new Date(time).getTime();
    if (Number.isNaN(scheduledAt)) return setError(t("modals:calendar.timeInvalid"));
    try {
      if (plan) {
        await api.updatePlan(plan.id, { title: title.trim(), platform, scheduledAt, note });
      } else {
        await api.createPlan({ title: title.trim(), platform, scheduledAt, note });
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:calendar.saveFailed"));
    }
  };

  const remove = async () => {
    if (!plan) return;
    await api.deletePlan(plan.id);
    await onSaved();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{plan ? t("modals:calendar.editTitle") : t("modals:calendar.addTitle")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <label className="field">
            <span>{t("modals:calendar.planTitle")}</span>
            <input value={title} placeholder={t("modals:calendar.planTitlePh")} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>{t("modals:calendar.platform")}</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {t(`nodes:inspector.compliance.platform${p[0]!.toUpperCase()}${p.slice(1)}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("modals:calendar.scheduledAt")}</span>
            <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label className="field">
            <span>{t("modals:calendar.note")}</span>
            <textarea rows={2} value={note} placeholder={t("modals:calendar.notePh")} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <div className="error-text">{error}</div>}
          <div className="modal__actions">
            {plan && (
              <button className="btn btn--ghost" onClick={() => void remove()}>
                {t("common.delete")}
              </button>
            )}
            <button className="btn btn--primary" onClick={() => void save()}>
              {t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
