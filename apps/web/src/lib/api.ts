import type { CompileResult, Graph, RunEvent, RuntimeState } from "@agent-world/core";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  getGraph: (id: string) => fetch(`/api/graphs/${id}`).then(json<Graph>),

  saveGraph: (graph: Graph) =>
    fetch(`/api/graphs/${graph.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(graph),
    }).then(json<{ ok: true }>),

  compile: (graph: Graph) =>
    fetch("/api/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(graph),
    }).then(json<CompileResult>),

  startRun: (graphId: string, budgetUsd: number | null) =>
    fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graphId, budgetUsd }),
    }).then(json<{ runId: string }>),

  cancelRun: (runId: string) =>
    fetch(`/api/runs/${runId}/cancel`, { method: "POST" }).then(json<{ ok: true }>),

  getEvents: (runId: string) =>
    fetch(`/api/runs/${runId}/events`).then(json<{ events: RunEvent[]; state: RuntimeState }>),
};
