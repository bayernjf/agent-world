import { create } from "zustand";
import { temporal } from "zundo";
import type { Graph, GraphEdge, GraphNode, NodeKind } from "@agent-world/core";
import { api, GraphConflictError } from "../lib/api";

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
/** Nodes snap to this grid so the board stays tidy and pipes line up. */
export const GRID = 20;

export const snap = (v: number) => Math.round(v / GRID) * GRID;

/**
 * The graph is the document: the user edits it directly and it is undoable.
 * Runtime state lives in a separate store because it is derived from the event
 * stream and must never be hand-edited — see store/run.ts.
 */
interface GraphState {
  graph: Graph;
  selectedId: string | null;
  saveState: "idle" | "saving" | "saved" | "error" | "conflict";
  /** Document version last loaded/saved from the server, for optimistic locking. */
  serverVersion: number | null;
  setGraph: (graph: Graph) => void;
  /** Reload server version after a conflict resolution / forced refresh. */
  syncServerVersion: (version: number | null) => void;
  select: (id: string | null) => void;
  moveNode: (id: string, x: number, y: number) => void;
  addNode: (kind: NodeKind, x: number, y: number) => void;
  duplicateNode: (id: string, dx?: number, dy?: number) => string | null;
  removeNode: (id: string) => void;
  addEdge: (from: string, to: string, kind: GraphEdge["kind"]) => { ok: boolean; reason?: string };
  removeEdge: (id: string) => void;
  updateNode: (id: string, patch: Partial<GraphNode>) => void;
  beginHistoryBatch: () => void;
  commitHistoryBatch: () => void;
  abortHistoryBatch: () => void;
  undo: () => void;
  redo: () => void;
  flushSave: () => Promise<void>;
  reloadGraph: () => Promise<void>;
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
      inputPolicy: { mode: "all" },
      retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 },
    },
  },
  gate: { gate: { maxAttempts: 3, criterion: "", onExhausted: "halt" } },
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const historyBatch = { depth: 0, start: null as Graph | null };

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
    (set, get) => ({
      graph: EMPTY,
      selectedId: null,
      saveState: "idle",
      serverVersion: null,

      // Accepts a graph possibly carrying a server-injected `version` field
      // (from GET /api/graphs/:id). Strip it from the document (it is not part
      // of the Graph schema) and remember it for the next conditional save.
      setGraph: (graph) => {
        const withVersion = graph as Graph & { version?: number };
        const version = typeof withVersion.version === "number" ? withVersion.version : undefined;
        if (version != null) {
          const { version: _v, ...doc } = withVersion;
          void _v;
          set({ graph: doc as Graph, serverVersion: version, saveState: "saved" });
        } else {
          set({ graph });
        }
      },
      syncServerVersion: (serverVersion) => set({ serverVersion }),

      reloadGraph: async () => {
        const id = get().graph.id;
        const fresh = await api.getGraph(id);
        const { version, ...doc } = fresh;
        set({ graph: doc as Graph, serverVersion: version, saveState: "saved" });
      },
      select: (selectedId) => set({ selectedId }),

      moveNode: (id, x, y) =>
        set((s) => {
          const sx = snap(x);
          const sy = snap(y);
          const graph = {
            ...s.graph,
            nodes: s.graph.nodes.map((n) => (n.id === id ? { ...n, x: sx, y: sy } : n)),
          };
          scheduleSave(graph);
          return { graph };
        }),

      addNode: (kind, x, y) =>
        set((s) => {
          useGraph.temporal.getState().resume();
          const id = nextId(kind[0]!);
          const node: GraphNode = {
            id,
            kind,
            name: `${kind.toUpperCase()}-${id.slice(-4)}`,
            x: snap(x),
            y: snap(y),
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
          useGraph.temporal.getState().resume();
          const graph = {
            ...s.graph,
            nodes: s.graph.nodes.filter((n) => n.id !== id),
            edges: s.graph.edges.filter((e) => e.from !== id && e.to !== id),
          };
          scheduleSave(graph);
          return { graph, selectedId: s.selectedId === id ? null : s.selectedId };
        }),

      duplicateNode: (id, dx = 30, dy = 30) => {
        useGraph.temporal.getState().resume();
        const state = get();
        const src = state.graph.nodes.find((n) => n.id === id);
        if (!src) return null;
        const newId = nextId(src.kind[0]!);
        const { id: _omit, ...rest } = src;
        const node: GraphNode = {
          ...rest,
          id: newId,
          name: `${src.name} 副本`,
          x: snap(src.x + dx),
          y: snap(src.y + dy),
        };
        const graph = { ...state.graph, nodes: [...state.graph.nodes, node] };
        set({ graph, selectedId: newId });
        scheduleSave(graph);
        return newId;
      },

      addEdge: (from, to, kind) =>
        {
          const state = get();
          useGraph.temporal.getState().resume();
          if (from === to) return { ok: false, reason: "不能连接到自身" };
          const exists = state.graph.edges.some((e) => e.from === from && e.to === to);
          if (exists) return { ok: false, reason: "这条管道已经存在" };
          set((s) => {
          const edge: GraphEdge = { id: nextId("e"), from, to, kind };
          const graph = { ...s.graph, edges: [...s.graph.edges, edge] };
          scheduleSave(graph);
          return { graph };
          });
          return { ok: true };
        },

      removeEdge: (id) =>
        set((s) => {
          useGraph.temporal.getState().resume();
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

      beginHistoryBatch: () => {
        historyBatch.depth += 1;
        if (historyBatch.depth === 1) {
          historyBatch.start = get().graph;
        }
      },

      commitHistoryBatch: () => {
        historyBatch.depth = Math.max(0, historyBatch.depth - 1);
        if (historyBatch.depth !== 0) return;
        const start = historyBatch.start;
        historyBatch.start = null;
        if (!start || start === get().graph) return;
        const setTemporal = useGraph.temporal as unknown as {
          setState: (fn: (st: { pastStates: unknown[]; futureStates: unknown[] }) => {
            pastStates: unknown[];
            futureStates: unknown[];
          }) => void;
        };
        setTemporal.setState((st) => ({
          pastStates: [...st.pastStates, { graph: start }],
          futureStates: [],
        }));
      },

      abortHistoryBatch: () => {
        historyBatch.depth = Math.max(0, historyBatch.depth - 1);
        if (historyBatch.depth === 0) historyBatch.start = null;
      },

      undo: () => {
        useGraph.temporal.getState().undo();
        scheduleSave(get().graph);
      },

      redo: () => {
        useGraph.temporal.getState().redo();
        scheduleSave(get().graph);
      },

      flushSave: async () => {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        const graph = get().graph;
        const version = get().serverVersion;
        useGraph.setState({ saveState: "saving" });
        try {
          const res = await api.saveGraph(graph, version);
          useGraph.setState({ saveState: "saved", serverVersion: res.version });
        } catch (err) {
          console.error("flush save failed", err);
          useGraph.setState({
            saveState: err instanceof GraphConflictError ? "conflict" : "error",
          });
        }
      },
    }),
    // Only the document is undoable; selection and save state are view state.
    // Compare by graph reference: graph is replaced immutably on every real edit
    // and left untouched by save-state/saveState writes, so this skips the
    // spurious history entries that autosave would otherwise create (which made
    // a single delete require two undos).
    {
      partialize: (s) => ({ graph: s.graph }),
      equality: (a, b) => a.graph === b.graph,
      handleSet: (defaultHandleSet) => (...args) => {
        if (historyBatch.depth > 0) return;
        (defaultHandleSet as (...args: unknown[]) => void)(...args);
      },
      limit: 50,
    },
  ),
);

export const useTemporal = () => useGraph.temporal.getState();
