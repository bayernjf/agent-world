import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest } from "node:http";
import type { RequestListener } from "node:http";
import { createServer as netCreateServer, connect as netConnect } from "node:net";
import type { AddressInfo, Socket } from "node:net";
import {
  childProxyEnv,
  closeCodeProxy,
  getCodeProxyUrl,
  registerNetToken,
  resolveConnectAddress,
  unregisterNetToken,
} from "./code-proxy.js";

/* 所有走代理的请求都打本地回环目标，因此需要 ALLOW_PRIVATE_NETWORK=1
 * （与 LAN 部署同款放宽开关）；个别用例显式关掉以验证内网拒绝。 */
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env.ALLOW_PRIVATE_NETWORK;
  process.env.ALLOW_PRIVATE_NETWORK = "1";
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.ALLOW_PRIVATE_NETWORK;
  else process.env.ALLOW_PRIVATE_NETWORK = savedEnv;
});

afterAll(async () => {
  await closeCodeProxy();
});

function listen(handler: RequestListener): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

interface ProxyResponse {
  status: number;
  body: string;
}

/** 以正向代理客户端身份发一条明文 HTTP 请求（Bearer 认证）。 */
function proxyGet(proxyPort: number, targetUrl: string, auth: string): Promise<ProxyResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const req = httpRequest({
      host: "127.0.0.1",
      port: proxyPort,
      method: "GET",
      path: targetUrl,
      headers: {
        host: target.host,
        "proxy-authorization": auth,
      },
    });
    req.setTimeout(10_000, () => req.destroy(new Error("proxy request timeout")));
    req.on("response", (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function proxyPort(): Promise<number> {
  const url = await getCodeProxyUrl();
  return Number(new URL(url).port);
}

describe("code-proxy token registry", () => {
  it("revokes access once the token is unregistered", async () => {
    const { server, port } = await listen((_q, s) => s.end("pong"));
    try {
      const token = registerNetToken({
        runId: "r1",
        nodeId: "n1",
        allowlist: ["localhost"],
        extraConnectPorts: [port],
      });
      const p = await proxyPort();
      const ok = await proxyGet(p, `http://localhost:${port}/ping`, `Bearer ${token}`);
      expect(ok.status).toBe(200);
      expect(ok.body).toBe("pong");
      unregisterNetToken(token);
      const denied = await proxyGet(p, `http://localhost:${port}/ping`, `Bearer ${token}`);
      expect(denied.status).toBe(407);
    } finally {
      await close(server);
    }
  });

  it("isolates allowlists across runs (cross-token isolation)", async () => {
    const { server, port } = await listen((_q, s) => s.end("pong"));
    try {
      const tLocal = registerNetToken({
        runId: "rA",
        nodeId: "n1",
        allowlist: ["localhost"],
        extraConnectPorts: [port],
      });
      const tOther = registerNetToken({ runId: "rB", nodeId: "n1", allowlist: ["example.com"] });
      const p = await proxyPort();
      const viaA = await proxyGet(p, `http://localhost:${port}/x`, `Bearer ${tLocal}`);
      const viaB = await proxyGet(p, `http://localhost:${port}/x`, `Bearer ${tOther}`);
      expect(viaA.status).toBe(200);
      expect(viaB.status).toBe(403);
    } finally {
      await close(server);
    }
  });
});

describe("code-proxy HTTP forward", () => {
  it("forwards an allowed request and preserves method/path/host", async () => {
    const seen: { method?: string; url?: string; host?: string[] } = {};
    const { server, port } = await listen((q, s) => {
      seen.method = q.method;
      seen.url = q.url;
      seen.host = q.headers.host;
      s.writeHead(200, { "content-type": "text/plain" });
      s.end("pong");
    });
    try {
      const token = registerNetToken({
        runId: "r1",
        nodeId: "n1",
        allowlist: ["localhost"],
        extraConnectPorts: [port],
      });
      const p = await proxyPort();
      const r = await proxyGet(p, `http://localhost:${port}/ping?a=1`, `Bearer ${token}`);
      expect(r.status).toBe(200);
      expect(r.body).toBe("pong");
      expect(seen.method).toBe("GET");
      expect(seen.url).toBe("/ping?a=1");
      expect(seen.host).toBe(`localhost:${port}`);
    } finally {
      await close(server);
    }
  });

  it("accepts the Basic credentials real clients derive from the proxy URL", async () => {
    const { server, port } = await listen((_q, s) => s.end("pong"));
    try {
      const token = registerNetToken({
        runId: "r1",
        nodeId: "n1",
        allowlist: ["localhost"],
        extraConnectPorts: [port],
      });
      const basic = Buffer.from(`aw:${token}`).toString("base64");
      const p = await proxyPort();
      const r = await proxyGet(p, `http://localhost:${port}/ping`, `Basic ${basic}`);
      expect(r.status).toBe(200);
    } finally {
      await close(server);
    }
  });

  it("denies hosts outside the run's allowlist with 403", async () => {
    const { server, port } = await listen((_q, s) => s.end("pong"));
    try {
      const token = registerNetToken({ runId: "r1", nodeId: "n1", allowlist: ["example.com"] });
      const p = await proxyPort();
      const r = await proxyGet(p, `http://localhost:${port}/x`, `Bearer ${token}`);
      expect(r.status).toBe(403);
      expect(r.body).toContain("not in this run's network allowlist");
    } finally {
      await close(server);
    }
  });

  it("denies plaintext forwards to ports outside the granted set (audit L4)", async () => {
    const { server, port } = await listen((_q, s) => s.end("pong"));
    try {
      // allowlist matches the host, but no extraConnectPorts: the random high
      // port must still be refused just like a non-80/443 CONNECT target.
      const token = registerNetToken({ runId: "r1", nodeId: "n1", allowlist: ["localhost"] });
      const p = await proxyPort();
      const r = await proxyGet(p, `http://localhost:${port}/x`, `Bearer ${token}`);
      expect(r.status).toBe(403);
      expect(r.body).toContain("not allowed through the proxy");
    } finally {
      await close(server);
    }
  });

  it("rejects requests without valid credentials with 407", async () => {
    const { server, port } = await listen((_q, s) => s.end("pong"));
    try {
      const p = await proxyPort();
      const bogus = await proxyGet(p, `http://localhost:${port}/x`, "Bearer nonexistent-token");
      expect(bogus.status).toBe(407);
    } finally {
      await close(server);
    }
  });

  it("denies internal addresses when ALLOW_PRIVATE_NETWORK is off", async () => {
    delete process.env.ALLOW_PRIVATE_NETWORK;
    const { server, port } = await listen((_q, s) => s.end("pong"));
    try {
      const token = registerNetToken({
        runId: "r1",
        nodeId: "n1",
        allowlist: ["127.0.0.1"],
        extraConnectPorts: [port],
      });
      const p = await proxyPort();
      const r = await proxyGet(p, `http://127.0.0.1:${port}/x`, `Bearer ${token}`);
      expect(r.status).toBe(403);
      expect(r.body).toContain("internal/unresolvable");
    } finally {
      await close(server);
    }
  });
});

describe("code-proxy CONNECT tunnel", () => {
  function connectOnce(
    p: number,
    target: string,
    auth: string,
  ): Promise<{ head: string; socket: Socket; rest: Buffer }> {
    return new Promise((resolve, reject) => {
      const socket = netConnect(p, "127.0.0.1", () => {
        socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${auth}\r\n\r\n`);
      });
      socket.setTimeout(10_000, () => socket.destroy(new Error("connect timeout")));
      let buf = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        const idx = buf.indexOf("\r\n\r\n");
        if (idx !== -1) {
          socket.off("data", onData);
          resolve({ head: buf.subarray(0, idx).toString("utf8"), socket, rest: buf.subarray(idx + 4) });
        }
      };
      socket.on("data", onData);
      socket.on("error", reject);
    });
  }

  it("tunnels raw bytes after host+port validation", { timeout: 15_000 }, async () => {
    // TCP echo server（非 80/443 端口：经 extraConnectPorts 放行，验证隧道本体）
    const echoSrv = netCreateServer((s) => {
      s.on("data", (d) => s.write(d));
    });
    await new Promise<void>((r) => echoSrv.listen(0, "127.0.0.1", () => r()));
    const echoPort = (echoSrv.address() as AddressInfo).port;
    try {
      const token = registerNetToken({
        runId: "r1",
        nodeId: "n1",
        allowlist: ["localhost"],
        extraConnectPorts: [echoPort],
      });
      const p = await proxyPort();
      const { head, socket } = await connectOnce(p, `localhost:${echoPort}`, `Bearer ${token}`);
      expect(head).toContain("200");
      const echoed = await new Promise<string>((resolve, reject) => {
        socket.setTimeout(5000, () => reject(new Error("echo timeout")));
        const chunks: Buffer[] = [];
        socket.on("data", (c) => {
          chunks.push(c);
          if (Buffer.concat(chunks).toString("utf8") === "echo-me") resolve("echo-me");
        });
        socket.on("error", reject);
        socket.write("echo-me");
      });
      expect(echoed).toBe("echo-me");
      socket.destroy();
    } finally {
      echoSrv.close();
    }
  });

  it("denies CONNECT to ports outside the granted set", async () => {
    const token = registerNetToken({ runId: "r1", nodeId: "n1", allowlist: ["localhost"] });
    const p = await proxyPort();
    const { head, socket } = await connectOnce(p, "localhost:8080", `Bearer ${token}`);
    expect(head).toContain("403");
    socket.destroy();
  });

  it("denies CONNECT without a valid token", async () => {
    const p = await proxyPort();
    const { head, socket } = await connectOnce(p, "localhost:443", "Bearer bogus");
    expect(head).toContain("407");
    socket.destroy();
  });
});

describe("resolveConnectAddress", () => {
  beforeEach(() => {
    delete process.env.ALLOW_PRIVATE_NETWORK;
  });

  it("pins and validates resolved addresses (rebinding-immune)", async () => {
    expect(await resolveConnectAddress("127.0.0.1")).toBeNull();
    expect(await resolveConnectAddress("192.168.1.1")).toBeNull();
    expect(await resolveConnectAddress("10.0.0.1")).toBeNull();
    expect(await resolveConnectAddress("::1")).toBeNull();
    // localhost 解析到回环 → 拒绝；公网 IP 原样返回（校验与连接同一地址）
    expect(await resolveConnectAddress("localhost")).toBeNull();
    expect(await resolveConnectAddress("8.8.8.8")).toBe("8.8.8.8");
    // 不可解析域名 → fail closed
    expect(await resolveConnectAddress("nonexistent.invalid")).toBeNull();
  });

  it("skips the internal check when ALLOW_PRIVATE_NETWORK is set", async () => {
    process.env.ALLOW_PRIVATE_NETWORK = "1";
    expect(await resolveConnectAddress("localhost")).toBe("localhost");
    expect(await resolveConnectAddress("127.0.0.1")).toBe("127.0.0.1");
  });
});

describe("childProxyEnv", () => {
  it("embeds the token as URL credentials and sets the fetch opt-in", () => {
    const env = childProxyEnv("tok-123", "http://127.0.0.1:45678");
    expect(env.HTTP_PROXY).toBe("http://aw:tok-123@127.0.0.1:45678");
    expect(env.HTTPS_PROXY).toBe("http://aw:tok-123@127.0.0.1:45678");
    expect(env.NODE_USE_ENV_PROXY).toBe("1");
    expect(env.AW_NET_TOKEN).toBe("tok-123");
  });
});
