// Minimal stdio MCP server for local testing / demonstration.
// Speaks JSON-RPC 2.0 with `Content-Length:` framing. Exposes a single `echo`
// tool. Point MCP_SERVERS at it, e.g.:
//   MCP_SERVERS='[{"id":"sample","command":"node","args":["scripts/sample-mcp-server.mjs"]}]'

function send(msg) {
  const payload = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
}
const response = (id, result) => ({ jsonrpc: "2.0", id, result });
const error = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  for (;;) {
    const sep = buf.indexOf("\r\n\r\n");
    if (sep === -1) break;
    const header = buf.slice(0, sep);
    const m = /content-length:\s*(\d+)/i.exec(header);
    if (!m) {
      buf = buf.slice(sep + 4);
      continue;
    }
    const len = Number(m[1]);
    const bodyStart = sep + 4;
    if (buf.length < bodyStart + len) break;
    const body = buf.slice(bodyStart, bodyStart + len);
    buf = buf.slice(bodyStart + len);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      continue;
    }
    handle(msg);
  }
});

function handle(msg) {
  if (msg.id === undefined) return; // notification: ignore
  const { id, method, params } = msg;
  if (method === "initialize") {
    send(response(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "sample", version: "1.0.0" } }));
  } else if (method === "tools/list") {
    send(
      response(id, {
        tools: [
          {
            name: "echo",
            description: "Echo the arguments back as JSON text.",
            inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
          },
        ],
      }),
    );
  } else if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (name === "echo") {
      send(response(id, { content: [{ type: "text", text: JSON.stringify(args) }] }));
    } else {
      send(error(id, -32601, `unknown tool: ${name}`));
    }
  } else {
    send(error(id, -32601, `method not found: ${method}`));
  }
}
