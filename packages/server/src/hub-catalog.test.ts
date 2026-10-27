import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedModel } from "@model-hub/model-kit";
import { bindHubCatalog, hubProjectionToProviders, isHubConfigured } from "./hub-catalog.js";
import { loadConfig } from "./config.js";
import { modelCatalogView } from "./routes/admin.js";

function model(over: Partial<ResolvedModel> & { model: string; baseUrl: string }): ResolvedModel {
  return {
    assignmentId: "asn_test",
    alias: over.model,
    role: "primary",
    modalities: ["text"],
    litellmId: null,
    displayName: null,
    protocol: "openai-compatible",
    apiKey: "sk-hub-key",
    endpoints: { chat: "/chat/completions" },
    adapter: null,
    contextWindow: null,
    supportsJson: true,
    supportsStream: true,
    dailyBudgetMicros: null,
    pricing: null,
    source: "hub",
    ...over,
  };
}

describe("hubProjectionToProviders", () => {
  it("groups models sharing a base URL into one provider", () => {
    const providers = hubProjectionToProviders([
      model({ model: "m-1", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" }),
      model({ model: "m-2", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" }),
    ]);
    const ark = providers["hub-ark"];
    expect(ark).toBeDefined();
    expect(ark?.models).toEqual(["m-1", "m-2"]);
    expect(ark?.source).toBe("builtin");
    expect(ark?.apiKey).toBe("sk-hub-key");
  });

  it("separates models on different base URLs", () => {
    const providers = hubProjectionToProviders([
      model({ model: "m-1", baseUrl: "https://api.openai.com/v1" }),
      model({ model: "m-2", baseUrl: "https://apihub.agnes-ai.com/v1" }),
    ]);
    expect(providers["hub-openai"]?.models).toEqual(["m-1"]);
    expect(providers["hub-agnes-ai"]?.models).toEqual(["m-2"]);
  });

  it("maps flat pricing to ModelPricing", () => {
    const providers = hubProjectionToProviders([
      model({
        model: "m-1",
        baseUrl: "https://api.openai.com/v1",
        pricing: {
          input_usd_per_million: 2.5,
          output_usd_per_million: 15,
          cache_read_usd_per_million: 0.25,
        },
      }),
    ]);
    expect(providers["hub-openai"]?.pricing?.["m-1"]).toEqual({
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
    });
  });

  it("maps image/video modalities and endpoints", () => {
    const providers = hubProjectionToProviders([
      model({
        model: "img-1",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        modalities: ["image"],
        endpoints: { images: "/images/generations" },
        pricing: { per_image: 0.045 },
      }),
      model({
        model: "vid-1",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        modalities: ["video"],
        endpoints: { videos: "/contents/generations/tasks" },
        pricing: { per_second: 0.227 },
      }),
    ]);
    const ark = providers["hub-ark"];
    expect(ark?.modalities?.["img-1"]).toBe("image");
    expect(ark?.modalities?.["vid-1"]).toBe("video");
    expect(ark?.endpoints?.image).toBe("/images/generations");
    expect(ark?.endpoints?.video).toBe("/contents/generations/tasks");
  });

  it("marks anthropic protocol providers", () => {
    const providers = hubProjectionToProviders([
      model({
        model: "claude-x",
        baseUrl: "https://api.anthropic.com",
        protocol: "anthropic",
        endpoints: { chat: "/v1/messages" },
      }),
    ]);
    expect(providers["hub-anthropic"]?.type).toBe("anthropic");
  });
});

describe("loadConfig with a bound hub catalog", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-hub-cfg-"));
  });
  afterEach(() => {
    bindHubCatalog(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("replaces code builtins with the hub but keeps fake and custom BYOK", async () => {
    const providers = hubProjectionToProviders([
      model({
        model: "hub-text-1",
        baseUrl: "https://apihub.agnes-ai.com/v1",
        pricing: { input_usd_per_million: 0.4, output_usd_per_million: 1.6 },
      }),
    ]);
    bindHubCatalog({
      kit: { list: () => [], revision: 7 } as never,
      providers: () => providers,
      sync: async () => ({ revision: 7, pulled: 1 }),
    });
    const cfg = await loadConfig();
    // code builtins gone
    expect(cfg.providers.agnes).toBeUndefined();
    expect(cfg.providers.backup).toBeUndefined();
    // hub present
    expect(cfg.providers["hub-agnes-ai"]?.models).toContain("hub-text-1");
    // fake kept
    expect(cfg.providers.fake).toBeDefined();
  });

  it("returns the normal config when no hub is bound", async () => {
    const cfg = await loadConfig();
    expect(cfg.providers.agnes).toBeDefined();
  });
});

describe("isHubConfigured", () => {
  afterEach(() => {
    delete process.env.MODEL_HUB_URL;
    delete process.env.MODEL_HUB_TOKEN;
    delete process.env.MODEL_HUB_DISABLED;
  });

  it("is false without URL/TOKEN and true when both are set", () => {
    expect(isHubConfigured()).toBe(false);
    process.env.MODEL_HUB_URL = "http://hub:8791";
    process.env.MODEL_HUB_TOKEN = "tok";
    expect(isHubConfigured()).toBe(true);
  });

  it("is false when the kill switch is set", () => {
    process.env.MODEL_HUB_URL = "http://hub:8791";
    process.env.MODEL_HUB_TOKEN = "tok";
    process.env.MODEL_HUB_DISABLED = "1";
    expect(isHubConfigured()).toBe(false);
  });
});

describe("modelCatalogView in hub mode", () => {
  afterEach(() => bindHubCatalog(null));

  it("exposes the hub projection read-only with a revision", () => {
    const providers = hubProjectionToProviders([
      model({ model: "hub-text-1", baseUrl: "https://apihub.agnes-ai.com/v1" }),
    ]);
    bindHubCatalog({
      kit: { list: () => [], revision: 42 } as never,
      providers: () => providers,
      sync: async () => ({ revision: 42, pulled: 1 }),
    });
    const view = modelCatalogView() as {
      fromHub: boolean;
      revision: number;
      providers: Record<string, { models: string[]; hasKey: boolean }>;
    };
    expect(view.fromHub).toBe(true);
    expect(view.revision).toBe(42);
    expect(view.providers["hub-agnes-ai"]?.models).toContain("hub-text-1");
    expect(JSON.stringify(view)).not.toContain("sk-hub-key");
  });
});
