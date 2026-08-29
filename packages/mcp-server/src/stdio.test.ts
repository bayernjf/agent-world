import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";

/**
 * End-to-end stdio smoke test: spawn the real CLI as a subprocess (the way
 * Claude Desktop / Cursor would) and drive a JSON-RPC conversation over
 * newline-delimited stdin/stdout. No upstream agent-world server is needed —
 * initialize / ping / tools/list never touch the network.
 */

const PKG_ROOT = join(import.meta.dirname, "..");
// tsx is a root devDependency; pnpm's strict node_modules means
// `node --import tsx` cannot resolve it from the package dir.
const TSX_BIN = join(PKG_ROOT, "..", "..", "node_modules", ".bin", "tsx");

let child: ChildProcessWithoutNullStreams | undefined;

function startCli(): ChildProcessWithoutNullStreams {
  const c = spawn(TSX_BIN, ["src/index.ts"], {
    cwd: PKG_ROOT,
    env: {
      ...process.env,
      AGENT_WORLD_MCP_TRANSPORT: "stdio",
      // Point at a dead port on purpose: nothing in this conversation
      // should reach the upstream server.
      AGENT_WORLD_URL: "http://127.0.0.1:9",
      AGENT_WORLD_TOKEN: "test-token",
    },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  child = c;
  return c;
}

interface Reply {
  id: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function converse(
  c: ChildProcessWithoutNullStreams,
  lines: string[],
  want: number,
): Promise<Reply[]> {
  const replies: Reply[] = [];
  let buf = "";
  const done = new Promise<Reply[]>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout; got ${replies.length}/${want}: ${buf.slice(0, 500)}`)),
      15000,
    );
    c.stdout.setEncoding("utf8");
    c.stdout.on("data", (chunk: string) => {
      buf += chunk;
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl === -1) break;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        replies.push(JSON.parse(line) as Reply);
        if (replies.length >= want) {
          clearTimeout(timer);
          resolve(replies);
        }
      }
    });
    c.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`CLI exited early code=${code} signal=${signal}`));
    });
  });
  for (const line of lines) c.stdin.write(`${line}\n`);
  c.stdin.end();
  return done;
}

afterEach(() => {
  child?.kill("SIGKILL");
  child = undefined;
});

describe("stdio transport (end-to-end CLI smoke)", () => {
  it("answers initialize -> tools/list -> ping over newline-delimited JSON", async () => {
    const c = startCli();
    const replies = await converse(
      c,
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }),
      ],
      3,
    );
    const byId = new Map(replies.map((r) => [r.id, r]));
    const init = byId.get(1);
    expect(init?.result?.serverInfo).toEqual({ name: "agent-world", version: expect.any(String) });
    const list = byId.get(2);
    const tools = (list?.result?.tools ?? []) as Array<{ name: string }>;
    expect(tools.length).toBeGreaterThan(10);
    expect(tools.map((t) => t.name)).toContain("run_graph");
    expect(byId.get(3)?.result).toEqual({});
  });

  it("survives a parse error and keeps serving the next line", async () => {
    const c = startCli();
    const replies = await converse(
      c,
      ["this is not json", JSON.stringify({ jsonrpc: "2.0", id: "after-error", method: "ping" })],
      2,
    );
    expect(replies[0].error?.code).toBe(-32700);
    expect(replies[1].id).toBe("after-error");
    expect(replies[1].result).toEqual({});
  });

  it("round-trips multibyte string ids without framing corruption", async () => {
    const c = startCli();
    const replies = await converse(
      c,
      [JSON.stringify({ jsonrpc: "2.0", id: "\u4e2d\u6587\u6807\u8bc6-\ud83d\ude80", method: "ping" })],
      1,
    );
    expect(replies[0].id).toBe("\u4e2d\u6587\u6807\u8bc6-\ud83d\ude80");
    expect(replies[0].result).toEqual({});
  });
});
