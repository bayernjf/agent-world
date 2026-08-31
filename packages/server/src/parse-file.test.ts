import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { safeUnzip } from "./parse-file.js";

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
