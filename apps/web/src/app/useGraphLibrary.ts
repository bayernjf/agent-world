/** Graph library and review-badge half of the app shell (audit P2 follow-up
 * split out of App.tsx): the local graph list, the CRUD handlers, the initial
 * load and the pending-review poll. The hook subscribes to the same graph/run
 * stores App.tsx did, so the semantics (flush-before-switch, duplicate names,
 * 0->1 auto tour) are unchanged.
 */
import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { getTemplate, type Graph } from "@agent-world/core";
import { api, DuplicateGraphNameError } from "../lib/api";
import { useToast } from "../store/toast";
import { useGraph } from "../store/graph";
import { useRun } from "../store/run";
import {
  buildTourContext,
  pickAutoTour,
  setLastAutoAt,
  useGuidedTour,
} from "../store/guided-tour";
import { TOURS } from "../tours";
import type { GraphSummary } from "../components/GraphSwitcher";

/** How often the HUD badge re-counts runs waiting on a human. */
const REVIEW_POLL_MS = 20_000;

const showError = (msg: string) => {
  useToast.getState().show(msg, { ttlMs: 6000 });
};

export interface GraphLibrary {
  newGraphOpen: boolean;
  setNewGraphOpen: Dispatch<SetStateAction<boolean>>;
  graphs: GraphSummary[];
  deleteTarget: GraphSummary | null;
  setDeleteTarget: Dispatch<SetStateAction<GraphSummary | null>>;
  shareTargetId: string | null;
  setShareTargetId: Dispatch<SetStateAction<string | null>>;
  graphsReady: boolean;
  /** Runs parked on a human decision across every line — the HUD badge. */
  pendingReviews: number;
  refreshGraphs: () => Promise<GraphSummary[]>;
  refreshPendingReviews: () => void;
  switchGraph: (id: string) => Promise<void>;
  createGraph: (
    template?: string,
    fieldValues?: Record<string, string>,
  ) => Promise<void | boolean>;
  duplicateGraph: (id: string) => Promise<void>;
  renameGraph: (id: string, name: string) => Promise<void | boolean>;
  confirmDelete: () => Promise<void>;
}

