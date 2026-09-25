import { describe, expect, it } from "vitest";
import type { AppConfig, Graph } from "@agent-world/core";
import {
  enforceSubscription,
  QuotaError,
  modelRefs,
  isBuiltinModel,
  currentPeriodStart,
} from "./subscription.js";

const cfg: AppConfig = {
  providers: {
    agnes: {
      type: "openai-compatible",
      source: "builtin",
      enabled: true,
      models: ["agnes-2.0-flash"],
      modalities: { "agnes-2.0-flash": "text" },
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

const graph: Graph = { id: "g", name: "t", nodes: [], edges: [] };
const textNode = (id: string, model: string) => ({
  id,
  kind: "textGen" as const,
  name: id,
  x: 0,
  y: 0,
  textGen: { model, prompt: "" },
});
const videoNode = (id: string, model = "my-model") => ({
  id,
  kind: "videoGen" as const,
  name: id,
  x: 0,
  y: 0,
  videoGen: { model, prompt: "" },
});
const MB = 1024 * 1024, GB = 1024 * MB;
const withNodes = (...nodes: Graph["nodes"]): Graph => ({ ...graph, nodes });

describe("modelRefs", () => {
  it("collects models from generation nodes, deduped", () => {
    expect(
      modelRefs(withNodes(textNode("a", "agnes-2.0-flash"), textNode("b", "my-model"))),
    ).toEqual(["agnes-2.0-flash", "my-model"]);
  });
});

describe("isBuiltinModel", () => {
  it("distinguishes builtin from custom providers", () => {
    expect(isBuiltinModel("agnes-2.0-flash", cfg)).toBe(true);
    expect(isBuiltinModel("my-model", cfg)).toBe(false);
  });
});

describe("enforceSubscription", () => {
  it("blocks builtin models on the free plan", () => {
    expect(() =>
      enforceSubscription(withNodes(textNode("a", "agnes-2.0-flash")), cfg, {
        usedTokens: 0,
        activeRuns: 0,
      }),
    ).toThrowError(QuotaError);
  });

  it("allows BYOK (custom model) on the free plan", () => {
    expect(() =>
      enforceSubscription(withNodes(textNode("a", "my-model")), cfg, {
        usedTokens: 0,
        activeRuns: 0,
      }),
    ).not.toThrow();
  });

  it("allows builtin models on a paid plan within quota", () => {
    expect(() =>
      enforceSubscription(withNodes(textNode("a", "agnes-2.0-flash")), cfg, {
        subscription: { plan: "starter", status: "active" },
        usedTokens: 100,
        activeRuns: 0,
      }),
    ).not.toThrow();
  });

  it("blocks builtin models on a paid plan over token quota", () => {
    expect(() =>
      enforceSubscription(withNodes(textNode("a", "agnes-2.0-flash")), cfg, {
        subscription: { plan: "starter", status: "active" },
        usedTokens: 500_001,
        activeRuns: 0,
      }),
    ).toThrowError(/额度已用尽/);
  });

  // design-monetization §6.4：欠费即停内置模型、BYOK 保留。宽限期（3-7 天）暂不
  // 实现——subscriptions 没有「状态何时变更」的列，见 deferred-items。
  it("blocks builtin models for a past_due subscription but not BYOK", () => {
    expect(() =>
      enforceSubscription(withNodes(textNode("a", "agnes-2.0-flash")), cfg, {
        subscription: { plan: "pro", status: "past_due" },
        usedTokens: 100,
        activeRuns: 0,
      }),
    ).toThrow(/欠费/);
    // The code is what the web modal branches on, so it is part of the contract.
    expect(() =>
      enforceSubscription(withNodes(textNode("a", "agnes-2.0-flash")), cfg, {
        subscription: { plan: "pro", status: "past_due" },
        usedTokens: 100,
        activeRuns: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: "PAYMENT_REQUIRED" }));

    expect(() =>
      enforceSubscription(withNodes(textNode("a", "my-model")), cfg, {
        subscription: { plan: "pro", status: "past_due" },
        usedTokens: 100,
        activeRuns: 0,
      }),
    ).not.toThrow();
  });

  it("keeps a canceled subscription working until its paid period ends", () => {
    const periodEnd = Date.parse("2026-10-01T00:00:00Z");
    const paid = (status: string, at: number) => () =>
      enforceSubscription(withNodes(textNode("a", "agnes-2.0-flash")), cfg, {
        subscription: { plan: "pro", status, currentPeriodEnd: periodEnd },
        usedTokens: 100,
        activeRuns: 0,
        now: at,
      });

    // Stripe writes `canceled` at cancel-at-period-end, while access is still paid for.
    expect(paid("canceled", periodEnd - 86_400_000)).not.toThrow();
    expect(paid("canceled", periodEnd + 1)).toThrow(/取消/);
    expect(paid("canceled", periodEnd + 1)).toThrowError(
      expect.objectContaining({ code: "SUBSCRIPTION_ENDED" }),
    );
    // An unknown/added status must not silently cut off someone who paid.
    expect(paid("trialing", periodEnd - 86_400_000)).not.toThrow();
  });

  it("blocks when concurrent runs exceed the plan", () => {
    expect(() =>
      enforceSubscription(withNodes(textNode("a", "my-model")), cfg, {
        subscription: { plan: "free", status: "active" },
        usedTokens: 0,
        activeRuns: 1,
      }),
    ).toThrowError(/并发上限/);
  });

  it("blocks builtin video generation once the plan's segment quota is reached", () => {
    // pro allows 10 segments; the 11th builtin video is blocked. BYOK video is user-paid and never counted.
    expect(() =>
      enforceSubscription(withNodes(videoNode("v", "agnes-2.0-flash")), cfg, {
        subscription: { plan: "pro", status: "active" },
        usedTokens: 0,
        activeRuns: 0,
        usedVideoSegments: 10,
      }),
    ).toThrowError(/视频生成额度/);
    expect(() =>
      enforceSubscription(withNodes(videoNode("v", "agnes-2.0-flash")), cfg, {
        subscription: { plan: "pro", status: "active" },
        usedTokens: 0,
        activeRuns: 0,
        usedVideoSegments: 9,
      }),
    ).not.toThrow();
  });

  it("allows BYOK video on the free plan (user-paid, not counted against platform quota)", () => {
    expect(() =>
      enforceSubscription(withNodes(videoNode("v", "my-model")), cfg, {
        usedTokens: 0,
        activeRuns: 0,
        usedVideoSegments: 0,
      }),
    ).not.toThrow();
  });

  it("blocks builtin video on the free plan via the builtin-model guard", () => {
    expect(() =>
      enforceSubscription(withNodes(videoNode("v", "agnes-2.0-flash")), cfg, {
        usedTokens: 0,
        activeRuns: 0,
        usedVideoSegments: 0,
      }),
    ).toThrowError(/免费层不可用内置模型/);
  });

  it("blocks once storage quota is reached", () => {
    expect(() =>
      enforceSubscription(withNodes(textNode("a", "my-model")), cfg, {
        subscription: { plan: "starter", status: "active" },
        usedTokens: 0,
        activeRuns: 0,
        usedStorageBytes: 5 * GB + 1,
      }),
    ).toThrowError(/存储空间/);
  });

  it("attaches a stable metric and structured detail to QuotaError", () => {
    try {
      enforceSubscription(withNodes(textNode("a", "agnes-2.0-flash")), cfg, {
        usedTokens: 0,
        activeRuns: 0,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaError);
      const q = err as QuotaError;
      expect(q.metric).toBe("builtin_model");
      expect(q.detail?.plan).toBe("free");
    }
  });
});

describe("currentPeriodStart", () => {
  it("aligns to the first day of the month", () => {
    const d = currentPeriodStart(new Date("2026-09-15T12:00:00Z").getTime());
    expect(new Date(d).getUTCDate()).toBe(1);
    expect(new Date(d).getUTCHours()).toBe(0);
  });
});
