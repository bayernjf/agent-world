import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Graph } from "@agent-world/core";

// The at-rest module caches its keyring per module instance, so every phase
// (seed under the old key, rotate, converge, verify) re-imports fresh after
// arranging env vars.
async function fresh<T>(module: string): Promise<T> {
  vi.resetModules();
  return (await import(/* @vite-ignore */ module)) as T;
}

const K1 = "a".repeat(64); // old key, id aaaaaa
const K2 = "b".repeat(64); // new key, id bbbbbb

const WEBHOOK_SECRET = "wh-rotate-secret";
const NODE_KEY = "sk-node-rotate";
const URL_TOKEN = "url-rotate-token";

function secretGraph(): Graph {
  return {
    id: "g1",
    name: "graph-g1",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0, source: {} },
      {
        id: "aud", kind: "audioGen", name: "AUD", x: 1, y: 0,
        audioGen: { model: "tts-1", apiKey: NODE_KEY },
      } as never,
      {
        id: "ht", kind: "http", name: "HT", x: 2, y: 0,
        http: { url: `https://api.example.com/y?access_token=${URL_TOKEN}&v=2`, headers: { "X-My-Auth": "hdr-rotate-token", Accept: "*/*" } },
      } as never,
      { id: "depot", kind: "sink", name: "DEPOT", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "aud", kind: "flow" },
      { id: "e2", from: "aud", to: "ht", kind: "flow" },
      { id: "e3", from: "ht", to: "depot", kind: "flow" },
    ],
    triggers: [{ type: "webhook", webhookSecret: WEBHOOK_SECRET, enabled: true }],
  } as unknown as Graph;
}

const SETTINGS_PLAINTEXT = JSON.stringify({ providers: { x: { apiKey: "sk-settings-rotate" } } });
const PUBLISH_PLAINTEXT = JSON.stringify({ url: "https://hook.example/x", token: "pub-rotate-token" });

