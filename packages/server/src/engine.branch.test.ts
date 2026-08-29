import { compile, replay, type BranchConfig, type Graph } from "@agent-world/core";
import { describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function graph(branch: BranchConfig): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "br", kind: "branch", name: "BR", x: 1, y: 0, branch },
      { id: "yes", kind: "sink", name: "YES", x: 2, y: 0 },
      { id: "no", kind: "sink", name: "NO", x: 2, y: 1 },
    ],
    edges: [
      { id: "e1", from: "src", to: "br", kind: "flow" },
      { id: "e2", from: "br", to: "yes", kind: "flow" },
      { id: "e3", from: "br", to: "no", kind: "flow" },
    ],
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
    now: () => 0,
    input,
  })) {
    events.push(e);
  }
  return events;
}

describe("branch node", () => {
  it("routes to the matching rule target and skips the other branch", async () => {
    const branch: BranchConfig = {
      rules: [{ id: "big", when: "${src} > 100", target: "yes" }],
      defaultTarget: "no",
    };
    const events = await collect(graph(branch), "500");

    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "yes")).toBe(true);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "no")).toBe(false);
    const routed = events.find((e) => e.type === "packet.sent" && e.edgeId === "e2");
    expect(routed).toBeTruthy();
    expect(replay(events).status).toBe("done");
  });

  it("falls through to the default target when no rule matches", async () => {
    const branch: BranchConfig = {
      rules: [{ id: "big", when: "${src} > 100", target: "yes" }],
      defaultTarget: "no",
    };
    const events = await collect(graph(branch), "10");

    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "yes")).toBe(false);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "no")).toBe(true);
    expect(replay(events).status).toBe("done");
  });

  it("drops the packet when nothing matches and no default is set", async () => {
    const branch: BranchConfig = {
      rules: [{ id: "big", when: "${src} > 100", target: "yes" }],
    };
    const events = await collect(graph(branch), "10");

    expect(events.some((e) => e.type === "node.finished" && (e.nodeId === "yes" || e.nodeId === "no"))).toBe(false);
    expect(replay(events).status).toBe("done");
  });

  it("evaluates rules in order and stops at the first match", async () => {
    const branch: BranchConfig = {
      rules: [
        { id: "first", when: "${src} == 1", target: "yes" },
        { id: "second", when: "true", target: "no" },
      ],
    };
    const events = await collect(graph(branch), "1");

    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "yes")).toBe(true);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "no")).toBe(false);
  });

  it("routes by a nested field of a json artifact (merge point keeps executing)", async () => {
    // src emits text; api returns json {score}; branch routes on ${api.score}.
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        { id: "api", kind: "http", name: "API", x: 1, y: 0, http: { method: "GET", url: "https://x.example" } },
        { id: "br", kind: "branch", name: "BR", x: 2, y: 0, branch: { rules: [{ id: "hi", when: "${api.score} >= 5", target: "yes" }], defaultTarget: "no" } },
        { id: "yes", kind: "sink", name: "YES", x: 3, y: 0 },
        { id: "no", kind: "sink", name: "NO", x: 3, y: 1 },
      ],
      edges: [
        { id: "e1", from: "src", to: "api", kind: "flow" },
        { id: "e2", from: "api", to: "br", kind: "flow" },
        { id: "e3", from: "br", to: "yes", kind: "flow" },
        { id: "e4", from: "br", to: "no", kind: "flow" },
      ],
    };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ score: 9 }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    // x.example is unresolvable in CI → the SSRF guard would fail the node
    // closed; this test is about branch routing, so bypass the check.
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    try {
      const events = await collect(g, "x");
      expect(events.some((e) => e.type === "node.finished" && e.nodeId === "yes")).toBe(true);
      expect(events.some((e) => e.type === "node.finished" && e.nodeId === "no")).toBe(false);
      expect(replay(events).status).toBe("done");
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
