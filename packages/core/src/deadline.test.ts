import { describe, expect, it } from "vitest";
import { deadlineAt, isTimedOut, remainingMs } from "./deadline.js";

describe("isTimedOut", () => {
  it("never times out when timeout is unset or non-positive", () => {
    expect(isTimedOut(0, 9_999_999, null)).toBe(false);
    expect(isTimedOut(0, 9_999_999, undefined)).toBe(false);
    expect(isTimedOut(0, 9_999_999, 0)).toBe(false);
    expect(isTimedOut(0, 9_999_999, -100)).toBe(false);
  });
  it("is false before the deadline and true at/after it", () => {
    expect(isTimedOut(1000, 1999, 1000)).toBe(false);
    expect(isTimedOut(1000, 2000, 1000)).toBe(true);
    expect(isTimedOut(1000, 5000, 1000)).toBe(true);
  });
});

describe("remainingMs", () => {
  it("is Infinity without a timeout", () => {
    expect(remainingMs(0, 123, null)).toBe(Infinity);
  });
  it("counts down and clamps at zero", () => {
    expect(remainingMs(1000, 1500, 1000)).toBe(500);
    expect(remainingMs(1000, 2500, 1000)).toBe(0);
  });
});

describe("deadlineAt", () => {
  it("returns the absolute deadline or null", () => {
    expect(deadlineAt(1000, 500)).toBe(1500);
    expect(deadlineAt(1000, null)).toBeNull();
  });
});
