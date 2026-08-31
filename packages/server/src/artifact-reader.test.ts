import { describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "./db.js";
import type { ArtifactStore } from "./artifact-store.js";
import { createReadArtifact } from "./artifact-reader.js";

function makeReader() {
  const db: Db = openDb(":memory:");
  // readBytes must never be reached for a rejected id; the spy proves it.
  const readBytes = vi.fn(async () => Buffer.from("x"));
  const artifacts = { readBytes } as unknown as ArtifactStore;
  const read = createReadArtifact(db, artifacts);
  return { read, readBytes };
}

describe("createReadArtifact id validation (audit M4)", () => {
  it("returns null for an unrelated URI", async () => {
    const { read } = makeReader();
    expect(await read("https://example.com/x")).toBeNull();
  });

  it("rejects an encoded path separator after decoding (%2f)", async () => {
    const { read, readBytes } = makeReader();
    // The raw regex matches "a%2fb" (no literal slash), but decoding yields
    // "a/b" — the post-decode charset check must refuse it.
    expect(await read("/api/artifacts/a%2fb")).toBeNull();
    expect(readBytes).not.toHaveBeenCalled();
  });

  it("rejects an encoded parent reference (%2e%2e)", async () => {
    const { read, readBytes } = makeReader();
    expect(await read("/api/artifacts/%2e%2e%2fsecret")).toBeNull();
    expect(readBytes).not.toHaveBeenCalled();
  });

  it("rejects a literal double-dot id", async () => {
    const { read } = makeReader();
    expect(await read("/api/artifacts/..")).toBeNull();
  });

  it("rejects ids outside the safe charset", async () => {
    const { read } = makeReader();
    expect(await read("/api/artifacts/a%20b")).toBeNull(); // encoded space
  });
});
