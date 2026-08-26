import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyHalt } from "./notify.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RUN_HALT_WEBHOOK;
});

describe("notifyHalt (4.7)", () => {
  it("is a no-op when RUN_HALT_WEBHOOK is unset", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await notifyHalt({ runId: "r1", graphId: "g1", nodeId: "n1", reason: "x" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs a halt payload to the configured webhook", async () => {
    process.env.RUN_HALT_WEBHOOK = "https://hooks.example.com/halt";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }) as unknown as Response);
    await notifyHalt({ runId: "r1", graphId: "g1", nodeId: "critic", reason: "质检返工耗尽" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://hooks.example.com/halt");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ event: "run.halted", runId: "r1", graphId: "g1", nodeId: "critic", reason: "质检返工耗尽" });
  });

  it("does not throw when the webhook fails", async () => {
    process.env.RUN_HALT_WEBHOOK = "https://hooks.example.com/halt";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(
      notifyHalt({ runId: "r1", graphId: "g1", nodeId: "n1" }),
    ).resolves.toBeUndefined();
  });
});
