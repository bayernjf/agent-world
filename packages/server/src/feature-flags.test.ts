import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS, isFeatureEnabled } from "./feature-flags.js";

describe("feature flags", () => {
  it("registry names are unique", () => {
    const names = FEATURE_FLAGS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("unknown flag fails closed", () => {
    expect(isFeatureEnabled("nonexistent-flag", "u1")).toBe(false);
  });

  it("rpa-metrics defaults to false (compliance risk, no override)", () => {
    expect(isFeatureEnabled("rpa-metrics", "u1")).toBe(false);
  });
});
