import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bindSettingsStore, loadConfig, saveConfig, type AppConfig, type SettingsStore } from "./config.js";

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

  it("saves and loads a user's settings through the bound store", () => {
    bindSettingsStore(store);
    expect(saveConfig(ALICE_CFG, "u1")).toBe("db");
    expect(loadConfig("u1").providers.alice?.apiKey).toBe("sk-alice");
  });

  it("keeps one user's settings invisible to another", () => {
    bindSettingsStore(store);
    saveConfig(ALICE_CFG, "u1");
    saveConfig(
      { ...ALICE_CFG, providers: { bob: { ...ALICE_CFG.providers.alice!, apiKey: "sk-bob" } } },
      "u2",
    );
    const u1 = loadConfig("u1");
    const u2 = loadConfig("u2");
    expect(u1.providers.alice?.apiKey).toBe("sk-alice");
    expect(u1.providers.bob).toBeUndefined();
    expect(u2.providers.bob?.apiKey).toBe("sk-bob");
    expect(u2.providers.alice).toBeUndefined();
  });

  it("falls back to built-in defaults for a user who never saved settings", () => {
    bindSettingsStore(store);
    const cfg = loadConfig("ghost");
    // No DB row, no file → the demo/fake baseline.
    expect(cfg.providers.demo).toBeTruthy();
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

  it("loadConfig() without a userId reads the file", () => {
    dir = mkdtempSync(join(tmpdir(), "aw-cfg-"));
    const file = join(dir, "agent-world.config.json");
    writeFileSync(file, JSON.stringify({ providers: { file: { type: "fake", models: ["x"] } } }));
    prev = process.env.AGENT_WORLD_CONFIG;
    process.env.AGENT_WORLD_CONFIG = file;

    const cfg = loadConfig();
    expect(cfg.providers.file).toBeTruthy();
    // Backfill keeps the built-in demo provider available.
    expect(cfg.providers.demo).toBeTruthy();
  });

  it("saveConfig() without a userId writes the file", () => {
    dir = mkdtempSync(join(tmpdir(), "aw-cfg-save-"));
    const file = join(dir, "agent-world.config.json");
    prev = process.env.AGENT_WORLD_CONFIG;
    process.env.AGENT_WORLD_CONFIG = file;
    // configPath() picks the first *existing* candidate; pre-create it so the
    // file (not the repo-root fallback) wins.
    writeFileSync(file, "{}");

    const path = saveConfig(ALICE_CFG);
    expect(path).toBe(file);
    const reloaded = loadConfig();
    expect(reloaded.providers.alice?.apiKey).toBe("sk-alice");
  });
});
