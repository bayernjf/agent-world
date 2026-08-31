import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compile, instantiateTemplate, replay, TEMPLATES, type Graph } from "@agent-world/core";
import { ArtifactStore } from "../artifact-store.js";
import { execute, resume } from "../engine.js";
import { guardedFetch, hostIsInternal } from "../ssrf.js";
import { fakeWorker } from "../worker.js";

/**
 * Core-path regression baseline ("安全网").
 *
 * This file deliberately mirrors the product's highest-risk invariants as a
 * single, fast, repeatable suite — the things that must never regress:
 *   - compile → execute → done with typed artifacts flowing downstream
 *   - rework loop (gate rejects once, textGen reruns, passes)
 *   - resume from an interrupted run without duplicating upstream artifacts
 *   - binary artifacts persist with a real local uri + sizeBytes
 *   - auth register/login + protected-route guard
 *   - SSRF fail-closed on internal hosts
 *
 * Run with: pnpm --filter @agent-world/server test:regression
 * It is intentionally dependency-free (no shared test helpers) so it stays a
 * stable safety net even when other suites are refactored.
 */

// ─── engine helpers ──────────────────────────────────────────────────────────

function linearGraph(): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0 },
      {
        id: "forge",
        kind: "textGen",
        name: "FORGE",
        x: 1,
        y: 0,
        textGen: {
          model: "test",
          prompt: "",
          skills: [],
          temperature: 0.7,
          timeoutMs: 60_000,
          retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
        },
      },
      { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "forge", kind: "flow" },
      { id: "e2", from: "forge", to: "depot", kind: "flow" },
    ],
  };
}

function gateGraph(): Graph {
  return {
    id: "g2",
    name: "g2",
    nodes: [
      { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0 },
      {
        id: "forge",
        kind: "textGen",
        name: "FORGE",
        x: 1,
        y: 0,
        textGen: {
          model: "test",
          prompt: "",
          skills: [],
          temperature: 0.7,
          timeoutMs: 60_000,
          retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
        },
      },
      { id: "critic", kind: "gate", name: "CRITIC", x: 2, y: 0, gate: { maxAttempts: 3, criterion: "ok", onExhausted: "halt" } },
      { id: "depot", kind: "sink", name: "DEPOT", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "forge", kind: "flow" },
      { id: "e2", from: "forge", to: "critic", kind: "flow" },
      { id: "e3", from: "critic", to: "depot", kind: "flow" },
      { id: "r1", from: "critic", to: "forge", kind: "rework" },
    ],
  };
}

function okWorker(input: (input: string) => string) {
  return {
    runTextGen: async function* () {
      yield { type: "text-delta", text: "x" };
      return { output: "dummy", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0, units: {} } };
    },
    // overridden per-test when needed
    judge: undefined as any,
    __echoInput: input,
  } as any;
}

function echoWorker(): any {
  const w = okWorker((i) => i);
  w.runTextGen = async function* (args: any) {
    yield { type: "text-delta", text: "x" };
    return { output: `echo:${args.input}`, usage: { tokensIn: 1, tokensOut: 1, costUsd: 0, units: {} } };
  };
  return w;
}

