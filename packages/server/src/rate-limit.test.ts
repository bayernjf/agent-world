import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
  it("allows up to the limit then blocks", () => {
    const rl = new RateLimiter(3, 60_000);
    expect(rl.allow("k")).toBe(true);
    expect(rl.allow("k")).toBe(true);
    expect(rl.allow("k")).toBe(true);
    expect(rl.allow("k")).toBe(false); // 4th within window blocked
    expect(rl.remaining("k")).toBe(0);
  });

  it("isolates keys", () => {
    const rl = new RateLimiter(1, 60_000);
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("b")).toBe(true); // different key unaffected
    expect(rl.allow("a")).toBe(false);
    expect(rl.remaining("b")).toBe(0);
    expect(rl.remaining("a")).toBe(0);
  });

  it("allows again after the window expires", () => {
    vi.useFakeTimers();
    try {
      const rl = new RateLimiter(2, 60_000);
      expect(rl.allow("k")).toBe(true);
      expect(rl.allow("k")).toBe(true);
      expect(rl.allow("k")).toBe(false);
      vi.advanceTimersByTime(61_000);
      expect(rl.allow("k")).toBe(true); // window slid forward
    } finally {
      vi.useRealTimers();
    }
  });

  it("remaining reflects available slots", () => {
    const rl = new RateLimiter(5, 60_000);
    expect(rl.remaining("k")).toBe(5);
    rl.allow("k");
    expect(rl.remaining("k")).toBe(4);
    rl.allow("k");
    rl.allow("k");
    expect(rl.remaining("k")).toBe(2);
  });
});
