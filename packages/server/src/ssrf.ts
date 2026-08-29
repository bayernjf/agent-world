import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard shared by every server-side outbound fetch (image proxy, HTTP
 * node). We resolve the hostname to its current IP addresses *at fetch time*
 * and refuse if any of them is private/internal. Checking the resolved IP
 * (not the raw hostname string) is what defeats DNS-rebinding: an attacker
 * cannot point a name at a public address to pass the check and then have the
 * real fetch resolve to an internal one — the same lookup feeds both paths.
 */

function ipv4IsInternal(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const a = o[0]!;
  const b = o[1]!;
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

function ipv6IsInternal(ip: string): boolean {
  const s = ip.toLowerCase().split("%")[0]!;
  if (s === "::1" || s === "::") return true;
  // IPv4-mapped (::ffff:a.b.c.d) / compatible (::a.b.c.d): the embedded
  // IPv4 address carries the real scope.
  const mapped = /::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return ipv4IsInternal(mapped[1]!);
  const head = s.split(":")[0] ?? "";
  const first = parseInt(head || "0", 16);
  if (Number.isNaN(first)) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (s.startsWith("2001:db8") || s.startsWith("2001:0db8")) return true; // documentation
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
