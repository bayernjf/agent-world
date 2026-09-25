import { describe, expect, it, vi } from "vitest";
import type { Graph, GraphNode } from "@agent-world/core";
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

// 守卫收窄（2026-09-25，PR #429 CI 实测）：「空」有两种，处置不同——
// ① 直接上游全是**不产正文**的节点（branch 只发路由元数据 / gate 人工放行时
//    无 verdict reason / 媒体节点产出的是 artifact 不是文本）：这是
//    「路由/产出后收尾」的结构形状，节点照常 done，但**不归档**——不落空
//    final 成品、不发包；否则 engine.branch ×7、reliability 的 halted→depot、
//    videogen accept-degraded 全部从 done 变 failed；
// ② 有内容型上游却产出空 → 真故障，failed + VALIDATION。
// 集合不是拍的：对失败套件临时探针实测 upstream kinds 分布为
// ["branch"]×7 / ["gate"]×3 / ["videoGen"]×1。
describe("sinkNode (empty input: structural vs broken)", () => {
  function graphWith(upstreams: Array<{ id: string; kind: string }>): Graph {
    return {
      id: "g",
      name: "g",
      nodes: [
        ...upstreams.map(
          (u) => ({ id: u.id, kind: u.kind, name: u.id.toUpperCase(), x: 0, y: 0 }) as GraphNode,
        ),
        sinkNodeDef("depot"),
      ],
      edges: upstreams.map((u, i) => ({ id: `e${i}`, from: u.id, to: "depot", kind: "flow" as const })),
    };
  }

  async function runEmpty(upstreams: Array<{ id: string; kind: string }>) {
    const base = makeCtx("");
    const ctx = { ...base.ctx, graph: graphWith(upstreams) } as unknown as NodeRunContext;
    await sinkNode(ctx, sinkNodeDef("depot"), "depot", 1);
    return base;
  }

  it("completes a sink fed only by a branch WITHOUT archiving an empty product", async () => {
    const { states, artifacts, events, produceArtifacts, sendPackets } = await runEmpty([
      { id: "br", kind: "branch" },
    ]);
    // 路由终点是「路由/产出后收尾」的设计形状：节点 done（时间线与恢复语义
    // 不变），但没有正文就不归档——成品库里不许出现永远打不开的空成品。
    expect(states.get("depot")).toBe("done");
    expect(events.some((e) => (e as { type?: string; nodeId?: string }).type === "node.finished" && (e as { nodeId?: string }).nodeId === "depot")).toBe(true);
    expect(artifacts.has("depot")).toBe(false);
    expect(events.some((e) => (e as { type?: string }).type === "node.failed")).toBe(false);
    expect(produceArtifacts).not.toHaveBeenCalled();
    expect(sendPackets).not.toHaveBeenCalled();
  });

  it("completes media-only upstreams the same way (videoGen produces artifacts, not text)", async () => {
    const { states, artifacts, events } = await runEmpty([{ id: "v", kind: "videoGen" }]);
    expect(states.get("depot")).toBe("done");
    expect(artifacts.has("depot")).toBe(false);
    expect(events.some((e) => (e as { type?: string }).type === "node.failed")).toBe(false);
  });

  it("still fails when a content producer is among the upstreams and output is empty", async () => {
    const { states, events } = await runEmpty([
      { id: "br", kind: "branch" },
      { id: "forge", kind: "textGen" },
    ]);
    expect(states.get("depot")).toBe("failed");
    const failed = events.find((e) => (e as { type?: string }).type === "node.failed") as {
      errorCode?: string;
    };
    expect(failed?.errorCode).toBe("VALIDATION");
  });

  it("fails an orphan sink (no upstream) — cannot classify emptiness as structural", async () => {
    const { states, events } = await runEmpty([]);
    expect(states.get("depot")).toBe("failed");
    expect(events.some((e) => (e as { type?: string }).type === "node.skipped")).toBe(false);
  });
});
