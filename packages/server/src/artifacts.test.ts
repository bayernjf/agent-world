import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { ArtifactStore, type StoredArtifact } from "./artifact-store.js";
import type { Artifact, Graph } from "@agent-world/core";

const U = "u1";
const OTHER = "u2";
const graph: Graph = { id: "g1", name: "G1", nodes: [], edges: [] };

describe("artifact persistence", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  let store: ArtifactStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "aw-dbart-"));
    db = openDb(join(dir, "test.sqlite"));
    store = new ArtifactStore(join(dir, "blobs"));
    await db.saveGraph(graph, 1, U);
  });
  afterEach(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function produce(runId: string, artifact: Artifact, nodeId = "n1", userId = U) {
    const saved = await store.save(artifact, { runId, nodeId });
    await db.insertArtifact(saved, userId);
    return saved;
  }

  async function startRun(runId: string) {
    await db.createRun({ id: runId, userId: U, graph, budgetUsd: null, at: Date.now() });
  }

  it("stores and retrieves artifact metadata per run", async () => {
    await startRun("r1");
    await produce("r1", { id: "a1", kind: "text", content: "hello" });
    await produce("r1", { id: "a2", kind: "image", uri: "https://x/y.png" });

    const list = await db.listArtifactsForRun("r1", U);
    expect(list.map((a) => a.id)).toEqual(["a1", "a2"]);
    const local = list.find((a) => a.id === "a1")!;
    expect(local.storage).toBe("local");
    expect(local.uri).toMatch(/^\/api\/artifacts\/a1$/);

    const remote = await await await db.getArtifact("a2", U)!;
    expect(remote.storage).toBe("uri");
    expect(remote.uri).toBe("https://x/y.png");
  });

  it("supports cross-run listing (latest first)", async () => {
    await startRun("r1");
    await startRun("r2");
    await produce("r1", { id: "old", kind: "text", content: "1" });
    await produce("r2", { id: "new", kind: "json", content: "{}" });
    const page = await db.listArtifacts(U, 10, 0);
    expect(page[0]!.id).toBe("new");
    expect(page).toHaveLength(2);
  });

  it("hides one user's artifacts from another", async () => {
    await startRun("r1");
    await produce("r1", { id: "a1", kind: "text", content: "secret" });

    expect(await db.listArtifacts(OTHER, 10, 0)).toHaveLength(0);
    expect(await db.listArtifactsForRun("r1", OTHER)).toHaveLength(0);
    expect(await db.getArtifact("a1", OTHER)).toBeNull();
    // The engine resolves artifacts its own run already owns.
    expect((await db.getArtifactUnscoped("a1"))?.runId).toBe("r1");
  });

  it("removes artifact rows when the run is deleted", async () => {
    await startRun("r1");
    await produce("r1", { id: "a1", kind: "text", content: "x" });
    await db.deleteRun("r1", U);
    expect(await db.listArtifactsForRun("r1", U)).toHaveLength(0);
    expect(await db.getArtifact("a1", U)).toBeNull();
  });

  it("is idempotent on duplicate insert (ON CONFLICT DO NOTHING)", async () => {
    await startRun("r1");
    const saved: StoredArtifact = await produce("r1", { id: "a1", kind: "text", content: "x" });
    await db.insertArtifact(saved, U);
    await db.insertArtifact(saved, U);
    expect(await db.listArtifactsForRun("r1", U)).toHaveLength(1);
  });
});