export function useGraphLibrary(): GraphLibrary {
  const { t } = useTranslation();
  const graph = useGraph((s) => s.graph);
  const flushSave = useGraph((s) => s.flushSave);
  const reset = useRun((s) => s.reset);
  const setGraph = useGraph((s) => s.setGraph);
  const setReadOnly = useGraph((s) => s.setReadOnly);
  const runStatus = useRun((s) => s.live.status);

  const [newGraphOpen, setNewGraphOpen] = useState(false);
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<GraphSummary | null>(null);
  const [shareTargetId, setShareTargetId] = useState<string | null>(null);
  const [graphsReady, setGraphsReady] = useState(false);
  const [pendingReviews, setPendingReviews] = useState(0);

  /** Case-insensitive, trimmed duplicate check across the local graph list. */
  const nameTaken = (name: string, excludeId?: string): GraphSummary | null => {
    const target = name.trim().toLowerCase();
    if (!target) return null;
    return (
      graphs.find(
        (g) => g.id !== excludeId && g.name.trim().toLowerCase() === target,
      ) ?? null
    );
  };

  /** Surface a friendly "name already used" message and bail. */
  const reportDuplicate = (
    name: string,
    dup: { name: string } | null,
  ): boolean => {
    if (!dup) return false;
    showError(t("common:app.duplicateName", { name }));
    return true;
  };

  const refreshGraphs = useCallback(async () => {
    try {
      const list = await api.listGraphs();
      setGraphs(list);
      return list;
    } catch (e) {
      showError(String(e));
      return [];
    }
  }, []);

  /** Only the count is read here; the queue itself fetches the rows. */
  const refreshPendingReviews = useCallback(() => {
    api
      .listPendingReviews({ limit: 1 })
      .then((d) => setPendingReviews(d.total))
      // The badge is cosmetic: a failed poll must not toast every 20s.
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshPendingReviews();
    const timer = setInterval(refreshPendingReviews, REVIEW_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshPendingReviews]);

  // A run halting on the canvas lights the badge at once instead of at the next poll.
  useEffect(() => {
    if (runStatus === "halted") refreshPendingReviews();
  }, [runStatus, refreshPendingReviews]);

  const switchGraph = useCallback(
    async (id: string) => {
      if (id === graph.id) return;
      try {
        await flushSave();
      } catch (e) {
        // Flush rethrows on failure (M22): abort the switch instead of silently
        // dropping unsaved edits, but tell the user why nothing happened.
        showError(String(e));
        return;
      }
      reset();
      try {
        const g = await api.getGraph(id);
        const sharedRole = graphs.find((gr) => gr.id === id)?.sharedRole ?? null;
        setReadOnly(sharedRole === "viewer");
        setGraph(g);
        useGraph.temporal.getState().clear();
        /* toast cleared by the producer */
      } catch (e) {
        showError(String(e));
      }
    },
    [graph.id, flushSave, reset, setGraph, graphs, setReadOnly],
  );

  const createGraph = useCallback(
    async (template?: string, fieldValues?: Record<string, string>) => {
      // Capture the in-session 0->1 moment before the await so we can auto-start
      // the first-run tour only for a brand-new user's first production line.
      const wasEmpty = graphs.length === 0;
      if (template) {
        const tpl = getTemplate(template);
        if (tpl && nameTaken(tpl.name))
          return reportDuplicate(
            tpl.name,
            graphs.find(
              (g) =>
                g.name.trim().toLowerCase() === tpl.name.trim().toLowerCase(),
            ) ?? null,
          );
      }
      try {
        const g = await api.createGraph(
          template ? { template, fieldValues } : undefined,
        );
        await refreshGraphs();
        reset();
        setGraph(g);
        useGraph.temporal.getState().clear();
        if (wasEmpty) {
          // Let panels/canvas settle before spotlighting (§五). Existing users
          // never pass through 0->1, so they are never auto-interrupted.
          const ctx = buildTourContext(1);
          const tour = pickAutoTour(TOURS, ctx);
          if (tour) {
            setLastAutoAt(ctx.now);
            window.setTimeout(
              () => useGuidedTour.getState().start(tour.id),
              400,
            );
          }
        }
      } catch (e) {
        if (e instanceof DuplicateGraphNameError) {
          showError(e.message);
          await refreshGraphs();
          return;
        }
        showError(String(e));
      }
    },
    [refreshGraphs, reset, setGraph, graphs, nameTaken],
  );

  const duplicateGraph = useCallback(
    async (id: string) => {
      try {
        const g = await api.createGraph({ from: id });
        await refreshGraphs();
        reset();
        setGraph(g);
        useGraph.temporal.getState().clear();
      } catch (e) {
        if (e instanceof DuplicateGraphNameError) {
          showError(e.message);
          await refreshGraphs();
          return;
        }
        showError(String(e));
      }
    },
    [refreshGraphs, reset, setGraph],
  );

  const renameGraph = useCallback(
    async (id: string, name: string) => {
      const dup = nameTaken(name, id);
      if (dup) return reportDuplicate(name, dup);
      try {
        if (id === graph.id) {
          setGraph({ ...graph, name });
          await flushSave();
        } else {
          const g = await api.getGraph(id);
          await api.saveGraph({ ...g, name });
        }
        await refreshGraphs();
      } catch (e) {
        if (e instanceof DuplicateGraphNameError) {
          showError(e.message);
          await refreshGraphs();
          return;
        }
        showError(String(e));
      }
    },
    [graph, refreshGraphs, setGraph, flushSave, nameTaken],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await api.deleteGraph(targetId);
      let list = await refreshGraphs();
      if (targetId === graph.id) {
        if (list.length === 0) {
          let g: Graph;
          try {
            g = await api.createGraph();
          } catch (e) {
            if (e instanceof DuplicateGraphNameError) {
              showError(e.message);
              return;
            }
            throw e;
          }
          list = await refreshGraphs();
          reset();
          setGraph(g);
        } else {
          await switchGraph(list[0]!.id);
        }
      }
      useGraph.temporal.getState().clear();
    } catch (e) {
      showError(String(e));
    }
  }, [deleteTarget, graph.id, refreshGraphs, reset, setGraph, switchGraph]);

  useEffect(() => {
    refreshGraphs()
      .then((list) => {
        if (list.length > 0) {
          api
            .getGraph(list[0]!.id)
            .then((g) => {
              const sharedRole = list[0]!.sharedRole ?? null;
              setReadOnly(sharedRole === "viewer");
              setGraph(g);
              useGraph.temporal.getState().clear();
            })
            .catch((e) => showError(String(e)));
        }
      })
      .finally(() => setGraphsReady(true));
  }, [refreshGraphs, setGraph, setReadOnly]);

  return {
    newGraphOpen,
    setNewGraphOpen,
    graphs,
    deleteTarget,
    setDeleteTarget,
    shareTargetId,
    setShareTargetId,
    graphsReady,
    pendingReviews,
    refreshGraphs,
    refreshPendingReviews,
    switchGraph,
    createGraph,
    duplicateGraph,
    renameGraph,
    confirmDelete,
  };
}
