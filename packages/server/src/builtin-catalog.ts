import { z } from "zod";
import { unpricedModels, type PriceCardGap } from "@agent-world/core";
import type { Modality, ModelPricing, ProviderConfig } from "./config.js";

/**
 * The platform-maintained built-in model catalog (design-model-catalog 阶段 ④).
 *
 * Operator actions this makes possible without a release: add / retire a
 * built-in model, re-label its modality, and edit its unit price. What it
 * deliberately cannot touch — `baseUrl`, `apiKey`, `type`, `endpoints`,
 * `videoAdapter`, `source` — is enforced by *this type*, not by hiding fields
 * in a UI: the patch schema is `.strict()`, so an attempt to override an
 * interface-dialect or credential field fails validation at the write
 * boundary. Endpoint + credential live in env (AGNES_API_KEY / BACKUP_*), and
 * the provider's dialect is code because it is code-shaped (see
 * config.ts:333-355 for what a `videoAdapter` actually contains).
 *
 * Storage is a reserved row in the existing `settings` table: its
 * `user_id` is an FK-free `TEXT PRIMARY KEY` (sqlite-driver.ts:383), so a
 * platform row needs no migration, and encryption at rest is inherited
 * because index.ts's store adapter encrypts at the boundary.
 */
export const PLATFORM_SETTINGS_KEY = "__platform__";

/** Compile-time exhaustiveness guard: adding a field to ModelPricing without
 *  listing it here is a type error, so the validator cannot silently start
 *  ignoring a new price dimension. */
const PRICE_FIELDS: Record<keyof ModelPricing, true> = {
  input: true,
  output: true,
  cacheRead: true,
  perImage: true,
  perSecond: true,
  perKiloChar: true,
  perMegaUtf8Byte: true,
};

const ModelPricingSchema = z
  .object({
    input: z.number().nonnegative().optional(),
    output: z.number().nonnegative().optional(),
    cacheRead: z.number().nonnegative().optional(),
    perImage: z.number().nonnegative().optional(),
    perSecond: z.number().nonnegative().optional(),
    perKiloChar: z.number().nonnegative().optional(),
    perMegaUtf8Byte: z.number().nonnegative().optional(),
  })
  .strict();

const ModalitySchema = z.enum(["text", "image", "video", "audio", "embedding"]);

