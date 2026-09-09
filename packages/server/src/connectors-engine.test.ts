import { afterAll, describe, expect, it } from "vitest";
import { compile, type ConnectorConfig, type Graph } from "@agent-world/core";
import { execute } from "./engine.js";
import { fakeWorker, type Worker } from "./worker.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const worker = () => fakeWorker({ chunkDelayMs: 0 });
const clock = () => 0;
const dir = mkdtempSync(path.join(tmpdir(), "conn-eng-"));
const textGen = { model: "t", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 };

function makeGraph(connector: ConnectorConfig): Graph {
  return {
    id: "cg",
    name: "cg",
    nodes: [
      { id: "in", kind: "source", name: "IN", x: 0, y: 0, source: { connector } },
      { id: "a", kind: "textGen", name: "A", x: 1, y: 0, textGen },
      { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "in", to: "a", kind: "flow" },
      { id: "e2", from: "a", to: "out", kind: "flow" },
    ],
  };
}

describe("source connector (4B.5)", () => {
  it("pulls file content into the source node output", async () => {
    const f = path.join(dir, "src.txt");
    writeFileSync(f, "FROM FILE CONTENT");
    const g = makeGraph({ type: "file", file: { path: f } });
    const { plan } = compile(g);
    if (!plan) throw new Error("no plan");
    const events: unknown[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan, worker: worker(), budgetUsd: null, now: clock })) {
      events.push(e);
    }
    const src = events.find(
      (e) => (e as { type: string }).type === "node.finished" && (e as { nodeId: string }).nodeId === "in",
    ) as { output: string } | undefined;
    expect(src?.output).toContain("FROM FILE CONTENT");
  });

  it("fails the run with a CONNECTOR error when the connector is unreachable", async () => {
    const g = makeGraph({ type: "http", http: { url: "http://127.0.0.1:1/", method: "GET" } });
    const { plan } = compile(g);
    if (!plan) throw new Error("no plan");
    const events: unknown[] = [];
    for await (const e of execute({
      runId: "r",
      graph: g,
      plan,
      worker: worker(),
      budgetUsd: null,
      now: clock,
      sleep: async () => {},
    })) {
      events.push(e);
    }
    const failed = events.find(
      (e) => (e as { type: string }).type === "node.failed" && (e as { nodeId: string }).nodeId === "in",
    ) as { errorCode?: string } | undefined;
    expect(failed?.errorCode).toBe("CONNECTOR");
  });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Echoes the *interpolated* prompt so a test can assert what `${...}` became. */
function echoPromptWorker(): Worker {
  return {
    async *runTextGen(args) {
      return { output: args.config.prompt, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "" };
    },
    async generateImage() {
      return [];
    },
  } as Worker;
}

/** Runs a graph and returns the interpolated prompt the textGen node saw. */
async function promptOf(
  g: Graph,
  opts: { connectorValues?: Record<string, string> } = {},
): Promise<string> {
  const { plan } = compile(g);
  if (!plan) throw new Error("no plan");
  let out = "";
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan,
    worker: echoPromptWorker(),
    budgetUsd: null,
    now: clock,
    ...(opts.connectorValues ? { connectorValues: opts.connectorValues } : {}),
  })) {
    if (e.type === "node.finished" && e.nodeId === "a") out = e.output ?? "";
  }
  return out;
}

/**
 * design-data-interpolation.md D1/D3: every connector type feeds the structured
 * `data` channel, so any pipeline — template-made or built from blank — can
 * reference its payload through the type's shortcut name.
 */
describe("connector data channel reaches downstream nodes", () => {
  it("file: ${file.content} and ${files[n].content} address one document each", async () => {
    const a = path.join(dir, "doc-1.txt");
    const b = path.join(dir, "doc-2.txt");
    writeFileSync(a, "合同甲");
    writeFileSync(b, "合同乙");
    const g = makeGraph({ type: "file", file: { path: path.join(dir, "doc-*.txt") } });
    g.nodes[1]!.textGen = { ...textGen, prompt: "[${file.name}][${files[1].content}]" };
    expect(await promptOf(g)).toBe("[doc-1.txt][合同乙]");
  });

  it("database: ${row.col} and ${rows[n].col} address query rows", async () => {
    const dbPath = path.join(dir, "eng.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, amount REAL);" +
        "INSERT INTO t (name, amount) VALUES ('alpha', 1.5), ('beta', 2.5);",
    );
    db.close();
    const g = makeGraph({
      type: "database",
      database: { driver: "sqlite", path: dbPath, query: "SELECT * FROM t ORDER BY id" },
    });
    g.nodes[1]!.textGen = { ...textGen, prompt: "[${row.name}][${rows[1].amount}]" };
    expect(await promptOf(g)).toBe("[alpha][2.5]");
  });

  it("form: ${form.field} reads the submitted value by field name", async () => {
    const g = makeGraph({
      type: "form",
      form: { fields: [{ name: "orderId", label: "订单号" }, { name: "note" }] },
    });
    g.nodes[1]!.textGen = { ...textGen, prompt: "[${form.orderId}][${form.note}]" };
    expect(await promptOf(g, { connectorValues: { orderId: "A-1" } })).toBe("[A-1][]");
  });

  it("a source custom field can pull from its own connector data", async () => {
    const f = path.join(dir, "note.txt");
    writeFileSync(f, "正文");
    const g = makeGraph({ type: "file", file: { path: f } });
    g.nodes[0]!.source = {
      ...g.nodes[0]!.source,
      custom: { 来源文件: "${file.name}" },
    };
    g.nodes[1]!.textGen = { ...textGen, prompt: "[${in.custom.来源文件}]" };
    expect(await promptOf(g)).toBe("[note.txt]");
  });

  it("two sources of one type disable the shortcut but keep the node namespace", async () => {
    const f = path.join(dir, "twin.txt");
    writeFileSync(f, "双份");
    const g = makeGraph({ type: "file", file: { path: f } });
    g.nodes.push({
      id: "in2",
      kind: "source",
      name: "IN2",
      x: 0,
      y: 1,
      source: { connector: { type: "file", file: { path: f } } },
    });
    g.edges.push({ id: "e3", from: "in2", to: "a", kind: "flow" });
    g.nodes[1]!.textGen = { ...textGen, prompt: "[${file.name}][${in.data[0].name}]" };
    expect(await promptOf(g)).toBe("[][twin.txt]");
  });
});
