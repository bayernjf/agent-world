import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createParkCoordScheduler } from "./parkCoordScheduler";

describe("createParkCoordScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not persist before the debounce window, then saves once with the position", () => {
    const persist = vi.fn();
    const s = createParkCoordScheduler(persist, 400);

    s.schedule("g1", 10, 20);
    expect(persist).not.toHaveBeenCalled();

    vi.advanceTimersByTime(399);
    expect(persist).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("g1", 10, 20);
  });

  it("coalesces repeated moves of the same factory to a single latest-value save", () => {
    const persist = vi.fn();
    const s = createParkCoordScheduler(persist, 400);

    s.schedule("g1", 1, 1);
    vi.advanceTimersByTime(300);
    s.schedule("g1", 2, 2);
    vi.advanceTimersByTime(300);
    s.schedule("g1", 3, 3);
    vi.advanceTimersByTime(400);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("g1", 3, 3);
  });

  it("keeps per-factory timers: dragging B does not cancel A's pending save", () => {
    const persist = vi.fn();
    const s = createParkCoordScheduler(persist, 400);

    s.schedule("A", 1, 1);
    vi.advanceTimersByTime(300); // inside A's debounce window
    s.schedule("B", 2, 2);
    vi.advanceTimersByTime(400); // B's window fully elapses (A's fired at t=400)

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledWith("A", 1, 1);
    expect(persist).toHaveBeenCalledWith("B", 2, 2);
  });

  it("flush sends every pending latest position immediately and does not double-fire later", () => {
    const persist = vi.fn();
    const s = createParkCoordScheduler(persist, 400);

    s.schedule("A", 1, 1);
    s.schedule("B", 2, 2);
    expect(s.pendingCount).toBe(2);

    s.flush();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledWith("A", 1, 1);
    expect(persist).toHaveBeenCalledWith("B", 2, 2);
    expect(s.pendingCount).toBe(0);

    vi.advanceTimersByTime(2000);
    expect(persist).toHaveBeenCalledTimes(2); // timers were cleared on flush
  });

  it("dispose cancels pending saves without calling persist", () => {
    const persist = vi.fn();
    const s = createParkCoordScheduler(persist, 400);

    s.schedule("A", 1, 1);
    s.schedule("B", 2, 2);
    s.dispose();
    vi.advanceTimersByTime(2000);

    expect(persist).not.toHaveBeenCalled();
    expect(s.pendingCount).toBe(0);
  });

  it("swallows a rejected persist so the pointer handler never throws", async () => {
    const persist = vi.fn().mockRejectedValue(new Error("network"));
    const s = createParkCoordScheduler(persist, 400);

    s.schedule("g1", 1, 1);
    await vi.runAllTimersAsync();

    expect(persist).toHaveBeenCalledTimes(1);
  });
});
