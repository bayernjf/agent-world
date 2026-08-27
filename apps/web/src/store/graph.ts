import { create } from "zustand";
import { temporal } from "zundo";
import type { Graph, GraphEdge, GraphNode, NodeKind } from "@agent-world/core";
import { api, GraphConflictError, type Modality } from "../lib/api";

/** Cached settings used to seed newly added nodes with a sensible model. */
interface ModelOption {
  provider: string;
  model: string;
  modality: Modality;
  enabled: boolean;
}
let cachedModelOptions: ModelOption[] = [];
/** Last known default model id; used as a last-ditch fallback for `agent` nodes. */
let cachedDefaultModel = "agnes-2.0-flash";

function flattenModelOptions(cfg: {
  providers: Record<string, { models?: string[]; modalities?: Record<string, Modality>; enabled?: boolean }>;
}): ModelOption[] {
  const out: ModelOption[] = [];
  for (const [providerName, p] of Object.entries(cfg.providers)) {
    if (p.enabled === false) continue;
    for (const model of p.models ?? []) {
      out.push({
        provider: providerName,
        model,
        modality: p.modalities?.[model] ?? "text",
        enabled: true,
      });
    }
  }
  return out;
}

export async function refreshDefaultModel() {
  try {
    const cfg = await api.getSettings();
    cachedModelOptions = flattenModelOptions(cfg);
    if (cfg.defaultModel) cachedDefaultModel = cfg.defaultModel;
  } catch {
    // keep last known / fallback
  }
}
void refreshDefaultModel();

/**
 * Pick the best model for a given node kind. The user's "default model" only
 * wins when it actually matches the modality this node needs — otherwise we
 * fall back to the first enabled provider/model that does. Returns null if no
 * candidate exists; callers should surface a friendly error and skip creation.
 */
function defaultModelFor(
  kind: NodeKind,
): { provider: string; model: string; modality: Modality } | null {
  const wanted = modalityForKind(kind);
  if (!wanted) return null;
  // Prefer the user's default model if its modality matches.
  const fromDefault = cachedModelOptions.find(
    (o) => o.model === cachedDefaultModel && o.modality === wanted && o.enabled,
  );
  if (fromDefault) return { provider: fromDefault.provider, model: fromDefault.model, modality: wanted };
  // Otherwise take the first enabled option for that modality.
  const fallback = cachedModelOptions.find((o) => o.modality === wanted && o.enabled);
  if (fallback) return { provider: fallback.provider, model: fallback.model, modality: wanted };
  // No real model found — return null so the caller can show a soft warning
  // at add time. Dispatch is the actual gatekeeper that refuses to run a
  // graph with empty model fields.
  return null;
}

