import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb } from "./db.js";

function testGraph(id: string, secret?: string): Graph {
  const g: Graph = {
    id,
    name: `graph-${id}`,
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0, source: {} },
      { id: "depot", kind: "sink", name: "DEPOT", x: 100, y: 0 },
    ],
    edges: [{ id: "e1", from: "src", to: "depot", kind: "flow" }],
  };
  if (secret) {
    g.triggers = [{ type: "webhook", webhookSecret: secret, enabled: true }];
  }
  return g;
}

describe("at-rest encryption: db integration (audit L3)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-atrest-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const rawDoc = (path: string, graphId: string): string => {
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const row = raw.prepare(`SELECT doc FROM graphs WHERE id = ?`).get(graphId) as { doc: string } | undefined;
      return row?.doc ?? "";
    } finally {
      raw.close();
    }
  };

  it("stores the graph doc encrypted on disk but returns the plaintext secret", () => {
    const path = join(dir, "g.sqlite");
    const db = openDb(path);
    const secret = "wh-verify-secret";
    db.saveGraph(testGraph("g1", secret), 0, "u1");

    // What is actually on disk must not contain the plaintext secret.
    const onDisk = rawDoc(path, "g1");
    expect(onDisk).not.toContain(secret);
    expect(onDisk).toContain("enc:v1:");

    // The app-facing read decrypts transparently.
    const loaded = db.getGraph("g1", "u1");
    expect(loaded?.triggers?.[0]?.webhookSecret).toBe(secret);
    db.close();
  });

  it("version snapshots round-trip and restore keeps the secret", () => {
    const db = openDb(join(dir, "v.sqlite"));
    const secret = "snapshot-secret";
    db.saveGraph(testGraph("g1", secret), 0, "u1");
    db.saveVersion("g1", "v1", JSON.stringify(testGraph("g1", secret)));

    const vers = db.listVersions("g1", "u1") as unknown as Array<{ id: string }>;
    const v = db.getVersion(vers[0].id, "u1") as unknown as { snapshot: string };
    expect(JSON.parse(v.snapshot)).toMatchObject({ id: "g1" });
    expect((JSON.parse(v.snapshot) as Graph).triggers?.[0]?.webhookSecret).toBe(secret);
    db.close();
  });

  it("run snapshots round-trip and the content hash still matches the version hash", () => {
    const db = openDb(join(dir, "r.sqlite"));
    const secret = "run-secret";
    const graph = testGraph("g1", secret);
    db.saveGraph(graph, 0, "u1");
    db.createRun({ id: "run1", userId: "u1", graph, budgetUsd: null, at: 1, trigger: "manual" });

    const run = db.getRun("run1", "u1") as unknown as { snapshot: string };
    expect((JSON.parse(run.snapshot) as Graph).triggers?.[0]?.webhookSecret).toBe(secret);

    // Auto-snapshot of the same graph: its stored content_hash (computed on
    // plaintext) must equal the hash derived from the (encrypted) run snapshot,
    // so the version panel's "matches what ran" marker stays correct.
    db.saveAutoSnapshot("g1", JSON.stringify(graph), 0, 10);
    const versionHash = (db.listVersions("g1", "u1") as unknown as Array<{ contentHash: string }>)[0]?.contentHash;
    expect(versionHash).toBeDefined();
    expect(db.getLatestRunContentHash("g1", "u1")).toBe(versionHash);
    db.close();
  });

  it("keeps working with legacy plaintext rows (no prefix)", () => {
    const path = join(dir, "legacy.sqlite");
    // Create the schema through openDb, then write a legacy plaintext row
    // directly, bypassing the new sealer.
    const seed = openDb(path);
    seed.close();
    const graph = testGraph("g1", "legacy-plain-secret");
    const raw = new DatabaseSync(path);
    raw
      .prepare(`INSERT INTO graphs (id, user_id, name, doc, origin_template_id, updated_at) VALUES (?, ?, ?, ?, NULL, ?)`)
      .run("g1", "u1", "g", JSON.stringify(graph), Date.now());
    raw.close();

    const db = openDb(path);
    const loaded = db.getGraph("g1", "u1");
    expect(loaded?.triggers?.[0]?.webhookSecret).toBe("legacy-plain-secret");
    db.close();
  });
});
