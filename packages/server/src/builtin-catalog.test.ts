import { beforeEach, describe, expect, it } from "vitest";
import {
  CatalogPatchSchema,
  PLATFORM_SETTINGS_KEY,
  PlatformCatalogSchema,
  bindCatalogStore,
  catalogPriceGaps,
  describeCatalogChange,
  loadPlatformCatalog,
  mergeBuiltinCatalog,
  platformCatalog,
  refreshPlatformCatalog,
  writePlatformCatalog,
  type CatalogStore,
  type PlatformCatalog,
} from "./builtin-catalog.js";
import type { ProviderConfig } from "./config.js";

const CODE_PROVIDER: ProviderConfig = {
  type: "openai-compatible",
  source: "builtin",
  enabled: true,
  baseUrl: "https://gw.example/v1",
  apiKey: "sk-secret",
  models: ["m-old", "m-keep"],
  modalities: { "m-old": "text", "m-keep": "text" },
  pricing: { "m-old": { input: 0.15, output: 0.6 } },
  endpoints: { video: "/videos" },
  videoAdapter: { createBody: { mode: "ti2vid" }, resultUrlPath: "url" },
};

function memStore(initial: Record<string, string> = {}): CatalogStore & { rows: Record<string, string> } {
  const rows = { ...initial };
  return {
    rows,
    async get(key) {
      return rows[key] ?? null;
    },
    async set(key, value) {
      rows[key] = value;
    },
  };
}

describe("CatalogPatchSchema — the allow-list is the type, not the UI", () => {
  it("accepts the four editable fields", () => {
    expect(() =>
      CatalogPatchSchema.parse({
        models: ["a", "b"],
        modalities: { a: "text", b: "image" },
        pricing: { a: { input: 1, output: 2 } },
        enabled: false,
      }),
    ).not.toThrow();
  });

  // The invariant of the whole design: an operator (or a bug, or a crafted
  // request) must not be able to redirect the hosted tier at another host,
  // swap its key, or rewrite the per-provider interface dialect.
  it.each([
    ["baseUrl", { baseUrl: "https://attacker.example/v1" }],
    ["apiKey", { apiKey: "sk-stolen" }],
    ["type", { type: "anthropic" }],
    ["endpoints", { endpoints: { video: "/evil" } }],
    ["videoAdapter", { videoAdapter: { createBody: { mode: "x" } } }],
    ["source", { source: "custom" }],
  ])("rejects an override of %s", (_field, patch) => {
    expect(CatalogPatchSchema.safeParse(patch).success).toBe(false);
  });

  it("rejects a negative price and a non-modality label", () => {
    expect(CatalogPatchSchema.safeParse({ pricing: { a: { input: -1 } } }).success).toBe(false);
    expect(CatalogPatchSchema.safeParse({ modalities: { a: "vibes" } }).success).toBe(false);
  });

  it("rejects an unknown field inside a provider patch", () => {
    expect(
      PlatformCatalogSchema.safeParse({ agnes: { models: ["x"], extra: 1 } }).success,
    ).toBe(false);
  });
});

describe("mergeBuiltinCatalog", () => {
  it("returns the code default untouched when there is no patch", () => {
    expect(mergeBuiltinCatalog(CODE_PROVIDER, undefined)).toBe(CODE_PROVIDER);
  });

  it("overlays the allowed fields and keeps the rest", () => {
    const merged = mergeBuiltinCatalog(CODE_PROVIDER, {
      models: ["m-new"],
      modalities: { "m-new": "image" },
      pricing: { "m-new": { perImage: 0.04 } },
    });
    expect(merged.models).toEqual(["m-new"]);
    expect(merged.modalities).toEqual({ "m-new": "image" });
    expect(merged.pricing).toEqual({ "m-new": { perImage: 0.04 } });
    // untouched, because the patch cannot express them
    expect(merged.baseUrl).toBe("https://gw.example/v1");
    expect(merged.apiKey).toBe("sk-secret");
    expect(merged.endpoints).toEqual({ video: "/videos" });
    expect(merged.videoAdapter).toEqual(CODE_PROVIDER.videoAdapter);
    expect(merged.source).toBe("builtin");
  });

  // Merge-not-replace would make retirement impossible: the code default would
  // keep supplying the entry, so rule A could never be triggered from data.
  it("replaces rather than merges, so emptying the list is expressible", () => {
    const merged = mergeBuiltinCatalog(CODE_PROVIDER, { models: [] });
    expect(merged.models).toEqual([]);
  });

  it("does not mutate the code default object", () => {
    const before = JSON.stringify(CODE_PROVIDER);
    mergeBuiltinCatalog(CODE_PROVIDER, { models: ["x"], enabled: false });
    expect(JSON.stringify(CODE_PROVIDER)).toBe(before);
  });
});

