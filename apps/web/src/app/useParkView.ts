/** RTS stage-B/C macro-park half of the app shell (audit P2 follow-up split
 * out of App.tsx): the 15s overview poll, the factory list derivation, and the
 * drill/cron/reschedule handlers. The view-mode store and the graph-switch
 * handler stay owned by App.tsx and are passed in, so the hook keeps no
 * navigation authority of its own.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type OperationsOverview } from "../lib/api";
import { useToast } from "../store/toast";
import type { ParkFactory, FactoryStatus } from "../canvas/CanvasPark";

const PARK_POLL_MS = 15_000;

const showError = (msg: string) => {
  useToast.getState().show(msg, { ttlMs: 6000 });
};

export interface ParkViewDeps {
  graphId: string;
  switchGraph: (id: string) => Promise<void>;
  setInspectorCollapsed: (next: boolean | ((prev: boolean) => boolean)) => void;
  viewMode: string;
  setViewMode: (next: "2d" | "3d" | "park") => void;
  setDrilledFromPark: (next: boolean) => void;
  requestDrillAnim: (dir: "in" | "out") => void;
}

export interface ParkView {
  parkOverview: OperationsOverview | null;
  parkFactories: ParkFactory[];
  enterFactory: (id: string) => Promise<void>;
  backToPark: () => void;
  enterPark: () => void;
  retryFactory: (id: string, lastRunId: string | null | undefined) => Promise<void>;
  refreshParkOverview: () => Promise<void>;
  toggleFactoryCron: (id: string) => Promise<void>;
  reschedulePlan: (planId: string, scheduledAt: number) => Promise<void>;
}

export function useParkView(deps: ParkViewDeps): ParkView {
  const {
    graphId, switchGraph, setInspectorCollapsed, viewMode, setViewMode,
    setDrilledFromPark, requestDrillAnim,
  } = deps;

  // Poll the overview only while the park is open.
  const [parkOverview, setParkOverview] = useState<OperationsOverview | null>(null);
  useEffect(() => {
    if (viewMode !== "park") return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.operationsOverview();
        if (!cancelled) setParkOverview(data);
      } catch (e) {
        // Park stays usable with the previous snapshot; surface nothing noisy.
        console.warn("park overview poll failed", e);
      }
    };
    void load();
    const timer = setInterval(() => void load(), PARK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [viewMode]);

  const parkFactories: ParkFactory[] = useMemo(() => {
    if (!parkOverview) return [];
    return parkOverview.graphs.map((g): ParkFactory => {
      // Worst-state-wins: failed/tripped > halted (review) > running > done > idle.
      let status: FactoryStatus = "idle";
      if (g.failed > 0 || g.tripped > 0) status = "failed";
      else if (g.halted > 0) status = "halted";
      else if (g.running > 0) status = "running";
      else if (g.done > 0) status = "done";
      const cs = parkOverview.cronState?.[g.graphId];
      return {
        id: g.graphId,
        name: g.graphName ?? g.graphId.slice(0, 8),
        // Palette seed, not copy: CanvasPark hashes it into a factory tint and
        // never renders it, so it must not follow the UI language.
        category: g.category ?? "自定义",
        status,
        pendingReview: g.pendingReview ?? g.halted ?? 0,
        hasCron: cs?.hasCron ?? false,
        cronEnabled: cs?.enabled ?? false,
        nextRunAt: cs?.nextAt ?? null,
        metrics: g.metrics,
        lastRunId: g.lastRunId,
        manual: g.parkX != null && g.parkZ != null ? { x: g.parkX, z: g.parkZ } : undefined,
      };
    });
  }, [parkOverview]);

  // B8 + C3 plan-B: drill from a park factory into its L1 single-factory 3D view
  // with a zoom ease (Canvas3D consumes the one-shot "in" request on mount).
  const enterFactory = useCallback(
    async (id: string) => {
      setDrilledFromPark(true);
      if (id !== graphId) await switchGraph(id);
      requestDrillAnim("in");
      setViewMode("3d");
    },
    [graphId, switchGraph, setDrilledFromPark, setViewMode, requestDrillAnim],
  );

  const backToPark = useCallback(() => {
    setDrilledFromPark(false);
    // The park is the multi-factory overview where the per-node Inspector has
    // no target; collapse it so the canvas keeps its full width (it reopens in
    // 2d/3d on explicit node selection).
    setInspectorCollapsed(true);
    requestDrillAnim("out");
    setViewMode("park");
  }, [setDrilledFromPark, setViewMode, requestDrillAnim, setInspectorCollapsed]);

  const enterPark = useCallback(() => {
    setDrilledFromPark(false);
    setInspectorCollapsed(true);
    setViewMode("park");
  }, [setDrilledFromPark, setViewMode, setInspectorCollapsed]);

  const retryFactory = useCallback(async (_id: string, lastRunId: string | null | undefined) => {
    if (!lastRunId) return; // nothing to retry before the pipeline ever ran
    try {
      await api.rerunRun(lastRunId);
    } catch (e) {
      showError(String(e));
    }
  }, []);

  // RTS stage-C: imperatively refresh the park snapshot after a local mutation
  // (cron toggle, plan reschedule, review decision) instead of waiting for the poll.
  const refreshParkOverview = useCallback(async () => {
    try {
      setParkOverview(await api.operationsOverview());
    } catch (e) {
      console.warn("park overview refresh failed", e);
    }
  }, []);

  const toggleFactoryCron = useCallback(
    async (id: string) => {
      try {
        const triggers = await api.listTriggers(id);
        const cron = triggers.find((tr) => tr.type === "cron");
        if (!cron) return;
        await api.createTrigger(id, { ...cron, enabled: !cron.enabled });
        // Reflect the new pause/resume state immediately rather than waiting for the poll.
        await refreshParkOverview();
      } catch (e) {
        showError(String(e));
      }
    },
    [refreshParkOverview],
  );

  // RTS stage-C C5: push a content plan's scheduled time, then refresh the park snapshot.
  // Cron schedules are periodic and intentionally not reschedulable here (read-only ticks).
  const reschedulePlan = useCallback(async (planId: string, scheduledAt: number) => {
    try {
      await api.updatePlan(planId, { scheduledAt });
      await refreshParkOverview();
    } catch (e) {
      showError(String(e));
    }
  }, [refreshParkOverview]);

  return {
    parkOverview,
    parkFactories,
    enterFactory,
    backToPark,
    enterPark,
    retryFactory,
    refreshParkOverview,
    toggleFactoryCron,
    reschedulePlan,
  };
}
