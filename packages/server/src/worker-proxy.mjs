// Subprocess worker proxy (4C.7). Run via child_process.fork by isolation.ts.
// It loads the plugin entry, proxies every worker method call from the parent
// over IPC, and overrides fetch / fs so all network & filesystem access is
// forwarded to the parent (which enforces the allowlists).
import { pathToFileURL } from "node:url";

const ENTRY = process.env.WORKER_PLUGIN_ENTRY;
const mod = await import(pathToFileURL(ENTRY).href);
const plugin = mod.plugin ?? mod.default;
const worker = plugin.createWorker();

let seq = 1;
const pending = new Map();

function proxyRequest(op, payload) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    pending.set(id, { resolve, reject });
    process.send({ dir: "c2p", kind: "proxy", id, op, payload });
  });
}

// Every network/filesystem access is funnelled to the parent. `fetch` is a
// writable global so we can override it directly; for fs we expose a cooperative
// shim (node:fs/promises bindings are read-only). A real plugin proxies its fs
// calls through `globalThis.__proxyFs`; the granular interception of every
// `fs.*` call for arbitrary plugins requires a custom ESM loader (documented
// limitation in 4C.7).
globalThis.fetch = async (url, init) => {
  const r = await proxyRequest("fetch", { url: String(url), init });
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    async text() {
      return r.body;
    },
    async json() {
      return JSON.parse(r.body);
    },
    headers: new Map(),
  };
};

globalThis.__proxyFs = {
  read: (p) => proxyRequest("fs", { op: "read", path: String(p) }),
  write: (p, data) => proxyRequest("fs", { op: "write", path: String(p), data: String(data) }),
  appendFile: (p, data) => proxyRequest("fs", { op: "appendFile", path: String(p), data: String(data) }),
  readdir: (p) => proxyRequest("fs", { op: "readdir", path: String(p) }),
  stat: (p) => proxyRequest("fs", { op: "stat", path: String(p) }),
  unlink: (p) => proxyRequest("fs", { op: "unlink", path: String(p) }),
  mkdir: (p) => proxyRequest("fs", { op: "mkdir", path: String(p) }),
  rm: (p) => proxyRequest("fs", { op: "rm", path: String(p) }),
};

async function collect(gen) {
  const events = [];
  let r = await gen.next();
  while (!r.done) {
    events.push(r.value);
    r = await gen.next();
  }
  return { events, result: r.value };
}

process.on("message", async (m) => {
  if (!m || m.dir !== "p2c") return;
  if (m.kind === "proxy-result") {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error));
    return;
  }
  if (m.kind === "call") {
    try {
      const fn = worker[m.method];
      let result;
      let events;
      if (m.method === "runAgent") {
        const out = await collect(fn(...m.args));
        events = out.events;
        result = out.result;
      } else {
        result = await fn(...m.args);
      }
      process.send({ dir: "c2p", kind: "call-result", id: m.id, ok: true, events, result });
    } catch (e) {
      process.send({
        dir: "c2p",
        kind: "call-result",
        id: m.id,
        ok: false,
        error: e && e.message ? e.message : String(e),
      });
    }
  }
});

process.send({ dir: "c2p", kind: "ready" });