/** Seed a database whose every encrypted surface was written under K1. */
async function seedDb(path: string): Promise<void> {
  process.env.AGENT_WORLD_ENCRYPTION_KEYS = K1;
  const { openDb } = await fresh<typeof import("./db.js")>("./db.js");
  const db = openDb(path);
  const graph = secretGraph();
  db.saveGraph(graph, 0, "u1");
  db.saveVersion("g1", "v1", JSON.stringify(graph));
  db.saveAutoSnapshot("g1", JSON.stringify(graph), 0, 10);
  db.createRun({ id: "run1", userId: "u1", graph, budgetUsd: null, at: 1, trigger: "manual" });
  db.close();

  const { encryptString } = await fresh<typeof import("./at-rest.js")>("./at-rest.js");
  const raw = new DatabaseSync(path);
  raw
    .prepare(`INSERT INTO settings (user_id, data, updated_at) VALUES (?, ?, ?)`)
    .run("u1", encryptString(SETTINGS_PLAINTEXT), 1);
  raw
    .prepare(
      `INSERT INTO publish_targets (id, user_id, platform, name, provider, config_encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("t1", "u1", "wechat", "n", "webhook", encryptString(PUBLISH_PLAINTEXT), 1);
  raw.close();
}

/** Read one raw cell, bypassing every decrypt helper. */
function rawCell(path: string, sql: string): string {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    const row = raw.prepare(sql).get() as { v: string };
    return row.v;
  } finally {
    raw.close();
  }
}

describe("key rotation re-encryption (design-key-rotation P2)", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-rotate-"));
    path = join(dir, "g.sqlite");
    process.env.DB_FILE = path;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.AGENT_WORLD_ENCRYPTION_KEYS;
    delete process.env.DB_FILE;
  });

  it("converges every surface onto the new primary key with plaintext intact", async () => {
    await seedDb(path);

    // Rotate: K2 is now primary, K1 decrypts only.
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = `${K2},${K1}`;
    const { reencrypt } = await fresh<typeof import("./key-rotation.js")>("./key-rotation.js");
    const report = reencrypt({ dbFile: path });

    expect(report.primaryId).toBe("bbbbbb");
    expect(report.ringIds).toEqual(["bbbbbb", "aaaaaa"]);
    expect(report.residue).toEqual({ v1: 0, oldKeyV2: 0 });

    const byTable = new Map(report.tables.map((t) => [t.table, t]));
    // Before convergence every row carried the old key id; after the run each
    // surface is rewritten onto the primary.
    expect(byTable.get("settings")!.rewritten).toBe(1);
    expect(byTable.get("publish_targets")!.rewritten).toBe(1);
    expect(byTable.get("graphs")!.rewritten).toBe(1);
    expect(byTable.get("graph_versions")!.rewritten).toBe(2); // manual + auto snapshot
    expect(byTable.get("runs")!.rewritten).toBe(1);

    // Raw bytes: 100% enc:v2:bbbbbb: coverage, no old-key residue.
    expect(rawCell(path, `SELECT data AS v FROM settings WHERE user_id = 'u1'`)).toMatch(/^enc:v2:bbbbbb:/);
    expect(rawCell(path, `SELECT config_encrypted AS v FROM publish_targets WHERE id = 't1'`)).toMatch(/^enc:v2:bbbbbb:/);
    for (const sql of [
      `SELECT doc AS v FROM graphs WHERE id = 'g1'`,
      `SELECT snapshot AS v FROM graph_versions WHERE graph_id = 'g1'`,
      `SELECT snapshot AS v FROM runs WHERE id = 'run1'`,
    ]) {
      const text = rawCell(path, sql);
      expect(text).not.toContain("enc:v1:");
      expect(text).not.toContain("enc%3Av1%3A");
      expect(text).toContain("enc:v2:bbbbbb:");
      // URL-sealed ciphertext converged too, in its percent-encoded spelling.
      expect(text).toContain("enc%3Av2%3Abbbbbb%3A");
    }
  });

  it("keeps every secret readable and the content-hash chain intact", async () => {
    await seedDb(path);
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = `${K2},${K1}`;
    const { reencrypt } = await fresh<typeof import("./key-rotation.js")>("./key-rotation.js");
    reencrypt({ dbFile: path });

    const dbMod = await fresh<typeof import("./db.js")>("./db.js");
    const atRest = await fresh<typeof import("./at-rest.js")>("./at-rest.js");
    const db = dbMod.openDb(path);

    const loaded = db.getGraph("g1", "u1")!;
    const nodes = loaded.nodes as unknown as Array<Record<string, any>>;
    expect(loaded.triggers?.[0]?.webhookSecret).toBe(WEBHOOK_SECRET);
    expect(nodes.find((n) => n.id === "aud")!.audioGen.apiKey).toBe(NODE_KEY);
    expect(nodes.find((n) => n.id === "ht")!.http.url).toBe(`https://api.example.com/y?access_token=${URL_TOKEN}&v=2`);
    expect(nodes.find((n) => n.id === "ht")!.http.headers["X-My-Auth"]).toBe("hdr-rotate-token");

    // Hashes are computed on plaintext, so the version panel's "matches what
    // ran" marker survives the re-keying untouched.
    const versionHash = (db.listVersions("g1", "u1") as unknown as Array<{ contentHash: string }>)
      .find((v) => v.contentHash)?.contentHash;
    expect(db.getLatestRunContentHash("g1", "u1")).toBe(versionHash);

    // And the whole-column surfaces still decrypt to the original JSON.
    expect(atRest.decryptString(rawCell(path, `SELECT data AS v FROM settings WHERE user_id = 'u1'`))).toBe(SETTINGS_PLAINTEXT);
    expect(atRest.decryptString(rawCell(path, `SELECT config_encrypted AS v FROM publish_targets WHERE id = 't1'`))).toBe(PUBLISH_PLAINTEXT);
    db.close();
  });

  it("is idempotent — a second run rewrites nothing", async () => {
    await seedDb(path);
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = `${K2},${K1}`;
    const { reencrypt } = await fresh<typeof import("./key-rotation.js")>("./key-rotation.js");
    reencrypt({ dbFile: path });
    const again = reencrypt({ dbFile: path });
    for (const t of again.tables) {
      expect(t.rewritten, t.table).toBe(0);
    }
    expect(again.residue).toEqual({ v1: 0, oldKeyV2: 0 });
  });

  it("fails closed on rows the keyring can no longer decrypt", async () => {
    await seedDb(path);
    // The operator dropped the old key before converging: every old-key row is
    // now undecryptable. The run must abort naming the row, not skip it.
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = K2;
    const { reencrypt } = await fresh<typeof import("./key-rotation.js")>("./key-rotation.js");
    expect(() => reencrypt({ dbFile: path })).toThrow(/settings\.user_id=u1/);

    // The very first surface (settings) aborts before anything is touched.
    expect(rawCell(path, `SELECT data AS v FROM settings WHERE user_id = 'u1'`)).toMatch(/^enc:v2:aaaaaa:/);
  });

  it("dry-run reports what would be rewritten without touching the rows", async () => {
    await seedDb(path);
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = `${K2},${K1}`;
    const { reencrypt } = await fresh<typeof import("./key-rotation.js")>("./key-rotation.js");
    const report = reencrypt({ dbFile: path, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.tables.find((t) => t.table === "settings")!.rewritten).toBe(1);
    // Nothing converged, so the residue census still shows the pre-run state.
    expect(report.residue.oldKeyV2).toBeGreaterThan(0);
    expect(rawCell(path, `SELECT data AS v FROM settings WHERE user_id = 'u1'`)).toMatch(/^enc:v2:aaaaaa:/);
  });

  it("re-encrypts only the requested tables and rejects unknown names", async () => {
    await seedDb(path);
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = `${K2},${K1}`;
    const { reencrypt } = await fresh<typeof import("./key-rotation.js")>("./key-rotation.js");

    const report = reencrypt({ dbFile: path, tables: ["settings"] });
    expect(report.tables.map((t) => t.table)).toEqual(["settings"]);
    expect(rawCell(path, `SELECT data AS v FROM settings WHERE user_id = 'u1'`)).toMatch(/^enc:v2:bbbbbb:/);
    // graphs untouched: still sealed under the old key.
    expect(rawCell(path, `SELECT doc AS v FROM graphs WHERE id = 'g1'`)).toContain("enc:v2:aaaaaa:");

    expect(() => reencrypt({ dbFile: path, tables: ["nope"] })).toThrow(/unknown tables/);
  });

  it("seals legacy plaintext whole-column rows as a bonus", async () => {
    await seedDb(path);
    // A pre-encryption-era settings row that was never re-saved by the app.
    const raw = new DatabaseSync(path);
    raw
      .prepare(`INSERT INTO settings (user_id, data, updated_at) VALUES (?, ?, ?)`)
      .run("u2", `{"providers":{"y":{"apiKey":"sk-legacy-plain"}}}`, 2);
    raw.close();

    process.env.AGENT_WORLD_ENCRYPTION_KEYS = `${K2},${K1}`;
    const { reencrypt } = await fresh<typeof import("./key-rotation.js")>("./key-rotation.js");
    const report = reencrypt({ dbFile: path });
    expect(report.tables.find((t) => t.table === "settings")!.legacyPlaintextSealed).toBe(1);

    const { decryptString } = await fresh<typeof import("./at-rest.js")>("./at-rest.js");
    const sealed = rawCell(path, `SELECT data AS v FROM settings WHERE user_id = 'u2'`);
    expect(sealed).toMatch(/^enc:v2:bbbbbb:/);
    expect(decryptString(sealed)).toBe(`{"providers":{"y":{"apiKey":"sk-legacy-plain"}}}`);
  });
});
