import { describe, expect, it } from "vitest";
import type { AppConfig, Graph } from "@agent-world/core";
import {
  DEMO_QUOTA,
  DemoForbiddenError,
  DemoQuotaError,
  assertNotDemo,
  enforceDemoQuota,
  hasBuiltinMedia,
} from "./demo.js";

const cfg: AppConfig = {
  providers: {
    agnes: {
      type: "openai-compatible",
      source: "builtin",
      enabled: true,
      models: ["agnes-2.0-flash"],
      modalities: { "agnes-2.0-flash": "text" },
    },
    agnesVideo: {
      type: "openai-compatible",
      source: "builtin",
      enabled: true,
      models: ["agnes-video"],
      modalities: { "agnes-video": "video" },
    },
    myown: {
      type: "openai-compatible",
      source: "custom",
      enabled: true,
      models: ["my-model"],
      modalities: { "my-model": "text" },
    },
  },
  defaultModel: "agnes-2.0-flash",
  defaultProvider: "agnes",
};

const base = { usedTokens: 0, totalRuns: 0, activeRuns: 0 };
const textNode = (model = "agnes-2.0-flash") => ({
  id: "t", kind: "textGen" as const, name: "t", x: 0, y: 0,
  textGen: { model, prompt: "" },
});
const videoNode = (model = "agnes-video") => ({
  id: "v", kind: "videoGen" as const, name: "v", x: 0, y: 0,
  videoGen: { model, prompt: "" },
});
const audioNode = (model = "agnes-video") => ({
  id: "a", kind: "audioGen" as const, name: "a", x: 0, y: 0,
  audioGen: { model, prompt: "" },
});
const g = (...nodes: Graph["nodes"]): Graph => ({ id: "g", name: "t", nodes, edges: [] });

describe("enforceDemoQuota", () => {
  it("allows a built-in TEXT graph within the token pool (the key difference from free plan)", () => {
    expect(() => enforceDemoQuota(g(textNode()), cfg, base)).not.toThrow();
  });

  it("allows an empty graph", () => {
    expect(() => enforceDemoQuota(g(), cfg, base)).not.toThrow();
  });

  it("blocks built-in video and audio nodes (DEMO_QUOTA_MEDIA)", () => {
    for (const node of [videoNode(), audioNode()]) {
      expect(() => enforceDemoQuota(g(node), cfg, base)).toThrowError(DemoQuotaError);
      try {
        enforceDemoQuota(g(node), cfg, base);
      } catch (e) {
        expect((e as DemoQuotaError).code).toBe("DEMO_QUOTA_MEDIA");
      }
    }
    expect(hasBuiltinMedia(g(videoNode(), textNode()), cfg)).toBe(true);
  });

  it("blocks once the lifetime token pool is exhausted (DEMO_QUOTA_TOKENS)", () => {
    expect(() =>
      enforceDemoQuota(g(textNode()), cfg, { ...base, usedTokens: DEMO_QUOTA.tokens }),
    ).toThrowError(DemoQuotaError);
    // Just under the cap still passes.
    expect(() =>
      enforceDemoQuota(g(textNode()), cfg, { ...base, usedTokens: DEMO_QUOTA.tokens - 1 }),
    ).not.toThrow();
  });

  it("blocks after maxRunsTotal (DEMO_QUOTA_RUNS)", () => {
    expect(() =>
      enforceDemoQuota(g(textNode("my-model")), cfg, { ...base, totalRuns: DEMO_QUOTA.maxRunsTotal }),
    ).toThrowError(DemoQuotaError);
  });

  it("blocks over storage (DEMO_QUOTA_STORAGE) and concurrency (DEMO_QUOTA_CONCURRENCY)", () => {
    expect(() =>
      enforceDemoQuota(g(), cfg, { ...base, usedStorageBytes: DEMO_QUOTA.storageBytes }),
    ).toThrowError(DemoQuotaError);
    expect(() =>
      enforceDemoQuota(g(), cfg, { ...base, activeRuns: DEMO_QUOTA.concurrentRuns }),
    ).toThrowError(DemoQuotaError);
  });
});

describe("assertNotDemo (capability blacklist)", () => {
  it("throws DemoForbiddenError carrying the feature for a demo, passes otherwise", () => {
    expect(() => assertNotDemo(true, "billing")).toThrowError(DemoForbiddenError);
    try {
      assertNotDemo(true, "publish");
    } catch (e) {
      expect((e as DemoForbiddenError).feature).toBe("publish");
    }
    expect(() => assertNotDemo(false, "billing")).not.toThrow();
  });
});
