import { compile, replay, type FileParseConfig, type Graph, type SourceFile } from "@agent-world/core";
import { zipSync } from "fflate";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function pngBytes(): Uint8Array {
  const png = new PNG({ width: 2, height: 2 });
  png.data = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  return new Uint8Array(PNG.sync.write(png));
}

function docxZip(): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello from Word</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second line with &amp; entity</w:t></w:r></w:p>
  </w:body>
</w:document>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": new TextEncoder().encode(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`),
    "word/document.xml": new TextEncoder().encode(documentXml),
    "word/media/image1.png": pngBytes(),
  };
  return Buffer.from(zipSync(files));
}

function pptxZip(): Buffer {
  const slide = (num: string, title: string, body: string): string =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": new TextEncoder().encode(`<?xml version="1.0"?><Types/>`),
    "ppt/slides/slide1.xml": new TextEncoder().encode(slide("1", "Slide One Title", "First slide body")),
    "ppt/slides/slide2.xml": new TextEncoder().encode(slide("2", "Slide Two Title", "Second slide body")),
    "ppt/media/image1.png": pngBytes(),
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
  /** Pre-seed a URI → data-URI entry, mimicking a file uploaded before any run. */
  seed: (uri: string, dataUri: string) => void;
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
    seed(uri: string, dataUri: string) {
      map.set(uri, dataUri);
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

/** Build a graph where `http` downloads `bytes` as a file, then `fp` parses it. */
async function collectDownload(bytes: Buffer, mimeType: string, fp: FileParseConfig) {
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
      { id: "http", kind: "http", name: "DL", x: 1, y: 0, http: { url: "https://files.example.com/report.docx", outputMode: "file" } },
      { id: "fp", kind: "fileParse", name: "PARSE", x: 2, y: 0, fileParse: fp },
      { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "http", kind: "flow" },
      { id: "e2", from: "http", to: "fp", kind: "flow" },
      { id: "e3", from: "fp", to: "sink", kind: "flow" },
    ],
  };
  try {
    const events = await collect(g, store);
    spy.mockRestore();
    vi.unstubAllEnvs();
    return events;
  } catch (err) {
    spy.mockRestore();
    vi.unstubAllEnvs();
    throw err;
  }
}

function jsonOf(events: any[], nodeId: string): string | undefined {
  return events.find((e) => e.type === "artifact.produced" && e.nodeId === nodeId)?.artifact.content;
}

function artifactsOf(events: any[], nodeId: string): any[] {
  return events.filter((e) => e.type === "artifact.produced" && e.nodeId === nodeId).map((e) => e.artifact);
}

describe("fileParse node — HTTP download link", () => {
  it("downloads a binary file through http outputMode=file and parses the docx", async () => {
    const events = await collectDownload(
      docxZip(),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      {},
    );
    expect(replay(events).status, JSON.stringify(events.map((e) => ({ t: e.type, n: e.nodeId, err: e.error })))).toBe("done");
    const arts = artifactsOf(events, "fp");
    const text = arts.find((a) => a.kind === "text")?.content ?? "";
    expect(text).toContain("Hello from Word");
    expect(text).toContain("Second line with & entity");
    const images = arts.filter((a) => a.kind === "image");
    expect(images.length).toBe(1);
    expect(images[0]!.mimeType).toBe("image/png");
    expect(images[0]!.uri).toMatch(/^\/api\/artifacts\//);
    const dl = artifactsOf(events, "http")[0];
    expect(dl.kind).toBe("file");
    expect(dl.mimeType).toContain("wordprocessingml");
    expect(dl.label).toBe("report.docx");
  });
});

describe("fileParse node — format extraction", () => {
  it("extracts text and images from a PPTX with correct slide order", async () => {
    const events = await collectDownload(pptxZip(), "application/vnd.openxmlformats-officedocument.presentationml.presentation", {});
    expect(replay(events).status).toBe("done");
    const arts = artifactsOf(events, "fp");
    const text = arts.find((a) => a.kind === "text")?.content ?? "";
    expect(text).toContain("Slide One Title");
    expect(text).toContain("Slide Two Title");
    expect(text.indexOf("Slide One Title")).toBeLessThan(text.indexOf("Slide Two Title"));
    expect(arts.filter((a) => a.kind === "image").length).toBe(1);
  });

  it("extracts text and an embedded PNG from a PDF", async () => {
    const events = await collectDownload(pdfBytes(), "application/pdf", {});
    expect(replay(events).status).toBe("done");
    const arts = artifactsOf(events, "fp");
    const text = arts.find((a) => a.kind === "text")?.content ?? "";
    expect(text).toContain("Hello PDF World from Agent World");
    const images = arts.filter((a) => a.kind === "image");
    expect(images.length).toBe(1);
    expect(images[0]!.mimeType).toBe("image/png");
  });

  it("maxImages caps how many images are extracted", async () => {
    const events = await collectDownload(docxZip(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", {
      maxImages: 0,
    });
    expect(replay(events).status).toBe("done");
    const images = artifactsOf(events, "fp").filter((a) => a.kind === "image");
    expect(images.length).toBe(0);
    expect(jsonOf(events, "fp")).toContain("Hello from Word");
  });

  it("fails with VALIDATION when the upstream produces no file artifact", async () => {
    // http returns text; fileParse should reject it.
    const store = artifactStore();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ hello: "world" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        { id: "http", kind: "http", name: "DL", x: 1, y: 0, http: { url: "https://files.example.com/data.json" } },
        { id: "fp", kind: "fileParse", name: "PARSE", x: 2, y: 0, fileParse: {} },
        { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "http", kind: "flow" },
        { id: "e2", from: "http", to: "fp", kind: "flow" },
        { id: "e3", from: "fp", to: "sink", kind: "flow" },
      ],
    };
    try {
      const events = await collect(g, store);
      expect(replay(events).status).toBe("failed");
      expect(events.some((e) => e.type === "node.failed" && e.nodeId === "fp" && e.errorCode === "VALIDATION")).toBe(true);
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("fails when the downloaded file is not a supported document format", async () => {
    const events = await collectDownload(Buffer.from("plain text, not a document"), "text/plain", {});
    expect(replay(events).status).toBe("failed");
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "fp")).toBe(true);
  });
});

