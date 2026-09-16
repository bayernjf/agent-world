import { unzipSync, type Unzipped } from "fflate";
import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PNG } from "pngjs";

// --- Decompression-bomb guards (M5) ---------------------------------------
// Office documents are small ZIPs; these ceilings are generous for real
// documents while stopping a zip bomb (high ratio / huge declared size / many
// entries) from exhausting memory during synchronous extraction.
/** Maximum accepted compressed archive size. */
export const MAX_COMPRESSED_ARCHIVE_BYTES = 100 * 1024 * 1024;
/** Maximum summed uncompressed size across all entries. */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
/** Maximum number of entries in one archive. */
export const MAX_ARCHIVE_ENTRIES = 20_000;

/** Injectable limits so tests can exercise the guards without giant fixtures. */
export interface UnzipLimits {
  maxCompressed?: number;
  maxTotalUncompressed?: number;
  maxEntries?: number;
}

/**
 * Safely unzip: reject an oversized archive, then use the central-directory
 * metadata (originalSize) to bound declared output while extracting, and
 * finally re-check the real byte total (a forged header can lie about size).
 */
export function safeUnzip(data: Uint8Array, limits: UnzipLimits = {}): Unzipped {
  const maxCompressed = limits.maxCompressed ?? MAX_COMPRESSED_ARCHIVE_BYTES;
  const maxTotal = limits.maxTotalUncompressed ?? MAX_TOTAL_UNCOMPRESSED_BYTES;
  const maxEntries = limits.maxEntries ?? MAX_ARCHIVE_ENTRIES;
  if (data.length > maxCompressed) {
    throw new Error("压缩包超过大小上限");
  }
  let entries = 0;
  let declaredTotal = 0;
  const files = unzipSync(data, {
    filter(file) {
      entries += 1;
      if (entries > maxEntries) throw new Error("压缩包条目数超过上限");
      declaredTotal += file.originalSize || 0;
      if (declaredTotal > maxTotal) {
        throw new Error("压缩包解压后总大小超过上限（疑似解压炸弹）");
      }
      return true;
    },
  });
  let actualTotal = 0;
  for (const name of Object.keys(files)) actualTotal += files[name]!.length;
  if (actualTotal > maxTotal) {
    throw new Error("解压结果总大小超过上限（疑似解压炸弹）");
  }
  return files;
}

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

/**
 * Expand pdfjs's 1/3/4-channel sample buffer to the RGBA layout pngjs requires.
 * Grayscale (typical for a black-and-white scanner at high dpi) becomes a neutral
 * grey, RGB gets an opaque alpha, RGBA is copied through untouched.
 */
function toRgba(data: Uint8Array, width: number, height: number, channels: number): Buffer {
  const total = width * height;
  if (channels === 4) return Buffer.from(data);
  const rgba = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    if (channels === 3) {
      rgba.set(data.subarray(i * 3, i * 3 + 3), i * 4);
    } else {
      const g = data[i] ?? 0;
      rgba[i * 4] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
    }
  }
  for (let p = 3; p < rgba.length; p += 4) rgba[p] = 255;
  return rgba;
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
      // pngjs always wants RGBA on write — feeding it the 1- or 3-channel buffer
      // that pdfjs hands over shifts every pixel and squashes the picture
      // (dogfood tpl-scan-ocr: a DeviceRGB scan came out at 3/4 height and OCR
      // read garbage). Expand grayscale/RGB to opaque RGBA first.
      const png = new PNG({ width, height, colorType: 6 });
      png.data = toRgba(data, width, height, channels);
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

/** Convert an Excel column letter run ("A", "AA") to a 0-based column index. */
function xlsxColIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Quote a CSV field when it contains a comma, quote or newline. */
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Read the shared-string table (`xl/sharedStrings.xml`), rich text joined. */
function xlsxSharedStrings(files: Record<string, Uint8Array>): string[] {
  const entry = files["xl/sharedStrings.xml"];
  if (!entry) return [];
  const xml = DECODER.decode(entry);
  return blocks(xml, "si").map((si) =>
    tagTexts(si, "t").map(decodeEntities).join(""),
  );
}

