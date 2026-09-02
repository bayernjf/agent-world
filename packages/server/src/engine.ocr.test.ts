import { compile, replay, type FileParseConfig, type Graph } from "@agent-world/core";
import { zipSync } from "fflate";
import { PNG } from "pngjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import { ocrImage } from "./ocr.js";
import { fakeWorker } from "./worker.js";

vi.mock("./ocr.js", () => ({
  ocrImage: vi.fn(),
}));

function pngBytes(): Uint8Array {
  const png = new PNG({ width: 2, height: 2 });
  png.data = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  return new Uint8Array(PNG.sync.write(png));
}

/** DOCX with two embedded images in word/media/. */
function docxZip(): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Scanned document</w:t></w:r></w:p></w:body>
</w:document>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": new TextEncoder().encode(`<?xml version="1.0"?><Types/>`),
    "word/document.xml": new TextEncoder().encode(documentXml),
    "word/media/image1.png": pngBytes(),
    "word/media/image2.png": pngBytes(),
  };
  return Buffer.from(zipSync(files));
}

/** Minimal hand-written PDF: one text line + one 2x2 RGB image. */
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
}

function artifactStore(): Store {
  const map = new Map<string, string>();
  let n = 0;
  return {
    storeBinary(data: Buffer, mimeType: string, _label?: string) {
      const id = `/api/artifacts/art-${++n}`;
      map.set(id, `data:${mimeType};base64,${data.toString("base64")}`);
      return id;
    },
    async readArtifact(uri: string) {
      return map.get(uri) ?? null;
    },
  };
}

async function collect(g: Graph, store: Store) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    now: () => 0,
    storeBinary: store.storeBinary,
    readArtifact: store.readArtifact,
  })) {
    events.push(e);
  }
  return events;
}

/** Graph where `http` downloads `bytes`, `fp` parses it, then `ocr` recognises images. */
async function collectPipeline(bytes: Buffer, mimeType: string, fp: FileParseConfig) {
  const store = artifactStore();
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(bytes, { status: 200, headers: { "content-type": mimeType } }),
  );
  vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
  const g: Graph = {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "dl", kind: "http", name: "DL", x: 1, y: 0, http: { url: "https://files.example.com/doc.bin", outputMode: "file" } },
      { id: "fp", kind: "fileParse", name: "FP", x: 2, y: 0, fileParse: fp },
      { id: "ocr", kind: "ocr", name: "OCR", x: 3, y: 0, ocr: {} },
      { id: "sink", kind: "sink", name: "SINK", x: 4, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "dl", kind: "flow" },
      { id: "e2", from: "dl", to: "fp", kind: "flow" },
      { id: "e3", from: "fp", to: "ocr", kind: "flow" },
      { id: "e4", from: "ocr", to: "sink", kind: "flow" },
    ],
  };
  try {
    return { events: await collect(g, store), store };
  } finally {
    spy.mockRestore();
    vi.unstubAllEnvs();
  }
}

function textOf(events: any[], nodeId: string): string | undefined {
  return events.find((e) => e.type === "artifact.produced" && e.nodeId === nodeId)?.artifact.content;
}

describe("ocr node — image text recognition", () => {
  beforeEach(() => {
    vi.mocked(ocrImage).mockReset();
    vi.mocked(ocrImage).mockImplementation(async (image: Buffer) => ({
      text: `FAKE[${image.length}B]`,
      confidence: 95,
    }));
  });

  it("recognises the image extracted from a PDF and emits a text artifact", async () => {
    const { events } = await collectPipeline(pdfBytes(), "application/pdf", { maxImages: 20 });
    expect(replay(events).status).toBe("done");
    expect(vi.mocked(ocrImage)).toHaveBeenCalledTimes(1);
    const out = textOf(events, "ocr");
    expect(out).toMatch(/^FAKE\[\d+B\]$/); // pdfjs-decoded 2x2 image, re-encoded as PNG
    // Byte length says nothing useful; check what tesseract is actually handed.
    // Feeding pngjs pdfjs's 3-channel samples shifted every pixel (dogfood
    // tpl-scan-ocr: a scan came out 3/4 tall and OCR read garbage).
    const [handed] = vi.mocked(ocrImage).mock.calls[0]!;
    const decoded = PNG.sync.read(handed);
    expect([decoded.width, decoded.height]).toEqual([2, 2]);
    expect(Array.from(decoded.data)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]);
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "ocr");
    expect(finished.output).toContain("平均置信度 95%");
    expect(events.some((e) => e.type === "packet.sent" && e.from === "ocr" && e.to === "sink")).toBe(true);
  });

  it("merges text from multiple images and passes the configured lang", async () => {
    const { events } = await collectPipeline(docxZip(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", {});
    expect(replay(events).status).toBe("done");
    expect(vi.mocked(ocrImage)).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(ocrImage).mock.calls;
    for (const [image, cfg] of calls) {
      expect(Buffer.isBuffer(image)).toBe(true);
      expect(cfg.lang).toBe("eng");
    }
    const out = textOf(events, "ocr");
    expect(out?.split("\n\n")).toHaveLength(2);
  });

  it("fails with VALIDATION when no unique upstream is configured", async () => {
    const store = artifactStore();
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src1", kind: "source", name: "SRC1", x: 0, y: 0 },
        { id: "src2", kind: "source", name: "SRC2", x: 0, y: 1 },
        { id: "ocr", kind: "ocr", name: "OCR", x: 1, y: 0, ocr: {} },
        { id: "sink", kind: "sink", name: "SINK", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src1", to: "ocr", kind: "flow" },
        { id: "e2", from: "src2", to: "ocr", kind: "flow" },
        { id: "e3", from: "ocr", to: "sink", kind: "flow" },
      ],
    };
    const events = await collect(g, store);
    expect(replay(events).status).toBe("failed");
    expect(
      events.some((e) => e.type === "node.failed" && e.nodeId === "ocr" && e.errorCode === "VALIDATION"),
    ).toBe(true);
    expect(vi.mocked(ocrImage)).not.toHaveBeenCalled();
  });

  it("fails with VALIDATION when the upstream produces no images", async () => {
    const store = artifactStore();
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        { id: "ocr", kind: "ocr", name: "OCR", x: 1, y: 0, ocr: {} },
        { id: "sink", kind: "sink", name: "SINK", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "ocr", kind: "flow" },
        { id: "e2", from: "ocr", to: "sink", kind: "flow" },
      ],
    };
    const events = await collect(g, store);
    expect(replay(events).status).toBe("failed");
    expect(
      events.some((e) => e.type === "node.failed" && e.nodeId === "ocr" && e.errorCode === "VALIDATION"),
    ).toBe(true);
  });

  it("fails the node when recognition throws", async () => {
    vi.mocked(ocrImage).mockRejectedValue(new Error("tesseract core crashed"));
    const { events } = await collectPipeline(pdfBytes(), "application/pdf", {});
    expect(replay(events).status).toBe("failed");
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "ocr");
    expect(failed.errorCode).toBe("PROVIDER_ERROR");
    expect(failed.error).toContain("tesseract core crashed");
  });
});
