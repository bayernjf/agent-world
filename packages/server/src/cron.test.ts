import { describe, expect, it } from "vitest";
import { nextRunAfter } from "./cron.js";

function at(iso: string): Date {
  return new Date(iso);
}

describe("nextRunAfter", () => {
  it("returns the next minute for '* * * * *'", () => {
    const next = nextRunAfter("* * * * *", at("2026-01-01T00:00:30Z"));
    expect(next?.getUTCHours()).toBe(0);
    expect(next?.getUTCMinutes()).toBe(1);
    expect(next?.getUTCSeconds()).toBe(0);
  });

  it("returns the top of the next hour for '0 * * * *'", () => {
    const next = nextRunAfter("0 * * * *", at("2026-01-01T00:00:00Z"));
    expect(next?.toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });

  it("returns the next quarter hour for '*/15 * * * *'", () => {
    const next = nextRunAfter("*/15 * * * *", at("2026-01-01T00:00:00Z"));
    expect(next?.toISOString()).toBe("2026-01-01T00:15:00.000Z");
  });

  it("returns midnight for '0 0 * * *'", () => {
    const next = nextRunAfter("0 0 * * *", at("2026-01-01T08:30:00Z"));
    expect(next?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("returns the next weekday 9am for '0 9 * * 1-5'", () => {
    // 2026-01-05 is a Monday.
    const next = nextRunAfter("0 9 * * 1-5", at("2026-01-05T00:00:00Z"));
    expect(next?.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  it("skips weekends for '0 9 * * 1-5'", () => {
    // Friday 2026-01-02 09:00 -> next weekday 9am is Monday 2026-01-05 (skips Sat/Sun).
    const next = nextRunAfter("0 9 * * 1-5", at("2026-01-02T09:00:00Z"));
    expect(next?.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  it("returns the next Sunday for '0 0 * * 0'", () => {
    // Thursday 2026-01-01 -> Sunday 2026-01-04.
    const next = nextRunAfter("0 0 * * 0", at("2026-01-01T00:00:00Z"));
    expect(next?.toISOString()).toBe("2026-01-04T00:00:00.000Z");
  });

  it("returns the first of the next month for '0 0 1 * *'", () => {
    const next = nextRunAfter("0 0 1 * *", at("2026-03-15T12:00:00Z"));
    expect(next?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("handles Feb 29 on leap years", () => {
    const next = nextRunAfter("0 0 29 2 *", at("2026-01-01T00:00:00Z"));
    expect(next?.getUTCFullYear()).toBe(2028);
    expect(next?.getUTCMonth()).toBe(1); // February
    expect(next?.getUTCDate()).toBe(29);
  });

  it("returns null for a malformed expression", () => {
    expect(nextRunAfter("not a cron", at("2026-01-01T00:00:00Z"))).toBeNull();
    expect(nextRunAfter("0 0 * *", at("2026-01-01T00:00:00Z"))).toBeNull();
    expect(nextRunAfter("99 * * * *", at("2026-01-01T00:00:00Z"))).toBeNull();
  });
});