async function drain(gen: AsyncGenerator<unknown, void, unknown>): Promise<any[]> {
  const out: any[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

// ─── engine core path ────────────────────────────────────────────────────────

describe("regression · engine core path", () => {
  it("compile → execute a linear pipeline to done, flowing typed artifacts downstream", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const worker = echoWorker();

    const events = await drain(
      execute({ runId: "r1", graph, plan: plan!, worker, budgetUsd: null, input: "raw", now: () => 0, sleep: async () => {} }),
    );

    expect(replay(events).status).toBe("done");
    const finished = events.filter((e) => e.type === "node.finished");
    expect(finished.map((e) => e.nodeId).sort()).toEqual(["depot", "forge", "intake"]);
    // The text node echoes upstream: the artifact content is the source input.
    const forgeText = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === "forge" && e.artifact.kind === "text",
    );
    expect(forgeText.artifact.content).toContain("raw");
  });

  it("rework loop: gate rejects once, forge reruns, pipeline still reaches done", async () => {
    const graph = gateGraph();
    const { plan } = compile(graph)!;
    const worker = echoWorker();
    let verdicts = 0;
    worker.judge = async () => {
      verdicts++;
      return { passed: verdicts >= 2, reason: verdicts >= 2 ? "ok" : "needs rework" };
    };

    const events = await drain(
      execute({ runId: "r2", graph, plan: plan!, worker, budgetUsd: null, input: "raw", now: () => 0, sleep: async () => {} }),
    );

    expect(replay(events).status).toBe("done");
    expect(verdicts).toBeGreaterThanOrEqual(2);
    const forgeRuns = events.filter((e) => e.type === "node.started" && e.nodeId === "forge");
    expect(forgeRuns.length).toBeGreaterThanOrEqual(2);
  });

  it("blank/empty graph fails closed with a clear error instead of a TypeError", async () => {
    // A brand-new "空白产线" canvas has no nodes/edges, so compile() yields a
    // null plan. execute() must reject with an actionable message, not blow up
    // dereferencing plan.loops/order/levels.
    const g: Graph = { id: "g", name: "g", nodes: [], edges: [] };
    const { plan } = compile(g);
    expect(plan).toBeNull();
    const worker: any = {
      runTextGen: async function* () {
        throw new Error("unreachable");
      },
      judge: async () => ({ passed: true, reason: "ok" }),
    };
    await expect(async () => {
      for await (const _e of execute({ runId: "r-blank", graph: g, plan: plan as any, worker, budgetUsd: null, input: "x", now: () => 0, sleep: async () => {} })) {
        /* drain */
      }
    }).rejects.toThrow(/graph does not compile/);
  });

  it("resume from an interrupted run reruns the failed node without duplicating upstream artifacts", async () => {
    // Regression guard for the reconstructState fix: node.finished may arrive
    // before artifact.produced (source nodes), so resume must not synthesize a
    // second text artifact and feed downstream the same upstream content twice.
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const failWorker: any = {
      runTextGen: async function* () {
        throw new Error("nope");
      },
      judge: async () => ({ passed: false, reason: "x" }),
    };

    const past = await drain(
      execute({ runId: "r3", graph, plan: plan!, worker: failWorker, budgetUsd: null, input: "raw", now: () => 0, sleep: async () => {} }),
    );
    expect(replay(past).status).toBe("failed");

    const okW = echoWorker();
    const cont = await drain(
      resume({ runId: "r3", graph, plan: plan!, worker: okW, budgetUsd: null, pastEvents: past, action: "continue", resetFrom: "forge", now: () => 0, sleep: async () => {} }),
    );
    expect(replay(cont).status).toBe("done");
    const forgeOut = cont.find((e) => e.type === "node.finished" && e.nodeId === "forge");
    // Upstream "raw" must appear exactly once, not "raw\n\nraw".
    expect(forgeOut.output).toBe("echo:raw");
  });

  it("error edge hands off to a catch node even when a human node will suspend the run", async () => {
    // review-publish: notify (no webhook configured) fails, its error edge must
    // still start notifyFallback instead of being starved by the suspended human.
    const t = TEMPLATES.find((x: { id: string }) => x.id === "tpl-review-publish")!;
    const graph = instantiateTemplate(t);
    const { plan } = compile(graph)!;
    const worker = fakeWorker({ failFirstAttempts: 0, chunkDelayMs: 0 });

    const events = await drain(
      execute({ runId: "r-rp", graph, plan: plan!, worker, budgetUsd: null, input: "测试内容", now: () => 0, sleep: async () => {} }),
    );

    const notifyId = graph.nodes.find((n) => n.name === "送审通知")?.id;
    const fallbackId = graph.nodes.find((n) => n.name === "通知兜底")?.id;
    expect(notifyId).toBeTruthy();
    expect(fallbackId).toBeTruthy();
    // notify must fail (missing webhook)
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === notifyId)).toBe(true);
    // the error-edge catch node must actually run, not stay starved
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === fallbackId)).toBe(true);
    // and the human node paused the run for operator review
    expect(events.some((e) => e.type === "human.review")).toBe(true);
  });

  it("template code nodes read engine inputs via stdin (batch-content split)", async () => {
    // Guards the code-node I/O contract: engine writes { inputs } to stdin and
    // template scripts read it back — a bare `inputs` reference must not regress.
    const t = TEMPLATES.find((x: { id: string }) => x.id === "tpl-batch-content")!;
    const graph = instantiateTemplate(t);
    const { plan } = compile(graph)!;
    const worker = fakeWorker({ failFirstAttempts: 0, chunkDelayMs: 0 });

    const events = await drain(
      execute({ runId: "r-bc", graph, plan: plan!, worker, budgetUsd: null, input: "甲\n乙\n丙", now: () => 0, sleep: async () => {} }),
    );

    const splitId = graph.nodes.find((n) => n.name === "拆条")?.id;
    expect(splitId).toBeTruthy();
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === splitId)).toBe(true);
    // split emits a json artifact with the two items — prove stdin inputs flowed in
    const splitArtifact = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === splitId && e.artifact.kind === "json",
    )?.artifact;
    expect(splitArtifact).toBeTruthy();
    expect(splitArtifact.content).toContain("甲");
    expect(splitArtifact.content).toContain("丙");
  });
});

