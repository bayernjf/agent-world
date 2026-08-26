import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  it("writes inline content to a deterministic local path and serves it back", () => {
    const a: Artifact = {
      id: "n1-a1",
      kind: "json",
      content: '{"ok":true}',
      mimeType: "application/json",
    };
    const saved = store.save(a, { runId: "run-abc", nodeId: "n1" });
    expect(saved.storage).toBe("local");
    expect(saved.uri).toBe("/api/artifacts/n1-a1");
    expect(saved.sizeBytes).toBe(11);

    const bytes = store.readBytes("run-abc", "n1-a1");
    expect(bytes?.toString("utf8")).toBe('{"ok":true}');
  });

  it("passes remote and data URIs through without writing to disk", () => {
    const a: Artifact = { id: "img", kind: "image", uri: "https://example.com/x.png" };
    const saved = store.save(a, { runId: "r", nodeId: "n" });
    expect(saved.storage).toBe("uri");
    expect(saved.uri).toBe("https://example.com/x.png");
    expect(store.readBytes("r", "img")).toBeNull();

    const data: Artifact = { id: "d", kind: "image", uri: "data:image/png;base64,AAAA" };
    expect(store.save(data, { runId: "r", nodeId: "n" }).storage).toBe("uri");
  });

  it("records artifacts with no content or uri as inline placeholders", () => {
    const a: Artifact = { id: "z", kind: "text" };
    const saved = store.save(a, { runId: "r", nodeId: "n" });
    expect(saved.storage).toBe("inline");
    expect(saved.uri).toBeNull();
  });
});
