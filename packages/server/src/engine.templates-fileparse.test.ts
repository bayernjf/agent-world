import { compile, getTemplate, instantiateTemplate, replay, type SourceFile } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

/**
 * Engine-level end-to-end coverage for the fileParse-based professional-service
 * templates (contract-review / privacy-review / due-diligence). These templates
 * only had compile + shape assertions before — the fileParse node needs a real
 * `kind === "file"` artifact (an uploaded document) that the plain text-input
 * tests never produced, so a broken parse path could ship green.
 *
 * We reuse the `artifactStore` + `seed` pattern from engine.fileparse.test.ts:
 * seed an in-memory PDF into the store, attach it to the source node's
 * `source.files`, then run the full pipeline and assert the parsed text flows
 * through to the gate / human stage.
 */

/** Minimal hand-written PDF with one text line (same shape as fileparse tests). */
function pdfBytes(): Buffer {
  const img = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const content =
    "BT /F1 12 Tf 72 720 Td (Hello PDF World from Agent World) Tj ET\n" +
    "q 2 0 0 2 0 0 cm /Im1 Do Q";
  const sLen = new TextEncoder().encode(content).length;
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>/XObject<</Im1 6 0 R>>>>>>endobj
4 0 obj<</Length ${sLen}>>stream
${content}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
6 0 obj<</Type/XObject/Subtype/Image/Width 2/Height 2/ColorSpace/DeviceRGB/BitsPerComponent 8/Length 12>>stream
${Buffer.from(img).toString("latin1")}
endstream endobj
trailer<</Root 1 0 R/Size 7>>
%%EOF`;
  return Buffer.from(pdf, "latin1");
}

interface Store {
  storeBinary: (data: Buffer, mimeType: string, label?: string) => string;
  readArtifact: (uri: string) => Promise<string | null>;
  seed: (uri: string, dataUri: string) => void;
}

function artifactStore(): Store {
  const map = new Map<string, string>();
  let n = 0;
  return {
    storeBinary(data, mimeType) {
      const id = `/api/artifacts/art-${++n}`;
      map.set(id, `data:${mimeType};base64,${data.toString("base64")}`);
      return id;
    },
    async readArtifact(uri) {
      return map.get(uri) ?? null;
    },
    seed(uri, dataUri) {
      map.set(uri, dataUri);
    },
  };
}

const UPLOAD_URI = "/api/artifacts/up-template.pdf";

/** Instantiate a template, attach one uploaded PDF, run it to the first halt/end. */
async function runFileParseTemplate(tplId: string) {
  const tpl = getTemplate(tplId)!;
  const graph = instantiateTemplate(tpl);
  const src = graph.nodes.find((n) => n.kind === "source");
  if (!src) throw new Error(`${tplId} has no source node`);
  const file: SourceFile = { uri: UPLOAD_URI, label: "尽调材料.pdf", mimeType: "application/pdf" };
  src.source = { files: [file] };

  const store = artifactStore();
  store.seed(UPLOAD_URI, `data:application/pdf;base64,${pdfBytes().toString("base64")}`);

  const { plan } = compile(graph)!;
  const worker = fakeWorker({ failFirstAttempts: 0, chunkDelayMs: 0 });
  const events: any[] = [];
  for await (const e of execute({
    runId: "r",
    graph,
    plan: plan!,
    worker,
    budgetUsd: null,
    input: "",
    storeBinary: store.storeBinary,
    readArtifact: store.readArtifact,
    now: () => 0,
    sleep: async () => {},
  })) {
    events.push(e);
  }
  return { graph, events };
}

function parsedText(events: any[], parseId: string | undefined): string {
  return (
    events.find((e) => e.type === "artifact.produced" && e.nodeId === parseId && e.artifact.kind === "text")
      ?.artifact.content ?? ""
  );
}

describe("fileParse templates run end to end (uploaded PDF)", () => {
  it("due-diligence template parses the PDF and finishes", async () => {
    const { graph, events } = await runFileParseTemplate("tpl-due-diligence");
    expect(replay(events).status).toBe("done");
    const parseId = graph.nodes.find((n) => n.name === "材料解析")?.id;
    expect(parsedText(events, parseId)).toContain("Hello PDF World from Agent World");
  });

  it("contract-review template parses the PDF then reaches the human review", async () => {
    const { graph, events } = await runFileParseTemplate("tpl-contract-review");
    expect(replay(events).status).toBe("halted");
    expect(events.some((e) => e.type === "human.review")).toBe(true);
    const parseId = graph.nodes.find((n) => n.name === "合同解析")?.id;
    expect(parsedText(events, parseId)).toContain("Hello PDF World from Agent World");
  });

  it("privacy-review template parses the PDF then reaches the human review", async () => {
    const { graph, events } = await runFileParseTemplate("tpl-privacy-review");
    expect(replay(events).status).toBe("halted");
    expect(events.some((e) => e.type === "human.review")).toBe(true);
    const parseId = graph.nodes.find((n) => n.name === "政策解析")?.id;
    expect(parsedText(events, parseId)).toContain("Hello PDF World from Agent World");
  });
});
