// ESM loader that intercepts `node:fs/promises` (and `fs/promises`) and
// redirects imports to the proxied implementation (fs-proxy.mjs). This lets
// arbitrary plugins that import fs directly — instead of using the cooperative
// `globalThis.__proxyFs` shim — still have every call routed through the
// parent process for allowlist enforcement (4C.7).
//
// Loaded via `--import ./fs-loader-register.mjs` when forking isolated workers.

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "node:fs/promises" || specifier === "fs/promises") {
    return {
      url: new URL("./fs-proxy.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
