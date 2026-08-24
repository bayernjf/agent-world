import { create } from "zustand";
import {
  EVENT_SCHEMA_VERSION,
  initialRuntime,
  reduce,
  replay,
  type RunEvent,
  type RuntimeState,
} from "@agent-world/core";

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
  connect: (runId: string) => void;
  disconnect: () => void;
  scrubTo: (seq: number | null) => void;
  reset: () => void;
}

let source: EventSource | null = null;

export const useRun = create<RunState>()((set, get) => ({
  runId: null,
  events: [],
  live: initialRuntime,
  scrubSeq: null,

  connect: (runId) => {
    get().disconnect();
    set({ runId, events: [], live: initialRuntime, scrubSeq: null });

    const es = new EventSource(`/api/runs/${runId}/stream`);
    source = es;

    es.onmessage = (msg) => {
      const parsed = JSON.parse(msg.data) as { version: number; event: RunEvent };
      if (parsed.version !== EVENT_SCHEMA_VERSION) {
        console.warn(`ignoring event with schema v${parsed.version}`);
        return;
      }
      set((s) => ({ events: [...s.events, parsed.event], live: reduce(s.live, parsed.event) }));
      if (parsed.event.type === "run.finished") get().disconnect();
    };

    es.onerror = () => get().disconnect();
  },

  disconnect: () => {
    source?.close();
    source = null;
  },

  scrubTo: (scrubSeq) => set({ scrubSeq }),

  reset: () => {
    get().disconnect();
    set({ runId: null, events: [], live: initialRuntime, scrubSeq: null });
  },
}));

/** What the canvas should draw: the scrub position if scrubbing, otherwise live. */
export function useVisibleRuntime(): RuntimeState {
  const { events, live, scrubSeq } = useRun();
  return scrubSeq === null ? live : replay(events, scrubSeq);
}
