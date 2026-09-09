import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AppConfigSchema,
  bindSettingsStore,
  endpointFor,
  loadConfig,
  MODALITY_ENDPOINT,
  saveConfig,
  type AppConfig,
  type ProviderConfig,
  type SettingsStore,
} from "./config.js";

function memStore(): { store: SettingsStore; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    store: {
      get: (userId) => map.get(userId) ?? null,
      set: (userId, data) => {
        map.set(userId, data);
      },
    },
    map,
  };
}

const ALICE_CFG: AppConfig = {
  providers: {
    alice: {
      type: "openai-compatible",
      baseUrl: "https://alice.example/v1",
      apiKey: "sk-alice",
      models: ["a1"],
      enabled: true,
    },
  },
  defaultModel: "a1",
  defaultProvider: "alice",
};

describe("per-user config storage", () => {
  const { store, map } = memStore();

  afterEach(() => {
    map.clear();
  });

  it("saves and loads a user's settings through the bound store", async () => {
    bindSettingsStore(store);
    expect(await saveConfig(ALICE_CFG, "u1")).toBe("db");
    expect((await loadConfig("u1")).providers.alice?.apiKey).toBe("sk-alice");
  });

  it("keeps one user's settings invisible to another", async () => {
    bindSettingsStore(store);
    await saveConfig(ALICE_CFG, "u1");
    await saveConfig(
      { ...ALICE_CFG, providers: { bob: { ...ALICE_CFG.providers.alice!, apiKey: "sk-bob" } } },
      "u2",
    );
    const u1 = await loadConfig("u1");
    const u2 = await loadConfig("u2");
    expect(u1.providers.alice?.apiKey).toBe("sk-alice");
    expect(u1.providers.bob).toBeUndefined();
    expect(u2.providers.bob?.apiKey).toBe("sk-bob");
    expect(u2.providers.alice).toBeUndefined();
  });

  it("falls back to built-in defaults for a user who never saved settings", async () => {
    bindSettingsStore(store);
    const cfg = await loadConfig("ghost");
    // No DB row, no file → the built-in agnes baseline.
    expect(cfg.providers.agnes).toBeTruthy();
  });

  it("builtin providers always win the merge — a stored copy can't shadow them", async () => {
    bindSettingsStore(store);
    // Simulate stale/crafted data: an agnes entry persisted before `source`
    // existed (or hand-injected), with a rogue key and models.
    await saveConfig(
      {
        ...ALICE_CFG,
        providers: {
          ...ALICE_CFG.providers,
          agnes: {
            type: "openai-compatible",
            baseUrl: "https://evil.example/v1",
            apiKey: "sk-evil",
            models: ["sneaky-model"],
          },
        },
      },
      "u-shadow",
    );
    const agnes = (await loadConfig("u-shadow")).providers.agnes!;
    expect(agnes.baseUrl).toBe("https://apihub.agnes-ai.com/v1");
    expect(agnes.models).toContain("agnes-2.0-flash");
    expect(agnes.models).not.toContain("sneaky-model");
  });
});

describe("legacy file config remains the shared baseline", () => {
  let dir: string;
  let prev: string | undefined;

  afterEach(() => {
    if (prev === undefined) delete process.env.AGENT_WORLD_CONFIG;
    else process.env.AGENT_WORLD_CONFIG = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("loadConfig() without a userId reads the file", async () => {
    dir = mkdtempSync(join(tmpdir(), "aw-cfg-"));
    const file = join(dir, "agent-world.config.json");
    writeFileSync(file, JSON.stringify({ providers: { file: { type: "fake", models: ["x"] } } }));
    prev = process.env.AGENT_WORLD_CONFIG;
    process.env.AGENT_WORLD_CONFIG = file;

    const cfg = await loadConfig();
    expect(cfg.providers.file).toBeTruthy();
    // Backfill keeps the built-in agnes provider available.
    expect(cfg.providers.agnes).toBeTruthy();
  });

  it("saveConfig() without a userId writes the file", async () => {
    dir = mkdtempSync(join(tmpdir(), "aw-cfg-save-"));
    const file = join(dir, "agent-world.config.json");
    prev = process.env.AGENT_WORLD_CONFIG;
    process.env.AGENT_WORLD_CONFIG = file;
    // configPath() picks the first *existing* candidate; pre-create it so the
    // file (not the repo-root fallback) wins.
    writeFileSync(file, "{}");

    const path = await saveConfig(ALICE_CFG);
    expect(path).toBe(file);
    const reloaded = await loadConfig();
    expect(reloaded.providers.alice?.apiKey).toBe("sk-alice");
  });
});

describe("endpointFor() — per-provider endpoint override", () => {
  it("falls back to the global MODALITY_ENDPOINT default when unset", () => {
    const prov: ProviderConfig = { type: "openai-compatible", models: ["m"] };
    expect(endpointFor(prov, "m", "text")).toBe(MODALITY_ENDPOINT.text);
    expect(endpointFor(prov, "m", "video")).toBe(MODALITY_ENDPOINT.video);
  });

  it("prefers the provider's per-modality override", () => {
    const prov: ProviderConfig = {
      type: "openai-compatible",
      models: ["m"],
      endpoints: { video: "/videos" },
    };
    expect(endpointFor(prov, "m", "video")).toBe("/videos");
    // Other modalities are untouched by the override.
    expect(endpointFor(prov, "m", "text")).toBe(MODALITY_ENDPOINT.text);
    expect(endpointFor(prov, "m", "image")).toBe(MODALITY_ENDPOINT.image);
  });

  it("built-in agnes resolves video to /videos for both video models", async () => {
    const cfg = await loadConfig("ghost");
    const agnes = cfg.providers.agnes!;
    expect(endpointFor(agnes, "agnes-video-v2.0", "video")).toBe("/videos");
    expect(endpointFor(agnes, "agnes-video-2.5-flash", "video")).toBe("/videos");
  });
});

describe("AppConfigSchema — user-supplied MCP servers", () => {
  const base = { providers: {}, defaultModel: "m", defaultProvider: "p" };

  it("accepts http and sse", () => {
    for (const transport of ["http", "sse"] as const) {
      const r = AppConfigSchema.safeParse({
        ...base,
        mcpServers: [{ id: "s1", transport, url: "https://example.com/mcp" }],
      });
      expect(r.success).toBe(true);
    }
  });

  it("rejects stdio — a user-supplied command line is arbitrary code execution", () => {
    const r = AppConfigSchema.safeParse({
      ...base,
      mcpServers: [{ id: "s1", transport: "stdio", command: "sh", args: ["-c", "curl evil"] }],
    });
    expect(r.success).toBe(false);
  });

  it("requires a well-formed url", () => {
    const r = AppConfigSchema.safeParse({
      ...base,
      mcpServers: [{ id: "s1", transport: "http", url: "not-a-url" }],
    });
    expect(r.success).toBe(false);
  });

  it("defaults enabled to true", () => {
    const cfg = AppConfigSchema.parse({
      ...base,
      mcpServers: [{ id: "s1", transport: "http", url: "https://example.com/mcp" }],
    });
    expect(cfg.mcpServers![0].enabled).toBe(true);
  });

  it("carries user skill cards and rejects tool kind among them", () => {
    expect(
      AppConfigSchema.safeParse({
        ...base,
        skillCards: [{ id: "local:a", name: "A", kind: "judge", criterion: "无错别字" }],
      }).success,
    ).toBe(true);
    expect(
      AppConfigSchema.safeParse({
        ...base,
        skillCards: [{ id: "local:a", name: "A", kind: "tool", config: {} }],
      }).success,
    ).toBe(false);
  });
});
