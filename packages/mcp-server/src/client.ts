import type { McpServerConfig } from "./config.js";

/** Raised when the main server responds with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Thin HTTP client for the agent-world REST API (see packages/server/src/index.ts). */
export class AgentWorldClient {
  constructor(private readonly cfg: McpServerConfig) {}

  private url(path: string): URL {
    const u = new URL(path, this.cfg.url);
    if (this.cfg.token) u.searchParams.set("token", this.cfg.token);
    return u;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
      });
    } catch (e) {
      throw new Error(
        `agent-world 主服务不可达（${this.cfg.url}）: ${(e as Error).message}。请确认主服务已启动。`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let detail = body;
      try {
        const parsed = JSON.parse(body) as { error?: string; message?: string };
        detail = parsed.message ?? parsed.error ?? body;
      } catch {
        // keep raw body
      }
      throw new ApiError(res.status, `agent-world API ${res.status}: ${detail}`);
    }
    if (res.status === 204) return null;
    return (await res.json().catch(() => null)) as unknown;
  }

  /** GET /api/graphs — every pipeline the token's user can see. */
  async listGraphs(): Promise<Array<Record<string, unknown>>> {
    const body = (await this.request("/api/graphs")) as Array<Record<string, unknown>>;
    return body;
  }

  /** GET /api/graphs/:id — full graph JSON (nodes, edges, configs). */
  async getGraph(graphId: string): Promise<Record<string, unknown>> {
    return (await this.request(`/api/graphs/${encodeURIComponent(graphId)}`)) as Record<string, unknown>;
  }

  /** POST /api/runs — start a pipeline run, returns { runId } immediately. */
  async startRun(graphId: string, input?: string): Promise<{ runId: string }> {
    return (await this.request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ graphId, input }),
    })) as { runId: string };
  }

  /** GET /api/runs/:id/events — reconstructed runtime state (status, artifacts…). */
  async runState(runId: string): Promise<Record<string, unknown>> {
    return (await this.request(`/api/runs/${encodeURIComponent(runId)}/events`)) as Record<string, unknown>;
  }

  /** GET /api/runs/:id/artifacts — artifacts produced by a run. */
  async listArtifacts(runId: string): Promise<Array<Record<string, unknown>>> {
    return (await this.request(
      `/api/runs/${encodeURIComponent(runId)}/artifacts`,
    )) as Array<Record<string, unknown>>;
  }

  /** GET /api/artifacts/:id — text content inline, binary as a download URL. */
  async getArtifact(artifactId: string): Promise<{
    id: string;
    mimeType: string;
    content?: string;
    downloadUrl?: string;
  }> {
    const u = this.url(`/api/artifacts/${encodeURIComponent(artifactId)}`);
    let res: Response;
    try {
      res = await fetch(u, { signal: AbortSignal.timeout(this.cfg.requestTimeoutMs) });
    } catch (e) {
      throw new Error(
        `agent-world 主服务不可达（${this.cfg.url}）: ${(e as Error).message}。请确认主服务已启动。`,
      );
    }
    if (!res.ok) throw new ApiError(res.status, `agent-world API ${res.status}`);
    const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
    if (/text|json|xml|javascript|svg/.test(mimeType)) {
      return { id: artifactId, mimeType, content: await res.text() };
    }
    return { id: artifactId, mimeType, downloadUrl: u.toString() };
  }
}
