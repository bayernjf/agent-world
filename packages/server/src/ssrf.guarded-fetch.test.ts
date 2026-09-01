import { lookup as dnsLookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuardedFetchError, guardedFetch, hostIsInternal, outboundProxyDispatcher } from "./ssrf.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const lookupMock = vi.mocked(dnsLookup);

describe("ipv6 internal-address detection (audit H4)", () => {
  it("recognizes hex-mapped IPv4 forms of internal addresses", async () => {
    // ::ffff:7f00:1 === 127.0.0.1; ::ffff:a9fe:a9fe === 169.254.169.254.
    // The old regex only caught the dotted spelling.
    expect(await hostIsInternal("::ffff:7f00:1")).toBe(true);
    expect(await hostIsInternal("::ffff:a9fe:a9fe")).toBe(true);
    expect(await hostIsInternal("::ffff:7f00:2")).toBe(true);
    // Dotted spelling still caught.
    expect(await hostIsInternal("::ffff:127.0.0.1")).toBe(true);
    expect(await hostIsInternal("::ffff:169.254.169.254")).toBe(true);
  });

  it("recognizes NAT64, Teredo and other special ranges", async () => {
    expect(await hostIsInternal("64:ff9b::7f00:1")).toBe(true); // NAT64 → 127.0.0.1
    expect(await hostIsInternal("64:ff9b::808:808")).toBe(false); // NAT64 → 8.8.8.8 (public)
    expect(await hostIsInternal("2001:0:1234::1")).toBe(true); // Teredo 2001::/32
    expect(await hostIsInternal("2001:db8::1")).toBe(true); // documentation
    expect(await hostIsInternal("fe80::1")).toBe(true); // link-local
    expect(await hostIsInternal("fc00::1")).toBe(true); // unique-local
    expect(await hostIsInternal("ff02::1")).toBe(true); // multicast
  });

  it("allows public IPv6 and refuses garbage (fail closed)", async () => {
    expect(await hostIsInternal("2606:4700::6810:84e5")).toBe(false); // public (Cloudflare)
    expect(await hostIsInternal("::ffff:808:808")).toBe(false); // mapped 8.8.8.8
    expect(await hostIsInternal("not-an-ip")).toBe(true); // via DNS failure below
  });
});

describe("guardedFetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    lookupMock.mockReset();
  });

  it("refuses an internal IP-literal target without fetching", async () => {
    await expect(guardedFetch("http://169.254.169.254/latest/")).rejects.toMatchObject({
      name: "GuardedFetchError",
      reason: "internal-target",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a hostname that resolves to an internal IP", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(guardedFetch("http://rebind.example.com/x")).rejects.toMatchObject({
      reason: "internal-target",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when ANY resolved record is internal (half-open rebinding)", async () => {
    lookupMock.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(guardedFetch("http://mixed.example.com/x")).rejects.toMatchObject({
      reason: "internal-target",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a public IP literal", async () => {
    const res = await guardedFetch("http://8.8.8.8/ping");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pins the connection to the validated DNS answer (audit H3)", async () => {
    lookupMock.mockResolvedValue([{ address: "1.2.3.4", family: 4 }]);
    await guardedFetch("http://public.example.com/data");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as { dispatcher?: unknown };
    // The dispatcher (pinned undici Agent) must be present: without it the
    // fetch would re-resolve the hostname and rebinding could sneak through.
    expect(init?.dispatcher).toBeDefined();
    // The visible URL keeps the original hostname (Host header / SNI intact).
    expect(fetchMock.mock.calls[0]![0]).toBe("http://public.example.com/data");
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(guardedFetch("ftp://8.8.8.8/f")).rejects.toMatchObject({ reason: "bad-url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a redirect hop to an internal address (audit C3)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } }),
    );
    await expect(guardedFetch("http://8.8.8.8/hop")).rejects.toMatchObject({
      reason: "internal-target",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows public redirects and strips Authorization cross-origin", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://9.9.9.9/elsewhere" } }),
      )
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    const res = await guardedFetch("http://8.8.8.8/auth", {
      headers: { authorization: "Bearer secret", "x-custom": "keep" },
    });
    expect(res.status).toBe(200);
    const secondInit = fetchMock.mock.calls[1]![1] as { headers: Record<string, string> };
    expect(secondInit.headers["authorization"]).toBeUndefined();
    expect(secondInit.headers["x-custom"]).toBe("keep");
  });

  it("downgrades non-GET to GET on 303 redirects", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: "/next" } }))
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    await guardedFetch("http://8.8.8.8/submit", { method: "POST", body: "x" });
    const secondInit = fetchMock.mock.calls[1]![1] as { method: string; body?: string };
    expect(secondInit.method).toBe("GET");
    expect(secondInit.body).toBeUndefined();
  });

  it("enforces the redirect budget", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: "/loop" } }),
    );
    await expect(guardedFetch("http://8.8.8.8/loop")).rejects.toMatchObject({
      reason: "too-many-redirects",
    });
    expect(fetchMock).toHaveBeenCalledTimes(6); // initial + 5 hops
  });

  it("ALLOW_PRIVATE_NETWORK=1 skips the guard entirely", async () => {
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const res = await guardedFetch("http://127.0.0.1:8080/lan");
    expect(res.status).toBe(200);
    const init = fetchMock.mock.calls[0]![1] as { dispatcher?: unknown };
    expect(init?.dispatcher).toBeUndefined(); // no pinning needed
  });

  it("outboundProxyDispatcher is undefined without AGENT_WORLD_PROXY", () => {
    delete process.env.AGENT_WORLD_PROXY;
    expect(outboundProxyDispatcher()).toBeUndefined();
  });

  it("AGENT_WORLD_PROXY routes through the proxy and still refuses internal literals", async () => {
    vi.stubEnv("AGENT_WORLD_PROXY", "http://127.0.0.1:7897");
    const agent = outboundProxyDispatcher();
    expect(agent).toBeDefined();
    expect(outboundProxyDispatcher()).toBe(agent); // cached

    // Internal IP literal refused without fetching, even in proxy mode.
    await expect(guardedFetch("http://169.254.169.254/latest/")).rejects.toMatchObject({
      reason: "internal-target",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // External hostname: no local DNS pinning — the request carries the proxy.
    await guardedFetch("https://html.duckduckgo.com/html/");
    const init = fetchMock.mock.calls[0]![1] as { dispatcher?: unknown };
    expect(init?.dispatcher).toBe(agent);
  });

  it("proxy mode refuses localhost-style hostnames without fetching", async () => {
    vi.stubEnv("AGENT_WORLD_PROXY", "http://127.0.0.1:7897");
    await expect(guardedFetch("http://localhost:8791/api")).rejects.toMatchObject({
      reason: "internal-target",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ALLOW_PRIVATE_NETWORK=1 also lifts the proxy-mode internal-target block", async () => {
    // Dogfood tpl-doc-ingest: with AGENT_WORLD_PROXY set, a local fixture URL
    // was refused even though the operator had opted into private networks;
    // the documented contract is "skips the internal checks entirely".
    vi.stubEnv("AGENT_WORLD_PROXY", "http://127.0.0.1:7897");
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const res = await guardedFetch("http://127.0.0.1:18900/fixture.pdf");
    expect(res.status).toBe(200);
    const init = fetchMock.mock.calls[0]![1] as { dispatcher?: unknown };
    expect(init?.dispatcher).toBe(outboundProxyDispatcher());
  });
});
