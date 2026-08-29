import { compile, replay, type Graph } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function graph(code: NonNullable<Graph["nodes"][number]["code"]>): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "calc", kind: "code", name: "CALC", x: 1, y: 0, code },
      { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "calc", kind: "flow" },
      { id: "e2", from: "calc", to: "out", kind: "flow" },
    ],
  };
}

async function collect(g: Graph, input?: string) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    now: () => 0,
    input,
  })) {
    events.push(e);
  }
  return events;
}

describe("code node (javascript)", () => {
  it("runs a script that reads stdin JSON and emits a json artifact", async () => {
    const script = [
      "const fs = require('fs');",
      "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
      "const n = Number(input.inputs.src);",
      "console.log(JSON.stringify({ doubled: n * 2 }));",
    ].join("\n");
    const events = await collect(graph({ language: "javascript", code: script, timeoutMs: 10000 }), "21");

    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
    expect(finished).toBeTruthy();
    expect(finished.output).toBe(JSON.stringify({ doubled: 42 }, null, 2));

    const arti = events.find((e) => e.type === "artifact.produced" && e.nodeId === "calc")?.artifact;
    expect(arti?.kind).toBe("json");
    expect(replay(events).status).toBe("done");
  });

  it("turns plain stdout into a text artifact", async () => {
    const script = [
      "const fs = require('fs');",
      "JSON.parse(fs.readFileSync(0, 'utf8'));",
      "console.log('hello from script');",
    ].join("\n");
    const events = await collect(graph({ language: "javascript", code: script, timeoutMs: 10000 }), "x");

    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
    expect(finished.output).toBe("hello from script");
    const arti = events.find((e) => e.type === "artifact.produced" && e.nodeId === "calc")?.artifact;
    expect(arti?.kind).toBe("text");
    expect(replay(events).status).toBe("done");
  });

  it("fails the node on non-zero exit code", async () => {
    const events = await collect(
      graph({ language: "javascript", code: "throw new Error('boom');", timeoutMs: 10000 }),
      "x",
    );

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "calc");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("PROVIDER_ERROR");
    expect(replay(events).status).toBe("failed");
  });

  it("kills a script that exceeds the timeout", async () => {
    const events = await collect(
      graph({ language: "javascript", code: "setTimeout(() => {}, 5000);", timeoutMs: 1000 }),
      "x",
    );

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "calc");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("TIMEOUT");
  });

  it("does not leak server env vars into the script (P0)", async () => {
    process.env.AW_TEST_SECRET = "super-secret";
    try {
      const script = [
        "const fs = require('fs');",
        "JSON.parse(fs.readFileSync(0, 'utf8'));",
        "console.log(process.env.AW_TEST_SECRET === undefined ? 'no-leak' : 'leaked');",
      ].join("\n");
      const events = await collect(graph({ language: "javascript", code: script, timeoutMs: 10000 }), "x");
      const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
      expect(finished.output).toBe("no-leak");
    } finally {
      delete process.env.AW_TEST_SECRET;
    }
  });

  it("runs in an isolated working directory (P0)", async () => {
    const script = [
      "const fs = require('fs');",
      "JSON.parse(fs.readFileSync(0, 'utf8'));",
      "console.log(process.cwd());",
    ].join("\n");
    const events = await collect(graph({ language: "javascript", code: script, timeoutMs: 10000 }), "x");
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
    expect(finished.output).toContain("aw-code-");
  });
});

/* ---------------- P1 sandbox: rlimit + Node permission ---------------- */

