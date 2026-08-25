import { create } from "zustand";
import {
  EVENT_SCHEMA_VERSION,
  initialRuntime,
  reduce,
  replay,
  type RunEvent,
  type RuntimeState,
} from "@agent-world/core";
import { api } from "../lib/api";

/**
 * Runtime state is a fold over the event stream, never edited by hand. Keeping the
 * raw log around is what makes the replay scrubber possible: scrubbing re-folds a
 * prefix instead of trying to undo state.
 */
interface RunState {
  runId: string | null;
  events: RunEvent[];
  live: RuntimeState;
  /** Non-null while scrubbing; the canvas renders this instead of `live`. */
  scrubSeq: number | null;
  connecting: boolean;
  connect: (runId: string) => void;
  loadRun: (runId: string) => Promise<void>;
  disconnect: () => void;
  scrubTo: (seq: number | null) => void;
  reset: () => void;
}

let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

function openStream(runId: string, afterSeq: number) {
  const url = `/api/runs/${runId}/stream${afterSeq >= 0 ? `?after=${afterSeq}` : ""}`;
  const es = new EventSource(url);
  source = es;

  es.onmessage = (msg) => {
    reconnectAttempts = 0;
    const parsed = JSON.parse(msg.data) as { version: number; event: RunEvent };
    if (parsed.version !== EVENT_SCHEMA_VERSION) {
      console.warn(`ignoring event with schema v${parsed.version}`);
      return;
    }
    useRun.setState((s) => ({
      events: [...s.events, parsed.event],
      live: reduce(s.live, parsed.event),
      connecting: false,
    }));
    if (parsed.event.type === "run.finished") {
      useRun.getState().disconnect();
    }
  };

  es.onerror = () => {
    es.close();
    source = null;
    const state = useRun.getState();
    // Don't reconnect if the run finished or we disconnected intentionally.
    if (state.live.status === "done" || state.live.status === "failed" || state.live.status === "cancelled") {
      return;
    }
    reconnectAttempts++;
    useRun.setState({ connecting: true });
    const delay = Math.min(10000, 500 * 2 ** reconnectAttempts);
    reconnectTimer = setTimeout(() => {
      const lastSeq = state.events.at(-1)?.seq ?? -1;
      openStream(runId, lastSeq);
    }, delay);
  };
}

export const useRun = create<RunState>()((set, get) => ({
  runId: null,
  events: [],
  live: initialRuntime,
  scrubSeq: null,
  connecting: false,

  connect: (runId) => {
    get().disconnect();
    set({ runId, events: [], live: initialRuntime, scrubSeq: null, connecting: true });
    openStream(runId, -1);
  },

  loadRun: async (runId) => {
    get().disconnect();
    const { events, state } = await api.getEvents(runId);
    set({ runId, events, live: state, scrubSeq: null, connecting: false });
  },

  disconnect: () => {
    source?.close();
    source = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempts = 0;
    set({ connecting: false });
  },

  scrubTo: (scrubSeq) => set({ scrubSeq }),

  reset: () => {
    get().disconnect();
    set({ runId: null, events: [], live: initialRuntime, scrubSeq: null, connecting: false });
  },
}));

/** What the canvas should draw: the scrub position if scrubbing, otherwise live. */
export function useVisibleRuntime(): RuntimeState {
  const { events, live, scrubSeq } = useRun();
  return scrubSeq === null ? live : replay(events, scrubSeq);
}

export async function resumeRun(action: "continue" | "scrap") {
  const runId = useRun.getState().runId;
  if (!runId) return;
  await api.resumeRun(runId, action);
  useRun.setState({ live: { ...useRun.getState().live, status: "running" } });
  openStream(runId, useRun.getState().events.at(-1)?.seq ?? -1);
}
