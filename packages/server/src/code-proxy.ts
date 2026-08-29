import { randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import type { AddressInfo } from "node:net";
import { connect as netConnect, isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, request as httpRequest } from "node:http";
import type { Socket } from "node:net";
import { log } from "./logger.js";
import { matchDomain } from "./permissions.js";
import { allowPrivateNetwork, hostIsInternal } from "./ssrf.js";

/**
 * net: "allowlist" 的 SSRF 校验代理（design-code-sandbox.md §10）。
 *
 * 常驻单例 HTTP 正向代理，监听 127.0.0.1 随机端口。engine 为每个 run 注册
 * 一次性 token（token → allowlist 绑定），并把带凭据的代理 URL 注入子进程
 * env（HTTP_PROXY/HTTPS_PROXY），标准客户端（Python urllib/requests、curl、
 * Node ≥ 24.5 的 fetch）会把凭据转成 `Proxy-Authorization: Basic` 自动携带。
 *
 * 这是协作式防护：只约束走代理 env 的 HTTP(S) 客户端，裸 socket 可绕过
 * （rlimit 后端下无法阻止）。硬保证只在 bwrap/sandbox-exec 的 none 档与
 * 未来 docker 档。
 */

const DEFAULT_CONNECT_PORTS = [80, 443];
const MAX_CONCURRENT_PER_TOKEN = 8;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;

export interface NetTokenRegistration {
  runId: string;
  nodeId: string;
  /** 允许访问的域名 pattern（TOOL_NETWORK_ALLOW 语义，复用 matchDomain）。 */
  allowlist: string[];
  /** 在默认 80/443 之外额外放行的 CONNECT 端口（测试钩子，生产不传）。 */
  extraConnectPorts?: number[];
}

interface TokenEntry {
  runId: string;
  nodeId: string;
  allowlist: string[];
  connectPorts: Set<number>;
  active: number;
}

const tokens = new Map<string, TokenEntry>();

const auditLog = log.child({ component: "code-proxy" });

let proxyServer: ReturnType<typeof createServer> | undefined;
let proxyUrlPromise: Promise<string> | undefined;

/** 注册一次性 token，run 结束时必须 unregister（engine 的 finally 负责）。 */
export function registerNetToken(reg: NetTokenRegistration): string {
  const token = randomUUID();
  tokens.set(token, {
    runId: reg.runId,
    nodeId: reg.nodeId,
    allowlist: reg.allowlist,
    connectPorts: new Set([...DEFAULT_CONNECT_PORTS, ...(reg.extraConnectPorts ?? [])]),
    active: 0,
  });
  return token;
}

export function unregisterNetToken(token: string): void {
  tokens.delete(token);
}

/**
 * 注入子进程的代理 env。token 以 URL 凭据形式内嵌（`http://aw:<token>@…`），
 * 这样标准代理客户端会自动发送 Basic 代理认证；`AW_NET_TOKEN` 供自定义客户端
 * 显式读取。不设 NO_PROXY：让 localhost 探测也经过代理，纳入审计与内网拒绝。
 */
export function childProxyEnv(token: string, baseUrl: string): Record<string, string> {
  const withCreds = baseUrl.replace(/^http:\/\//, `http://aw:${token}@`);
  return {
    HTTP_PROXY: withCreds,
    HTTPS_PROXY: withCreds,
    // Node ≥ 24.5 的 fetch（undici）读取代理 env 的开关；更老版本忽略（诚实边界）
    NODE_USE_ENV_PROXY: "1",
    AW_NET_TOKEN: token,
  };
}

/** 懒启动单例代理，返回 `http://127.0.0.1:<port>`。 */
export function getCodeProxyUrl(): Promise<string> {
  if (!proxyUrlPromise) proxyUrlPromise = startProxy();
  return proxyUrlPromise;
}

/** 测试用：停掉单例并清空 token。 */
export async function closeCodeProxy(): Promise<void> {
  const server = proxyServer;
  proxyServer = undefined;
  proxyUrlPromise = undefined;
  tokens.clear();
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
}

function startProxy(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void handleRequest(req, res).catch(() => res.destroy());
    });
    server.on("connect", (req: IncomingMessage, socket: Socket, head: Buffer) => {
      void handleConnect(req, socket, head).catch(() => socket.destroy());
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      proxyServer = server;
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

/* ---------------- token 提取与目标解析 ---------------- */

function tokenOf(req: IncomingMessage): string | undefined {
  const raw = req.headers["proxy-authorization"];
  if (!raw) return undefined;
  const s = Array.isArray(raw) ? raw[0] : raw;
  const m = /^(\w+)\s+(.+)$/.exec(s);
  if (!m) return undefined;
  const scheme = m[1]!.toLowerCase();
  const credential = m[2]!;
  if (scheme === "bearer") return credential;
  if (scheme === "basic") {
    try {
      const decoded = Buffer.from(credential, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      return colon === -1 ? decoded : decoded.slice(colon + 1);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * 解析 hostname 为一个可放行的连接地址（IP）。解析一次、校验该 IP、连接该
 * IP——check 与 connect 用同一次解析，DNS-rebinding 无法穿透。
 * 返回 null 表示目标不可放行（内网/不可解析）。ALLOW_PRIVATE_NETWORK=1 时
 * 跳过内网检查并交由内核解析（部署方主动放宽）。
 */
export async function resolveConnectAddress(hostname: string): Promise<string | null> {
  if (allowPrivateNetwork()) return hostname;
  if (isIP(hostname)) return (await hostIsInternal(hostname)) ? null : hostname;
  try {
    const records = await dnsLookup(hostname, { all: true });
    for (const r of records) {
      if (!(await hostIsInternal(r.address))) return r.address;
    }
    return null; // 全部解析结果都是内网 → 拒绝（fail closed）
  } catch {
    return null;
  }
}

function audit(
  entry: TokenEntry | undefined,
  target: string,
  verdict: "allow" | "deny",
  reason: string,
  t0: number,
  extra: Record<string, unknown> = {},
): void {
  const line = {
    runId: entry?.runId,
    nodeId: entry?.nodeId,
    target,
    verdict,
    reason,
    ms: Date.now() - t0,
    ...extra,
  };
  if (verdict === "allow") auditLog.info("proxy request", line);
  else auditLog.warn("proxy denied", line);
}

/* ---------------- 明文 HTTP 正向代理 ---------------- */

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const t0 = Date.now();
  const target = req.url ?? "";
  const entry = entryForRequest(req);
  if (!entry) {
    audit(undefined, target, "deny", "invalid-token", t0);
    res.writeHead(407, { "content-type": "text/plain; charset=utf-8" });
    res.end("proxy authentication required (missing or invalid Proxy-Authorization)");
    return;
  }
  if (entry.active >= MAX_CONCURRENT_PER_TOKEN) {
    audit(entry, target, "deny", "concurrency-limit", t0);
    res.writeHead(429, { "content-type": "text/plain; charset=utf-8" });
    res.end("too many concurrent proxy requests for this run");
    return;
  }
  entry.active++;
  res.on("close", () => {
    entry.active--;
  });

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    audit(entry, target, "deny", "malformed-url", t0);
    res.writeHead(400).end("expected an absolute http(s) URL");
    return;
  }
  if (url.protocol !== "http:") {
    // https 必须走 CONNECT 隧道；不走代理协议的客户端不该走到这里
    audit(entry, target, "deny", "scheme-not-http", t0);
    res.writeHead(400).end("https targets must use CONNECT");
    return;
  }
  if (!matchDomain(url.host, entry.allowlist)) {
    audit(entry, url.host, "deny", "not-in-allowlist", t0);
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end(`host ${url.host} is not in this run's network allowlist`);
    return;
  }
  const address = await resolveConnectAddress(url.hostname);
  if (!address) {
    audit(entry, url.host, "deny", "internal-or-unresolvable", t0);
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end(`host ${url.host} resolves to an internal/unresolvable address`);
    return;
  }

  // 转发：连接校验通过的 IP，Host 头保持原样
  const headers: Record<string, string | string[]> = { ...req.headers, host: url.host };
  delete headers["proxy-authorization"];
  delete headers["proxy-connection"];
  delete headers.connection;
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    audit(entry, url.host, "deny", "body-too-large", t0);
    res.writeHead(413).end("request body exceeds the proxy limit");
    return;
  }
  const fwd = httpRequest({
    host: address,
    port: url.port || 80,
    method: req.method,
    path: url.pathname + url.search,
    headers,
  });
  fwd.setTimeout(UPSTREAM_TIMEOUT_MS, () => fwd.destroy(new Error("upstream timeout")));
  fwd.on("response", (fres) => {
    audit(entry, url.host, "allow", "ok", t0, {
      method: req.method,
      status: fres.statusCode,
    });
    const outHeaders = { ...fres.headers };
    delete outHeaders.connection;
    delete outHeaders["transfer-encoding"];
    res.writeHead(fres.statusCode ?? 502, outHeaders);
    fres.pipe(res);
  });
  fwd.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`upstream error: ${err.message}`);
    } else {
      res.destroy();
    }
  });
  let bodyBytes = 0;
  req.on("data", (chunk: Buffer) => {
    bodyBytes += chunk.length;
    if (bodyBytes > MAX_BODY_BYTES) {
      fwd.destroy(new Error("body too large"));
      if (!res.headersSent) {
        res.writeHead(413).end("request body exceeds the proxy limit");
      } else {
        res.destroy();
      }
    }
  });
  req.pipe(fwd);
}

