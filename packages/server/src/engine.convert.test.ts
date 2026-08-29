import { compile, replay, type Graph } from "@agent-world/core";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function pngBytes(): Buffer {
  const png = new PNG({ width: 2, height: 2 });
  png.data = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  return PNG.sync.write(png);
}

/** 2x2 RGBA source pixels, JPEG-encoded at the given quality. */
function jpegBytes(quality = 90): Buffer {
  return Buffer.from(
    jpeg.encode(
      { width: 2, height: 2, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]) },
      quality,
    ).data,
  );
}

/** Minimal hand-written PDF with one embedded 2x2 RGB image. */
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

/** Build a graph where `http` downloads `bytes` as a file, then `cv` converts it. */
async function collectDownload(bytes: Buffer, mimeType: string, cv: Record<string, unknown>) {
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
      { id: "cv", kind: "convert", name: "CV", x: 2, y: 0, convert: cv },
      { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "dl", kind: "flow" },
      { id: "e2", from: "dl", to: "cv", kind: "flow" },
      { id: "e3", from: "cv", to: "sink", kind: "flow" },
    ],
  };
  try {
    return { events: await collect(g, store), store };
  } finally {
    spy.mockRestore();
    vi.unstubAllEnvs();
  }
}

function imageArtifacts(events: any[], nodeId: string): any[] {
  return events
    .filter((e) => e.type === "artifact.produced" && e.nodeId === nodeId && e.artifact.kind === "image")
    .map((e) => e.artifact);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("convert node — format conversion", () => {
  it("extracts the embedded image from a PDF (to: image)", async () => {
    const { events, store } = await collectDownload(pdfBytes(), "application/pdf", { to: "image" });
    expect(replay(events).status).toBe("done");
    const imgs = imageArtifacts(events, "cv");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].mimeType).toBe("image/png");
    const dataUri = await store.readArtifact(imgs[0].uri);
    expect(dataUri).toMatch(/^data:image\/png;base64,/);
    const decoded = PNG.sync.read(Buffer.from(dataUri!.split(",")[1]!, "base64"));
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
  });

  it("re-encodes a PNG download as JPEG (to: jpeg)", async () => {
    const { events, store } = await collectDownload(pngBytes(), "image/png", { to: "jpeg", quality: 80 });
    expect(replay(events).status).toBe("done");
    const imgs = imageArtifacts(events, "cv");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].mimeType).toBe("image/jpeg");
    const dataUri = await store.readArtifact(imgs[0].uri);
    const buf = Buffer.from(dataUri!.split(",")[1]!, "base64");
    const decoded = jpeg.decode(buf, { useTArray: true });
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
  });

  it("re-encodes a JPEG download as PNG (to: png)", async () => {
    const { events } = await collectDownload(jpegBytes(), "image/jpeg", { to: "png" });
    expect(replay(events).status).toBe("done");
    const imgs = imageArtifacts(events, "cv");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].mimeType).toBe("image/png");
  });

  it("converts multiple image artifacts at once", async () => {
    // fileParse extracts both docx images, then convert re-encodes them to jpeg.
    const { zipSync } = await import("fflate");
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Pics</w:t></w:r></w:p></w:body>
</w:document>`;
    const files: Record<string, Uint8Array> = {
      "[Content_Types].xml": new TextEncoder().encode(`<?xml version="1.0"?><Types/>`),
      "word/document.xml": new TextEncoder().encode(documentXml),
      "word/media/image1.png": new Uint8Array(pngBytes()),
      "word/media/image2.png": new Uint8Array(pngBytes()),
    };
    const docx = Buffer.from(zipSync(files));
    const store = artifactStore();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(docx, { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } }),
    );
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        { id: "dl", kind: "http", name: "DL", x: 1, y: 0, http: { url: "https://files.example.com/d.docx", outputMode: "file" } },
        { id: "fp", kind: "fileParse", name: "FP", x: 2, y: 0, fileParse: {} },
        { id: "cv", kind: "convert", name: "CV", x: 3, y: 0, convert: { to: "jpeg" } },
        { id: "sink", kind: "sink", name: "SINK", x: 4, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "dl", kind: "flow" },
        { id: "e2", from: "dl", to: "fp", kind: "flow" },
        { id: "e3", from: "fp", to: "cv", kind: "flow" },
        { id: "e4", from: "cv", to: "sink", kind: "flow" },
      ],
    };
    try {
      const events = await collect(g, store);
      expect(replay(events).status).toBe("done");
      const imgs = imageArtifacts(events, "cv");
      expect(imgs).toHaveLength(2);
      for (const img of imgs) expect(img.mimeType).toBe("image/jpeg");
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("fails with VALIDATION when the upstream has no convertible input", async () => {
    const store = artifactStore();
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        { id: "cv", kind: "convert", name: "CV", x: 1, y: 0, convert: { to: "jpeg" } },
        { id: "sink", kind: "sink", name: "SINK", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "cv", kind: "flow" },
        { id: "e2", from: "cv", to: "sink", kind: "flow" },
      ],
    };
    const events = await collect(g, store);
    expect(replay(events).status).toBe("failed");
    expect(
      events.some((e) => e.type === "node.failed" && e.nodeId === "cv" && e.errorCode === "VALIDATION"),
    ).toBe(true);
  });

  it("fails when the download is not a decodable image", async () => {
    const { events } = await collectDownload(Buffer.from("not an image"), "image/png", { to: "jpeg" });
    expect(replay(events).status).toBe("failed");
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "cv");
    expect(failed.errorCode).toBe("PROVIDER_ERROR");
    expect(failed.error).toContain("图片转换失败");
  });
});
