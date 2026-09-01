import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(failed.errorCode).toBe("SCRIPT_ERROR");
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
        expect(failed?.errorCode).toBe("SCRIPT_ERROR");
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
      expect(failed?.errorCode).toBe("SCRIPT_ERROR");
      // Expect << 12s. Give 7s headroom for slow CI.
      expect(elapsed).withContext(`elapsed=${elapsed}ms, should finish < 8s`).toBeLessThan(8000);
    } finally {
      if (prev === undefined) delete process.env.CODE_LIMIT_CPU_SEC;
      else process.env.CODE_LIMIT_CPU_SEC = prev;
    }
  }, 15000);
});

describe("code node fs/net policy", () => {
  it("fs: allowlist grants READ access to TOOL_FS_ALLOW prefixes (writes stay workdir-only)", async () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "aw-fsallow-"));
    const secret = join(dir, "note.txt");
    writeFileSync(secret, "allowed-content");
    try {
      process.env.TOOL_FS_ALLOW = dir;
      const script = [
        "const fs = require('fs');",
        "const path = process.env.AW_TEST_FILE;",
        "console.log(JSON.stringify({ content: fs.readFileSync(path, 'utf8') }));",
      ].join("\n");
      // Pass the file path via the script itself (env is trimmed).
      const inlined = script.replace("process.env.AW_TEST_FILE", JSON.stringify(secret));
      const events = await collect(
        graph({ language: "javascript", code: inlined, timeoutMs: 10000, fs: "allowlist" }),
        "x",
      );
      const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
      expect(finished).toBeTruthy();
      expect(finished.output).toBe(JSON.stringify({ content: "allowed-content" }, null, 2));
      expect(replay(events).status).toBe("done");
    } finally {
      delete process.env.TOOL_FS_ALLOW;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fs: allowlist still denies reads outside the allowlist", async () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "aw-fsdeny-"));
    try {
      process.env.TOOL_FS_ALLOW = dir;
      // /etc/hosts is outside workdir AND outside the allowlist.
      const script = [
        "const fs = require('fs');",
        "console.log(JSON.stringify({ leaked: fs.readFileSync('/etc/hosts', 'utf8').slice(0, 20) }));",
      ].join("\n");
      const events = await collect(
        graph({ language: "javascript", code: script, timeoutMs: 10000, fs: "allowlist" }),
        "x",
      );
      const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "calc");
      expect(failed).toBeTruthy();
      expect(replay(events).status).toBe("failed");
    } finally {
      delete process.env.TOOL_FS_ALLOW;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("net: allowlist without TOOL_NETWORK_ALLOW fails validation honestly", async () => {
    const saved = process.env.TOOL_NETWORK_ALLOW;
    delete process.env.TOOL_NETWORK_ALLOW;
    try {
      const events = await collect(
        graph({ language: "javascript", code: "console.log('never runs');", timeoutMs: 10000, net: "allowlist" }),
        "x",
      );
      const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "calc");
      expect(failed.errorCode).toBe("VALIDATION");
      expect(failed.error).toContain("TOOL_NETWORK_ALLOW");
    } finally {
      if (saved === undefined) delete process.env.TOOL_NETWORK_ALLOW;
      else process.env.TOOL_NETWORK_ALLOW = saved;
    }
  });

  it("net: allowlist routes python egress through the validating proxy", { timeout: 30000 }, async () => {
    const { createServer } = await import("node:http");
    const target = createServer((q, s) => {
      s.writeHead(200, { "content-type": "text/plain" });
      s.end("pong");
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", () => r()));
    const targetPort = (target.address() as { port: number }).port;
    const savedAllow = process.env.TOOL_NETWORK_ALLOW;
    const savedPrivate = process.env.ALLOW_PRIVATE_NETWORK;
    const savedPorts = process.env.TOOL_NETWORK_EXTRA_PORTS;
    process.env.TOOL_NETWORK_ALLOW = "localhost";
    process.env.ALLOW_PRIVATE_NETWORK = "1"; // 目标是回环地址，与 LAN 部署同款放宽
    process.env.TOOL_NETWORK_EXTRA_PORTS = String(targetPort); // audit L4: 代理默认仅 80/443，放行本测试的临时端口
    try {
      const code = [
        "import urllib.request",
        `body = urllib.request.urlopen("http://localhost:${targetPort}/ping", timeout=10).read().decode()`,
        "print(body)",
      ].join("\n");
      const events = await collect(
        graph({ language: "python", code, timeoutMs: 20000, net: "allowlist" }),
        "x",
      );
      const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
      expect(finished).toBeTruthy();
      expect(finished.output.trim()).toBe("pong");
    } finally {
      if (savedAllow === undefined) delete process.env.TOOL_NETWORK_ALLOW;
      else process.env.TOOL_NETWORK_ALLOW = savedAllow;
      if (savedPrivate === undefined) delete process.env.ALLOW_PRIVATE_NETWORK;
      else process.env.ALLOW_PRIVATE_NETWORK = savedPrivate;
      if (savedPorts === undefined) delete process.env.TOOL_NETWORK_EXTRA_PORTS;
      else process.env.TOOL_NETWORK_EXTRA_PORTS = savedPorts;
      target.close();
    }
  });

  it("net: allowlist blocks hosts outside TOOL_NETWORK_ALLOW via the proxy", { timeout: 30000 }, async () => {
    const savedAllow = process.env.TOOL_NETWORK_ALLOW;
    const savedPrivate = process.env.ALLOW_PRIVATE_NETWORK;
    // 白名单只放行 example.com；目标 localhost 不在其中 → 代理返回 403
    process.env.TOOL_NETWORK_ALLOW = "example.com";
    process.env.ALLOW_PRIVATE_NETWORK = "1";
    try {
      const code = [
        "import urllib.request",
        "try:",
        '    urllib.request.urlopen("http://localhost:1/ping", timeout=10).read()',
        "    print('unexpected-success')",
        "except Exception as e:",
        "    print('blocked:' + str(e.code) if hasattr(e, 'code') else 'blocked')",
      ].join("\n");
      const events = await collect(
        graph({ language: "python", code, timeoutMs: 20000, net: "allowlist" }),
        "x",
      );
      const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
      expect(finished).toBeTruthy();
      expect(finished.output).toContain("blocked:403");
    } finally {
      if (savedAllow === undefined) delete process.env.TOOL_NETWORK_ALLOW;
      else process.env.TOOL_NETWORK_ALLOW = savedAllow;
      if (savedPrivate === undefined) delete process.env.ALLOW_PRIVATE_NETWORK;
      else process.env.ALLOW_PRIVATE_NETWORK = savedPrivate;
    }
  });

  it("一个连沙箱都准备不出来的 code 节点仍然留下 node.failed", async () => {
    // CI flaky 的那一类：code 节点的子进程压根没起来时，异常会从 runNode 裸抛到
    // `void runNode(...)` 上——一个 unhandled rejection，节点永久停在 "running"，
    // 事件流里既没有 node.finished 也没有 node.failed，红起来的 CI 说不出原因。
    // 指向一个不存在的 TMPDIR，可以让 workdir 创建稳定失败，不必依赖负载时序。
    const savedTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = join(tmpdir(), `aw-no-such-tmp-${Date.now()}`);
    try {
      const events = await collect(
        graph({ language: "javascript", code: "console.log('never runs');", timeoutMs: 10000 }),
        "x",
      );
      const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "calc");
      expect(failed).toBeTruthy();
      expect(failed.error).toContain("节点执行异常");
      expect(failed.errorCode).toBe("UNKNOWN");
      expect(events.some((e) => e.type === "node.finished" && e.nodeId === "calc")).toBe(false);
      expect(replay(events).status).toBe("failed");
    } finally {
      if (savedTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmpdir;
    }
  });
});
