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
