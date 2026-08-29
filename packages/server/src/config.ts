import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MODALITY,
  MODALITIES,
  MODALITY_ENDPOINT,
  type Modality,
  type ModelPricing,
  type ProviderType,
} from "@agent-world/core";

// Re-export shared billing/modality definitions so server code can import them
// from a single place; the canonical definitions live in core.
export {
  DEFAULT_MODALITY,
  MODALITIES,
  MODALITY_ENDPOINT,
  PRICING_FIELDS,
  computeCost,
} from "@agent-world/core";
export type { Modality, ModelPricing, ProviderType } from "@agent-world/core";


/**
 * One model backend. To drive an `imageGen` node, register a provider whose
 * `baseUrl` points at an OpenAI-compatible image server (the engine POSTs to
 * `<baseUrl>/images/generations`) and list the image model in `models`:
 *
 *   {
 *     "type": "openai-compatible",
 *     "baseUrl": "https://api.your-image-host/v1",
 *     "apiKey": "sk-...",
 *     "models": ["agnes-image"],
 *     "modalities": { "agnes-image": "image" }
 *   }
 *
 * An individual `imageGen` node can also override `baseUrl` + `apiKey` directly
 * (e.g. to point at a local ComfyUI / Stable-Diffusion OpenAI-compatible server).
 */
export interface ProviderConfig {
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  models: string[];
  /** Per-model pricing; a model with no entry is metered as 0 cost. */
  pricing?: Record<string, ModelPricing>;
  /** Per-model modality; missing entries default to "text". */
  modalities?: Record<string, Modality>;
  /** Disabled providers are kept in config but skipped by the router. */
  enabled?: boolean;
}

/** Normalize a Base URL: trim trailing slash and strip any accidentally-pasted
 *  endpoint suffix (e.g. /chat/completions, /images/generations) so it is
 *  always the API root. */
export function normalizeBaseUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  for (const ep of Object.values(MODALITY_ENDPOINT)) {
    if (u.toLowerCase().endsWith(ep.toLowerCase())) {
      u = u.slice(0, -ep.length);
      break;
    }
  }
  return u.replace(/\/+$/, "");
}

export function modalityOf(provider: ProviderConfig, model: string): Modality {
  return provider.modalities?.[model] ?? DEFAULT_MODALITY;
}

export interface AppConfig {
  providers: Record<string, ProviderConfig>;
  defaultModel: string;
  defaultProvider: string;
  /** Display order of model cards, stored as "provider::model" keys. */
  modelOrder?: string[];
  /** Soft monthly budget in USD; the engine warns at 80%/100%. Null disables it. */
  monthlyBudgetUsd?: number | null;
}

const FAKE_PROVIDER: ProviderConfig = { type: "fake", models: [] };

/**
 * Built-in "demo" provider that ships with the product. It uses the fake
 * worker (no network, deterministic placeholders) so a brand new user can
 * add nodes and run a line before configuring a real API key. Models are
 * grouped by modality so the addNode lookup can route each node kind to
 * a sensible default.
 *
 * The user can disable this provider (enabled: false) from Settings; it
 * cannot be permanently removed because the loadConfig merge always
 * re-injects it from DEFAULT_CONFIG. That trade-off is intentional: a
 * first-run user with no real provider must still be able to build a line.
 */
const DEMO_PROVIDER: ProviderConfig = {
  type: "fake",
  enabled: true,
  models: ["demo-chat", "demo-image", "demo-video", "demo-audio"],
  modalities: {
    "demo-chat": "text",
    "demo-image": "image",
    "demo-video": "video",
    "demo-audio": "audio",
  },
};

const DEFAULT_CONFIG: AppConfig = {
  providers: {
    // Kept for backward compatibility — anything that still references
    // type:"fake" or model:"fake" routes to the same fakeWorker.
    fake: FAKE_PROVIDER,
    demo: DEMO_PROVIDER,
  },
  defaultModel: "demo-chat",
  defaultProvider: "demo",
  modelOrder: ["demo::demo-chat", "demo::demo-image", "demo::demo-video", "demo::demo-audio"],
};

/**
 * Per-user settings storage (a SQLite-backed `settings` table, bound at
 * startup by index.ts). config.ts stays free of a DB import; without a bound
 * store, config is read from / written to the legacy config file so tests and
 * file-only deployments keep working.
 */
