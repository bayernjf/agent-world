import { describe, expect, it, vi } from "vitest";
import type { GraphNode } from "@agent-world/core";
import { sinkNode } from "./sink.js";
import type { NodeRunContext } from "./types.js";

/**
 * Regression for the MVP readiness review (§3①): with an empty upstream output
 * the sink must fail loudly (node.failed + VALIDATION) instead of silently
 * recording a done node and producing an empty "finished" artifact.
 */

function makeCtx(input: string) {
  const states = new Map<string, string>();
  const artifacts = new Map<string, unknown[]>();
  const events: unknown[] = [];
  const produceArtifacts = vi.fn();
  const sendPackets = vi.fn();
  const ctx = {
    artifacts,
    emit: (e: unknown) => events.push(e),
    inputFor: async () => input,
    produceArtifacts,
    sendPackets,
    states,
  } as unknown as NodeRunContext;
  return { ctx, states, artifacts, events, produceArtifacts, sendPackets };
}

const sinkNodeDef = (id: string): GraphNode =>
  ({ id, kind: "sink", name: "成品库", x: 0, y: 0 }) as GraphNode;

describe("sinkNode (MVP §3① empty-input guard)", () => {
  it("fails with VALIDATION when upstream text is empty", async () => {
    const { ctx, states, artifacts, events, produceArtifacts, sendPackets } = makeCtx("");
    await sinkNode(ctx, sinkNodeDef("depot"), "depot", 1);

    expect(states.get("depot")).toBe("failed");
    const failed = events.find((e) => (e as { type?: string }).type === "node.failed") as {
      errorCode?: string;
      error?: string;
    };
    expect(failed?.errorCode).toBe("VALIDATION");
    expect(failed?.error).toContain("没有收到可整理的文本");
    expect(artifacts.has("depot")).toBe(false);
    expect(produceArtifacts).not.toHaveBeenCalled();
    expect(sendPackets).not.toHaveBeenCalled();
  });

  it("fails the same way for whitespace-only upstream text", async () => {
    const { ctx, states, events } = makeCtx("  \n\t ");
    await sinkNode(ctx, sinkNodeDef("depot"), "depot", 1);

    expect(states.get("depot")).toBe("failed");
    const failed = events.find((e) => (e as { type?: string }).type === "node.failed") as {
      errorCode?: string;
    };
    expect(failed?.errorCode).toBe("VALIDATION");
  });

  it("still records done and produces the artifact on real text", async () => {
    const { ctx, states, artifacts, events, produceArtifacts, sendPackets } = makeCtx("这是一段成稿正文");
    await sinkNode(ctx, sinkNodeDef("depot"), "depot", 1);

    expect(states.get("depot")).toBe("done");
    expect(artifacts.get("depot")).toBeDefined();
    expect(produceArtifacts).toHaveBeenCalledWith("depot", "这是一段成稿正文", 1);
    expect(sendPackets).toHaveBeenCalledWith("depot", expect.any(String), "text");
    const finished = events.find((e) => (e as { type?: string }).type === "node.finished");
    expect(finished).toBeDefined();
    expect(events.some((e) => (e as { type?: string }).type === "node.failed")).toBe(false);
  });
});
