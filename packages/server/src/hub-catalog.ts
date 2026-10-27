/**
 * model-hub projection layer (W6-4 / W6-5).
 *
 * agent-world pulls its built-in model plane from model-hub through the
 * model-kit: the projection (models + cleartext keys + endpoints + pricing)
 * is grouped into ProviderConfig objects and merged into the effective config
 * beneath the user's own BYOK providers and above the operator platform
 * catalog and the code-shipped seeds:
 *
 *   BYOK (custom) > hub > platformCatalog > code seeds.
 *
 * The hub catalog is process-global (one agent-world project token shared by
 * every user); per-user BYOK stays in each user's settings row. Credentials
 * live only in the model-kit's 0600 cache and in memory — they are never
 * written into the agent-world DB or the settings blob.
 */
import { ModelKit, type AdapterConfig, type ResolvedModel } from "@model-hub/model-kit";
import type { ProviderConfig } from "./config.js";
import { AGNES_VIDEO_ADAPTER, type VideoDialect } from "./video-dialects.js";
import type { Modality, ModelPricing } from "@agent-world/core";

const HUB_PROVIDER_PREFIX = "hub-";

/**
 * Full video dialects for gateways whose video API is known to diverge from the
 * plain OpenAI shape, keyed by the inferred provider key. When the hub projects
 * such a gateway, the code dialect is reused rather than reconstructed from the
 * generic adapter fields.
 */
const VIDEO_DIALECTS: Record<string, VideoDialect> = {
  "agnes-ai": AGNES_VIDEO_ADAPTER,
};

/**
 * Build a video adapter for a hub provider. A known gateway reuses its full
 * dialect; otherwise the generic hub adapter fields are mapped when present.
 */
function mapVideoAdapter(
  providerKeyName: string,
  adapter: AdapterConfig | null,
): ProviderConfig["videoAdapter"] {
  const known = VIDEO_DIALECTS[providerKeyName];
  if (known) return known;
  if (!adapter) return undefined;
  const mapped: NonNullable<ProviderConfig["videoAdapter"]> = {};
  if (typeof adapter.retrieval_url_template === "string")
    mapped.retrievalUrlTemplate = adapter.retrieval_url_template;
  if (typeof adapter.result_url_path === "string")
    mapped.resultUrlPath = adapter.result_url_path;
  if (typeof adapter.duration_path === "string")
    mapped.durationPath = adapter.duration_path;
  if (typeof adapter.seconds_field === "string")
    mapped.secondsField = adapter.seconds_field;
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

/** Map the hub flat pricing to agent-world ModelPricing. */
function mapPricing(model: ResolvedModel): ModelPricing | undefined {
  const p = model.pricing;
  if (!p) return undefined;
  const pricing: ModelPricing = {};
  if (p.input_usd_per_million !== undefined) pricing.input = p.input_usd_per_million;
  if (p.output_usd_per_million !== undefined) pricing.output = p.output_usd_per_million;
  if (p.cache_read_usd_per_million !== undefined)
    pricing.cacheRead = p.cache_read_usd_per_million;
  if (p.per_image !== undefined) pricing.perImage = p.per_image;
  if (p.per_second !== undefined) pricing.perSecond = p.per_second;
  if (p.per_kilo_char !== undefined) pricing.perKiloChar = p.per_kilo_char;
  if (p.per_mega_utf8_byte !== undefined)
    pricing.perMegaUtf8Byte = p.per_mega_utf8_byte;
  return Object.keys(pricing).length > 0 ? pricing : undefined;
}

/** Infer a short provider key from the base URL (e.g. ark, agnes, openai). */
function providerKey(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).host;
    const parts = host.split(".");
    // e.g. ark.cn-beijing.volces.com -> ark; api.openai.com -> openai;
    // apihub.agnes-ai.com -> agnes-ai.
    const head = parts[0] === "api" || parts[0] === "apihub" ? parts[1] : parts[0];
    return (head ?? "provider").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  } catch {
    return "provider";
  }
}

