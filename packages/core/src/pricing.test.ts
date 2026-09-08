import { describe, expect, it } from "vitest";
import { computeCost, addUnits, unpricedModels } from "./pricing.js";

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

describe("unpricedModels", () => {
  it("flags a model with no price card at all", () => {
    const gaps = unpricedModels({ acme: { models: ["m1"] } });
    expect(gaps).toEqual([
      { provider: "acme", model: "m1", modality: "text", level: "none", missing: ["input", "output"] },
    ]);
  });

  it("flags a text model priced on input only as partial", () => {
    const gaps = unpricedModels({ acme: { models: ["m1"], pricing: { m1: { input: 1 } } } });
    expect(gaps).toEqual([
      { provider: "acme", model: "m1", modality: "text", level: "partial", missing: ["output"] },
    ]);
  });

  it("accepts a fully priced text model", () => {
    expect(unpricedModels({ acme: { models: ["m1"], pricing: { m1: { input: 1, output: 2 } } } })).toEqual([]);
  });

  it("treats an explicit zero as priced, not missing", () => {
    expect(unpricedModels({ acme: { models: ["free"], pricing: { free: { input: 0, output: 0 } } } })).toEqual([]);
  });

  it("accepts an audio model priced on either dimension alone", () => {
    const providers = {
      acme: {
        models: ["tts-a", "tts-b"],
        modalities: { "tts-a": "audio" as const, "tts-b": "audio" as const },
        pricing: { "tts-a": { perSecond: 0.001 }, "tts-b": { perKiloChar: 0.015 } },
      },
    };
    expect(unpricedModels(providers)).toEqual([]);
  });

  it("uses the modality's own fields, so embedding needs input only", () => {
    const providers = {
      acme: { models: ["e1"], modalities: { e1: "embedding" as const }, pricing: { e1: { input: 0.02 } } },
    };
    expect(unpricedModels(providers)).toEqual([]);
  });

  it("skips disabled providers", () => {
    expect(unpricedModels({ acme: { models: ["m1"], enabled: false } })).toEqual([]);
  });
});
