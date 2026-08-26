import type { Graph } from "@agent-world/core";
import { compile } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function makeGraph(opts: { sourceImages?: string[]; n?: number }): Graph {
  return {
    id: "ig",
    name: "ig",
    nodes: [
      { id: "in", kind: "source", name: "IN", x: 0, y: 0, source: { images: opts.sourceImages ?? [] } },
      {
        id: "img",
        kind: "imageGen",
        name: "IMG",
        x: 1,
        y: 0,
        imageGen: { model: "agnes-image", prompt: "", n: opts.n ?? 1 },
      },
      { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "in", to: "img", kind: "flow" },
      { id: "e2", from: "img", to: "out", kind: "flow" },
    ],
  };
}

async function collect(g: Graph) {
  const { plan } = compile(g);
  if (!plan) throw new Error("no plan");
  const events: Array<{ type: string; nodeId?: string; artifact?: { kind: string }; usage?: { units?: Record<string, number> } }> = [];
  for await (const e of execute({
    runId: "r1",
    graph: g,
    plan,
    worker: fakeWorker({ chunkDelayMs: 0 }),
    input: "",
  })) {
    events.push(e as never);
  }
  return events;
}

describe("imageGen node", () => {
  it("fakeWorker.generateImage returns an array of results honoring n", async () => {
    const res = await fakeWorker().generateImage({
      node: { id: "x", kind: "imageGen", name: "X", x: 0, y: 0 } as never,
      config: { model: "agnes-image", n: 3 },
      input: "p",
    });
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(3);
    expect(res[0].mimeType).toBe("image/png");
  });

  it("emits one artifact per generated image and aggregates usage", async () => {
    const events = await collect(makeGraph({ n: 2 }));
    const imgs = events.filter((e) => e.type === "artifact.produced" && e.artifact?.kind === "image");
    expect(imgs).toHaveLength(2);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "img")).toBe(true);
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "img");
    expect(finished?.usage?.units?.images).toBe(2);
  });

  it("skips generation when an upstream source already has images", async () => {
    const events = await collect(makeGraph({ sourceImages: ["https://example.com/p.png"] }));
    // The source node emits its own reference image; the imageGen node must NOT
    // generate when an upstream source already supplies photos.
    const imgsFromImgNode = events.filter(
      (e) => e.type === "artifact.produced" && e.artifact?.kind === "image" && e.nodeId === "img",
    );
    expect(imgsFromImgNode).toHaveLength(0);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "img")).toBe(true);
  });
});
