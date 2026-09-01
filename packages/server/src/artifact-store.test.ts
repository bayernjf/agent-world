import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "./artifact-store.js";
import type { Artifact } from "@agent-world/core";

describe("artifact store", () => {
  let dir: string;
  let store: ArtifactStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-art-"));
    store = new ArtifactStore(dir);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes inline content to a deterministic local path and serves it back", async () => {
    const a: Artifact = {
      id: "n1-a1",
      kind: "json",
      content: '{"ok":true}',
      mimeType: "application/json",
    };
    const saved = await store.save(a, { runId: "run-abc", nodeId: "n1" });
    expect(saved.storage).toBe("local");
    expect(saved.uri).toBe("/api/artifacts/n1-a1");
    expect(saved.sizeBytes).toBe(11);

    const bytes = await store.readBytes("run-abc", "n1-a1");
    expect(bytes?.toString("utf8")).toBe('{"ok":true}');
  });

  it("passes remote and data URIs through without writing to disk", async () => {
    const a: Artifact = { id: "img", kind: "image", uri: "https://example.com/x.png" };
    const saved = await store.save(a, { runId: "r", nodeId: "n" });
    expect(saved.storage).toBe("uri");
    expect(saved.uri).toBe("https://example.com/x.png");
    expect(await store.readBytes("r", "img")).toBeNull();

    const data: Artifact = { id: "d", kind: "image", uri: "data:image/png;base64,AAAA" };
    expect((await store.save(data, { runId: "r", nodeId: "n" })).storage).toBe("uri");
  });

  it("records artifacts with no content or uri as inline placeholders", async () => {
    const a: Artifact = { id: "z", kind: "text" };
    const saved = await store.save(a, { runId: "r", nodeId: "n" });
    expect(saved.storage).toBe("inline");
    expect(saved.uri).toBeNull();
  });

  it("keeps local /api/artifacts refs as local rows instead of inline stubs", async () => {
    const a: Artifact = { id: "img-0", kind: "image", uri: "/api/artifacts/up-abc", sizeBytes: 2048 };
    const saved = await store.save(a, { runId: "r", nodeId: "n" });
    expect(saved.storage).toBe("local");
    expect(saved.uri).toBe("/api/artifacts/up-abc");
    expect(saved.sizeBytes).toBe(2048);
  });

  it("persists raw uploaded bytes as a local image artifact", async () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const saved = await store.saveBinary({
      userId: "u1",
      data: buf,
      kind: "image",
      mimeType: "image/png",
      label: "product.png",
    });
    expect(saved.storage).toBe("local");
    expect(saved.kind).toBe("image");
    expect(saved.mimeType).toBe("image/png");
    expect(saved.sizeBytes).toBe(buf.length);
    expect(saved.uri).toMatch(/^\/api\/artifacts\//);
    const back = await store.readBytes("uploads", saved.id);
    expect(back?.equals(buf)).toBe(true);
  });

  it("gives two users identical uploads distinct ids", async () => {
    const buf = Buffer.from("same-photo-bytes");
    const a = await store.saveBinary({ userId: "u1", data: buf, kind: "image" });
    const b = await store.saveBinary({ userId: "u2", data: buf, kind: "image" });
    expect(a.id).not.toBe(b.id);
  });
});
