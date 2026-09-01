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
  /**
   * Per-provider endpoint override per modality (e.g. `{ video: "/videos" }`
   * for a gateway whose video API lives at a non-standard path). Absent
   * modalities fall back to the global MODALITY_ENDPOINT default.
   */
  endpoints?: Partial<Record<Modality, string>>;
  /**
   * Optional adapter for gateways whose video API diverges from the standard
   * OpenAI-compatible video shape. agnes is the shipped example: it requires a
   * literal `mode` ("ti2vid"), rejects `duration`, takes explicit width/height
   * instead of `aspect_ratio`, and returns the generated URL at `metadata.url`
   * (not `output[0].url`).
   */
  videoAdapter?: {
    /** Literal fields merged into the create-task body (e.g. `{ mode: "ti2vid" }`). */
    createBody?: Record<string, unknown>;
    /** Do not send `duration` (gateway rejects it; duration is controlled via
     *  other fields such as num_frames/frame_rate). */
    omitDuration?: boolean;
    /** Maps a node's aspect string (e.g. "16:9") to explicit width/height for
     *  gateways that take dimensions instead of `aspect_ratio`. */
    aspectToSize?: Record<string, { width: number; height: number }>;
    /** Dot path to the generated video URL inside the poll result
     *  (default `output.0.url` for OpenAI-style `output` arrays). */
    resultUrlPath?: string;
  };
  /** Disabled providers are kept in config but skipped by the router. */
  enabled?: boolean;
  /** "builtin" = product-owned tier, injected from DEFAULT_CONFIG and
   *  read-only in Settings (immutable, only selectable); absent/"custom"
   *  = user-managed tier, fully editable. */
  source?: "builtin" | "custom";
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

/**
 * Resolve the API sub-path for a model's modality. Providers differ — one
 * gateway hosts video at `/videos`, another at `/videos/generations`, and two
 * models inside one provider can even split across paths. So the resolution
 * is: provider.endpoints[modality] override > global MODALITY_ENDPOINT
 * default. The worker and the "test connection" probe share this one helper
 * so they always agree on where to POST.
 */
export function endpointFor(provider: ProviderConfig, model: string, modality: Modality): string {
  return provider.endpoints?.[modality] ?? MODALITY_ENDPOINT[modality];
}

export interface AppConfig {
  providers: Record<string, ProviderConfig>;
  defaultModel: string;
  defaultProvider: string;
  /** Display order of model cards, stored as "provider::model" keys. */
  modelOrder?: string[];
  /** Soft monthly budget in USD; the engine warns at 80%/100%. Null disables it. */
  monthlyBudgetUsd?: number | null;
  /**
   * Pre-save auto-snapshot tuning (design-versions §1). minIntervalMs
   * throttles same-content snapshots; maxKeep is the per-graph rolling
   * retention for auto snapshots (manual ones are never pruned).
   */
  autoSnapshot?: { minIntervalMs?: number; maxKeep?: number };
}

/**
 * Internal "fake" provider with zero models. It is not user-visible in
 * Settings (no models) and only serves as the routing fallback when a node
 * references an unknown model / an explicitly "fake" model string, so the
 * engine degrades to the deterministic fake worker instead of crashing.
 */
const FAKE_PROVIDER: ProviderConfig = { type: "fake", models: [] };

/**
 * Built-in "agnes" provider: the product's hosted model gateway. Shipped as
 * read-only so every user sees the same real models without configuring a
 * key — matching the model-layering decision (product-vision-discussion §九).
 * `source:"builtin"` makes it immutable in Settings (no delete / no key edit);
 * it can only be selected, and can be disabled like demo.
 */
const AGNES_PROVIDER: ProviderConfig = {
  type: "openai-compatible",
  source: "builtin",
  enabled: true,
  baseUrl: "https://apihub.agnes-ai.com/v1",
  // The gateway key is injected at deploy time via AGNES_API_KEY and must never
  // be committed. Without it the built-in tier fails closed ("missing API key")
  // instead of leaking a secret into the repo.
  apiKey: process.env.AGNES_API_KEY,
  models: [
    "agnes-2.0-flash",
    "agnes-2.5-flash",
    "agnes-image-2.0-flash",
    "agnes-image-2.1-flash",
    "agnes-video-v2.0",
    "agnes-video-2.5-flash",
  ],
  modalities: {
    "agnes-2.0-flash": "text",
    "agnes-2.5-flash": "text",
    "agnes-image-2.0-flash": "image",
    "agnes-image-2.1-flash": "image",
    "agnes-video-v2.0": "video",
    "agnes-video-2.5-flash": "video",
  },
  // Agnes gateway serves video at POST /v1/videos (not /videos/generations),
  // so declare it explicitly — independent of the global MODALITY_ENDPOINT default.
  endpoints: { video: "/videos" },
  // agnes video API diverges from the OpenAI-compatible video shape: it wants
  // a literal `mode` ("ti2vid"), rejects `duration`, takes width/height, and
  // returns the finished URL at `metadata.url`.
  videoAdapter: {
    createBody: { mode: "ti2vid" },
    omitDuration: true,
    aspectToSize: {
      "16:9": { width: 1280, height: 720 },
      "9:16": { width: 720, height: 1280 },
      "1:1": { width: 768, height: 768 },
      "4:3": { width: 1024, height: 768 },
      "3:4": { width: 768, height: 1024 },
    },
    // The completed task carries the video URL at the top-level `url` field
    // (metadata is empty); the parser falls back to metadata.url/output[0].
    resultUrlPath: "url",
  },
};

const DEFAULT_CONFIG: AppConfig = {
  providers: {
    // Kept for backward compatibility — anything that still references
    // type:"fake" or model:"fake" routes to the same fakeWorker.
    fake: FAKE_PROVIDER,
    agnes: AGNES_PROVIDER,
  },
  defaultModel: "agnes-2.0-flash",
  defaultProvider: "agnes",
  modelOrder: [
    "agnes::agnes-2.0-flash",
    "agnes::agnes-2.5-flash",
    "agnes::agnes-image-2.0-flash",
    "agnes::agnes-image-2.1-flash",
    "agnes::agnes-video-v2.0",
    "agnes::agnes-video-2.5-flash",
  ],
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
    // Builtin tiers are product-owned: a user copy stored before the `source`
    // field existed (or hand-crafted) must never shadow the injected default,
    // so the builtin provider always wins the merge.
    for (const [name, def] of Object.entries(DEFAULT_CONFIG.providers)) {
      if (def.source === "builtin") providers[name] = def;
    }
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
