import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";

/**
 * SSRF guard shared by every server-side outbound fetch (image proxy, HTTP
 * node). We resolve the hostname to its current IP addresses *at fetch time*
 * and refuse if any of them is private/internal. Checking the resolved IP
 * (not the raw hostname string) is what defeats DNS-rebinding: an attacker
 * cannot point a name at a public address to pass the check and then have the
 * real fetch resolve to an internal one — the same lookup feeds both paths.
 */

function ipv4UintIsInternal(v: number): boolean {
  const a = (v >>> 24) & 0xff;
  const b = (v >>> 16) & 0xff;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGN 100.64.0.0/10
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 0) || // 192.0.0.0/24
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 198 && (b === 18 || b === 19)) || // benchmark 198.18.0.0/15
    a >= 224 // multicast 224/4 + reserved 240/4 + broadcast
  );
}

function ipv4IsInternal(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  return ipv4UintIsInternal((((o[0]! << 24) | (o[1]! << 16) | (o[2]! << 8) | o[3]!) >>> 0));
}

/**
 * Normalize an IPv6 address (dotted-quad tail included) into eight 16-bit
 * segments, or null when it cannot be parsed. Scoped addresses (`%eth0`)
 * are handled by the caller.
 */
function ipv6Segments(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const v4tail = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.slice(s.lastIndexOf(":") + 1));
  if (v4tail) {
    const o = v4tail.slice(1).map(Number);
    if (o.some((n) => Number.isNaN(n) || n > 255)) return null;
    s = `${s.slice(0, s.lastIndexOf(":") + 1)}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parsePart = (part: string): number[] | null => {
    if (part === "") return [];
    const segs: number[] = [];
    for (const h of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      segs.push(parseInt(h, 16));
    }
    return segs;
  };
  const head = parsePart(halves.length === 2 ? halves[0]! : s);
  const tail = halves.length === 2 ? parsePart(halves[1]!) : [];
  if (!head || !tail) return null;
  const segs = [...head, ...tail];
  if (halves.length === 2) {
    if (segs.length > 8) return null;
    while (segs.length < 8) segs.splice(head.length, 0, 0);
  }
  return segs.length === 8 ? segs : null;
}

function ipv6IsInternal(ip: string): boolean {
  const s = ip.toLowerCase().split("%")[0]!;
  const seg = ipv6Segments(s);
  // Unparseable → fail closed.
  if (!seg) return true;
  // :: and ::1
  if (seg.every((x) => x === 0)) return true;
  if (seg.slice(0, 7).every((x) => x === 0) && seg[7] === 1) return true;
  // IPv4-mapped ::ffff:0:0/96 — both hex (::ffff:7f00:1) and dotted
  // (::ffff:127.0.0.1) forms normalize to the same segments (audit H4).
  if (seg.slice(0, 5).every((x) => x === 0) && seg[5] === 0xffff) {
    return ipv4UintIsInternal(((seg[6]! << 16) | seg[7]!) >>> 0);
  }
  // IPv4-compatible ::a.b.c.d (and the bare ::x:y form) — deprecated,
  // treated as loopback-adjacent; refuse.
  if (seg.slice(0, 6).every((x) => x === 0)) return true;
  // NAT64 64:ff9b::/96: the embedded IPv4 address decides.
  if (seg[0] === 0x64 && seg[1] === 0xff9b && seg.slice(2, 6).every((x) => x === 0)) {
    return ipv4UintIsInternal(((seg[6]! << 16) | seg[7]!) >>> 0);
  }
  // Teredo 2001:0000::/32
  if (seg[0] === 0x2001 && seg[1] === 0x0000) return true;
  if (seg[0] === 0x2001 && seg[1] === 0x0db8) return true; // documentation
  if ((seg[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((seg[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((seg[0]! & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True when the hostname is a private/internal address (or unresolvable). */
export async function hostIsInternal(hostname: string): Promise<boolean> {
  if (isIP(hostname)) {
    return isIP(hostname) === 4 ? ipv4IsInternal(hostname) : ipv6IsInternal(hostname);
  }
  try {
    const records = await dnsLookup(hostname, { all: true });
    if (records.length === 0) return true;
    return records.some((r) =>
      r.family === 4 ? ipv4IsInternal(r.address) : ipv6IsInternal(r.address),
    );
  } catch {
    // Fail closed: if we cannot resolve it, we do not fetch it.
    return true;
  }
}

/**
 * Opt-out for deployments that intentionally reach internal services (e.g. a
 * LAN-only install calling a private API). Off by default; set
 * ALLOW_PRIVATE_NETWORK=1 (or "true") to bypass the check entirely.
 */
export function allowPrivateNetwork(): boolean {
  const v = process.env.ALLOW_PRIVATE_NETWORK;
  if (v === undefined) return false;
  return v === "1" || v.toLowerCase() === "true";
}

/* ------------------------------------------------------------------ *
 * guardedFetch — the outbound boundary every server-side fetch should
 * go through (audit batch 2). Three properties:
 *
 * 1. Resolve once, connect pinned. The DNS answer that passes the check is
 *    the same one the TCP/TLS connection uses (via an undici Agent whose
 *    lookup returns the validated IP), eliminating the check-vs-connect
 *    TOCTOU window of plain check-then-fetch (audit H3).
 * 2. Redirects are followed manually (≤ maxRedirects hops) and every hop
 *    re-passes the guard (audit C3 pattern).
 * 3. Cross-origin redirect hops drop Authorization/Cookie headers, and
 *    303/301/302 downgrade non-GET methods to GET — mirroring what
 *    fetch's automatic following would do.
 *
 * ALLOW_PRIVATE_NETWORK=1 skips the internal checks entirely (and lets
 * the platform resolver handle connections, like code-proxy does).
 * ------------------------------------------------------------------ */

export interface GuardedFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Maximum redirect hops to follow (default 5). */
  maxRedirects?: number;
}

/**
 * Thrown for guard rejections (internal target, bad redirect target) and
 * non-http(s) URLs. Callers should treat these as deterministic failures —
 * never retry them.
 */
export class GuardedFetchError extends Error {
  constructor(
    public readonly reason: "internal-target" | "too-many-redirects" | "bad-url" | "bad-redirect",
    message: string,
  ) {
    super(message);
    this.name = "GuardedFetchError";
  }
}

/** Pinned-connection agents, cached by host|ip. Bounded; evicted oldest. */
const agentCache = new Map<string, Agent>();
const MAX_PINNED_AGENTS = 32;

function pinnedAgent(ip: string, family: number): Agent {
  const key = `${ip}|${family}`;
  const hit = agentCache.get(key);
  if (hit) {
    // Refresh LRU position.
    agentCache.delete(key);
    agentCache.set(key, hit);
    return hit;
  }
  const agent = new Agent({
    connect: {
      lookup(
        _hostname: string,
        opts: { all?: boolean },
        cb: (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void,
      ) {
        if (opts?.all) cb(null, [{ address: ip, family }]);
        else cb(null, ip, family);
      },
    },
  });
  agentCache.set(key, agent);
  while (agentCache.size > MAX_PINNED_AGENTS) {
    const oldest = agentCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const a = agentCache.get(oldest);
    agentCache.delete(oldest);
    void a?.close().catch(() => {});
  }
  return agent;
}

/**
 * Validate `hostname` and return the IP the connection must be pinned to,
 * or null when the target must be refused. IP literals validate in place
 * (no pinning needed — they cannot be rebindinged).
 */
async function resolveGuarded(hostname: string): Promise<{ pin: string; family: number } | null> {
  const family = isIP(hostname);
  if (family) {
    const internal = family === 4 ? await Promise.resolve(ipv4IsInternal(hostname)) : await Promise.resolve(ipv6IsInternal(hostname));
    return internal ? null : { pin: hostname, family };
  }
  let records: { address: string; family: number }[];
  try {
    records = await dnsLookup(hostname, { all: true });
  } catch {
    return null; // unresolvable → fail closed
  }
  if (records.length === 0) return null;
  // Refuse when ANY record is internal: partial-internal answers are the
  // classic half-open rebinding setup.
  for (const r of records) {
    if (r.family === 4 ? ipv4IsInternal(r.address) : ipv6IsInternal(r.address)) return null;
  }
  const first = records[0]!;
  return { pin: first.address, family: first.family };
}

/**
 * Fetch a URL through the SSRF guard. Throws GuardedFetchError on guard
 * rejections; other network errors propagate as-is from fetch.
 */
export async function guardedFetch(url: string | URL, init: GuardedFetchInit = {}): Promise<Response> {
  const maxRedirects = init.maxRedirects ?? 5;
  let current = new URL(url);
  let method = init.method ?? "GET";
  let sendBody = init.body && method !== "GET" ? init.body : undefined;
  let hopHeaders: Record<string, string> = { ...(init.headers ?? {}) };

  for (let hop = 0; ; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new GuardedFetchError("bad-url", `仅允许 http(s) 协议: ${current.protocol}`);
    }
    let dispatcher: Agent | undefined;
    if (!allowPrivateNetwork()) {
      const resolved = await resolveGuarded(current.hostname);
      if (!resolved) {
        throw new GuardedFetchError(
          "internal-target",
          `拒绝访问内网或私网地址（SSRF 防护）: ${current.hostname}`,
        );
      }
      dispatcher = pinnedAgent(resolved.pin, resolved.family);
    }

    // The pinned Agent must come from the same undici build as the global
    // fetch (Node's bundled undici). The pnpm dependency is pinned to that
    // same major (^7.8) so passing `dispatcher` here stays protocol-compatible
    // — an 8.x Agent handed to the 7.x global fetch throws "invalid
    // onRequestStart method" and every pinned request would fail. The pinned
    // agent routes the TCP/TLS connection to the validated IP; Host header and
    // SNI still use the original hostname.
    const r = await fetch(current.toString(), {
      method,
      headers: hopHeaders,
      body: sendBody,
      redirect: "manual",
      signal: init.signal,
      // Pinned agent routes the TCP/TLS connection to the validated IP;
      // Host header and SNI still use the original hostname.
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);

    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return r; // 3xx without Location: hand back as-is
      if (hop >= maxRedirects) {
        throw new GuardedFetchError("too-many-redirects", `重定向超过 ${maxRedirects} 跳`);
      }
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        throw new GuardedFetchError("bad-redirect", `重定向地址不合法: ${loc}`);
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new GuardedFetchError("bad-redirect", `重定向协议不允许: ${next.protocol}`);
      }
      if (next.host !== current.host) {
        // Never replay credentials at a different origin.
        const { authorization, Authorization, cookie, Cookie, ...rest } = hopHeaders;
        hopHeaders = rest;
      }
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && method !== "GET")) {
        method = "GET";
        sendBody = undefined;
      }
      current = next;
      continue;
    }
    return r;
  }
}
