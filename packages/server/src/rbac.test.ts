import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb } from "./db.js";
import { ArtifactStore } from "./artifact-store.js";
import {
  artifactAccessRole,
  graphAccessRole,
  requireGraph,
  runAccessRole,
  visibleGraphs,
} from "./rbac.js";

let dir: string;
let db: ReturnType<typeof openDb>;
let store: ArtifactStore;

const OWNER = "u-owner";
const EDITOR = "u-editor";
const VIEWER = "u-viewer";
const OUTSIDER = "u-outsider";

function makeGraph(id: string): Graph {
  return { id, name: `G-${id}`, nodes: [], edges: [] };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-perm-"));
  db = openDb(join(dir, "perm.sqlite"));
  store = new ArtifactStore(join(dir, "blobs"));
  for (const u of [OWNER, EDITOR, VIEWER, OUTSIDER]) {
    await db.createUser(u, `${u}@test.dev`, "x");
  }
});

afterAll(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("permissions: graph ACL four states", () => {
  const gid = "g-perm";

  beforeAll(async () => {
    await db.saveGraph(makeGraph(gid), 1_000, OWNER);
  });

  it("owner sees owner, others see nothing before sharing", async () => {
    expect(await graphAccessRole(db, OWNER, gid)).toBe("owner");
    expect(await graphAccessRole(db, EDITOR, gid)).toBeNull();
    expect(await graphAccessRole(db, VIEWER, gid)).toBeNull();
    expect(await graphAccessRole(db, OUTSIDER, gid)).toBeNull();
    expect(await graphAccessRole(db, OWNER, "g-missing")).toBeNull();
  });

  it("editor/viewer rows grant their roles and overwrite on re-grant", async () => {
    await db.saveResourceAccess("graph", gid, EDITOR, "editor");
    await db.saveResourceAccess("graph", gid, VIEWER, "viewer");
    expect(await graphAccessRole(db, EDITOR, gid)).toBe("editor");
    expect(await graphAccessRole(db, VIEWER, gid)).toBe("viewer");

    await db.saveResourceAccess("graph", gid, VIEWER, "editor"); // viewer → editor
    expect(await graphAccessRole(db, VIEWER, gid)).toBe("editor");
    await db.saveResourceAccess("graph", gid, VIEWER, "viewer"); // restore

    // requireGraph enforces the minimum role and resolves the owner id.
    expect((await requireGraph(db, EDITOR, gid, "editor"))?.graphOwnerId).toBe(OWNER);
    expect(await requireGraph(db, VIEWER, gid, "editor")).toBeNull();
    expect((await requireGraph(db, VIEWER, gid, "viewer"))?.graphOwnerId).toBe(OWNER);
    expect((await requireGraph(db, OWNER, gid, "owner"))?.graphOwnerId).toBe(OWNER);

    // Revoking removes access.
    expect(await db.deleteResourceAccess("graph", gid, VIEWER)).toBe(true);
    expect(await graphAccessRole(db, VIEWER, gid)).toBeNull();
    expect(await db.deleteResourceAccess("graph", gid, VIEWER)).toBe(false); // idempotent
  });

  it("visibleGraphs lists owned + shared but not foreign or stale", async () => {
    await db.saveResourceAccess("graph", gid, EDITOR, "editor");
    await db.saveGraph(makeGraph("g-foreign"), 2_000, OUTSIDER);
    await db.saveResourceAccess("graph", "g-foreign", EDITOR, "viewer"); // shared to EDITOR
    await db.saveResourceAccess("graph", "g-ghost", EDITOR, "viewer"); // stale: graph deleted

    const mine = await visibleGraphs(db, EDITOR);
    expect(mine.get(gid)).toBe("editor");
    expect(mine.get("g-foreign")).toBe("viewer");
    expect(mine.has("g-ghost")).toBe(false);

    const ownerView = await visibleGraphs(db, OWNER);
    expect(ownerView.get(gid)).toBeNull(); // owned → null role marker
    expect(ownerView.has("g-foreign")).toBe(false);
  });
});

describe("permissions: runs and artifacts inherit the graph ACL", () => {
  const gid = "g-runacl";
  const graph = makeGraph(gid);

  beforeAll(async () => {
    await db.saveGraph(graph, 1_000, OWNER);
    await db.saveResourceAccess("graph", gid, VIEWER, "viewer");
  });

  it("resolves a run back to its graph", async () => {
    const runId = randomUUID();
    await db.createRun({
      id: runId,
      userId: OWNER,
      graph,
      budgetUsd: null,
      at: 1_000,
      trigger: "manual",
      input: undefined,
    });
    expect(await runAccessRole(db, OWNER, runId)).toBe("owner");
    expect(await runAccessRole(db, VIEWER, runId)).toBe("viewer");
    expect(await runAccessRole(db, OUTSIDER, runId)).toBeNull();
    expect(await runAccessRole(db, OWNER, "no-such-run")).toBeNull();
  });

  it("resolves an artifact back to its graph", async () => {
    const runId = randomUUID();
    await db.createRun({ id: runId, userId: OWNER, graph, budgetUsd: null, at: 2_000, trigger: "manual", input: undefined });
    const saved = await store.save(
      { id: randomUUID(), kind: "text", mimeType: "text/plain", label: "l", content: "hello" },
      { runId, nodeId: "n1" },
    );
    await db.insertArtifact(saved, OWNER);
    expect(await artifactAccessRole(db, OWNER, saved.id)).toBe("owner");
    expect(await artifactAccessRole(db, VIEWER, saved.id)).toBe("viewer");
    expect(await artifactAccessRole(db, OUTSIDER, saved.id)).toBeNull();
  });

  it("orphaned runs (graph deleted) fall back to runs.user_id", async () => {
    const orphanGraph = makeGraph("g-orphan");
    await db.saveGraph(orphanGraph, 3_000, OWNER);
    const runId = randomUUID();
    await db.createRun({ id: runId, userId: OWNER, graph: orphanGraph, budgetUsd: null, at: 3_000, trigger: "manual", input: undefined });
    await db.deleteGraph("g-orphan", OWNER);
    expect(await runAccessRole(db, OWNER, runId)).toBe("owner");
    expect(await runAccessRole(db, OUTSIDER, runId)).toBeNull();
  });
});
