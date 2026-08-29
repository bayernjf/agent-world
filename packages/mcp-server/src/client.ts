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
    return new URL(path, this.cfg.url);
  }

  /** Auth header carried on every request (Authorization: Bearer, when a token is set). */
  private authHeaders(): Record<string, string> {
    return this.cfg.token ? { authorization: `Bearer ${this.cfg.token}` } : {};
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        ...init,
        headers: { "content-type": "application/json", ...this.authHeaders(), ...(init?.headers ?? {}) },
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

  /** GET /api/runs/:id/stats — node-level cost/token aggregates for a run. */
  async runStats(runId: string): Promise<{
    nodes: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  }> {
    return (await this.request(`/api/runs/${encodeURIComponent(runId)}/stats`)) as {
      nodes: number;
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
    };
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
      res = await fetch(u, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
      });
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

  /** POST /api/graphs — create from a template, copy another graph, or blank. */
  async createGraph(input: { name?: string; template?: string; from?: string }): Promise<Record<string, unknown>> {
    return (await this.request("/api/graphs", {
      method: "POST",
      body: JSON.stringify(input),
    })) as Record<string, unknown>;
  }

  /** PUT /api/graphs/:id — replace the graph document (full Graph JSON). */
  async updateGraph(
    graphId: string,
    graph: Record<string, unknown>,
  ): Promise<{ ok: boolean; version?: number }> {
    return (await this.request(`/api/graphs/${encodeURIComponent(graphId)}`, {
      method: "PUT",
      body: JSON.stringify(graph),
    })) as { ok: boolean; version?: number };
  }

  /** DELETE /api/graphs/:id — remove a pipeline. */
  async deleteGraph(graphId: string): Promise<{ ok: boolean }> {
    return (await this.request(`/api/graphs/${encodeURIComponent(graphId)}`, {
      method: "DELETE",
    })) as { ok: boolean };
  }

  /** POST /api/runs/:id/cancel — abort a running pipeline. */
  async cancelRun(runId: string): Promise<{ ok: boolean }> {
    return (await this.request(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    })) as { ok: boolean };
  }

  /** GET /api/knowledge/search?q=&limit= — full-text search over the knowledge base. */
  async searchKnowledge(query: string, limit?: number): Promise<{ entries: Array<Record<string, unknown>> }> {
    const qs = new URLSearchParams({ q: query });
    if (limit != null) qs.set("limit", String(limit));
    return (await this.request(`/api/knowledge/search?${qs}`)) as {
      entries: Array<Record<string, unknown>>;
    };
  }

  /**
   * GET /api/runs/:id/events — the run's event log. With `since`/`limit` the
   * server returns a paged window; without them it returns the full log plus
   * the reconstructed state.
   */
  async runEvents(runId: string, since?: number, limit?: number): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams();
    if (since != null) qs.set("after", String(since));
    if (limit != null) qs.set("limit", String(limit));
    const path = `/api/runs/${encodeURIComponent(runId)}/events`;
    return (await this.request(qs.size > 0 ? `${path}?${qs}` : path)) as Record<string, unknown>;
  }

  /** Open the main server's live run stream (`GET /api/runs/:id/stream`) as SSE. */
  async openRunStream(runId: string, signal?: AbortSignal): Promise<Response> {
    const u = new URL(`/api/runs/${encodeURIComponent(runId)}/stream`, this.cfg.url);
    return fetch(u, {
      headers: { accept: "text/event-stream", ...this.authHeaders() },
      signal,
    });
  }
}
