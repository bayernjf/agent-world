import { compile, replay, type Graph, type VcsConfig } from "@agent-world/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function artifactStore() {
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
  const store = artifactStore();
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    input,
    now: () => 0,
    storeBinary: store.storeBinary,
    readArtifact: store.readArtifact,
  })) {
    events.push(e);
  }
  return events;
}

function vcsGraph(vcs: VcsConfig): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "v", kind: "vcs", name: "VCS", x: 1, y: 0, vcs },
      { id: "sink", kind: "sink", name: "SINK", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "v", kind: "flow" },
      { id: "e2", from: "v", to: "sink", kind: "flow" },
    ],
  };
}

function jsonOf(events: any[], nodeId: string): any | undefined {
  return events.find((e) => e.type === "artifact.produced" && e.nodeId === nodeId)?.artifact;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Skip the real DNS resolve-and-pin path of guardedFetch so the mocked
  // fetch receives every request verbatim (same contract as notify tests).
  vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("vcs node — github & gitlab", () => {
  it("creates a github PR with body falling back to upstream text", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ number: 42, html_url: "https://github.com/o/r/pull/42" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const events = await collect(
      vcsGraph({ provider: "github", action: "create_pr", owner: "o", repo: "r", head: "feature/x", base: "main" }),
      "PR description from agent",
    );
    expect(replay(events).status).toBe("done");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/o/r/pulls");
    expect((init as any).method).toBe("POST");
    expect((init as any).headers.authorization).toBe("Bearer ghp_test");
    const body = JSON.parse((init as any).body);
    expect(body).toEqual({ title: "VCS", head: "feature/x", base: "main", body: "PR description from agent" });
    const art = jsonOf(events, "v");
    expect(art.kind).toBe("json");
    expect(JSON.parse(art.content)).toEqual({ number: 42, html_url: "https://github.com/o/r/pull/42" });
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "v");
    expect(finished.output).toContain("PR #42");
  });

  it("lists gitlab issues", async () => {
    vi.stubEnv("GITLAB_TOKEN", "glpat-test");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ iid: 1, title: "bug" }, { iid: 2, title: "feat" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const events = await collect(vcsGraph({ provider: "gitlab", action: "list_issues", projectId: "group/proj" }));
    expect(replay(events).status).toBe("done");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gitlab.com/api/v4/projects/group%2Fproj/issues?state=opened&per_page=30");
    expect((init as any).headers["private-token"]).toBe("glpat-test");
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "v");
    expect(finished.output).toContain("2 issues");
  });

  it("triggers a github workflow (204 no content)", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const events = await collect(
      vcsGraph({ provider: "github", action: "trigger_workflow", owner: "o", repo: "r", workflowId: "deploy.yml", ref: "main", inputs: { env: "prod" } }),
    );
    expect(replay(events).status).toBe("done");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/o/r/actions/workflows/deploy.yml/dispatches");
    expect(JSON.parse((init as any).body)).toEqual({ ref: "main", inputs: { env: "prod" } });
  });

  it("percent-encodes user-supplied GitHub path segments (audit L5)", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }),
    );
    await collect(vcsGraph({ provider: "github", action: "list_issues", owner: "evil/repos", repo: "r?x=1" }));
    const [url] = fetchMock.mock.calls[0]!;
    // "/" and "?" are encoded, so the values cannot inject extra path/query parts.
    expect(url).toBe("https://api.github.com/repos/evil%2Frepos/r%3Fx%3D1/issues?state=open&per_page=30");
    expect(url as string).not.toContain("/repos/evil/repos");
  });

  it("fails with AUTH when the token env is missing", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const events = await collect(vcsGraph({ provider: "github", action: "list_issues", owner: "o", repo: "r" }));
    expect(replay(events).status).toBe("failed");
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "v" && e.errorCode === "AUTH")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails with PROVIDER_ERROR on a 422 (e.g. PR already exists)", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "Validation Failed: pull request already exists" }), { status: 422 }));
    const events = await collect(vcsGraph({ provider: "github", action: "create_pr", owner: "o", repo: "r", head: "f", base: "main" }));
    expect(replay(events).status).toBe("failed");
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "v");
    expect(failed.errorCode).toBe("PROVIDER_ERROR");
    expect(failed.error).toContain("Validation Failed");
  });

  it("retries transient failures and succeeds on the second attempt", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ number: 1, title: "x" }]), { status: 200 }));
    const events = await collect(
      vcsGraph({ provider: "github", action: "list_issues", owner: "o", repo: "r", retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 } }),
    );
    expect(replay(events).status).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("routes provider calls through the outbound proxy when AGENT_WORLD_PROXY is set (dogfood tpl-release-pr)", async () => {
    // The bare global fetch used to bypass AGENT_WORLD_PROXY, so on
    // proxy-only networks every GitHub/GitLab call died with ECONNREFUSED.
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "");
    vi.stubEnv("AGENT_WORLD_PROXY", "http://127.0.0.1:7897");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const events = await collect(vcsGraph({ provider: "github", action: "list_issues", owner: "o", repo: "r" }));
    expect(replay(events).status).toBe("done");
    const [, init] = fetchMock.mock.calls[0]!;
    // A dispatcher (the ProxyAgent) must ride along, i.e. the request leaves
    // through the configured proxy instead of a direct connection.
    expect((init as any).dispatcher).toBeDefined();
    expect((init as any).dispatcher.constructor.name).toBe("ProxyAgent");
  });
});
