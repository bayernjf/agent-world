// Sample subprocess worker plugin — used by isolation.test.ts to exercise the
// fork-based isolation path (4C.7). It reports which env vars it can see (to
// prove env trimming) and performs a network + filesystem access (to prove
// those are proxied through the parent).
function makeWorker() {
  return {
    async *runTextGen() {
      const envKeys = Object.keys(process.env).sort();
      const secretLeaked = process.env.TOP_SECRET === "leaked";
      yield { type: "text-delta", text: "running in child" };
      let net = "none";
      try {
        const url = process.env.NET_URL || "http://127.0.0.1/";
        const res = await fetch(url);
        net = `${res.status}:${await res.text()}`;
      } catch (e) {
        net = `err:${(e && e.message) || String(e)}`;
      }
      let fsRead = "none";
      try {
        // Direct import of node:fs/promises — the ESM loader (fs-loader.mjs)
        // intercepts this and routes it through globalThis.__proxyFs, so even
        // plugins that don't use the cooperative shim go through the allowlist.
        const fs = await import("node:fs/promises");
        fsRead = (await fs.readFile(process.env.FS_PATH || "/dev/null", "utf8")).slice(0, 16);
      } catch (e) {
        fsRead = `err:${(e && e.message) || String(e)}`;
      }
      return {
        output: JSON.stringify({ envKeys, secretLeaked, net, fsRead }),
        usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
      };
    },
    async judge() {
      return { passed: true, reason: "ok" };
    },
    async generateImage() {
      return [{ url: "data:image/png;base64,", mimeType: "image/png" }];
    },
  };
}

export const plugin = {
  id: "sample-iso",
  name: "Sample Iso",
  isolation: "subprocess",
  env: ["ALLOWED_FLAG"],
  createWorker: makeWorker,
};
