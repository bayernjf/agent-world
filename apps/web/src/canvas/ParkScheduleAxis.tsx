/**
 * ParkScheduleAxis — RTS stage-C C5 spatial scheduling for the L0 park.
 *
 * A 24-hour horizontal timeline rendered as an HTML overlay below the 3D park:
 *  - cron next-fires are read-only ticks (a cron expression has no single
 *    "reschedule" semantic — pause/resume lives in the factory popover, C7);
 *  - content_plan items are actionable: clicking one offers +1h / +24h, which
 *    writes back through PATCH /api/plan/:id (onReschedule).
 *
 * Scope note (deliberate cut): only content_plan.scheduledAt supports drag/click
 * rescheduling. Cron schedules are periodic and therefore shown read-only here.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContentPlan } from "../lib/api";
import type { ParkFactory } from "./CanvasPark";

const WINDOW_MS = 24 * 60 * 60 * 1000;

type AxisEvent = {
  key: string;
  at: number;
  kind: "plan" | "cron";
  label: string;
  planId?: string;
};

/** Per-graph cron summary as returned by the operations overview. */
export type CronStateMap = Record<string, { hasCron: boolean; enabled: boolean; nextAt: number | null }>;

/** Human "x minutes/hours later" using the active locale. */
function relLabel(t: (k: string, o?: Record<string, unknown>) => string, at: number, now: number): string {
  const mins = Math.round((at - now) / 60000);
  if (mins < 60) return t("park:schedule.inMinutes", { n: Math.max(0, mins) });
  return t("park:schedule.inHours", { n: (mins / 60).toFixed(1) });
}

export interface ParkScheduleAxisProps {
  plans: ContentPlan[];
  factories: Pick<ParkFactory, "id" | "name">[];
  /** Enabled crons only surface as ticks; a paused cron has nextAt null and is hidden. */
  cronState?: CronStateMap;
  onReschedule?: (planId: string, newAt: number) => void;
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
}

export default function ParkScheduleAxis({ plans, factories, cronState, onReschedule, now }: ParkScheduleAxisProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const nowMs = now ?? Date.now();
  const windowEnd = nowMs + WINDOW_MS;

  const events = useMemo<AxisEvent[]>(() => {
    const nameOf = new Map(factories.map((f) => [f.id, f.name]));
    const evs: AxisEvent[] = [];
    for (const p of plans) {
      if (p.scheduledAt >= nowMs && p.scheduledAt <= windowEnd) {
        evs.push({ key: `plan-${p.id}`, at: p.scheduledAt, kind: "plan", label: p.title, planId: p.id });
      }
    }
    for (const [gid, st] of Object.entries(cronState ?? {})) {
      // Only an enabled cron with a concrete next fire gets a (read-only) tick.
      if (st.enabled && typeof st.nextAt === "number" && st.nextAt >= nowMs && st.nextAt <= windowEnd) {
        evs.push({ key: `cron-${gid}`, at: st.nextAt, kind: "cron", label: nameOf.get(gid) ?? gid });
      }
    }
    return evs.sort((a, b) => a.at - b.at);
    // windowEnd derives from nowMs; re-run when the clock / inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, factories, cronState, nowMs]);

  if (events.length === 0) {
    return (
      <div className="park-schedule park-schedule--empty" data-testid="park-schedule">
        {t("park:schedule.empty")}
      </div>
    );
  }

  const pos = (at: number): string => `${((at - nowMs) / WINDOW_MS) * 100}%`;
  const selectedPlan = events.find((e) => e.key === selected && e.kind === "plan");

  const reschedule = (planId: string, deltaMs: number, oldAt: number) => {
    onReschedule?.(planId, oldAt + deltaMs);
    setSelected(null);
  };

  return (
    <div className="park-schedule" data-testid="park-schedule">
      <div className="park-schedule__head">
        <span className="park-schedule__title">{t("park:schedule.title")}</span>
        <span className="park-schedule__ends">{t("park:schedule.now")} — 24h</span>
      </div>
      <div className="park-schedule__track">
        {events.map((e) => {
          const isPlan = e.kind === "plan";
          return (
            <button
              type="button"
              key={e.key}
              className={`park-schedule__tick park-schedule__tick--${e.kind}${selected === e.key ? " is-selected" : ""}`}
              style={{ left: pos(e.at) }}
              disabled={!isPlan}
              title={`${isPlan ? t("park:schedule.plan") : t("park:schedule.nextRun")} · ${e.label} · ${relLabel(t, e.at, nowMs)}`}
              onClick={() => isPlan && setSelected((cur) => (cur === e.key ? null : e.key))}
            >
              <span className="park-schedule__tick-dot" />
              <span className="park-schedule__tick-label">{e.label}</span>
            </button>
          );
        })}
      </div>
      {selectedPlan && (
        <div className="park-schedule__actions" data-testid="park-schedule-actions">
          <span className="park-schedule__actions-label">
            {selectedPlan.label} · {relLabel(t, selectedPlan.at, nowMs)}
          </span>
          <button
            type="button"
            className="park-schedule__btn"
            onClick={() => reschedule(selectedPlan.planId!, 60 * 60 * 1000, selectedPlan.at)}
          >
            {t("park:schedule.delay1h")}
          </button>
          <button
            type="button"
            className="park-schedule__btn"
            onClick={() => reschedule(selectedPlan.planId!, 24 * 60 * 60 * 1000, selectedPlan.at)}
          >
            {t("park:schedule.delay24h")}
          </button>
        </div>
      )}
    </div>
  );
}
