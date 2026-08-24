import { create } from "zustand";
import { temporal } from "zundo";
import type { Graph, GraphEdge, GraphNode, NodeKind } from "@agent-world/core";

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
  agent: { agent: { model: "claude-sonnet-5", prompt: "", skills: [] } },
  gate: { gate: { maxAttempts: 3, criterion: "", onExhausted: "halt" } },
};

export const useGraph = create<GraphState>()(
  temporal(
    (set) => ({
      graph: EMPTY,
      selectedId: null,

      setGraph: (graph) => set({ graph }),
      select: (selectedId) => set({ selectedId }),

      moveNode: (id, x, y) =>
        set((s) => ({
          graph: {
            ...s.graph,
            nodes: s.graph.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
          },
        })),

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
          return { graph: { ...s.graph, nodes: [...s.graph.nodes, node] }, selectedId: id };
        }),

      removeNode: (id) =>
        set((s) => ({
          graph: {
            ...s.graph,
            nodes: s.graph.nodes.filter((n) => n.id !== id),
            edges: s.graph.edges.filter((e) => e.from !== id && e.to !== id),
          },
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),

      addEdge: (from, to, kind) =>
        set((s) => {
          const exists = s.graph.edges.some((e) => e.from === from && e.to === to);
          if (exists || from === to) return s;
          const edge: GraphEdge = { id: nextId("e"), from, to, kind };
          return { graph: { ...s.graph, edges: [...s.graph.edges, edge] } };
        }),

      removeEdge: (id) =>
        set((s) => ({ graph: { ...s.graph, edges: s.graph.edges.filter((e) => e.id !== id) } })),

      updateNode: (id, patch) =>
        set((s) => ({
          graph: {
            ...s.graph,
            nodes: s.graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
          },
        })),
    }),
    // Only the document is undoable; selection is view state.
    { partialize: (s) => ({ graph: s.graph }), limit: 50 },
  ),
);

export const useTemporal = () => useGraph.temporal.getState();