/** Map a node kind to the modality its worker executes against. */
function modalityForKind(kind: NodeKind): Modality | null {
  switch (kind) {
    case "agent":
      return "text";
    case "imageGen":
      return "image";
    case "videoGen":
      return "video";
    case "audioGen":
      return "audio";
    default:
      return null;
  }
}

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
  /** @deprecated Use selectedNodeIds instead. Returns the first selected node id (or null). */
  selectedId: string | null;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  saveState: "idle" | "saving" | "saved" | "error" | "conflict";
  /** Document version last loaded/saved from the server, for optimistic locking. */
  serverVersion: number | null;
  setGraph: (graph: Graph) => void;
  /** Reload server version after a conflict resolution / forced refresh. */
  syncServerVersion: (version: number | null) => void;
  /** Single-select a node (clears all other selection). */
  select: (id: string | null) => void;
  /** Toggle a node in the selection. If additive is false, replaces selection. */
  toggleNode: (id: string, additive?: boolean) => void;
  /** Toggle an edge in the selection. If additive is false, replaces selection. */
  toggleEdge: (id: string, additive?: boolean) => void;
  /** Clear all selection. */
  selectNone: () => void;
  /** Select all nodes. */
  selectAllNodes: () => void;
  moveNode: (id: string, x: number, y: number) => void;
  /** Move multiple nodes by relative dx/dy (used for multi-select dragging). */
  moveNodes: (ids: string[], dx: number, dy: number) => void;
  /**
   * Add a node of the given kind at (x, y). Always succeeds: when the kind
   * needs a model but no configured provider supports the required modality,
   * the model field is left empty and `missingModality` is returned so the
   * UI can show a soft warning. The dispatch endpoint is the gatekeeper that
   * actually refuses to run a graph with empty models.
   */
  addNode: (kind: NodeKind, x: number, y: number) => {
    id: string;
    /** Set when the kind needs a model but no configured model matched. */
    missingModality: Modality | null;
  };
  duplicateNode: (id: string, dx?: number, dy?: number) => string | null;
  removeNode: (id: string) => void;
  addEdge: (from: string, to: string, kind: GraphEdge["kind"]) => { ok: boolean; reason?: string };
  removeEdge: (id: string) => void;
  /** Delete all selected nodes and edges. */
  deleteSelected: () => void;
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
  imageGen: { imageGen: { model: "agnes-image", prompt: "", n: 1 } },
  videoGen: { videoGen: { model: "video-gen", prompt: "", n: 1 } },
  audioGen: { audioGen: { model: "tts-1", prompt: "", format: "mp3", n: 1 } },
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
      selectedNodeIds: [],
      selectedEdgeIds: [],
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
      select: (id) => set({ selectedId: id, selectedNodeIds: id ? [id] : [], selectedEdgeIds: [] }),

      toggleNode: (id, additive = false) =>
        set((s) => {
          if (!additive) {
            return { selectedId: id, selectedNodeIds: [id], selectedEdgeIds: [] };
          }
          const exists = s.selectedNodeIds.includes(id);
          const next = exists ? s.selectedNodeIds.filter((x) => x !== id) : [...s.selectedNodeIds, id];
          return { selectedId: next[0] ?? null, selectedNodeIds: next, selectedEdgeIds: [] };
        }),

      toggleEdge: (id, additive = false) =>
        set((s) => {
          if (!additive) {
            return { selectedId: null, selectedNodeIds: [], selectedEdgeIds: [id] };
          }
          const exists = s.selectedEdgeIds.includes(id);
          const next = exists ? s.selectedEdgeIds.filter((x) => x !== id) : [...s.selectedEdgeIds, id];
          return { selectedEdgeIds: next, selectedNodeIds: [], selectedId: null };
        }),

      selectNone: () => set({ selectedId: null, selectedNodeIds: [], selectedEdgeIds: [] }),

      selectAllNodes: () =>
        set((s) => {
          const ids = s.graph.nodes.map((n) => n.id);
          return { selectedId: ids[0] ?? null, selectedNodeIds: ids, selectedEdgeIds: [] };
        }),

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

      moveNodes: (ids, dx, dy) =>
        set((s) => {
          const idSet = new Set(ids);
          const sdx = snap(dx);
          const sdy = snap(dy);
          if (sdx === 0 && sdy === 0) return s;
          const graph = {
            ...s.graph,
            nodes: s.graph.nodes.map((n) =>
              idSet.has(n.id) ? { ...n, x: snap(n.x + sdx), y: snap(n.y + sdy) } : n,
            ),
          };
          scheduleSave(graph);
          return { graph };
        }),

      addNode: (kind, x, y) => {
        const wanted = modalityForKind(kind);
        const seed = wanted ? defaultModelFor(kind) : null;
        const id = nextId(kind[0]!);
        const node: GraphNode = {
          id,
          kind,
          name: `${kind.toUpperCase()}-${id.slice(-4)}`,
          x: snap(x),
          y: snap(y),
          ...DEFAULTS[kind],
        };
        // Stamp the resolved model onto the kind's sub-config when we have
        // one. When no model matches the modality, clear the placeholder
        // model that DEFAULTS seeded so the dispatch endpoint can detect
        // the empty config and surface a clear "configure the model first"
        // error.
        if (seed) {
          if (kind === "agent" && node.agent) {
            node.agent = { ...node.agent, model: seed.model };
          } else if (kind === "imageGen" && node.imageGen) {
            node.imageGen = { ...node.imageGen, model: seed.model };
          } else if (kind === "videoGen" && node.videoGen) {
            node.videoGen = { ...node.videoGen, model: seed.model };
          } else if (kind === "audioGen" && node.audioGen) {
            node.audioGen = { ...node.audioGen, model: seed.model };
          }
        } else if (wanted) {
          if (kind === "agent" && node.agent) {
            node.agent = { ...node.agent, model: "" };
          } else if (kind === "imageGen" && node.imageGen) {
            node.imageGen = { ...node.imageGen, model: "" };
          } else if (kind === "videoGen" && node.videoGen) {
            node.videoGen = { ...node.videoGen, model: "" };
          } else if (kind === "audioGen" && node.audioGen) {
            node.audioGen = { ...node.audioGen, model: "" };
          }
        }
        set((s) => {
          useGraph.temporal.getState().resume();
          const graph = { ...s.graph, nodes: [...s.graph.nodes, node] };
          scheduleSave(graph);
          return { graph, selectedId: id, selectedNodeIds: [id], selectedEdgeIds: [] };
        });
        return {
          id,
          missingModality: wanted && !seed ? wanted : null,
        };
      },

      removeNode: (id) =>
        set((s) => {
          useGraph.temporal.getState().resume();
          const graph = {
            ...s.graph,
            nodes: s.graph.nodes.filter((n) => n.id !== id),
            edges: s.graph.edges.filter((e) => e.from !== id && e.to !== id),
          };
          scheduleSave(graph);
          const nextNodeIds = s.selectedNodeIds.filter((x) => x !== id);
          return { graph, selectedId: nextNodeIds[0] ?? null, selectedNodeIds: nextNodeIds };
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
        set({ graph, selectedId: newId, selectedNodeIds: [newId], selectedEdgeIds: [] });
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
          return { graph, selectedEdgeIds: s.selectedEdgeIds.filter((x) => x !== id) };
        }),

      deleteSelected: () =>
        set((s) => {
          if (s.selectedNodeIds.length === 0 && s.selectedEdgeIds.length === 0) return s;
          useGraph.temporal.getState().resume();
          const nodeSet = new Set(s.selectedNodeIds);
          const edgeSet = new Set(s.selectedEdgeIds);
          const graph = {
            ...s.graph,
            nodes: s.graph.nodes.filter((n) => !nodeSet.has(n.id)),
            edges: s.graph.edges.filter(
              (e) => !edgeSet.has(e.id) && !nodeSet.has(e.from) && !nodeSet.has(e.to),
            ),
          };
          scheduleSave(graph);
          return { graph, selectedId: null, selectedNodeIds: [], selectedEdgeIds: [] };
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
