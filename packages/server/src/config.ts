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
}

const FAKE_PROVIDER: ProviderConfig = { type: "fake", models: [] };
const DEFAULT_CONFIG: AppConfig = {
  providers: {
    fake: FAKE_PROVIDER,
  },
  defaultModel: "fake",
  defaultProvider: "fake",
  modelOrder: [],
};

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

export function configPath(): string {
  return candidatePaths().find((p) => {
    try {
      readFileSync(p, "utf8");
      return true;
    } catch {
      return false;
    }
  }) ?? join(homedir(), ".agent-world", "config.json");
}

export function loadConfig(): AppConfig {
  for (const path of candidatePaths()) {
    try {
      const raw = readFileSync(path, "utf8");
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
      // try next
    }
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: AppConfig): string {
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
