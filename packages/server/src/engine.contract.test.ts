import { compile, replay, type ContractSpec, type Graph } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

/**
 * G2.2 — the pure validator (G2.1) and Inspector contract form (G2.3) only
 * become real once the engine enforces a node's `contract` after it produces
 * output and before downstream is scheduled. These tests drive the full
 * scheduler with a source node whose raw intake is JSON, asserting the guard
 * fails the node deterministically (SCHEMA_VIOLATION), drops the dirty output,
 * routes to error-edge catches, and stays fully backward compatible when no
 * contract is declared (the Hasee M1 pipelines declare none).
 */

function graphWith(contract: ContractSpec | undefined, withCatch = false): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0, ...(contract ? { contract } : {}) },
      { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
      ...(withCatch ? [{ id: "rescue", kind: "sink" as const, name: "RESCUE", x: 2, y: 1 }] : []),
    ],
    edges: [
      { id: "e1", from: "src", to: "depot", kind: "flow" },
      ...(withCatch ? [{ id: "e2", from: "src", to: "rescue" as const, kind: "error" as const }] : []),
    ],
  };
}

async function collect(g: Graph, input: string) {
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

const GOOD = JSON.stringify({ name: "alice", age: 30, tags: ["a"], meta: { ok: true } });

describe("G2.2 engine output-contract guard", () => {
  it("runs unchanged when the node declares no contract (backward compatible)", async () => {
    const events = await collect(graphWith(undefined), GOOD);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "src")).toBe(true);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "depot")).toBe(true);
    expect(replay(events).status).toBe("done");
  });

  it("passes when an empty contract declares nothing to assert", async () => {
    const events = await collect(graphWith({ requiredFields: [] }), "plain text, not even JSON");
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "src")).toBe(false);
    expect(replay(events).status).toBe("done");
  });

  it("passes when every required field is present and non-empty", async () => {
    const events = await collect(graphWith({ requiredFields: ["name", "age"] }), GOOD);
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "src")).toBe(false);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "depot")).toBe(true);
    expect(replay(events).status).toBe("done");
  });

  it("fails the node with SCHEMA_VIOLATION when a required field is missing and skips flow downstream", async () => {
    const events = await collect(graphWith({ requiredFields: ["name", "missing"] }), GOOD);
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "src");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("SCHEMA_VIOLATION");
    expect(failed.error).toContain("missing");
    // The dirty output must not flow: the flow tail is skipped and the run fails.
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "depot")).toBe(false);
    expect(events.some((e) => e.type === "node.skipped" && e.nodeId === "depot")).toBe(true);
    expect(replay(events).status).toBe("failed");
  });

  it("reports SCHEMA_VIOLATION when output is not a JSON object but fields are required", async () => {
    const events = await collect(graphWith({ requiredFields: ["name"] }), "just some plain text");
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "src");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("SCHEMA_VIOLATION");
    expect(failed.error).toContain("not a JSON object");
    expect(replay(events).status).toBe("failed");
  });

  it("fails on a runtime type mismatch", async () => {
    // `age` is a number in the payload; asserting it as a string must fail.
    const events = await collect(graphWith({ requiredFields: [], types: { age: "string" } }), GOOD);
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "src");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("SCHEMA_VIOLATION");
    expect(failed.error).toContain("type mismatch");
    expect(replay(events).status).toBe("failed");
  });

  it("treats an empty string/array required value as missing", async () => {
    const events = await collect(
      graphWith({ requiredFields: ["name", "tags"] }),
      JSON.stringify({ name: "", tags: [] }),
    );
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "src");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("SCHEMA_VIOLATION");
    expect(failed.error).toContain("name");
    expect(failed.error).toContain("tags");
  });

  it("hands the violation cause to an error-edge catch node and lets the run succeed", async () => {
    const events = await collect(graphWith({ requiredFields: ["missing"] }, true), GOOD);
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "src");
    expect(failed?.errorCode).toBe("SCHEMA_VIOLATION");
    // The catch sink receives an error packet and runs; the stranded flow tail skips.
    expect(events.some((e) => e.type === "packet.sent" && e.edgeId === "e2")).toBe(true);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "rescue")).toBe(true);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "depot")).toBe(false);
    // Error was handled by the catch branch → run is done, not failed.
    expect(replay(events).status).toBe("done");
  });

  it("is deterministic: a contract violation is not retried", async () => {
    const events = await collect(graphWith({ requiredFields: ["missing"] }), GOOD);
    const starts = events.filter((e) => e.type === "node.started" && e.nodeId === "src");
    // Only one attempt — SCHEMA_VIOLATION is not in the retryable set.
    expect(starts).toHaveLength(1);
  });
});
