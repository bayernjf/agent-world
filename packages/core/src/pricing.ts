/**
 * Billing model. Text/embedding models charge by token; image models charge per
 * generated image; video per second of footage; TTS per second and/or per 1K
 * input characters. One model never mixes these, but a run can contain several
 * modalities, so usage carries both token totals and a free-form units map.
 */

export type ProviderType = "openai-compatible" | "anthropic" | "fake";

/** What kind of output a model produces. Drives which API endpoint is used. */
export type Modality = "text" | "image" | "video" | "audio" | "embedding";

export const MODALITIES: Modality[] = ["text", "image", "video", "audio", "embedding"];

export const DEFAULT_MODALITY: Modality = "text";

/** Sub-path under the provider's Base URL for each modality (OpenAI-compatible). */
export const MODALITY_ENDPOINT: Record<Modality, string> = {
  text: "/chat/completions",
  image: "/images/generations",
  video: "/videos/generations",
  audio: "/audio/speech",
  embedding: "/embeddings",
};

/**
 * Non-token usage counters. Keyed by a stable unit name so new modalities can
 * be added without an event-schema migration. Keys currently emitted:
 *  - images:     generated image count
 *  - seconds:    generated audio/video duration (seconds)
 *  - characters: TTS input characters (billed per 1K)
 */
export type UsageUnits = Record<string, number>;

export const UNIT_LABELS: Record<string, string> = {
  images: "张",
  seconds: "秒",
  characters: "字符",
};

/**
 * Pricing for a model. Which fields apply depends on the model's modality:
 *  - text / embedding: input, output, cacheRead (USD per 1M tokens)
 *  - image:             perImage (USD per generated image)
 *  - video:             perSecond (USD per second of generated video)
 *  - audio (TTS/STT):   perSecond and/or perKiloChar
 * Fields not relevant to the modality are ignored. A model with no entry is
 * metered as 0 cost (unknown pricing).
 */
export interface ModelPricing {
  // Token-based (text / embedding), USD per 1M tokens.
  input?: number;
  output?: number;
  cacheRead?: number;
  // Image, USD per generated image.
  perImage?: number;
  // Video / audio, USD per second.
  perSecond?: number;
  // Text-to-speech, USD per 1K input characters.
  perKiloChar?: number;
}

/** Human-readable unit label shown next to a price field, per modality. */
export interface PricingField {
  key: keyof ModelPricing;
  label: string;
  unit: string;
  step?: string;
}

export const PRICING_FIELDS: Record<Modality, PricingField[]> = {
  text: [
    { key: "input", label: "输入", unit: "/ 1M token" },
    { key: "output", label: "输出", unit: "/ 1M token" },
  ],
  embedding: [
    { key: "input", label: "输入", unit: "/ 1M token" },
  ],
  image: [
    { key: "perImage", label: "每张", unit: "USD / 张", step: "0.001" },
  ],
  video: [
    { key: "perSecond", label: "每秒", unit: "USD / 秒", step: "0.001" },
  ],
  audio: [
    { key: "perSecond", label: "每秒", unit: "USD / 秒", step: "0.0001" },
    { key: "perKiloChar", label: "每千字符", unit: "USD / 1K 字符", step: "0.0001" },
  ],
};

/** Per-modality heading shown above the price inputs. */
export const PRICING_HEADING: Record<Modality, string> = {
  text: "单价（USD / 100万 token，留空不计费）",
  embedding: "单价（USD / 100万 token，留空不计费）",
  image: "单价（USD / 张，留空不计费）",
  video: "单价（USD / 秒，留空不计费）",
  audio: "单价（USD / 秒 或 / 1K 字符，留空不计费）",
};

/** Which unit counter each per-unit price field consumes. */
const PRICE_UNIT: Partial<Record<keyof ModelPricing, string>> = {
  perImage: "images",
  perSecond: "seconds",
  perKiloChar: "characters",
};

export interface CostInput {
  tokensIn?: number;
  tokensOut?: number;
  cachedTokens?: number;
  units?: UsageUnits;
}

/**
 * Compute the USD cost of one call from raw usage and a model's pricing.
 * Token fields are billed per 1M; per-image/second/kilochar fields use their
 * natural unit. Any dimension without a configured price contributes 0.
 */
export function computeCost(usage: CostInput, pricing: ModelPricing | undefined): number {
  if (!pricing) return 0;
  const tokensIn = usage.tokensIn ?? 0;
  const tokensOut = usage.tokensOut ?? 0;
  const cachedTokens = usage.cachedTokens ?? 0;
  const billableIn = pricing.cacheRead != null ? Math.max(0, tokensIn - cachedTokens) : tokensIn;

  let cost =
    (billableIn * (pricing.input ?? 0) +
      cachedTokens * (pricing.cacheRead ?? pricing.input ?? 0) +
      tokensOut * (pricing.output ?? 0)) /
    1_000_000;

  const units = usage.units ?? {};
  for (const [field, unitKey] of Object.entries(PRICE_UNIT) as Array<[keyof ModelPricing, string]>) {
    const price = pricing[field];
    const amount = units[unitKey] ?? 0;
    if (price != null && amount > 0) {
      cost += field === "perKiloChar" ? (amount / 1000) * price : amount * price;
    }
  }
  return cost;
}

/** Sum two unit maps, returning a new map (never mutates inputs). */
export function addUnits(a: UsageUnits | undefined, b: UsageUnits | undefined): UsageUnits {
  const out: UsageUnits = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) {
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}
