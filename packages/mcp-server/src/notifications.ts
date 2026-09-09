import type http from "node:http";
import type { AgentWorldClient } from "./client.js";
import { META, SUBSCRIPTION_TYPES, type SubscriptionType } from "./protocol.js";

/**
 * Server-initiated push for the Streamable HTTP transport.
 *
 * Two channels, one hub:
 *   - 2024-11-05: the client opens `GET /mcp` as an SSE sink, then POSTs a
 *     `resources/subscribe` for `run://{id}`.
 *   - 2026-07-28 (SEP-2575): the GET endpoint and resources/subscribe are gone.
 *     The client POSTs `subscriptions/listen`, opts into specific change types,
 *     and the response itself stays open as the notification stream. Frames are
 *     tagged with the subscription id the server minted.
 *
 * Either way the payload is a standard `notifications/resources/updated`
 * mirrored from the main server's `GET /api/runs/:id/stream`.
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
  /** Change types this sink opted into; the legacy GET sink takes everything. */
  types: ReadonlySet<SubscriptionType>;
  subscriptionId?: string;
}

const ALL_TYPES: ReadonlySet<SubscriptionType> = new Set(SUBSCRIPTION_TYPES);

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
        // SSE frames end with a blank line; accept both LF and CRLF (M18).
        const sep = /\r?\n\r?\n/;
        let m: RegExpExecArray | null;
        while ((m = sep.exec(buffer)) !== null) {
          const frame = buffer.slice(0, m.index);
          buffer = buffer.slice(m.index + m[0].length);
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

  /** Register a `GET /mcp` SSE response as a push target (legacy 2024-11-05 path). */
  addSink(res: http.ServerResponse): void {
    this.addSinkInternal(res, ALL_TYPES, undefined);
  }

  /**
   * Register a `POST subscriptions/listen` response as a scoped push target
   * (2026-07-28 path): the client opted into specific change types, and the
   * server minted a subscription id used to tag every outbound frame.
   */
  addSubscriptionSink(res: http.ServerResponse, types: SubscriptionType[], subscriptionId: string): void {
    this.addSinkInternal(res, new Set(types), subscriptionId);
  }

  private addSinkInternal(
    res: http.ServerResponse,
    types: ReadonlySet<SubscriptionType>,
    subscriptionId: string | undefined,
  ): void {
    const sink: Sink = {
      write: (frame) => {
        if (!sink.isOpen) return;
        if (!res.writableEnded) {
          try {
            res.write(frame);
          } catch {
            // L18: write can throw when the connection dropped but 'close'
            // hasn't fired yet — mark closed so broadcast skips it.
            sink.isOpen = false;
            this.sinks.delete(sink);
          }
        }
      },
      isOpen: true,
      types,
      subscriptionId,
    };
    this.sinks.add(sink);
    res.on("close", () => {
      sink.isOpen = false;
      this.sinks.delete(sink);
      // Last client gone → tear down upstream connections to avoid leaks.
      if (this.sinks.size === 0) this.closeBridges();
    });
  }

  /** Whether this URI is a shape the hub can bridge, without starting anything. */
  canSubscribe(uri: string): boolean {
    return parseRunUri(uri) !== null;
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
    for (const sink of this.sinks) {
      // Run updates ride the resourceSubscriptions channel; a client that only
      // asked for list-changed notifications must not receive them.
      if (!sink.types.has("resourceSubscriptions")) continue;
      sink.write(
        sseFrame("message", {
          jsonrpc: "2.0",
          method: "notifications/resources/updated",
          params: {
            uri: notification.uri,
            runId: notification.runId,
            status: notification.status,
            ...(sink.subscriptionId ? { _meta: { [META.subscriptionId]: sink.subscriptionId } } : {}),
          },
        }),
      );
    }
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
