/**
 * Per-factory debounced persistence for manual RTS park positions
 * (PUT /api/graphs/:id/park-coord, design-rts-stage-b B1).
 *
 * A single shared debounce timer silently drops a factory's pending save
 * whenever a *different* factory is dragged inside the debounce window:
 * drag A, then drag B within 400ms and A's PUT was cancelled by B's
 * clearTimeout, so A snapped back to auto-layout after a refresh. Keying the
 * timers by graph id makes each factory debounce independently.
 *
 * flush() immediately sends every pending latest position — used on unmount
 * so the last drag of a session is not lost. persist() failures are swallowed
 * on purpose: the local override (overridesRef) still holds for the session,
 * and a failed save must not crash the pointer handler.
 */
export type ParkCoordPersist = (
  graphId: string,
  x: number,
  z: number,
) => Promise<unknown> | void;

export interface ParkCoordScheduler {
  /** Debounce a position save for one factory; later calls replace its pending value. */
  schedule(graphId: string, x: number, z: number): void;
  /** Send every pending latest position now and clear its timer. */
  flush(): void;
  /** Drop all pending saves without sending them (does not touch the server). */
  dispose(): void;
  /** Number of factories with an unsent, debounced save (tests/diagnostics). */
  readonly pendingCount: number;
}

interface PendingEntry {
  x: number;
  z: number;
  timer: ReturnType<typeof setTimeout>;
}

export function createParkCoordScheduler(
  persist: ParkCoordPersist,
  debounceMs = 400,
): ParkCoordScheduler {
  const pending = new Map<string, PendingEntry>();

  function fireAndForget(graphId: string, x: number, z: number): void {
    try {
      Promise.resolve(persist(graphId, x, z)).catch(() => {
        /* non-fatal: local override retained; next layout recompute restores it */
      });
    } catch {
      /* a synchronous throw from persist is equally non-fatal */
    }
  }

  function schedule(graphId: string, x: number, z: number): void {
    const prev = pending.get(graphId);
    if (prev) clearTimeout(prev.timer);
    const entry: PendingEntry = { x, z, timer: undefined as unknown as ReturnType<typeof setTimeout> };
    entry.timer = setTimeout(() => {
      pending.delete(graphId);
      fireAndForget(graphId, entry.x, entry.z);
    }, debounceMs);
    pending.set(graphId, entry);
  }

  function flush(): void {
    for (const [graphId, entry] of pending) {
      clearTimeout(entry.timer);
      fireAndForget(graphId, entry.x, entry.z);
    }
    pending.clear();
  }

  function dispose(): void {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
  }

  return {
    schedule,
    flush,
    dispose,
    get pendingCount() {
      return pending.size;
    },
  };
}