/** The allow-list. Everything not listed here is rejected by `.strict()`. */
export const CatalogPatchSchema = z
  .object({
    models: z.array(z.string().min(1).max(120)).max(200).optional(),
    modalities: z.record(z.string().min(1).max(120), ModalitySchema).optional(),
    pricing: z
      .record(z.string().min(1).max(120), ModelPricingSchema)
      .optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type CatalogPatch = z.infer<typeof CatalogPatchSchema>;

/** Provider names are open (any built-in tier can be overlaid); the guarantee
 *  lives in the value schema, which is `.strict()`. */
export const PlatformCatalogSchema = z.record(
  z.string().min(1).max(64),
  CatalogPatchSchema,
);
export type PlatformCatalog = z.infer<typeof PlatformCatalogSchema>;

/**
 * Overlay one patch on the code-shipped built-in provider.
 *
 * The three maps **replace** rather than merge, on purpose: with merge
 * semantics an operator could add a model but never retire one, because the
 * code default would keep supplying the entry. Retiring is the whole point of
 * rule A, so `models: []` must be able to mean "none".
 */
export function mergeBuiltinCatalog(
  def: ProviderConfig,
  patch: CatalogPatch | undefined,
): ProviderConfig {
  if (!patch) return def;
  const next: ProviderConfig = { ...def };
  if (patch.models) next.models = [...patch.models];
  if (patch.modalities) next.modalities = { ...patch.modalities };
  if (patch.pricing) next.pricing = { ...patch.pricing };
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  return next;
}

export interface CatalogStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

let store: CatalogStore | undefined;
/** `parseRaw` runs synchronously on every loadConfig, so the catalog is read
 *  once at boot and again after each admin write; the merge never awaits. */
let cache: PlatformCatalog = {};

export function bindCatalogStore(bound: CatalogStore): void {
  store = bound;
}

export function platformCatalog(): PlatformCatalog {
  return cache;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Read + validate the platform row. A bad payload never degrades to "empty
 * catalog": that would silently un-retire every model and reset every price, so
 * the previously loaded catalog is kept and the caller is told why.
 */
export async function loadPlatformCatalog(): Promise<{
  catalog: PlatformCatalog;
  error?: string;
}> {
  if (!store) return { catalog: {} };
  let raw: string | null;
  try {
    raw = await store.get(PLATFORM_SETTINGS_KEY);
  } catch (err) {
    return {
      catalog: cache,
      error: `platform catalog read failed; keeping the loaded one: ${(err as Error).message}`,
    };
  }
  if (raw === null || raw.trim() === "") return { catalog: {} };
  const parsed = PlatformCatalogSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    return {
      catalog: cache,
      error: `platform catalog payload invalid; keeping the loaded one: ${parsed.error.issues[0]?.message ?? "unparseable"}`,
    };
  }
  return { catalog: parsed.data };
}

/** Boot + post-write refresh. Returns an error string instead of throwing: a
 *  broken catalog row must not stop the server, it must be reported. */
export async function refreshPlatformCatalog(): Promise<{ error?: string }> {
  const { catalog, error } = await loadPlatformCatalog();
  cache = catalog;
  return error ? { error } : {};
}

export async function writePlatformCatalog(next: PlatformCatalog): Promise<void> {
  if (!store) throw new Error("catalog store is not bound");
  const validated = PlatformCatalogSchema.parse(next);
  await store.set(PLATFORM_SETTINGS_KEY, JSON.stringify(validated));
  cache = validated;
}

export interface CatalogChange {
  provider: string;
  added: string[];
  removed: string[];
  modalityEdited: string[];
  priceEdited: string[];
  enabledChanged: boolean;
}

/**
 * Describe a write for the audit log. Names only — price *values* are
 * readable back from the catalog row, so copying them into audit_log would
 * widen the exposure of a billing-relevant field without adding any answer.
 */
export function describeCatalogChange(
  before: PlatformCatalog,
  after: PlatformCatalog,
  codeDefaults: Record<string, ProviderConfig>,
): CatalogChange[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: CatalogChange[] = [];
  for (const provider of [...names].sort()) {
    const b = before[provider] ?? {};
    const a = after[provider] ?? {};
    const base = codeDefaults[provider]?.models ?? [];
    const beforeSet = new Set(b.models ?? base);
    const afterSet = new Set(a.models ?? b.models ?? base);
    const modalityEdited = [
      ...new Set([...Object.keys(b.modalities ?? {}), ...Object.keys(a.modalities ?? {})]),
    ].filter((m) => (b.modalities?.[m] ?? null) !== (a.modalities?.[m] ?? null));
    const priceEdited = [
      ...new Set([...Object.keys(b.pricing ?? {}), ...Object.keys(a.pricing ?? {})]),
    ].filter((m) => JSON.stringify(b.pricing?.[m] ?? null) !== JSON.stringify(a.pricing?.[m] ?? null));
    const change: CatalogChange = {
      provider,
      added: [...afterSet].filter((m) => !beforeSet.has(m)),
      removed: [...beforeSet].filter((m) => !afterSet.has(m)),
      modalityEdited,
      priceEdited,
      enabledChanged: (b.enabled ?? true) !== (a.enabled ?? true),
    };
    if (
      change.added.length ||
      change.removed.length ||
      change.modalityEdited.length ||
      change.priceEdited.length ||
      change.enabledChanged
    ) {
      out.push(change);
    }
  }
  return out;
}

/** Write-time advisory: a model with no price card is metered as 0, so the
 *  cost report silently understates. Reuses the same gap detector the cost
 *  report uses, so the two can never disagree about what "unpriced" means. */
export function catalogPriceGaps(
  catalog: PlatformCatalog,
  codeDefaults: Record<string, ProviderConfig>,
): PriceCardGap[] {
  const providers: Record<string, ProviderConfig> = {};
  for (const [name, def] of Object.entries(codeDefaults)) {
    if (def.source !== "builtin") continue;
    providers[name] = mergeBuiltinCatalog(def, catalog[name]);
  }
  return unpricedModels(providers);
}

/** Modality of a catalog entry after merging, for UI hints. */
export function catalogModality(
  patch: CatalogPatch | undefined,
  model: string,
  fallback: Modality = "text",
): Modality {
  return patch?.modalities?.[model] ?? fallback;
}
