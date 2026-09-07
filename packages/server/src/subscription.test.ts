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

  it("blocks when concurrent runs exceed the plan", () => {
    expect(() =>
      enforceSubscription(withNodes(textNode("a", "my-model")), cfg, {
        subscription: { plan: "free", status: "active" },
        usedTokens: 0,
        activeRuns: 1,
      }),
    ).toThrowError(/并发上限/);
  });
});

describe("currentPeriodStart", () => {
  it("aligns to the first day of the month", () => {
    const d = currentPeriodStart(new Date("2026-09-15T12:00:00Z").getTime());
    expect(new Date(d).getUTCDate()).toBe(1);
    expect(new Date(d).getUTCHours()).toBe(0);
  });
});
