import { describe, expect, it } from "vitest";
import { computeCost, addUnits } from "./pricing.js";

describe("computeCost", () => {
  it("prices text models by input/output tokens per 1M", () => {
    const cost = computeCost(
      { tokensIn: 1_000_000, tokensOut: 500_000 },
      { input: 3, output: 15 },
    );
    expect(cost).toBeCloseTo(3 + 7.5);
  });

  it("applies the cache-read discount when configured", () => {
    const cost = computeCost(
      { tokensIn: 1_000_000, tokensOut: 0, cachedTokens: 800_000 },
      { input: 3, cacheRead: 0.3 },
    );
    // 200k billable at $3/M + 800k cached at $0.3/M
    expect(cost).toBeCloseTo(0.6 + 0.24);
  });

  it("prices image models per generated image", () => {
    const cost = computeCost(
      { tokensIn: 0, tokensOut: 0, units: { images: 4 } },
      { perImage: 0.04 },
    );
    expect(cost).toBeCloseTo(0.16);
  });

  it("prices video per second", () => {
    const cost = computeCost(
      { units: { seconds: 30 } },
      { perSecond: 0.2 },
    );
    expect(cost).toBeCloseTo(6);
  });

  it("prices TTS per 1K input characters", () => {
    const cost = computeCost(
      { units: { characters: 2500 } },
      { perKiloChar: 0.015 },
    );
    expect(cost).toBeCloseTo(0.0375);
  });

  it("returns 0 when no pricing is configured", () => {
    expect(computeCost({ tokensIn: 1000, tokensOut: 1000 }, undefined)).toBe(0);
  });

  it("ignores unit dimensions that have no matching price", () => {
    const cost = computeCost(
      { units: { images: 2, seconds: 10 } },
      { perImage: 0.05 },
    );
    expect(cost).toBeCloseTo(0.1);
  });
});

describe("addUnits", () => {
  it("sums matching keys and leaves others untouched", () => {
    expect(addUnits({ images: 1, seconds: 3 }, { images: 2, characters: 100 })).toEqual({
      images: 3,
      seconds: 3,
      characters: 100,
    });
  });

  it("treats undefined as empty", () => {
    expect(addUnits(undefined, { images: 1 })).toEqual({ images: 1 });
    expect(addUnits({ images: 1 }, undefined)).toEqual({ images: 1 });
  });
});
