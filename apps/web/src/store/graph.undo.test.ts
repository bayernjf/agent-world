import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    getSettings: () => Promise.resolve({
      providers: {
        test: {
          type: "openai-compatible",
          enabled: true,
          models: ["x"],
          modalities: { x: "text" },
        },
      },
      defaultModel: "x",
      defaultProvider: "test",
    }),
    saveGraph: () => Promise.resolve({ ok: true }),
  },
}));

describe("graph undo history", () => {
  it("resumes stale paused tracking for discrete edits", async () => {
    const { useGraph } = await import("./graph");
    useGraph.temporal.getState().pause();
    useGraph.getState().addNode("agent", 10, 10);
    expect(useGraph.temporal.getState().isTracking).toBe(true);
    expect(useGraph.temporal.getState().pastStates.length).toBeGreaterThan(0);
  });
});