/**
 * Group the projected models (by base URL) into ProviderConfig objects.
 * Models on the same base URL share one provider record.
 */
export function hubProjectionToProviders(models: ResolvedModel[]): Record<string, ProviderConfig> {
  const groups = new Map<string, ResolvedModel[]>();
  for (const model of models) {
    const key = providerKey(model.baseUrl);
    const list = groups.get(key) ?? [];
    list.push(model);
    groups.set(key, list);
  }

  const providers: Record<string, ProviderConfig> = {};
  for (const [key, list] of groups) {
    const first = list[0];
    if (!first) continue;
    const pricing: Record<string, ModelPricing> = {};
    const modalities: Record<string, Modality> = {};
    const endpoints: Partial<Record<Modality, string>> = {};
    // The video dialect comes from the first video-capable model's adapter.
    let videoAdapter: ProviderConfig["videoAdapter"];
    for (const m of list) {
      const mapped = mapPricing(m);
      if (mapped) pricing[m.model] = mapped;
      const modality = (m.modalities[0] ?? "text") as Modality;
      modalities[m.model] = modality;
      if (m.modalities.includes("video") && !videoAdapter) {
        videoAdapter = mapVideoAdapter(key, m.adapter);
      }
      if (m.endpoints.images) endpoints.image = m.endpoints.images;
      if (m.endpoints.videos) endpoints.video = m.endpoints.videos;
      if (m.endpoints.embeddings) endpoints.embedding = m.endpoints.embeddings;
      if (m.endpoints.chat) endpoints.text = m.endpoints.chat;
      if (m.endpoints.audio) endpoints.audio = m.endpoints.audio;
    }
    providers[`${HUB_PROVIDER_PREFIX}${key}`] = {
      type: first.protocol === "anthropic" ? "anthropic" : "openai-compatible",
      source: "builtin",
      enabled: true,
      baseUrl: first.baseUrl,
      apiKey: first.apiKey,
      models: list.map((m) => m.model),
      pricing: Object.keys(pricing).length > 0 ? pricing : undefined,
      modalities,
      endpoints: Object.keys(endpoints).length > 0 ? endpoints : undefined,
      videoAdapter,
    };
  }
  return providers;
}

export interface HubCatalog {
  kit: ModelKit;
  /** Current hub providers (from the latest projection). */
  providers(): Record<string, ProviderConfig>;
  /** Re-pull the projection and return the refreshed providers. */
  sync(): Promise<{ revision: number | null; pulled: number }>;
}

let catalog: HubCatalog | null = null;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** Whether the hub env plane is configured (and not killed). */
export function isHubConfigured(): boolean {
  if (["1", "true", "yes"].includes(env("MODEL_HUB_DISABLED").toLowerCase()))
    return false;
  return Boolean(env("MODEL_HUB_URL") && env("MODEL_HUB_TOKEN"));
}

/** Build the hub catalog from env; returns null when not configured. */
export async function createHubCatalog(): Promise<HubCatalog | null> {
  if (!isHubConfigured()) return null;
  const cachePath = env("MODEL_HUB_CACHE_PATH") || "./data/model-hub-cache.json";
  const kit = await new ModelKit({
    hubUrl: env("MODEL_HUB_URL"),
    token: env("MODEL_HUB_TOKEN"),
    cachePath,
  }).init();
  const instance: HubCatalog = {
    kit,
    providers: () => hubProjectionToProviders(kit.list()),
    sync: async () => {
      await kit.refresh();
      return { revision: kit.revision, pulled: kit.list().length };
    },
  };
  catalog = instance;
  return instance;
}

/** The currently bound hub catalog (null when the hub is not active). */
export function getHubCatalog(): HubCatalog | null {
  return catalog;
}

/** Bind a pre-built catalog (tests) or clear it (null). */
export function bindHubCatalog(instance: HubCatalog | null): void {
  catalog = instance;
}