// ─── artifact persistence ────────────────────────────────────────────────────

describe("regression · artifact persistence", () => {
  let dir: string;
  let store: ArtifactStore;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-reg-art-"));
    store = new ArtifactStore(dir);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves inline binary content to a local path with sizeBytes", async () => {
    const saved = await store.save(
      { id: "v0", kind: "video", content: Buffer.from("fake-mp4-bytes"), mimeType: "video/mp4" } as any,
      { runId: "r", nodeId: "video" },
    );
    expect(saved.storage).toBe("local");
    expect(saved.uri).toContain("/api/artifacts/");
    expect(saved.sizeBytes).toBe(14);
  });

  it("keeps a local /api/artifacts/ reference as local storage (not an inline stub)", async () => {
    const saved = await store.save(
      { id: "img-0", kind: "image", uri: "/api/artifacts/up-abc123", mimeType: "image/png" } as any,
      { runId: "r", nodeId: "img" },
    );
    expect(saved.storage).toBe("local");
    expect(saved.uri).toBe("/api/artifacts/up-abc123");
  });
});

// ─── auth ────────────────────────────────────────────────────────────────────

describe("regression · auth", () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof import("../index.js")>>["app"];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "aw-reg-auth-"));
    process.env.DB_FILE = join(dir, "auth.sqlite");
    process.env.ALLOW_REGISTRATION = "1";
    const mod = await import("../index.js");
    app = mod.app;
  });
  afterAll(() => {
    delete process.env.DB_FILE;
    delete process.env.ALLOW_REGISTRATION;
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("register → login → protected route", async () => {
    const reg = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "core@reg.test", password: "secret123" }),
    });
    expect(reg.status).toBe(201);

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "core@reg.test", password: "secret123" }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toContain("auth_token=");

    // Protected route (/api/graphs): no auth → 401, with cookie → 200.
    const anon = await app.request("/api/graphs");
    expect(anon.status).toBe(401);
    const authed = await app.request("/api/graphs", { headers: { cookie } });
    expect(authed.status).toBe(200);
  });
});

// ─── SSRF fail-closed ────────────────────────────────────────────────────────

describe("regression · SSRF guard", () => {
  it("classifies internal hosts as internal", async () => {
    expect(await hostIsInternal("127.0.0.1")).toBe(true);
    expect(await hostIsInternal("169.254.169.254")).toBe(true);
    expect(await hostIsInternal("::ffff:7f00:1")).toBe(true);
  });

  it("guardedFetch refuses internal URLs without touching the network", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(guardedFetch("http://127.0.0.1/steal")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
