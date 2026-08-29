import { compile, replay, type Graph } from "@agent-world/core";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function pngBytes(): Buffer {
  const png = new PNG({ width: 2, height: 2 });
  png.data = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  return PNG.sync.write(png);
}

interface Store {
  storeBinary: (data: Buffer, mimeType: string, label?: string) => string;
  readArtifact: (uri: string) => Promise<string | null>;
}

function artifactStore(): Store {
  const map = new Map<string, string>();
  return {
    storeBinary(data: Buffer, mimeType: string, _label?: string) {
      const id = `/api/artifacts/art-${map.size + 1}`;
      map.set(id, `data:${mimeType};base64,${data.toString("base64")}`);
      return id;
    },
    async readArtifact(uri: string) {
      return map.get(uri) ?? null;
    },
  };
}

async function collect(g: Graph, input?: string) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    input,
    now: () => 0,
    storeBinary: artifactStore().storeBinary,
    readArtifact: artifactStore().readArtifact,
  })) {
    events.push(e);
  }
  return events;
}

function searchGraph(search: Record<string, unknown>): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source" as const, name: "SRC", x: 0, y: 0 },
      { id: "se", kind: "search" as const, name: "SEARCH", x: 1, y: 0, search },
      { id: "sink", kind: "sink" as const, name: "SINK", x: 2, y: 0 },
    ],
    edges: [
      { id: "e0", from: "src", to: "se", kind: "flow" as const },
      { id: "e1", from: "se", to: "sink", kind: "flow" as const },
    ],
  };
}

/** DuckDuckGo HTML endpoint response with two results. */
function ddgHtml(): string {
  return `<html><body>
  <div class="results">
    <div class="result">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc">Result <b>One</b></a>
      <a class="result__snippet" href="#">Snippet &amp; one text</a>
    </div>
    <div class="result">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb&amp;rut=def">Result Two</a>
      <a class="result__snippet" href="#">Snippet two</a>
    </div>
  </div>
  </body></html>`;
}

function artifactsOf(events: any[], nodeId: string): any[] {
  return events.filter((e) => e.type === "artifact.produced" && e.nodeId === nodeId).map((e) => e.artifact);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("search node — web search", () => {
  it("runs a static query on duckduckgo and emits text + json artifacts", async () => {
    fetchMock.mockResolvedValue(new Response(ddgHtml(), { status: 200 }));
    const events = await collect(searchGraph({ query: "agent world" }));
    expect(replay(events).status).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://html.duckduckgo.com/html/");
    expect((init as any).method).toBe("POST");
    expect((init as any).body).toBe("q=agent+world");
    const arts = artifactsOf(events, "se");
    const text = arts.find((a: any) => a.kind === "text");
    const json = arts.find((a: any) => a.kind === "json");
    expect(text.content).toContain("1. Result One");
    expect(text.content).toContain("https://example.com/a");
    const payload = JSON.parse(json.content);
    expect(payload.results).toHaveLength(2);
    expect(payload.results[0]).toEqual({
      title: "Result One",
      url: "https://example.com/a",
      snippet: "Snippet & one text",
    });
    expect(payload.provider).toBe("duckduckgo");
  });

  it("falls back to the upstream text artifact as the query", async () => {
    fetchMock.mockResolvedValue(new Response(ddgHtml(), { status: 200 }));
    const events = await collect(searchGraph({}), "generated research question");
    expect(replay(events).status).toBe("done");
    expect((fetchMock.mock.calls[0]![1] as any).body).toBe("q=generated+research+question");
  });

  it("searches via tavily when the API key is configured", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { title: "Tavily Hit", url: "https://t.example.com/x", content: "tavily snippet" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const events = await collect(searchGraph({ query: "q", provider: "tavily", maxResults: 3 }));
    expect(replay(events).status).toBe("done");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tavily.com/search");
    expect((init as any).headers.authorization).toBe("Bearer tvly-test");
    const json = artifactsOf(events, "se").find((a: any) => a.kind === "json");
    expect(JSON.parse(json.content).results[0].title).toBe("Tavily Hit");
  });

  it("fails with AUTH when the provider key is missing", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    const events = await collect(searchGraph({ query: "q", provider: "tavily" }));
    expect(replay(events).status).toBe("failed");
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "se");
    expect(failed.errorCode).toBe("AUTH");
    expect(failed.error).toContain("TAVILY_API_KEY");
  });

  it("fails with PROVIDER_ERROR when the provider errors out", async () => {
    fetchMock.mockResolvedValue(new Response("oops", { status: 502 }));
    const events = await collect(searchGraph({ query: "q" }));
    expect(replay(events).status).toBe("failed");
    expect(
      events.some((e) => e.type === "node.failed" && e.nodeId === "se" && e.errorCode === "PROVIDER_ERROR"),
    ).toBe(true);
  });

  it("fails with VALIDATION when there is no query and no upstream text", async () => {
    // The source brief is never empty (placeholder fallback), so use an
    // http(file) download as the upstream: it produces a file artifact, no text.
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    fetchMock.mockResolvedValue(
      new Response(pngBytes(), { status: 200, headers: { "content-type": "image/png" } }),
    );
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        { id: "dl", kind: "http", name: "DL", x: 1, y: 0, http: { url: "https://files.example.com/p.png", outputMode: "file" } },
        { id: "se", kind: "search", name: "SEARCH", x: 2, y: 0, search: {} },
        { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "dl", kind: "flow" },
        { id: "e2", from: "dl", to: "se", kind: "flow" },
        { id: "e3", from: "se", to: "sink", kind: "flow" },
      ],
    };
    const events = await collect(g);
    expect(replay(events).status).toBe("failed");
    expect(
      events.some((e) => e.type === "node.failed" && e.nodeId === "se" && e.errorCode === "VALIDATION"),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the http download, no search call
  });

  it("emits an empty-result note when the search returns nothing", async () => {
    fetchMock.mockResolvedValue(new Response("<html><body>no results</body></html>", { status: 200 }));
    const events = await collect(searchGraph({ query: "nothing to find" }));
    expect(replay(events).status).toBe("done");
    const text = artifactsOf(events, "se").find((a: any) => a.kind === "text");
    expect(text.content).toContain("没有找到");
    const json = artifactsOf(events, "se").find((a: any) => a.kind === "json");
    expect(JSON.parse(json.content).results).toHaveLength(0);
  });

  it("retries transient fetch failures and succeeds on the second attempt", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(new Response(ddgHtml(), { status: 200 }));
    const events = await collect(
      searchGraph({ query: "q", retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 } }),
    );
    expect(replay(events).status).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