function entryForRequest(req: IncomingMessage): TokenEntry | undefined {
  const token = tokenOf(req);
  return token ? tokens.get(token) : undefined;
}

/* ---------------- CONNECT 隧道（HTTPS） ---------------- */

async function handleConnect(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
  const t0 = Date.now();
  const target = req.url ?? "";
  const lastColon = target.lastIndexOf(":");
  const host = lastColon === -1 ? target : target.slice(0, lastColon);
  const port = lastColon === -1 ? 443 : Number(target.slice(lastColon + 1));
  const respond = (code: number, msg: string) => {
    socket.end(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
  };
  const entry = entryForRequest(req);
  if (!entry) {
    audit(undefined, target, "deny", "invalid-token", t0);
    respond(407, "Proxy Authentication Required");
    return;
  }
  if (!matchDomain(host, entry.allowlist)) {
    audit(entry, target, "deny", "not-in-allowlist", t0);
    respond(403, "Forbidden");
    return;
  }
  if (!Number.isInteger(port) || !entry.connectPorts.has(port)) {
    // 只放行 80/443：避免代理被当成任意端口的通用 TCP 跳板
    audit(entry, target, "deny", "port-not-allowed", t0);
    respond(403, "Forbidden");
    return;
  }
  const address = await resolveConnectAddress(host);
  if (!address) {
    audit(entry, target, "deny", "internal-or-unresolvable", t0);
    respond(403, "Forbidden");
    return;
  }
  if (entry.active >= MAX_CONCURRENT_PER_TOKEN) {
    audit(entry, target, "deny", "concurrency-limit", t0);
    respond(429, "Too Many Requests");
    return;
  }
  entry.active++;
  const upstream = netConnect({ host: address, port }, () => {
    audit(entry, target, "allow", "ok", t0, { method: "CONNECT" });
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => upstream.destroy(new Error("upstream timeout")));
  upstream.on("error", (err) => {
    audit(entry, target, "deny", `upstream-error: ${err.message}`, t0);
    respond(502, "Bad Gateway");
  });
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => {
    entry.active--;
    upstream.destroy();
  });
}
