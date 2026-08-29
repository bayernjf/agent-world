import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { ArtifactStore, type StoredArtifact } from "./artifact-store.js";
import type { Artifact, Graph } from "@agent-world/core";

const U = "u1";
const graph: Graph = { id: "g1", name: "G1", nodes: [], edges: [] };

describe("artifact persistence", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  let store: ArtifactStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-dbart-"));
    db = openDb(join(dir, "test.sqlite"));
    store = new ArtifactStore(join(dir, "blobs"));
    db.saveGraph(graph, 1, U);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function produce(runId: string, artifact: Artifact, nodeId = "n1") {
    const saved = await store.save(artifact, { runId, nodeId });
    db.insertArtifact(saved);
    return saved;
  }

  function startRun(runId: string) {
    db.createRun({ id: runId, userId: U, graph, budgetUsd: null, at: Date.now() });
  }

  it("stores and retrieves artifact metadata per run", async () => {
    startRun("r1");
    await produce("r1", { id: "a1", kind: "text", content: "hello" });
    await produce("r1", { id: "a2", kind: "image", uri: "https://x/y.png" });

    const list = db.listArtifactsForRun("r1");
    expect(list.map((a) => a.id)).toEqual(["a1", "a2"]);
    const local = list.find((a) => a.id === "a1")!;
    expect(local.storage).toBe("local");
    expect(local.uri).toMatch(/^\/api\/artifacts\/a1$/);

    const remote = db.getArtifact("a2")!;
    expect(remote.storage).toBe("uri");
    expect(remote.uri).toBe("https://x/y.png");
  });

  it("supports cross-run listing (latest first)", async () => {
    startRun("r1");
    startRun("r2");
    await produce("r1", { id: "old", kind: "text", content: "1" });
    await produce("r2", { id: "new", kind: "json", content: "{}" });
    const page = db.listArtifacts(10, 0);
    expect(page[0]!.id).toBe("new");
    expect(page).toHaveLength(2);
  });

  it("removes artifact rows when the run is deleted", async () => {
    startRun("r1");
    await produce("r1", { id: "a1", kind: "text", content: "x" });
    db.deleteRun("r1", U);
    expect(db.listArtifactsForRun("r1")).toHaveLength(0);
    expect(db.getArtifact("a1")).toBeNull();
  });

  it("is idempotent on duplicate insert (ON CONFLICT DO NOTHING)", async () => {
    startRun("r1");
    const saved: StoredArtifact = await produce("r1", { id: "a1", kind: "text", content: "x" });
    db.insertArtifact(saved);
    db.insertArtifact(saved);
    expect(db.listArtifactsForRun("r1")).toHaveLength(1);
  });
});
