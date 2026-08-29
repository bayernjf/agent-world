import { unzipSync } from "fflate";
import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PNG } from "pngjs";

/**
 * File parsing for the `fileParse` node: extract text and embedded images from
 * PDF / DOCX / PPTX documents.
 *
 * - PDF: `pdfjs-dist` (official Mozilla build, main-thread decoding — no worker
 *   or canvas required in Node). Text via `getTextContent`; images are decoded
 *   to raw pixels and re-encoded as PNG via `pngjs`.
 * - DOCX / PPTX: Office Open XML documents are ZIP archives. `fflate` unpacks
 *   them, then we pull text runs out of the XML (`w:t` / `a:t`) and export the
 *   already-encoded images from the `word/media/` / `ppt/media/` folders.
 */

export interface ParsedImage {
  mimeType: string;
  data: Uint8Array;
}

export interface ParsedDocument {
  /** Concatenated text (paragraphs/newlines; PDF pages separated by blank lines). */
  text: string;
  /** Embedded images (PDF ones re-encoded as PNG; Office ones as stored). */
  images: ParsedImage[];
}

const DECODER = new TextDecoder();

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Extract the inner text of every `<tag ...>...</tag>` occurrence. */
function tagTexts(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1] ?? "");
  return out;
}

/** Split XML into complete `<block ...>...</block>` elements. */
function blocks(xml: string, block: string): string[] {
  return xml.match(new RegExp(`<${block}\\b[^>]*>[\\s\\S]*?<\\/${block}>`, "g")) ?? [];
}

/** DOCX: paragraphs (`w:p`) with text runs (`w:t`); tabs → space, breaks → newline. */
function docxText(xml: string): string {
  const cleaned = xml.replace(/<w:tab[^>]*\/>/g, " ").replace(/<w:br[^>]*\/>/g, "\n");
  return blocks(cleaned, "w:p")
    .map((p) => tagTexts(p, "w:t").map(decodeEntities).join(""))
    .join("\n")
    .trim();
}

/** PPTX: paragraphs (`a:p`) with text runs (`a:t`) inside each slide. */
function pptxText(xml: string): string {
  const paras = blocks(xml, "a:p");
  if (paras.length === 0) return tagTexts(xml, "a:t").map(decodeEntities).join(" ").trim();
  return paras
    .map((p) => tagTexts(p, "a:t").map(decodeEntities).join(""))
    .join("\n")
    .trim();
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
};

/** Images stored in a DOCX/PPTX media folder (already encoded PNG/JPEG/…). */
function mediaImages(files: Record<string, Uint8Array>, prefix: string): ParsedImage[] {
  const out: ParsedImage[] = [];
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith(prefix)) continue;
    const ext = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    const mime = ext ? MIME_BY_EXT[ext] : undefined;
    if (!mime) continue;
    out.push({ mimeType: mime, data });
  }
  return out;
}

/** Embedded images on one PDF page: decode to raw pixels, re-encode as PNG. */
async function pdfPageImages(page: { getOperatorList: () => Promise<any>; commonObjs: any; objs: any }): Promise<ParsedImage[]> {
  const out: ParsedImage[] = [];
  try {
    const ops = await page.getOperatorList();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
      const key = ops.argsArray[i][0] as string;
      const image = await new Promise((resolve) =>
        (key.startsWith("g_") ? page.commonObjs : page.objs).get(key, resolve),
      );
      if (!image || typeof image !== "object") continue;
      const { width, height, data } = image as { width: number; height: number; data?: Uint8Array };
      if (!data || !width || !height) continue;
      const channels = data.length / (width * height);
      if (![1, 3, 4].includes(channels)) continue;
      const colorType = channels === 4 ? 6 : channels === 3 ? 2 : 0;
      const png = new PNG({ width, height, colorType });
      png.data = Buffer.from(data);
      out.push({ mimeType: "image/png", data: new Uint8Array(PNG.sync.write(png)) });
    }
  } catch {
    // One page failing to yield images must not kill the whole extraction.
  }
  return out;
}

/**
 * Extract every embedded image from a PDF buffer, re-encoded as PNG. Shared
 * by the `fileParse` node (text + images) and the `convert` node (pdf → image).
 */
export async function extractPdfImages(buf: Uint8Array): Promise<ParsedImage[]> {
  const doc = await getDocument({ data: buf }).promise;
  const images: ParsedImage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      images.push(...(await pdfPageImages(page)));
    }
  } finally {
    await doc.loadingTask?.destroy?.();
  }
  return images;
}

async function parsePdf(buf: Uint8Array): Promise<ParsedDocument> {
  const doc = await getDocument({ data: buf }).promise;
  const pages: string[] = [];
  const images: ParsedImage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? (item.str as string) : ""))
        .join(" ")
        .trim();
      if (pageText) pages.push(pageText);
      images.push(...(await pdfPageImages(page)));
    }
  } finally {
    await doc.loadingTask?.destroy?.();
  }
  return { text: pages.join("\n\n"), images };
}

function parseDocx(files: Record<string, Uint8Array>): ParsedDocument {
  const entry = files["word/document.xml"];
  if (!entry) throw new Error("docx 缺少 word/document.xml");
  const text = docxText(DECODER.decode(entry));
  return { text, images: mediaImages(files, "word/media/") };
}

function parsePptx(files: Record<string, Uint8Array>): ParsedDocument {
  const slides = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)/)?.[1] ?? 0);
      return na - nb;
    });
  if (slides.length === 0) throw new Error("pptx 缺少幻灯片文件（ppt/slides/slideN.xml）");
  const texts = slides
    .map((name) => pptxText(DECODER.decode(files[name]!)))
    .filter(Boolean);
  return { text: texts.join("\n\n"), images: mediaImages(files, "ppt/media/") };
}

/**
 * Parse a document buffer into text + images. Format is detected by magic
 * bytes (`%PDF`, ZIP `PK`) with the MIME type as a hint.
 */
export async function parseDocument(
  buf: Buffer,
  mimeType?: string,
): Promise<ParsedDocument> {
  const b = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const isPdfMagic = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
  if (isPdfMagic || mimeType?.includes("pdf")) return parsePdf(b);
  const isZipMagic = b[0] === 0x50 && b[1] === 0x4b; // PK
  if (isZipMagic || mimeType?.includes("vnd.openxmlformats")) {
    const files = unzipSync(b);
    if (Object.keys(files).some((n) => n.startsWith("word/"))) return parseDocx(files);
    if (Object.keys(files).some((n) => n.startsWith("ppt/"))) return parsePptx(files);
    throw new Error("ZIP 文件不是 docx/pptx 文档");
  }
  throw new Error("不支持的文件格式（仅支持 PDF / DOCX / PPTX）");
}

/** Decode a `data:<mime>;base64,...` (or plain-data) URI back to bytes. */
export function dataUriToBuffer(dataUri: string): Buffer {
  const comma = dataUri.indexOf(",");
  const meta = comma === -1 ? "" : dataUri.slice(0, comma);
  const payload = comma === -1 ? dataUri : dataUri.slice(comma + 1);
  if (/;base64/i.test(meta)) return Buffer.from(payload, "base64");
  return Buffer.from(decodeURIComponent(payload), "latin1");
}
