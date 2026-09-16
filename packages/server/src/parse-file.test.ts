import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { PNG } from "pngjs";
import { extractPdfImages, parseDocument, safeUnzip } from "./parse-file.js";

function makeZip(files: Record<string, string>): Uint8Array {
  const obj: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) obj[name] = strToU8(text);
  return zipSync(obj);
}

describe("safeUnzip decompression-bomb guards (audit M5)", () => {
  it("extracts a normal small archive", () => {
    const zip = makeZip({ "word/a.txt": "hello", "word/b.txt": "world" });
    const out = safeUnzip(zip);
    expect(Object.keys(out).sort()).toEqual(["word/a.txt", "word/b.txt"]);
  });

  it("rejects an archive with more entries than allowed", () => {
    const zip = makeZip({ "a.txt": "1", "b.txt": "2", "c.txt": "3" });
    expect(() => safeUnzip(zip, { maxEntries: 2 })).toThrow(/条目数/);
  });

  it("rejects when the uncompressed total exceeds the cap", () => {
    const zip = makeZip({ "a.txt": "abcdefghij" }); // 10 bytes
    expect(() => safeUnzip(zip, { maxTotalUncompressed: 5 })).toThrow(/总大小/);
  });

  it("rejects when the compressed archive itself exceeds the cap", () => {
    const zip = makeZip({ "a.txt": "data" });
    expect(() => safeUnzip(zip, { maxCompressed: 2 })).toThrow(/超过大小上限/);
  });
});

/** One-page PDF whose only content is a 2x2 image in the given color space. */
function pdfWithImage(colorSpace: "DeviceRGB" | "DeviceGray", samples: number[]): Uint8Array {
  const content = "q 2 0 0 2 0 0 cm /Im1 Do Q";
  const sLen = new TextEncoder().encode(content).length;
  const head = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 6 6]/Contents 4 0 R/Resources<</XObject<</Im1 6 0 R>>>>>>endobj
4 0 obj<</Length ${sLen}>>stream
${content}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
6 0 obj<</Type/XObject/Subtype/Image/Width 2/Height 2/ColorSpace/${colorSpace}/BitsPerComponent 8/Length ${samples.length}>>stream
`;
  const tail = "\nendstream endobj\ntrailer<</Root 1 0 R/Size 7>>\n%%EOF";
  return new Uint8Array(
    Buffer.concat([Buffer.from(head, "latin1"), Buffer.from(samples), Buffer.from(tail, "latin1")]),
  );
}

// Dogfood tpl-scan-ocr (2026-09-01): the extracted page came back squashed to 3/4
// height because pdfjs hands over 1/3-channel samples while pngjs always writes
// from an RGBA buffer — the shift silently destroyed every scan image, so the ocr
// node downstream read garbage. Count-only assertions could not see this.
describe("extractPdfImages — pixel fidelity", () => {
  it("keeps a DeviceRGB image pixel-exact with an opaque alpha", async () => {
    const imgs = await extractPdfImages(
      pdfWithImage("DeviceRGB", [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
    );
    expect(imgs).toHaveLength(1);
    const png = PNG.sync.read(Buffer.from(imgs[0]!.data));
    expect([png.width, png.height]).toEqual([2, 2]);
    expect(Array.from(png.data)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]);
  });

  it("expands a DeviceGray scan to neutral grey", async () => {
    const imgs = await extractPdfImages(pdfWithImage("DeviceGray", [0, 85, 170, 255]));
    expect(imgs).toHaveLength(1);
    const png = PNG.sync.read(Buffer.from(imgs[0]!.data));
    expect(Array.from(png.data)).toEqual([
      0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255,
    ]);
  });
});

function makeXlsx(files: Record<string, string>): Buffer {
  return Buffer.from(
    makeZip({ "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/"></Types>', ...files }),
  );
}

const WB = (sheets: string) =>
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
const RELS = (pairs: [string, string][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pairs
    .map(([id, t]) => `<Relationship Id="${id}" Type="x" Target="${t}"/>`)
    .join("")}</Relationships>`;

describe("parseDocument xlsx", () => {
  it("reads shared strings, numbers, gaps and quotes commas", async () => {
    const xlsx = makeXlsx({
      "xl/workbook.xml": WB('<sheet name="数据" sheetId="1" r:id="rId1"/>'),
      "xl/_rels/workbook.xml.rels": RELS([["rId1", "worksheets/sheet1.xml"]]),
      "xl/sharedStrings.xml":
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        "<si><t>姓名</t></si><si><t>苹果,香蕉</t></si><si><t>备注</t></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>30</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>9</v></c></row>' +
        "</sheetData></worksheet>",
    });
    const doc = await parseDocument(xlsx);
    // B2 is absent -> empty middle field; trailing empty cells are omitted.
    expect(doc.text).toBe('姓名,30,"苹果,香蕉"\n备注,,9');
    expect(doc.images).toEqual([]);
  });

  it("joins rich-text runs inside one shared string", async () => {
    const xlsx = makeXlsx({
      "xl/workbook.xml": WB('<sheet name="S1" sheetId="1" r:id="rId1"/>'),
      "xl/_rels/workbook.xml.rels": RELS([["rId1", "worksheets/sheet1.xml"]]),
      "xl/sharedStrings.xml":
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        "<si><r><t>姓</t></r><r><t>名</t></r></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
        "</sheetData></worksheet>",
    });
    const doc = await parseDocument(xlsx);
    expect(doc.text).toBe("姓名");
  });

  it("emits per-sheet headers in workbook order, with inlineStr and booleans", async () => {
    const xlsx = makeXlsx({
      "xl/workbook.xml": WB(
        '<sheet name="数据" sheetId="1" r:id="rId1"/><sheet name="明细" sheetId="2" r:id="rId2"/>',
      ),
      "xl/_rels/workbook.xml.rels": RELS([
        ["rId1", "worksheets/sheet1.xml"],
        ["rId2", "worksheets/sheet2.xml"],
      ]),
      "xl/worksheets/sheet1.xml":
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>标题</t></is></c></row>' +
        "</sheetData></worksheet>",
      "xl/worksheets/sheet2.xml":
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>城市</t></is></c><c r="B1" t="b"><v>1</v></c></row>' +
        "</sheetData></worksheet>",
    });
    const doc = await parseDocument(xlsx);
    expect(doc.text).toBe("===== Sheet: 数据 =====\n标题\n\n===== Sheet: 明细 =====\n城市,TRUE");
  });

  it("falls back to numeric-suffixed worksheets when rels are missing", async () => {
    const xlsx = makeXlsx({
      "xl/worksheets/sheet1.xml":
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row>' +
        "</sheetData></worksheet>",
    });
    const doc = await parseDocument(xlsx);
    expect(doc.text).toBe("1,2");
  });

  it("is detected via the spreadsheetml MIME type", async () => {
    const xlsx = makeXlsx({
      "xl/workbook.xml": WB('<sheet name="S1" sheetId="1" r:id="rId1"/>'),
      "xl/_rels/workbook.xml.rels": RELS([["rId1", "worksheets/sheet1.xml"]]),
      "xl/worksheets/sheet1.xml":
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>' +
        "</sheetData></worksheet>",
    });
    const doc = await parseDocument(
      xlsx,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(doc.text).toBe("x");
  });
});
