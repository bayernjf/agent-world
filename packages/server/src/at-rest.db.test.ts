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

  // The L3 integration tests above only exercised `triggers[].webhookSecret`.
  // Node-level credentials live in the same three places — graphs.doc, version
  // snapshots and run snapshots — and were plaintext in all of them.
  it("keeps node-level credentials off disk in the doc, version and run snapshots", () => {
    const path = join(dir, "nodes.sqlite");
    const db = openDb(path);
    const nodeKey = "sk-node-on-disk";
    const botToken = "bot-token-on-disk";
    const connToken = "conn-token-on-disk";
    const graph: Graph = {
      id: "g1",
      name: "graph-g1",
      nodes: [
        {
          id: "src", kind: "source", name: "SRC", x: 0, y: 0,
          source: {
            connector: {
              type: "http",
              http: { url: "https://api.example.com/x", auth: { type: "bearer", token: connToken } },
            },
          },
        } as never,
        {
          id: "aud", kind: "audioGen", name: "AUD", x: 1, y: 0,
          audioGen: { model: "tts-1", apiKey: nodeKey },
        } as never,
        {
          id: "nt", kind: "notify", name: "NT", x: 2, y: 0,
          notify: { provider: "feishu", webhookUrl: `https://open.feishu.cn/hook/${botToken}`, message: "m" },
        } as never,
        { id: "depot", kind: "sink", name: "DEPOT", x: 3, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "aud", kind: "flow" },
        { id: "e2", from: "aud", to: "nt", kind: "flow" },
        { id: "e3", from: "nt", to: "depot", kind: "flow" },
      ],
    };

    db.saveGraph(graph, 0, "u1");
    db.saveVersion("g1", "v1", JSON.stringify(graph));
    db.createRun({ id: "run1", userId: "u1", graph, budgetUsd: null, at: 1, trigger: "manual" });
    db.saveAutoSnapshot("g1", JSON.stringify(graph), 0, 10);

    // Every stored copy must be free of all three plaintext credentials.
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const docs = [
        (raw.prepare(`SELECT doc AS d FROM graphs WHERE id = 'g1'`).get() as { d: string }).d,
        ...(raw.prepare(`SELECT snapshot AS d FROM graph_versions WHERE graph_id = 'g1'`).all() as Array<{ d: string }>).map((r) => r.d),
        (raw.prepare(`SELECT snapshot AS d FROM runs WHERE id = 'run1'`).get() as { d: string }).d,
      ];
      expect(docs.length).toBeGreaterThanOrEqual(4); // doc + manual & auto versions + run
      for (const d of docs) {
        expect(d).not.toContain(nodeKey);
        expect(d).not.toContain(botToken);
        expect(d).not.toContain(connToken);
        expect(d).toContain("enc:v1:");
      }
    } finally {
      raw.close();
    }

    // App-facing reads decrypt transparently, so nothing downstream changes.
    const loaded = db.getGraph("g1", "u1")!;
    const nodes = loaded.nodes as unknown as Array<Record<string, any>>;
    expect(nodes.find((n) => n.id === "aud")!.audioGen.apiKey).toBe(nodeKey);
    expect(nodes.find((n) => n.id === "nt")!.notify.webhookUrl).toContain(botToken);
    expect(nodes.find((n) => n.id === "src")!.source.connector.http.auth.token).toBe(connToken);

    // Hashes stay plaintext-based, so "matches what ran" still lines up.
    const versionHash = (db.listVersions("g1", "u1") as unknown as Array<{ contentHash: string }>)
      .find((v) => v.contentHash)?.contentHash;
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
