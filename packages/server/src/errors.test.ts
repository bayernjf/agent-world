import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addErrorSink,
  clearErrors,
  createWebhookErrorSink,
  errorCount,
  installProcessGuards,
  recentErrors,
  recordError,
  setErrorCapacity,
  type ErrorRecord,
} from "./errors.js";

afterEach(() => {
  clearErrors();
});

describe("error capture buffer", () => {
  it("normalizes Error, string, null and plain-object throws", () => {
    recordError("manual", new TypeError("boom"));
    recordError("manual", "string failure");
    recordError("manual", null);
    recordError("manual", { code: 42 });

    const recs = recentErrors();
    expect(recs).toHaveLength(4);
    // most-recent-first
    expect(recs[0]!.message).toBe('{"code":42}');
    expect(recs[1]!.message).toBe("null");
    expect(recs[2]!.message).toBe("string failure");
    expect(recs[3]!.name).toBe("TypeError");
    expect(recs[3]!.message).toBe("boom");
    for (const r of recs) {
      expect(r.id).toBeTruthy();
      expect(isNaN(Date.parse(r.ts))).toBe(false);
    }
  });

  it("attaches whitelisted bindings but omits the field when empty", () => {
    recordError("request", new Error("with"), { method: "POST", path: "/api/runs" });
    recordError("manual", new Error("without"));
    const recs = recentErrors();
    const withBindings = recs.find((r) => r.message === "with")!;
    const without = recs.find((r) => r.message === "without")!;
    expect(withBindings.bindings).toEqual({ method: "POST", path: "/api/runs" });
    expect(without.bindings).toBeUndefined();
  });

  it("truncates oversized stacks", () => {
    const e = new Error("long");
    e.stack = "S".repeat(9000);
    recordError("worker", e);
    const stack = recentErrors()[0]!.stack!;
    expect(stack.length).toBeLessThanOrEqual(4000 + "[truncated]".length + 1);
    expect(stack.endsWith("[truncated]")).toBe(true);
  });

  it("evicts oldest records once capacity is exceeded", () => {
    setErrorCapacity(3);
    recordError("manual", new Error("a"));
    recordError("manual", new Error("b"));
    recordError("manual", new Error("c"));
    recordError("manual", new Error("d"));
    expect(errorCount()).toBe(3);
    expect(recentErrors().map((r) => r.message)).toEqual(["d", "c", "b"]);
  });

  it("respects the limit argument", () => {
    for (const m of ["a", "b", "c", "d"]) recordError("manual", new Error(m));
    expect(recentErrors(2)).toHaveLength(2);
    expect(recentErrors(2).map((r) => r.message)).toEqual(["d", "c"]);
  });

  it("returns defensive copies", () => {
    recordError("manual", new Error("a"));
    const first = recentErrors()[0]!;
    first.message = "mutated";
    expect(recentErrors()[0]!.message).toBe("a");
  });
});

describe("error sinks", () => {
  it("fans out to sinks and supports unsubscribe", () => {
    const seen: ErrorRecord[] = [];
    const off = addErrorSink({ capture: (r) => seen.push(r) });
    recordError("worker", new Error("to sink"));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.message).toBe("to sink");
    off();
    recordError("worker", new Error("after off"));
    expect(seen).toHaveLength(1);
  });

  it("isolates a synchronously throwing sink", () => {
    addErrorSink({ capture: () => { throw new Error("sink down"); } });
    expect(() => recordError("manual", new Error("kept"))).not.toThrow();
    expect(recentErrors()[0]!.message).toBe("kept");
  });

  it("swallows an async sink rejection", async () => {
    addErrorSink({ capture: async () => { throw new Error("async sink down"); } });
    expect(() => recordError("manual", new Error("kept2"))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(recentErrors()[0]!.message).toBe("kept2");
  });

  it("webhook sink POSTs the record and never throws on network failure", async () => {
    const calls: Array<{ url: string; init: { method: string; body: string } }> = [];
    const okSink = createWebhookErrorSink({
      url: "https://example.test/intake",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true };
      },
    });
    addErrorSink(okSink);
    recordError("request", new Error("ship me"), { path: "/api/x" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://example.test/intake");
    expect(calls[0]!.init.method).toBe("POST");
    const body = JSON.parse(calls[0]!.init.body) as ErrorRecord;
    expect(body.message).toBe("ship me");
    expect(body.bindings).toEqual({ path: "/api/x" });

    clearErrors();
    const failingSink = createWebhookErrorSink({
      url: "https://example.test/intake",
      fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
    });
    addErrorSink(failingSink);
    expect(() => recordError("request", new Error("still fine"))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("installProcessGuards", () => {
  it("captures uncaughtException and invokes onFatal, unhandledRejection without onFatal", () => {
    const onFatal = vi.fn();
    const uninstall = installProcessGuards({ onFatal });

    process.emit("uncaughtException", new Error("fatal boom"));
    process.emit("unhandledRejection", new Error("rejected boom"));

    const recs = recentErrors();
    expect(recs.map((r) => r.kind).sort()).toEqual([
      "uncaught_exception",
      "unhandled_rejection",
    ]);
    expect(onFatal).toHaveBeenCalledTimes(1);

    uninstall();
    // after uninstall, process events are no longer captured. A bare
    // uncaughtException with no listener crashes Node, so attach a one-shot
    // absorbing listener just for this assertion.
    const before = errorCount();
    const absorb = () => {};
    process.once("uncaughtException", absorb);
    process.emit("uncaughtException", new Error("after uninstall"));
    expect(errorCount()).toBe(before);
  });

  it("is idempotent and returns the same uninstaller", () => {
    const onFatal = vi.fn();
    const u1 = installProcessGuards({ onFatal });
    const u2 = installProcessGuards({ onFatal });
    expect(u2).toBe(u1);
    process.emit("uncaughtException", new Error("once"));
    expect(onFatal).toHaveBeenCalledTimes(1);
    u1();
  });
});