// Dogfood 2026-09-01 (tpl-contract-review): the intake node was named 「合同文件」
// but no source node could ever produce a kind="file" artifact, so fileParse
// always failed with 没有产出文件产物. Uploading a document onto the source is
// the product path this covers — the HTTP download tests above never had it.
describe("fileParse node — uploaded document on the source node", () => {
  const UPLOAD_URI = "/api/artifacts/up-contract01";

  const UPLOADED_PDF: SourceFile = {
    uri: UPLOAD_URI,
    label: "供货合同-2026.pdf",
    mimeType: "application/pdf",
  };

  function graphWithSource(files: SourceFile[], images: string[] = []): Graph {
    return {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "合同文件", x: 0, y: 0, source: { files, images } },
        { id: "fp", kind: "fileParse", name: "PARSE", x: 2, y: 0, fileParse: {} },
        { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "fp", kind: "flow" },
        { id: "e2", from: "fp", to: "sink", kind: "flow" },
      ],
    };
  }

  it("materializes source.files as a file artifact and parses it end to end", async () => {
    const store = artifactStore();
    store.seed(UPLOAD_URI, `data:application/pdf;base64,${pdfBytes().toString("base64")}`);

    const events = await collect(graphWithSource([UPLOADED_PDF]), store);

    const fileArts = artifactsOf(events, "src").filter((a) => a.kind === "file");
    expect(fileArts.length).toBe(1);
    expect(fileArts[0]!.uri).toBe(UPLOAD_URI);
    expect(fileArts[0]!.label).toBe("供货合同-2026.pdf");

    expect(replay(events).status, JSON.stringify(events.map((e) => ({ t: e.type, n: e.nodeId, err: e.error })))).toBe("done");
    const parsed = artifactsOf(events, "fp").find((a) => a.kind === "text")?.content ?? "";
    expect(parsed).toContain("Hello PDF World from Agent World");
  });

  it("keeps the image artifacts alongside uploaded files", async () => {
    const store = artifactStore();
    store.seed(UPLOAD_URI, `data:application/pdf;base64,${pdfBytes().toString("base64")}`);

    const events = await collect(graphWithSource([UPLOADED_PDF], ["https://img.example.com/a.png"]), store);

    const kinds = artifactsOf(events, "src").map((a) => a.kind);
    expect(kinds).toContain("file");
    expect(kinds).toContain("image");
    expect(replay(events).status).toBe("done");
  });

  it("still fails with an actionable error when the source got no document", async () => {
    const events = await collect(graphWithSource([]), artifactStore());
    expect(replay(events).status).toBe("failed");
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "fp");
    expect(failed?.errorCode).toBe("VALIDATION");
    expect(failed?.error).toContain("没有产出文件产物");
  });

  it("parses every uploaded document instead of dropping all but the first", async () => {
    const store = artifactStore();
    const dataUri = `data:application/pdf;base64,${pdfBytes().toString("base64")}`;
    store.seed(UPLOAD_URI, dataUri);
    store.seed("/api/artifacts/up-contract02", dataUri);

    const events = await collect(
      graphWithSource([
        UPLOADED_PDF,
        { ...UPLOADED_PDF, uri: "/api/artifacts/up-contract02", label: "供货合同-2026b.pdf" },
      ]),
      store,
    );

    expect(replay(events).status).toBe("done");
    const text = artifactsOf(events, "fp").find((a) => a.kind === "text")?.content ?? "";
    // Both documents' text is present, separated by a per-file header.
    expect(text).toContain("===== 供货合同-2026.pdf =====");
    expect(text).toContain("===== 供货合同-2026b.pdf =====");
    expect(text.split("Hello PDF World from Agent World").length - 1).toBe(2);
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "fp");
    expect(finished?.output).toContain("2 个文档");
  });
});


