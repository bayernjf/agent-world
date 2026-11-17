import { describe, expect, it } from "vitest";
import {
  currentUsageDimensions,
  parseUsageDimensions,
  runAsUsageDimensions,
} from "./usage-context.js";

describe("parseUsageDimensions", () => {
  it("accepts the three known ids", () => {
    const parsed = parseUsageDimensions({ taskId: "task-1", positionId: "pos-1", departmentId: "dep-1" });
    expect(parsed).toEqual({ ok: true, value: { taskId: "task-1", positionId: "pos-1", departmentId: "dep-1" } });
  });

  it("treats absent and null as no attribution", () => {
    expect(parseUsageDimensions(undefined)).toEqual({ ok: true });
    expect(parseUsageDimensions(null)).toEqual({ ok: true });
    expect(parseUsageDimensions({})).toEqual({ ok: true, value: undefined });
  });

  it("rejects an unknown field so a typo cannot silently drop attribution", () => {
    expect(parseUsageDimensions({ taskID: "t" })).toEqual({
      ok: false,
      error: 'usageDimensions has unknown field "taskID"',
    });
  });

  it("rejects empty, non-string and over-long ids", () => {
    expect(parseUsageDimensions({ taskId: "" }).ok).toBe(false);
    expect(parseUsageDimensions({ taskId: 7 }).ok).toBe(false);
    expect(parseUsageDimensions({ taskId: "x".repeat(129) }).ok).toBe(false);
  });

  it("rejects an array or a primitive payload", () => {
    expect(parseUsageDimensions(["task-1"]).ok).toBe(false);
    expect(parseUsageDimensions("task-1").ok).toBe(false);
  });
});

describe("runAsUsageDimensions", () => {
  it("exposes the ids inside the run and clears them after", async () => {
    await runAsUsageDimensions({ taskId: "task-1" }, async () => {
      expect(currentUsageDimensions()).toEqual({ taskId: "task-1" });
    });
    expect(currentUsageDimensions()).toBeUndefined();
  });

  it("keeps concurrent runs isolated", async () => {
    const seen: string[] = [];
    await Promise.all([
      runAsUsageDimensions({ taskId: "a" }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        seen.push(currentUsageDimensions()?.taskId ?? "none");
      }),
      runAsUsageDimensions({ taskId: "b" }, async () => {
        await new Promise((r) => setTimeout(r, 2));
        seen.push(currentUsageDimensions()?.taskId ?? "none");
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(currentUsageDimensions()?.taskId ?? "none");
      })(),
    ]);
    expect(seen.sort()).toEqual(["a", "b", "none"]);
  });

  it("passes through when no dimensions are supplied", async () => {
    const got = await runAsUsageDimensions(undefined, async () => currentUsageDimensions());
    expect(got).toBeUndefined();
  });
});