describe("platform row round-trip", () => {
  // Reset the module cache deterministically: a corrupt row keeps the last good
  // catalog by design, so tests must not inherit each other's baseline.
  beforeEach(async () => {
    bindCatalogStore(memStore());
    await refreshPlatformCatalog();
  });

  it("writes, reloads and exposes the same catalog", async () => {
    await writePlatformCatalog({ agnes: { models: ["m-a"], enabled: true } });
    bindCatalogStore(memStore({ [PLATFORM_SETTINGS_KEY]: JSON.stringify({ agnes: { models: ["m-a"], enabled: true } }) }));
    const { catalog, error } = await loadPlatformCatalog();
    expect(error).toBeUndefined();
    expect(catalog.agnes?.models).toEqual(["m-a"]);
  });

  it("an absent row means no overlay at all", async () => {
    bindCatalogStore(memStore());
    const { catalog } = await loadPlatformCatalog();
    expect(catalog).toEqual({});
  });

  // A corrupt row must not fall back to "empty": that would silently un-retire
  // every model and reset every price while looking healthy.
  it("keeps the last good catalog on a corrupt row and reports it", async () => {
    bindCatalogStore(memStore({ [PLATFORM_SETTINGS_KEY]: "not json" }));
    const first = await refreshPlatformCatalog();
    expect(first.error).toContain("invalid");
    await writePlatformCatalog({ agnes: { models: ["m-good"] } });
    expect(platformCatalog().agnes?.models).toEqual(["m-good"]);

    bindCatalogStore(memStore({ [PLATFORM_SETTINGS_KEY]: '{"agnes":{"models":[' }));
    const second = await refreshPlatformCatalog();
    expect(second.error).toContain("invalid");
    expect(platformCatalog().agnes?.models).toEqual(["m-good"]);
  });

  it("a row that tries to smuggle a baseUrl is refused, and the cache is unchanged", async () => {
    bindCatalogStore(
      memStore({ [PLATFORM_SETTINGS_KEY]: JSON.stringify({ agnes: { baseUrl: "https://evil" } }) }),
    );
    const res = await refreshPlatformCatalog();
    expect(res.error).toContain("invalid");
    expect(platformCatalog()).toEqual({});
  });
});

describe("describeCatalogChange (audit detail: names, not values)", () => {
  it("reports added / removed / price-edited model names only", () => {
    const changes = describeCatalogChange(
      { agnes: { models: ["a", "b"], pricing: { a: { input: 1, output: 2 } } } },
      { agnes: { models: ["a", "c"], pricing: { a: { input: 9, output: 2 } } } },
      { agnes: CODE_PROVIDER },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      provider: "agnes",
      added: ["c"],
      removed: ["b"],
      priceEdited: ["a"],
      enabledChanged: false,
    });
    // the detail must not carry the numbers themselves
    expect(JSON.stringify(changes)).not.toContain('"9"');
    expect(JSON.stringify(changes).match(/9/g)).toBeNull();
  });

  it("emits nothing for a no-op write", () => {
    const same: PlatformCatalog = { agnes: { models: ["m-old", "m-keep"] } };
    expect(describeCatalogChange(same, { ...same }, { agnes: CODE_PROVIDER })).toEqual([]);
  });
});

// The point of ④, end to end inside the config layer: an operator retires a
// built-in model **by writing data**, and dispatch refuses pipelines that still
// name it. Without this, "the catalog is data" is a claim about storage rather
// than a capability.
describe("catalog → loadConfig → dispatchability", () => {
  const graphWith = (model: string) =>
    ({
      id: "g",
      name: "g",
      nodes: [
        { id: "a", kind: "textGen", name: "A", x: 0, y: 0, textGen: { model, prompt: "" } },
      ],
      edges: [],
    }) as never;

  it("retiring a built-in model from the platform row makes dispatch refuse it", async () => {
    const { loadConfig } = await import("./config.js");
    const { validateModels } = await import("./validate-models.js");
    const errorsOf = async () =>
      (await validateModels(graphWith("agnes-2.0-flash"), await loadConfig(undefined))).filter(
        (d) => d.severity === "error",
      );

    bindCatalogStore(memStore());
    await refreshPlatformCatalog();
    expect(await errorsOf()).toEqual([]); // shipped in the code catalog

    await writePlatformCatalog({
      agnes: {
        models: ["agnes-2.5-flash"],
        modalities: { "agnes-2.5-flash": "text" },
        pricing: { "agnes-2.5-flash": { input: 0.4, output: 1.6 } },
      },
    });
    const errs = await errorsOf();
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain("已不可用");
    expect(errs[0]!.nodeId).toBe("a");

    // and removing the overlay reverts to the code catalog, no restart needed
    bindCatalogStore(memStore());
    await refreshPlatformCatalog();
    expect(await errorsOf()).toEqual([]);
  });
});
describe("catalogPriceGaps", () => {
  it("flags a newly added model that has no price card", () => {
    const gaps = catalogPriceGaps({ agnes: { models: ["m-new"], modalities: { "m-new": "text" } } }, { agnes: CODE_PROVIDER });
    expect(gaps.some((g) => g.model === "m-new" && g.level === "none")).toBe(true);
  });

  it("does not flag models priced through the overlay", () => {
    const gaps = catalogPriceGaps(
      { agnes: { models: ["m-new"], modalities: { "m-new": "text" }, pricing: { "m-new": { input: 1, output: 1 } } } },
      { agnes: CODE_PROVIDER },
    );
    expect(gaps.some((g) => g.model === "m-new")).toBe(false);
  });
});
