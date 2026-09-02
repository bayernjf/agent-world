import { describe, expect, it, beforeEach } from "vitest";
import { useRun } from "./run";
import { initialRuntime } from "@agent-world/core";

describe("useRun store", () => {
  beforeEach(() => {
    // Reset to initial state without triggering disconnect side effects
    // on external resources (EventSource etc. are null in fresh state).
    useRun.setState({
      runId: null,
      events: [],
      live: initialRuntime,
      scrubSeq: null,
      connection: "idle",
      connecting: false,
      reconnecting: false,
      view: "live",
    });
  });

  it("has the expected initial state", () => {
    const s = useRun.getState();
    expect(s.runId).toBeNull();
    expect(s.events).toEqual([]);
    expect(s.live).toEqual(initialRuntime);
    expect(s.scrubSeq).toBeNull();
    expect(s.connection).toBe("idle");
    expect(s.connecting).toBe(false);
    expect(s.reconnecting).toBe(false);
    expect(s.view).toBe("live");
  });

  it("scrubTo sets the scrub sequence number", () => {
    useRun.getState().scrubTo(5);
    expect(useRun.getState().scrubSeq).toBe(5);
  });

  it("scrubTo(null) clears the scrub sequence", () => {
    useRun.getState().scrubTo(10);
    expect(useRun.getState().scrubSeq).toBe(10);
    useRun.getState().scrubTo(null);
    expect(useRun.getState().scrubSeq).toBeNull();
  });

  it("disconnect resets connection flags without clearing run data", () => {
    useRun.setState({
      runId: "run-123",
      events: [{ seq: 0, type: "run.started", ts: 0 } as never],
      connection: "live",
      connecting: true,
      reconnecting: true,
      view: "replay",
    });
    useRun.getState().disconnect();
    const s = useRun.getState();
    // Connection flags reset
    expect(s.connection).toBe("idle");
    expect(s.connecting).toBe(false);
    expect(s.reconnecting).toBe(false);
    expect(s.view).toBe("live");
    // Run data preserved
    expect(s.runId).toBe("run-123");
    expect(s.events.length).toBe(1);
  });

  it("reset clears all run data and disconnects", () => {
    useRun.setState({
      runId: "run-456",
      events: [{ seq: 0, type: "run.started", ts: 0 } as never],
      scrubSeq: 3,
      connection: "live",
    });
    useRun.getState().reset();
    const s = useRun.getState();
    expect(s.runId).toBeNull();
    expect(s.events).toEqual([]);
    expect(s.live).toEqual(initialRuntime);
    expect(s.scrubSeq).toBeNull();
  });

  it("scrubTo can be set to 0 (falsy but valid)", () => {
    useRun.getState().scrubTo(0);
    expect(useRun.getState().scrubSeq).toBe(0);
  });

  it("multiple scrubTo calls update the value", () => {
    useRun.getState().scrubTo(1);
    useRun.getState().scrubTo(2);
    useRun.getState().scrubTo(3);
    expect(useRun.getState().scrubSeq).toBe(3);
  });
});
