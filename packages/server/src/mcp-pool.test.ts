import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeAllUserMcpServers,
  connectUserMcpServer,
  ensureUserMcpServers,
  userMcpSkills,
  userMcpStatus,
} from "./mcp-pool.js";
import type { UserMcpServer } from "./config.js";

/** Minimal streamable-HTTP MCP server exposing one `echo` tool. */
function startServer(): Promise<{ url: string; close: () => void; requests: Record<string, string>[] }> {
  const requests: Record<string, string>[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 404;
        res.end();
        return;
      }
      requests.push(req.headers as Record<string, string>);
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw) as { id?: unknown; method?: string };
        const result =
          body.method === "initialize"
            ? { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "t", version: "1" } }
            : body.method === "tools/list"
              ? { tools: [{ name: "echo", description: "echo back" }] }
              : { content: [{ type: "text", text: '{"ok":true}' }] };
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      });
    });
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://localhost:${port}/mcp`, close: () => server.close(), requests });
    });
  });
}

function serverCfg(url: string, over: Partial<UserMcpServer> = {}): UserMcpServer {
  return { id: "s1", transport: "http", url, enabled: true, ...over };
}

afterEach(() => closeAllUserMcpServers());

describe("connectUserMcpServer", () => {
  it("discovers tools and reports them for the settings UI", async () => {
    const srv = await startServer();
    try {
      const status = await connectUserMcpServer("alice", serverCfg(srv.url));
      expect(status.connected).toBe(true);
      expect(status.toolCount).toBe(1);
      expect(status.toolNames).toEqual(["echo"]);
      expect(status.error).toBeUndefined();
    } finally {
      srv.close();
    }
  });

  it("reports a failure as a status instead of throwing", async () => {
    const status = await connectUserMcpServer("alice", serverCfg("http://127.0.0.1:1/mcp"));
    expect(status.connected).toBe(false);
    expect(status.toolCount).toBe(0);
    expect(status.error).toBeTruthy();
    // The failed server is still listed, so the UI can show why.
    expect(userMcpStatus("alice")).toHaveLength(1);
  });

  it("sends the configured auth headers to the remote server", async () => {
    const srv = await startServer();
    try {
      await connectUserMcpServer("alice", serverCfg(srv.url, { headers: { Authorization: "Bearer tok" } }));
      expect(srv.requests[0]?.authorization).toBe("Bearer tok");
    } finally {
      srv.close();
    }
  });
});

describe("per-user isolation", () => {
  it("keeps one user's remote tools out of another user's map", async () => {
    const srv = await startServer();
    try {
      await connectUserMcpServer("alice", serverCfg(srv.url));
      expect([...userMcpSkills("alice").keys()]).toEqual(["mcp:s1:echo"]);
      expect(userMcpSkills("bob").size).toBe(0);
      expect(userMcpStatus("bob")).toEqual([]);
    } finally {
      srv.close();
    }
  });

  it("lets two users hold the same server id against different endpoints", async () => {
    const a = await startServer();
    const b = await startServer();
    try {
      await connectUserMcpServer("alice", serverCfg(a.url));
      await connectUserMcpServer("bob", serverCfg(b.url));
      expect(userMcpStatus("alice")[0].url).toBe(a.url);
      expect(userMcpStatus("bob")[0].url).toBe(b.url);
    } finally {
      a.close();
      b.close();
    }
  });
});

describe("ensureUserMcpServers", () => {
  it("reuses a live connection instead of re-handshaking", async () => {
    const srv = await startServer();
    try {
      await ensureUserMcpServers("alice", [serverCfg(srv.url)]);
      const before = srv.requests.length;
      await ensureUserMcpServers("alice", [serverCfg(srv.url)]);
      expect(srv.requests.length).toBe(before);
    } finally {
      srv.close();
    }
  });

  it("reconnects when the user edits the endpoint", async () => {
    const a = await startServer();
    const b = await startServer();
    try {
      await ensureUserMcpServers("alice", [serverCfg(a.url)]);
      await ensureUserMcpServers("alice", [serverCfg(b.url)]);
      expect(userMcpStatus("alice")[0].url).toBe(b.url);
      expect(b.requests.length).toBeGreaterThan(0);
    } finally {
      a.close();
      b.close();
    }
  });

  it("drops a server the user removed or disabled", async () => {
    const srv = await startServer();
    try {
      await ensureUserMcpServers("alice", [serverCfg(srv.url)]);
      await ensureUserMcpServers("alice", [serverCfg(srv.url, { enabled: false })]);
      expect(userMcpStatus("alice")).toEqual([]);
      expect(userMcpSkills("alice").size).toBe(0);
      await ensureUserMcpServers("alice", [serverCfg(srv.url)]);
      await ensureUserMcpServers("alice", []);
      expect(userMcpStatus("alice")).toEqual([]);
    } finally {
      srv.close();
    }
  });
});

describe("closeAllUserMcpServers", () => {
  it("releases every pooled transport", async () => {
    const srv = await startServer();
    try {
      await connectUserMcpServer("alice", serverCfg(srv.url));
      await connectUserMcpServer("bob", serverCfg(srv.url));
      closeAllUserMcpServers();
      expect(userMcpStatus("alice")).toEqual([]);
      expect(userMcpStatus("bob")).toEqual([]);
    } finally {
      srv.close();
    }
  });
});
