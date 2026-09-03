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
type Connection = "idle" | "connecting" | "live" | "reconnecting";

interface RunState {
  runId: string | null;
  events: RunEvent[];
  live: RuntimeState;
  /** Non-null while scrubbing; the canvas renders this instead of `live`. */
  scrubSeq: number | null;
  connection: Connection;
  /** True during both the initial connect and a reconnect (for spinners). */
  connecting: boolean;
  /** True only while backing off after a dropped connection. */
  reconnecting: boolean;
  /** "replay" while viewing a finished run via history; "live" otherwise. */
  view: "live" | "replay";
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
  // EventSource can't set custom headers, but the server emits `id:` on every
  // frame so the browser automatically sends `Last-Event-ID` on native
  // reconnects. We still pass `?after=` explicitly because we manage reconnects
  // ourselves (exponential backoff) and it makes the resume point unambiguous.
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
      connection: "live",
      connecting: false,
      reconnecting: false,
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
    if (
      state.live.status === "done" ||
      state.live.status === "failed" ||
      state.live.status === "cancelled"
    ) {
      return;
    }
    reconnectAttempts++;
    useRun.setState({
      connection: "reconnecting",
      connecting: true,
      reconnecting: true,
    });
    const delay = Math.min(10000, 500 * 2 ** reconnectAttempts);
    reconnectTimer = setTimeout(() => {
      // Read the latest seq from the store, not a stale snapshot captured at
      // error time, so events delivered just before the drop aren't re-fetched.
      const lastSeq = useRun.getState().events.at(-1)?.seq ?? -1;
      openStream(runId, lastSeq);
    }, delay);
  };
}

export const useRun = create<RunState>()((set, get) => ({
  runId: null,
  events: [],
  live: initialRuntime,
  scrubSeq: null,
  connection: "idle",
  connecting: false,
  reconnecting: false,
  view: "live",

  connect: (runId) => {
    get().disconnect();
    set({
      runId,
      events: [],
      live: initialRuntime,
      scrubSeq: null,
      connection: "connecting",
      connecting: true,
      reconnecting: false,
      view: "live",
    });
    openStream(runId, -1);
  },

  loadRun: async (runId) => {
    get().disconnect();
    const { events, state } = await api.getEvents(runId);
    set({
      runId,
      events,
      live: state,
      scrubSeq: null,
      connection: "idle",
      connecting: false,
      reconnecting: false,
      view: "replay",
    });
  },

  disconnect: () => {
    source?.close();
    source = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempts = 0;
    set({
      connection: "idle",
      connecting: false,
      reconnecting: false,
      view: "live",
    });
  },

  scrubTo: (scrubSeq) => set({ scrubSeq }),

  reset: () => {
    get().disconnect();
    set({
      runId: null,
      events: [],
      live: initialRuntime,
      scrubSeq: null,
    });
  },
}));

/** What the canvas should draw: the scrub position if scrubbing, otherwise live. */
export function useVisibleRuntime(): RuntimeState {
  const { events, live, scrubSeq } = useRun();
  return scrubSeq === null ? live : replay(events, scrubSeq);
}

export async function resumeRun(
  action: "continue" | "approve" | "reject" | "edit" | "scrap",
  resetFrom?: string,
  editOutput?: Record<string, string>,
  approveTools?: string[],
) {
  const state = useRun.getState();
  const runId = state.runId;
  if (!runId) return;
  // Close any stream left open from the halted run before reopening, otherwise
  // two EventSources would fold the same events twice.
  state.disconnect();
  await api.resumeRun(runId, action, resetFrom, editOutput, approveTools);
  useRun.setState({
    runId,
    connection: "connecting",
    connecting: true,
    reconnecting: false,
    view: "live",
    live: { ...useRun.getState().live, status: "running" },
  });
  openStream(runId, useRun.getState().events.at(-1)?.seq ?? -1);
}

/**
 * Re-attach to a run the engine resumed without this store asking for it — the
 * review queue decides through POST /api/reviews/decide. Without it, a canvas
 * looking at that run stays frozen on its halted frame with a closed stream.
 * No-op for any run other than the one currently loaded.
 */
export function reattachRun(runId: string) {
  const state = useRun.getState();
  if (state.runId !== runId) return;
  state.disconnect();
  useRun.setState({
    connection: "connecting",
    connecting: true,
    reconnecting: false,
    view: "live",
    live: { ...useRun.getState().live, status: "running" },
  });
  openStream(runId, useRun.getState().events.at(-1)?.seq ?? -1);
}