/** Resolve worksheet file paths in workbook order, with names when available. */
function xlsxSheets(
  files: Record<string, Uint8Array>,
): { name: string; path: string }[] {
  // Map r:id -> worksheet target via xl/_rels/workbook.xml.rels.
  const relsEntry = files["xl/_rels/workbook.xml.rels"];
  const relTargets = new Map<string, string>();
  if (relsEntry) {
    for (const m of DECODER.decode(relsEntry).matchAll(
      /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g,
    )) {
      const target = m[2]!.replace(/^\//, ""); // leading "/" = relative to xl/
      relTargets.set(m[1]!, target.startsWith("xl/") ? target : `xl/${target}`);
    }
  }
  const wb = files["xl/workbook.xml"];
  if (wb) {
    const out: { name: string; path: string }[] = [];
    for (const m of DECODER.decode(wb).matchAll(/<sheet\b[^>]*>/g)) {
      const tag = m[0]!;
      const name = decodeEntities(tag.match(/\bname="([^"]*)"/)?.[1] ?? "");
      const rid = tag.match(/r:id="([^"]+)"/)?.[1];
      const target = rid ? relTargets.get(rid) : undefined;
      if (target && files[target]) out.push({ name: name || target, path: target });
    }
    if (out.length > 0) return out;
  }
  // Fallback: enumerate worksheets by their numeric suffix.
  return Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b2) => {
      const na = Number(a.match(/sheet(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b2.match(/sheet(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    })
    .map((path, i) => ({ name: `Sheet${i + 1}`, path }));
}

/** Convert one worksheet XML document into CSV text. */
function xlsxSheetToCsv(xml: string, shared: string[]): string {
  const rows: string[][] = [];
  for (const rowXml of blocks(xml, "row")) {
    const cells: { col: number; val: string }[] = [];
    for (const cXml of blocks(rowXml, "c")) {
      const ref = cXml.match(/\br="([A-Z]+)\d+"/)?.[1];
      const col = ref ? xlsxColIndex(ref) : cells.length;
      const type = cXml.match(/\bt="([^"]+)"/)?.[1];
      let val = "";
      if (type === "inlineStr") {
        val = tagTexts(cXml, "t").map(decodeEntities).join("");
      } else {
        const raw = cXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
        if (type === "s") {
          val = shared[Number(raw)] ?? "";
        } else if (type === "b") {
          val = raw.trim() === "1" ? "TRUE" : "FALSE";
        } else {
          val = decodeEntities(raw.trim());
        }
      }
      cells.push({ col, val });
    }
    const maxCol = cells.reduce((mx, c) => Math.max(mx, c.col), -1);
    const arr: string[] = new Array(maxCol + 1).fill("");
    for (const c of cells) arr[c.col] = c.val;
    rows.push(arr);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function parseXlsx(files: Record<string, Uint8Array>): ParsedDocument {
  const sheets = xlsxSheets(files);
  if (sheets.length === 0) throw new Error("xlsx 缺少工作表文件（xl/worksheets/sheetN.xml）");
  const shared = xlsxSharedStrings(files);
  const multi = sheets.length > 1;
  const parts = sheets.map((s) => {
    const csv = xlsxSheetToCsv(DECODER.decode(files[s.path]!), shared);
    return multi ? `===== Sheet: ${s.name} =====\n${csv}` : csv;
  });
  return { text: parts.join("\n\n"), images: [] };
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
    const files = safeUnzip(b);
    const names = Object.keys(files);
    if (names.some((n) => n.startsWith("word/"))) return parseDocx(files);
    if (names.some((n) => n.startsWith("ppt/"))) return parsePptx(files);
    if (names.some((n) => n.startsWith("xl/"))) return parseXlsx(files);
    throw new Error("ZIP 文件不是 docx/pptx/xlsx 文档");
  }
  throw new Error("不支持的文件格式（仅支持 PDF / DOCX / PPTX / XLSX）");
}

/** Decode a `data:<mime>;base64,...` (or plain-data) URI back to bytes. */
export function dataUriToBuffer(dataUri: string): Buffer {
  const comma = dataUri.indexOf(",");
  const meta = comma === -1 ? "" : dataUri.slice(0, comma);
  const payload = comma === -1 ? dataUri : dataUri.slice(comma + 1);
  if (/;base64/i.test(meta)) return Buffer.from(payload, "base64");
  return Buffer.from(decodeURIComponent(payload), "latin1");
}
