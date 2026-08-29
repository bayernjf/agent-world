import type http from "node:http";
import type { AgentWorldClient } from "./client.js";

/**
 * Server-initiated push for the Streamable HTTP transport.
 *
 * MCP has no arbitrary event push; the compliant channel is an SSE stream plus
 * standard `notifications/resources/updated` messages. Clients open `GET /mcp`
 * (the SSE sink), then `POST` a `resources/subscribe` for `run://{id}`. This
 * hub mirrors the main server's `GET /api/runs/:id/stream` into that sink,
 * turning `run.finished` events into `notifications/resources/updated` frames.
 *
 * stdio has no push channel, so clients there poll `get_run_events` instead.
 */

export interface RunUpdateNotification {
  uri: string;
  runId: string;
  status: string;
}

interface Sink {
  write(frame: string): void;
  isOpen: boolean;
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseRunUri(uri: string): string | null {
  const m = /^run:\/\/([^/]+)$/.exec(uri);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Extract JSON payloads from the `data:` lines of one SSE frame. */
function parseSseData(frame: string): unknown[] {
  const out: unknown[] = [];
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // ignore non-JSON frames (e.g. heartbeat comments)
    }
  }
  return out;
}

/** A single upstream SSE bridge: main server stream → notification callback. */
class Bridge {
  private controller = new AbortController();
  private lastStatus: string | undefined;

  constructor(
    private readonly runId: string,
    private readonly client: AgentWorldClient,
    private readonly onUpdate: (n: RunUpdateNotification) => void,
  ) {}

  async start(): Promise<void> {
    let res: Response;
    try {
      res = await this.client.openRunStream(this.runId, this.controller.signal);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      throw e;
    }
    if (!res.ok) throw new Error(`agent-world API ${res.status}`);
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.handleFrame(frame);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private handleFrame(frame: string): void {
    for (const data of parseSseData(frame)) {
      const envelope = data as { event?: { type?: string; status?: string; runId?: string } };
      if (envelope.event?.type !== "run.finished") continue;
      const status = envelope.event.status;
      if (!status || status === this.lastStatus) continue;
      this.lastStatus = status;
      this.onUpdate({ uri: `run://${this.runId}`, runId: this.runId, status });
    }
  }

  abort(): void {
    this.controller.abort();
  }
}

export class NotificationsHub {
  private sinks = new Set<Sink>();
  private bridges = new Map<string, Bridge>();

  /** Register a `GET /mcp` SSE response as a push target. */
  addSink(res: http.ServerResponse): void {
    const sink: Sink = {
      write: (frame) => {
        if (!res.writableEnded) res.write(frame);
      },
      isOpen: true,
    };
    this.sinks.add(sink);
    res.on("close", () => {
      sink.isOpen = false;
      this.sinks.delete(sink);
      // Last client gone → tear down upstream connections to avoid leaks.
      if (this.sinks.size === 0) this.closeBridges();
    });
  }

  /** Subscribe to `run://{id}`; no-op if already subscribed for that run. */
  async subscribe(uri: string, client: AgentWorldClient): Promise<void> {
    const runId = parseRunUri(uri);
    if (!runId) {
      throw new Error(`不支持的订阅 URI "${uri}"。仅支持 run://{runId}`);
    }
    if (this.bridges.has(runId)) return;
    const bridge = new Bridge(runId, client, (n) => this.broadcast(n));
    this.bridges.set(runId, bridge);
    void bridge.start().catch((e) => {
      this.bridges.delete(runId);
      if ((e as Error).name !== "AbortError") {
        this.broadcast({ uri: `run://${runId}`, runId, status: "error" });
      }
    });
  }

  private broadcast(notification: RunUpdateNotification): void {
    const frame = sseFrame("message", {
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: {
        uri: notification.uri,
        runId: notification.runId,
        status: notification.status,
      },
    });
    for (const sink of this.sinks) sink.write(frame);
  }

  /** Abort every upstream bridge and clear subscriptions. */
  closeBridges(): void {
    for (const bridge of this.bridges.values()) bridge.abort();
    this.bridges.clear();
  }

  /** Teardown everything (bridges + sinks). */
  closeAll(): void {
    this.closeBridges();
    this.sinks.clear();
  }
}
