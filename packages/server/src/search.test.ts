import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchConfig } from "@agent-world/core";
import { searchWeb, SearchAuthError } from "./search.js";

const cfg: SearchConfig = {
  query: "q",
  provider: "duckduckgo",
  maxResults: 5,
  retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("searchWeb error surfacing", () => {
  it("wraps bare network failures with an actionable hint", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;
    await expect(searchWeb("q", cfg)).rejects.toThrow(
      /无法直连该搜索源.*TAVILY_API_KEY.*AGENT_WORLD_PROXY/s,
    );
  });

  it("fails loudly on DDG anomaly challenge pages instead of silent zero results", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("<html><body>anomaly detection challenge</body></html>", { status: 202 }),
    ) as unknown as typeof fetch;
    await expect(searchWeb("q", cfg)).rejects.toThrow(/反爬验证页.*tavily/s);
  });

  it("keeps SearchAuthError untouched (no retry, no hint)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new SearchAuthError("缺少环境变量 TAVILY_API_KEY");
    }) as unknown as typeof fetch;
    await expect(
      searchWeb("q", { ...cfg, provider: "tavily" }),
    ).rejects.toThrow(SearchAuthError);
  });

  it("passes unrelated provider errors through unchanged", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("nope", { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(
      searchWeb("q", { ...cfg, provider: "tavily" }),
    ).rejects.toThrow(/^(?!.*无法直连该搜索源)/);
  });
});

// Credentials used to be env-only, which meant switching the search backend
// required editing the server environment and restarting it.
describe("searchWeb credential resolution", () => {
  afterEach(() => vi.unstubAllEnvs());

  /** Run a tavily search against an empty result set and report the header sent. */
  const sentAuthorization = async (over: Partial<SearchConfig>): Promise<string> => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    await searchWeb("q", { ...cfg, provider: "tavily", ...over });
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    return headers.authorization ?? "";
  };

  it("prefers the node key over the env var", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-env");
    expect(await sentAuthorization({ apiKey: "tvly-node" })).toBe("Bearer tvly-node");
  });

  it("still falls back to the env var when the node omits the key", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-env");
    expect(await sentAuthorization({})).toBe("Bearer tvly-env");
  });

  it("treats a whitespace-only node key as absent", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-env");
    expect(await sentAuthorization({ apiKey: "   " })).toBe("Bearer tvly-env");
  });

  it("names both places when neither side has a credential", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    await expect(
      searchWeb("q", { ...cfg, provider: "tavily", retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 } }),
    ).rejects.toThrow(/节点的 apiKey 未填写.*TAVILY_API_KEY/s);
  });
});
