import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useToast, copyToClipboard } from "./toast";

describe("useToast", () => {
  beforeEach(() => {
    useToast.setState({ toast: null });
  });

  it("starts with no toast", () => {
    expect(useToast.getState().toast).toBeNull();
  });

  it("show stores a toast with the given message and ttl", () => {
    useToast.getState().show("hello", { ttlMs: 1234 });
    const t = useToast.getState().toast;
    expect(t).not.toBeNull();
    expect(t!.message).toBe("hello");
    expect(t!.ttlMs).toBe(1234);
  });

  it("show without options leaves ttlMs undefined", () => {
    useToast.getState().show("plain");
    expect(useToast.getState().toast!.ttlMs).toBeUndefined();
  });

  it("clear removes the toast", () => {
    useToast.getState().show("x");
    useToast.getState().clear();
    expect(useToast.getState().toast).toBeNull();
  });

  it("each show increments id so consumers can dedupe", () => {
    useToast.getState().show("a");
    const id1 = useToast.getState().toast!.id;
    useToast.getState().show("b");
    expect(useToast.getState().toast!.id).toBeGreaterThan(id1);
  });
});

describe("copyToClipboard", () => {
  // The fallback path touches `document` which doesn't exist in the node
  // vitest env used by this package. We only test the navigator.clipboard
  // branch here; the DOM fallback is exercised manually in the browser.
  const originalClipboard = (navigator as { clipboard?: unknown }).clipboard;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("returns true and forwards the text to navigator.clipboard.writeText", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const ok = await copyToClipboard("payload");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("payload");
  });

  it("returns false when clipboard.writeText throws and rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
      configurable: true,
      writable: true,
    });
    // In node env there is no `document` so the execCommand fallback can't
    // kick in; expect false.
    const ok = await copyToClipboard("nope");
    expect(ok).toBe(false);
  });
});
