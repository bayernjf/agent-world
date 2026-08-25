import { create } from "zustand";
import { temporal } from "zundo";
import type { Graph, GraphEdge, GraphNode, NodeKind } from "@agent-world/core";
import { api } from "../lib/api";

/** Cached default model for newly created agent nodes. */
let cachedDefaultModel = "agnes-2.0-flash";
export async function refreshDefaultModel() {
  try {
    const cfg = await api.getSettings();
    if (cfg.defaultModel) cachedDefaultModel = cfg.defaultModel;
  } catch {
    // keep last known / fallback
  }
}
void refreshDefaultModel();

export const PLANT_W = 150;
export const PLANT_H = 92;

/**
 * The graph is the document: the user edits it directly and it is undoable.
 * Runtime state lives in a separate store because it is derived from the event
 * stream and must never be hand-edited — see store/run.ts.
 */
interface GraphState {
  graph: Graph;
  selectedId: string | null;
  saveState: "idle" | "saving" | "saved" | "error";
  setGraph: (graph: Graph) => void;
  select: (id: string | null) => void;
  moveNode: (id: string, x: number, y: number) => void;
  addNode: (kind: NodeKind, x: number, y: number) => void;
  removeNode: (id: string) => void;
  addEdge: (from: string, to: string, kind: GraphEdge["kind"]) => void;
  removeEdge: (id: string) => void;
  updateNode: (id: string, patch: Partial<GraphNode>) => void;
}

const EMPTY: Graph = { id: "seed", name: "Pilot Line", nodes: [], edges: [] };

let counter = 0;
const nextId = (prefix: string) => `${prefix}${++counter}-${Math.random().toString(36).slice(2, 6)}`;

const DEFAULTS: Record<NodeKind, Partial<GraphNode>> = {
  source: {},
  sink: {},
  agent: {
    agent: {
      model: "agnes-2.0-flash",
      prompt: "",
      skills: [],
      temperature: 0.7,
      timeoutMs: 120000,
      retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 },
    },
  },
  gate: { gate: { maxAttempts: 3, criterion: "", onExhausted: "halt" } },
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(graph: Graph) {
  if (saveTimer) clearTimeout(saveTimer);
  useGraph.setState({ saveState: "saving" });
  saveTimer = setTimeout(async () => {
    try {
      await api.saveGraph(graph);
      useGraph.setState({ saveState: "saved" });
    } catch (err) {
      console.error("auto-save failed", err);
      useGraph.setState({ saveState: "error" });
    }
  }, 500);
}

export const useGraph = create<GraphState>()(
  temporal(
    (set) => ({
      graph: EMPTY,
      selectedId: null,
      saveState: "idle",

      setGraph: (graph) => set({ graph }),
      select: (selectedId) => set({ selectedId }),

      moveNode: (id, x, y) =>
        set((s) => {
          const graph = {
            ...s.graph,
            nodes: s.graph.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
          };
          scheduleSave(graph);
          return { graph };
        }),

      addNode: (kind, x, y) =>
        set((s) => {
          const id = nextId(kind[0]!);
          const node: GraphNode = {
            id,
            kind,
            name: `${kind.toUpperCase()}-${id.slice(-4)}`,
            x,
            y,
            ...DEFAULTS[kind],
          };
          if (kind === "agent" && node.agent) {
            node.agent = { ...node.agent, model: cachedDefaultModel };
          }
          const graph = { ...s.graph, nodes: [...s.graph.nodes, node] };
          scheduleSave(graph);
          return { graph, selectedId: id };
        }),

      removeNode: (id) =>
        set((s) => {
          const graph = {
            ...s.graph,
            nodes: s.graph.nodes.filter((n) => n.id !== id),
            edges: s.graph.edges.filter((e) => e.from !== id && e.to !== id),
          };
          scheduleSave(graph);
          return { graph, selectedId: s.selectedId === id ? null : s.selectedId };
        }),

      addEdge: (from, to, kind) =>
        set((s) => {
          const exists = s.graph.edges.some((e) => e.from === from && e.to === to);
          if (exists || from === to) return s;
          const edge: GraphEdge = { id: nextId("e"), from, to, kind };
          const graph = { ...s.graph, edges: [...s.graph.edges, edge] };
          scheduleSave(graph);
          return { graph };
        }),

      removeEdge: (id) =>
        set((s) => {
          const graph = { ...s.graph, edges: s.graph.edges.filter((e) => e.id !== id) };
          scheduleSave(graph);
          return { graph };
        }),

      updateNode: (id, patch) =>
        set((s) => {
          const graph = {
            ...s.graph,
            nodes: s.graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
          };
          scheduleSave(graph);
          return { graph };
        }),
    }),
    // Only the document is undoable; selection and save state are view state.
    { partialize: (s) => ({ graph: s.graph }), limit: 50 },
  ),
);

export const useTemporal = () => useGraph.temporal.getState();
