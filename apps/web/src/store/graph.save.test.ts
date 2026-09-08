import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Controlled stand-in for api.saveGraph: lets each test script the version the
// server assigns per call, which is exactly what the If-Match bug hinges on.
const saveGraph = vi.fn<
  (graph: unknown, version?: number | null) => Promise<{ ok: true; version: number }>
>();

vi.mock("../lib/api", () => ({
  api: {
    getSettings: () =>
      Promise.resolve({ providers: {}, defaultModel: undefined, defaultProvider: undefined }),
    saveGraph: (graph: unknown, version?: number | null) => saveGraph(graph, version),
  },
  GraphConflictError: class GraphConflictError extends Error {},
}));

describe("graph save version tracking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveGraph.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-save records the server version it was assigned", async () => {
    const { useGraph } = await import("./graph");
    useGraph.getState().setGraph({
      id: "g1",
      name: "G1",
      nodes: [],
      edges: [],
      version: 1,
    } as never);
    expect(useGraph.getState().serverVersion).toBe(1);

    saveGraph.mockResolvedValueOnce({ ok: true, version: 2 });
    useGraph.getState().addNode("textGen", 10, 10);
    await vi.advanceTimersByTimeAsync(500);

    expect(saveGraph).toHaveBeenCalledTimes(1);
    expect(useGraph.getState().serverVersion).toBe(2);
    expect(useGraph.getState().saveState).toBe("saved");
  });

  it("flushSave after a completed auto-save sends the fresh If-Match, not the stale one", async () => {
    const { useGraph } = await import("./graph");
    useGraph.getState().setGraph({
      id: "g2",
      name: "G2",
      nodes: [],
      edges: [],
      version: 1,
    } as never);

    // An edit auto-saves; the server's upsert bumps the version to 2.
    saveGraph.mockResolvedValueOnce({ ok: true, version: 2 });
    useGraph.getState().addNode("textGen", 10, 10);
    await vi.advanceTimersByTimeAsync(500);
    expect(useGraph.getState().serverVersion).toBe(2);

    // Switching graphs flushes with a conditional PUT. Before the fix this
    // carried the stale version 1, the server answered 409, and the switch
    // was silently aborted.
    saveGraph.mockResolvedValueOnce({ ok: true, version: 3 });
    await useGraph.getState().flushSave();

    expect(saveGraph).toHaveBeenCalledTimes(2);
    expect(saveGraph.mock.calls[1]?.[1]).toBe(2);
  });

  it("flushSave waits for an in-flight auto-save before its conditional PUT", async () => {
    const { useGraph } = await import("./graph");
    useGraph.getState().setGraph({
      id: "g3",
      name: "G3",
      nodes: [],
      edges: [],
      version: 1,
    } as never);

    // The auto-save PUT hangs until released, like a slow request.
    let releaseAutoSave: (v: { ok: true; version: number }) => void = () => {};
    const autoSaveDone = new Promise<{ ok: true; version: number }>((resolve) => {
      releaseAutoSave = resolve;
    });
    saveGraph.mockReturnValueOnce(autoSaveDone);

    useGraph.getState().addNode("textGen", 10, 10);
    await vi.advanceTimersByTimeAsync(500);
    expect(saveGraph).toHaveBeenCalledTimes(1);

    // Flush while the auto-save is still in flight; it must not race ahead.
    saveGraph.mockResolvedValueOnce({ ok: true, version: 3 });
    const flushed = useGraph.getState().flushSave();
    await Promise.resolve();
    expect(saveGraph).toHaveBeenCalledTimes(1); // queued, not fired yet

    releaseAutoSave({ ok: true, version: 2 });
    await flushed;

    expect(saveGraph).toHaveBeenCalledTimes(2);
    expect(saveGraph.mock.calls[1]?.[1]).toBe(2);
  });
});
