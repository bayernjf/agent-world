import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import {
  spawnIsolatedWorker,
  trimEnv,
  isPathAllowed,
  disposeIsolatedWorkers,
  type IsolatedWorker,
} from "./isolation.js";

const entry = fileURLToPath(new URL("../scripts/sample-worker-plugin.mjs", import.meta.url));

let server: Server;
let baseUrl: string;
let tmpDir: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.statusCode = 200;
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${(addr as { port: number }).port}`;
  tmpDir = mkdtempSync(join(tmpdir(), "iso-"));
});

afterAll(() => {
  server.close();
  rmSync(tmpDir, { recursive: true, force: true });
  disposeIsolatedWorkers();
});

afterEach(() => {
  for (const k of ["TOP_SECRET", "ALLOWED_FLAG", "NET_URL", "FS_PATH", "TOOL_NETWORK_ALLOW", "TOOL_FS_ALLOW"]) {
    delete process.env[k];
  }
});

async function runOnce(w: IsolatedWorker): Promise<any> {
  const gen = w.runTextGen({ node: { id: "n" }, config: {}, attempt: 1, input: "", tools: [] });
  let r = await gen.next();
  while (!r.done) r = await gen.next();
  return JSON.parse((r.value as { output: string }).output);
}

const DECLARED = ["ALLOWED_FLAG", "NET_URL", "FS_PATH"];

describe("trimEnv (4C.7 + audit M6)", () => {
  it("keeps the safe base but strips a declared secret-named key (M6)", () => {
    process.env.FOO_SECRET = "x";
    const e = trimEnv(["FOO_SECRET"]);
    expect(e.FOO_SECRET).toBeUndefined();
    expect(e.PATH).toBeDefined();
    delete process.env.FOO_SECRET;
  });
  it("forwards a declared secret only when the operator allowlists it (M6)", () => {
    process.env.FOO_SECRET = "x";
    process.env.PLUGIN_ENV_ALLOWLIST = "FOO_SECRET";
    try {
      const e = trimEnv(["FOO_SECRET"]);
      expect(e.FOO_SECRET).toBe("x");
    } finally {
      delete process.env.PLUGIN_ENV_ALLOWLIST;
      delete process.env.FOO_SECRET;
    }
  });
  it("keeps an ordinary declared key and drops undeclared secrets", () => {
    process.env.ORDINARY = "ok";
    process.env.BAR_SECRET = "y";
    const e = trimEnv(["ORDINARY", "OTHER"]);
    expect(e.ORDINARY).toBe("ok");
    expect(e.BAR_SECRET).toBeUndefined();
    delete process.env.ORDINARY;
    delete process.env.BAR_SECRET;
  });
});

describe("IsolatedWorker (4C.7)", () => {
  it("runs worker methods across the process boundary", async () => {
    process.env.ALLOWED_FLAG = "yes";
    const w = await spawnIsolatedWorker(entry, "sample-iso", DECLARED);
    try {
      expect(await w.judge({})).toEqual({ passed: true, reason: "ok" });
      expect(await w.generateImage({})).toEqual([{ url: "data:image/png;base64,", mimeType: "image/png" }]);
    } finally {
      w.dispose();
    }
  });

  it("trims the environment the plugin can see (no secret leak)", async () => {
    process.env.TOP_SECRET = "leaked";
    process.env.ALLOWED_FLAG = "yes";
    const w = await spawnIsolatedWorker(entry, "sample-iso", DECLARED);
    try {
      const out = await runOnce(w);
      expect(out.envKeys).toContain("ALLOWED_FLAG");
      expect(out.envKeys).not.toContain("TOP_SECRET");
      expect(out.secretLeaked).toBe(false);
    } finally {
      w.dispose();
    }
  });

  it("proxies network access and honours the allowlist", async () => {
    process.env.ALLOWED_FLAG = "yes";
    process.env.NET_URL = `${baseUrl}/ok`;
    process.env.TOOL_NETWORK_ALLOW = "127.0.0.1";
    // The proxy fetch goes through the guarded egress, which refuses 127.0.0.1
    // by default; this case exercises allowlist + proxying, not the SSRF guard.
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const w = await spawnIsolatedWorker(entry, "sample-iso", DECLARED);
    try {
      const out = await runOnce(w);
      expect(out.net).toBe("200:ok");
    } finally {
      vi.unstubAllEnvs();
      w.dispose();
    }
  });

  it("blocks network access outside the allowlist", async () => {
    process.env.ALLOWED_FLAG = "yes";
    process.env.NET_URL = "http://10.255.255.1/blocked";
    process.env.TOOL_NETWORK_ALLOW = "127.0.0.1";
    const w = await spawnIsolatedWorker(entry, "sample-iso", DECLARED);
    try {
      const out = await runOnce(w);
      expect(out.net.startsWith("err:")).toBe(true);
      expect(out.net).toMatch(/not permitted/);
    } finally {
      w.dispose();
    }
  });

  it("proxies filesystem reads through the allowlist", async () => {
    const file = join(tmpDir, "data.txt");
    writeFileSync(file, "hello-fs");
    process.env.ALLOWED_FLAG = "yes";
    process.env.FS_PATH = file;
    process.env.TOOL_FS_ALLOW = file;
    const w = await spawnIsolatedWorker(entry, "sample-iso", DECLARED);
    try {
      const out = await runOnce(w);
      expect(out.fsRead).toBe("hello-fs");
    } finally {
      w.dispose();
    }
  });

  it("blocks filesystem reads outside the allowlist", async () => {
    process.env.ALLOWED_FLAG = "yes";
    process.env.FS_PATH = "/etc/passwd";
    process.env.TOOL_FS_ALLOW = join(tmpDir, "data.txt");
    const w = await spawnIsolatedWorker(entry, "sample-iso", DECLARED);
    try {
      const out = await runOnce(w);
      expect(out.fsRead.startsWith("err:")).toBe(true);
      expect(out.fsRead).toMatch(/not permitted/);
    } finally {
      w.dispose();
    }
  });
});

describe("isPathAllowed boundary check (audit H9)", () => {
  // Use os.tmpdir() directly: the module-level tmpDir is only assigned in
  // beforeAll, which runs after this describe body is collected.
  const base = join(tmpdir(), "aw-isolation-allowed-root");
  it("admits the base itself and paths strictly inside it", () => {
    expect(isPathAllowed(base, [base])).toBe(true);
    expect(isPathAllowed(join(base, "sub", "file.txt"), [base])).toBe(true);
  });
  it("rejects a sibling whose name only prefix-matches the base (startsWith bypass)", () => {
    const sibling = `${base}-evil/file.txt`;
    expect(isPathAllowed(sibling, [base])).toBe(false);
  });
  it("rejects parent-traversal that resolves outside the base", () => {
    expect(isPathAllowed(join(base, "..", "elsewhere"), [base])).toBe(false);
  });
  it("treats an empty/absent allowlist as unrestricted", () => {
    expect(isPathAllowed("/anything", [])).toBe(true);
    expect(isPathAllowed("/anything", undefined)).toBe(true);
  });
});

describe("subprocess startup handshake fail-closed (audit H8)", () => {
  it("rejects when the plugin entry cannot be loaded (no ready, child exits)", async () => {
    const missing = join(tmpDir, "does-not-exist-worker.mjs");
    await expect(
      spawnIsolatedWorker(missing, "broken-iso", [], { handshakeTimeoutMs: 3000 }),
    ).rejects.toThrow(/startup|ready|exited/i);
  });
});