export interface SettingsStore {
  get(userId: string): string | null;
  set(userId: string, data: string): void;
}

let settingsStore: SettingsStore | undefined;

export function bindSettingsStore(store: SettingsStore): void {
  settingsStore = store;
}

function candidatePaths(): string[] {
  const paths: string[] = [];
  if (process.env.AGENT_WORLD_CONFIG) paths.push(process.env.AGENT_WORLD_CONFIG);
  paths.push(join(homedir(), ".agent-world", "config.json"));
  // Walk up from cwd so the config is found whether running from repo root or
  // from packages/server (tsx watch sets cwd to the package dir).
  let dir = process.cwd();
  while (true) {
    paths.push(join(dir, "agent-world.config.json"));
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return paths;
}

function existingConfigPath(): string | null {
  for (const path of candidatePaths()) {
    try {
      readFileSync(path, "utf8");
      return path;
    } catch {
      // try next
    }
  }
  return null;
}

export function configPath(): string {
  return existingConfigPath() ?? join(homedir(), ".agent-world", "config.json");
}

/** Read the legacy file config (undefined when no file exists). */
function readFileConfigRaw(): string | undefined {
  const path = existingConfigPath();
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Parse + backfill a raw JSON config string; null when unparseable. */
function parseRaw(raw: string | undefined): AppConfig | null {
  if (raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const providers = { ...DEFAULT_CONFIG.providers, ...parsed.providers };
    // Backfill enabled: true for real providers that predate the field.
    for (const [name, prov] of Object.entries(providers)) {
      if (prov.type === "fake") continue;
      const patch: Partial<ProviderConfig> = {};
      if (prov.enabled === undefined) patch.enabled = true;
      if (prov.baseUrl) patch.baseUrl = normalizeBaseUrl(prov.baseUrl);
      if (Object.keys(patch).length > 0) {
        providers[name] = { ...prov, ...patch };
      }
    }
    // Backfill modality defaults for models that predate the field.
    for (const prov of Object.values(providers)) {
      if (prov.type === "fake") continue;
      if (!prov.modalities) prov.modalities = {};
      for (const m of prov.models) {
        if (!prov.modalities[m]) prov.modalities[m] = DEFAULT_MODALITY;
      }
    }
    // Backfill modelOrder from provider order if absent.
    if (!parsed.modelOrder) {
      const order: string[] = [];
      for (const [name, prov] of Object.entries(providers)) {
        if (prov.type !== "fake") for (const m of prov.models) order.push(`${name}::${m}`);
      }
      parsed.modelOrder = order;
    }
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      providers,
    };
  } catch {
    return null;
  }
}

/**
 * Load the effective config. With a userId and a bound store, the user's own
 * saved settings win; otherwise the legacy file config is the shared baseline.
 * Priority: per-user DB row > legacy file > built-in defaults.
 */
export function loadConfig(userId?: string): AppConfig {
  if (userId && settingsStore) {
    const stored = settingsStore.get(userId);
    const fromDb = parseRaw(stored ?? undefined);
    if (fromDb) return fromDb;
  }
  return parseRaw(readFileConfigRaw()) ?? DEFAULT_CONFIG;
}

/**
 * Save the config. With a userId and a bound store it goes to the per-user
 * row (mutually invisible across users); otherwise it lands in the legacy
 * config file. Returns a location label for the caller.
 */
export function saveConfig(config: AppConfig, userId?: string): string {
  if (userId && settingsStore) {
    settingsStore.set(userId, JSON.stringify(config));
    return "db";
  }
  const path = configPath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  return path;
}

/** Look up which provider config owns a given model name. */
export function providerForModel(
  config: AppConfig,
  model: string,
): { name: string; provider: ProviderConfig } {
  // When the requested model is the configured default and the default
  // provider owns it, prefer that provider — model names can repeat across
  // providers, so "set as default" must be able to disambiguate.
  if (model === config.defaultModel) {
    const dp = config.providers[config.defaultProvider];
    if (dp && (dp.models.includes(model) || config.defaultProvider === model)) {
      return { name: config.defaultProvider, provider: dp };
    }
  }
  for (const [name, provider] of Object.entries(config.providers)) {
    if (provider.models.includes(model) || name === model) {
      return { name, provider };
    }
  }
  const def = config.providers[config.defaultProvider];
  if (def) return { name: config.defaultProvider, provider: def };
  return { name: "fake", provider: FAKE_PROVIDER };
}