describe("code node sandbox P1", () => {
  it("denies JS fs.read outside the temp workdir", async () => {
    // /etc/passwd is a readable-but-outside-workdir target. P1's Node
    // --experimental-permission with --allow-fs-read=<workdir> must block it.
    const script = [
      "const fs = require('fs');",
      "fs.readFileSync(0, 'utf8');", // drain stdin first
      "try {",
      "  fs.readFileSync('/etc/passwd');",
      "  console.log('UNEXPECTED-ALLOW');",
      "} catch (e) {",
      "  console.log(e && e.code === 'ERR_ACCESS_DENIED' ? 'BLOCKED' : 'OTHER-ERR:'+e.code);",
      "}",
    ].join("\n");
    const events = await collect(graph({ language: "javascript", code: script, timeoutMs: 15000 }), "x");
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
    expect(finished?.output ?? "no-finished").toBe("BLOCKED");
  });

  it("denies JS child_process spawning (--allow-child-process absent)", async () => {
    // Node's permission gate (stable form, --permission) controls fs and
    // addon/child-process/worker creation. NETWORK-level permissions were
    // removed from the stable model in Node 24; network gating for JS
    // requires OS-level backends (P2). Honest boundary documented in
    // docs/design-code-sandbox.md §7.
    const script = [
      "require('fs').readFileSync(0, 'utf8');",
      "try {",
      "  const r = require('child_process').spawnSync(process.execPath, ['-e','console.log(1)'], {encoding:'utf8', timeout:2000});",
      "  console.log('LEAKED?:'+String((r.stdout||'').trim()));",
      "} catch (e) {",
      "  console.log(e.code === 'ERR_ACCESS_DENIED' ? 'BLOCKED-CHILD' : 'OTHER-CHILD-ERR:'+e.code);",
      "}",
    ].join("\n");
    const events = await collect(graph({ language: "javascript", code: script, timeoutMs: 12000 }), "x");
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "calc");
    // Child spawning must not silently succeed. Either the script exits with
    // an explicit BLOCKED-CHILD marker or the engine reports failure.
    const outcome = finished?.output ?? `failed:${failed?.errorCode ?? 'none'}`;
    const ok =
      finished?.output === "BLOCKED-CHILD" ||
      (failed && (failed.errorCode === "PROVIDER_ERROR" || failed.errorCode === "VALIDATION"));
    expect(ok).withContext(`outcome=${JSON.stringify(outcome)}`).toBe(true);
  });

  it("lets JS fs.read/write inside the temp workdir", async () => {
    // --allow-fs-{read,write}=<workdir> must still permit local files; this
    // keeps real user scripts usable inside their sandbox.
    const script = [
      "const fs = require('fs');",
      "fs.readFileSync(0, 'utf8');",
      "fs.writeFileSync('./local.txt', 'hello-local');",
      "const out = fs.readFileSync('./local.txt', 'utf8');",
      "console.log(out);",
    ].join("\n");
    const events = await collect(graph({ language: "javascript", code: script, timeoutMs: 15000 }), "x");
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
    expect(finished?.output).toBe("hello-local");
  });

  it("RLIMIT_NPROC stops a trivial fork bomb from runaway spawning", async () => {
    // Spawning children via child_process recursively is the common JS fork
    // bomb shape. RLIMIT_NPROC (ulimit -u) should make the 2nd/3rd fork fail
    // fast with non-zero exit (and the engine reports PROVIDER_ERROR).
    // Keep maxProcs tiny (5) via env override so the bomb dies quickly.
    const prev = process.env.CODE_LIMIT_MAX_PROCS;
    process.env.CODE_LIMIT_MAX_PROCS = "5";
    try {
      const script = [
        "const { spawnSync } = require('child_process');",
        "require('fs').readFileSync(0, 'utf8');",
        "let tries = 0;",
        "for (let i = 0; i < 40; i++) {",
        "  const r = spawnSync(process.execPath, ['-e', 'while(true){}'], { timeout: 300 });",
        "  if (r.status !== null) tries++; else { process.exit(5); }",
        "}",
        "console.log('forks-succeeded:' + tries);",
      ].join("\n");
      const events = await collect(
        graph({ language: "javascript", code: script, timeoutMs: 20000 }),
        "x",
      );
      const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
      const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "calc");
      // Either we complete cleanly but with a cap on actual spawns, or the
      // bomb fails hard (non-zero exit) — both mean we didn't silently
      // create 40 processes that could starve the host.
      if (finished) {
        const m = /forks-succeeded:(\d+)/.exec(finished.output);
        const ok = m ? Number(m[1]) <= 8 : false; // well below 40, capped
        expect(ok).withContext(`output=${finished.output}`).toBe(true);
      } else {
        expect(failed).toBeTruthy();
        expect(failed?.errorCode).toBe("PROVIDER_ERROR");
      }
    } finally {
      if (prev === undefined) delete process.env.CODE_LIMIT_MAX_PROCS;
      else process.env.CODE_LIMIT_MAX_PROCS = prev;
    }
  });

  it("applies CODE_LIMIT_CPU_SEC and fails infinite JS loops before timeoutMs", async () => {
    // RLIMIT_CPU kills the process via SIGXCPU after the limit in seconds of
    // CPU time. 1s of CPU is enough to be deterministic and still way
    // faster than the script's 12s wall-time timeout → reports PROVIDER_ERROR,
    // not TIMEOUT.
    const prev = process.env.CODE_LIMIT_CPU_SEC;
    process.env.CODE_LIMIT_CPU_SEC = "1";
    try {
      const t0 = Date.now();
      const events = await collect(
        graph({
          language: "javascript",
          code: "require('fs').readFileSync(0,'utf8'); while(true) {}",
          timeoutMs: 12000,
        }),
        "x",
      );
      const elapsed = Date.now() - t0;
      const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "calc");
      expect(failed).withContext("expected SIGXCPU → non-zero exit → node.failed").toBeTruthy();
      expect(failed?.errorCode).toBe("PROVIDER_ERROR");
      // Expect << 12s. Give 7s headroom for slow CI.
      expect(elapsed).withContext(`elapsed=${elapsed}ms, should finish < 8s`).toBeLessThan(8000);
    } finally {
      if (prev === undefined) delete process.env.CODE_LIMIT_CPU_SEC;
      else process.env.CODE_LIMIT_CPU_SEC = prev;
    }
  }, 15000);
});
