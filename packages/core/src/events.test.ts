import { describe, expect, it } from "vitest";
import { ErrorCode, RunEvent } from "./events.js";

describe("node.degraded event (G4)", () => {
  const base = { seq: 1, ts: 1000, type: "node.degraded", nodeId: "v1", attempt: 1 };

  it("parses a full degraded event carrying a remote job handle", () => {
    const ev = RunEvent.parse({
      ...base,
      reason: "video job poll timed out after 300s; the remote render may still be in progress",
      errorCode: "TIMEOUT",
      remoteJob: { provider: "siliconflow", jobId: "job-abc", kind: "video" },
    });
    expect(ev.type).toBe("node.degraded");
    if (ev.type !== "node.degraded") throw new Error("wrong union member");
    expect(ev.reason).toContain("300s");
    expect(ev.errorCode).toBe("TIMEOUT");
    expect(ev.remoteJob).toEqual({ provider: "siliconflow", jobId: "job-abc", kind: "video" });
    // NodeRunKey fields survive.
    expect(ev.nodeId).toBe("v1");
    expect(ev.attempt).toBe(1);
  });

  it("parses a minimal degraded event (reason only; errorCode/remoteJob optional)", () => {
    const ev = RunEvent.parse({ ...base, reason: "outcome undecided" });
    if (ev.type !== "node.degraded") throw new Error("wrong union member");
    expect(ev.errorCode).toBeUndefined();
    expect(ev.remoteJob).toBeUndefined();
  });

  it("accepts image/audio remote-job kinds and an omitted provider", () => {
    for (const kind of ["image", "audio"] as const) {
      const ev = RunEvent.parse({
        ...base,
        reason: "x",
        remoteJob: { jobId: "j", kind },
      });
      if (ev.type !== "node.degraded") throw new Error("wrong union member");
      expect(ev.remoteJob?.kind).toBe(kind);
      expect(ev.remoteJob?.provider).toBeUndefined();
    }
  });

  it("rejects an unknown remote-job kind", () => {
    expect(() =>
      RunEvent.parse({ ...base, reason: "x", remoteJob: { jobId: "j", kind: "podcast" } }),
    ).toThrow();
  });

  it("rejects a missing reason", () => {
    expect(() => RunEvent.parse(base)).toThrow();
  });
});

describe("ErrorCode REMOTE_JOB_LOST (G4)", () => {
  it("admits REMOTE_JOB_LOST for reattach after provider TTL", () => {
    expect(ErrorCode.safeParse("REMOTE_JOB_LOST").success).toBe(true);
  });

  it("keeps the pre-existing codes valid (additive change)", () => {
    for (const code of [
      "TIMEOUT",
      "RATE_LIMIT",
      "PROVIDER_ERROR",
      "AUTH",
      "VALIDATION",
      "SCHEMA_VIOLATION",
      "BUDGET",
      "CONNECTOR",
      "UNKNOWN",
      "UNSUPPORTED",
      "SCRIPT_ERROR",
      "SUBPROCESS",
    ]) {
      expect(ErrorCode.safeParse(code).success).toBe(true);
    }
  });
});
