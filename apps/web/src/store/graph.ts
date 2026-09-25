import { create } from "zustand";
import { temporal } from "zundo";
import type { Graph, GraphEdge, GraphNode, NodeKind } from "@agent-world/core";
import i18n from "../i18n";
import { api, GraphConflictError, type Modality } from "../lib/api";
import { arrangeVariantLanes, duplicateLaneStructure } from "../canvas/layout";

/** Cached settings used to seed newly added nodes with a sensible model. */
export interface ModelOption {
  provider: string;
  model: string;
  modality: Modality;
  enabled: boolean;
}
let cachedModelOptions: ModelOption[] = [];
/** The user's configured default model, as last read from settings. Only used
 *  to label an empty model slot ("跟随默认 · <name>") — never to rewrite one. */
let cachedDefaultModel = "";

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
    // Unauthenticated (still on the login screen) or transient failure.
    // Leave the list AND the ready flag untouched: marking ready=true here
    // while the list is empty made the first graph load after login treat a
    // valid built-in model as unknown and wipe it (demo zero-config 422).
    return;
  }
  // Tell one-shot consumers (e.g. the Inspector's model dropdowns) that the
  // settings snapshot changed so they refetch — otherwise models added in the
  // Settings overlay stay invisible until a full page reload.
  window.dispatchEvent(new Event("aw:settings-changed"));
}
void refreshDefaultModel();

/** Read the cached enabled model options (built-in + user-configured).
 *  The Model Assign modal groups these by modality as pick candidates. */
export function getModelOptions(): ModelOption[] {
  return cachedModelOptions;
}

/**
 * Pick the best model for a given node kind. The user's "default model" only
 * wins when it actually matches the modality this node needs — otherwise we
 * fall back to the first enabled provider/model that does. Returns null if no
 * candidate exists; callers should surface a friendly error and skip creation.
 * Exported for the Inspector: an empty slot is labelled "跟随默认 · <this>".
 */
export function defaultModelFor(
  kind: NodeKind,
  cached: ReadonlyArray<ModelOption> = cachedModelOptions,
  defaultModel: string = cachedDefaultModel,
): { provider: string; model: string; modality: Modality } | null {
  const wanted = modalityForKind(kind);
  if (!wanted) return null;
  // Prefer the user's default model if its modality matches.
  const fromDefault = cached.find(
    (o) => o.model === defaultModel && o.modality === wanted && o.enabled,
  );
  if (fromDefault) return { provider: fromDefault.provider, model: fromDefault.model, modality: wanted };
  // Otherwise prefer a REAL provider (anything not the internal fake
  // worker). Legacy configs may still carry a "demo"/"fake" provider from
  // before the demo tier was removed, so keep excluding them to respect the
  // user's configured models when they exist.
  const real = cached.find((o) => o.modality === wanted && o.enabled && o.provider !== "demo" && o.provider !== "fake");
  if (real) return { provider: real.provider, model: real.model, modality: wanted };
  // No real model — fall back to the first enabled model so addNode can
  // still succeed for a brand-new user with zero configured models.
  const fallback = cached.find((o) => o.modality === wanted && o.enabled);
  if (fallback) return { provider: fallback.provider, model: fallback.model, modality: wanted };
  return null;
}

// 这里曾经有一个"打开产线时自动改模型"的迁移（remapNodeModel /
// migrateGraphModels）：它把"不认识或为空"的模型重写成当时可用的具体模型并自动
// 存盘。两个理由使它必须消失：① 它是 #53 零配置首跑 422 的根因（选项还没加载就
// 把有效的内置模型抹成空串）；② 规则 B 之后"空"是有意义的槽位、「已下架的钉名」
// 应该报错让用户自己重选（规则 A），静默改绑下一个可用模型正是我们不要的行为。
// 现在打开一张图永远不会改它的模型字段。

/** Map a node kind to the modality its worker executes against. */
function modalityForKind(kind: NodeKind): Modality | null {
  switch (kind) {
    case "textGen":
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
  /** When true, suppresses auto-save and flushSave (viewer mode). */
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;
  setGraph: (graph: Graph) => void;
  /** Reload server version after a conflict resolution / forced refresh. */
  syncServerVersion: (version: number | null) => void;
  /** Single-select a node (clears all other selection). */
  select: (id: string | null) => void;
  /**
   * Whether the right-hand Inspector panel should be visible. The panel is
   * opened by an explicit canvas *click* (not by selection, which also happens
   * when a node is dragged into place) — see Canvas.onPointerUp.
   */
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
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
  /** Auto-arrange a fanout's variant lanes into parallel tracks (F10). */
  arrangeLanes: (fanoutId: string) => void;
  /** Duplicate a fanout's first lane structure across its variant count (F10). */
  duplicateLanes: (fanoutId: string) => void;
  /** Collapsed fanout lane groups, keyed by fanout id (F10). */
  collapsedFans: Record<string, boolean>;
  toggleLaneCollapse: (fanoutId: string) => void;
  /**
   * Batch-assign a model to the given AI nodes (textGen/imageGen/videoGen/
   * audioGen). Only the `model` field of each node's sub-config is written —
   * prompts, skills and other settings are untouched. Returns how many
   * nodes actually changed.
   */
  assignModel: (ids: string[], model: string) => number;
  /** Replace the graph's default variables (cross-run persisted state). */
  updateGraphVariables: (variables: Record<string, unknown>) => void;
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
  textGen: {
    textGen: {
      // 空槽 = 跟随当前默认模型（design-model-catalog 规则 B）。写死内置模型名
      // 会让"换默认"对新建节点无效，并且每个型号都是另一个供应商的方言。
      model: "",
      prompt: "",
      skills: [],
      temperature: 0.7,
      timeoutMs: 120000,
      inputPolicy: { mode: "all" },
      retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 },
    },
  },
  gate: { gate: { maxAttempts: 3, criterion: "", onExhausted: "halt", skills: [] } },
  imageGen: { imageGen: { model: "", prompt: "", n: 1 } },
  videoGen: { videoGen: { model: "", prompt: "", n: 1 } },
  audioGen: { audioGen: { model: "", prompt: "", format: "mp3", n: 1 } },
  http: { http: { method: "GET", url: "", headers: {}, query: {}, timeoutMs: 30000, outputMode: "auto", failOnError: true, retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 } } },
  code: { code: { language: "javascript", code: "", timeoutMs: 30000, retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 }, env: [], fs: "sandbox", net: "none" } },
  branch: { branch: { rules: [], defaultTarget: undefined } },
  map: { map: { template: "{}" } },
  loop: { loop: { maxIterations: 100 } },
  parallel: { parallel: { asObject: false } },
  table: { table: { steps: [] } },
  database: { database: { setupSql: "", sql: "" } },
  fileParse: { fileParse: { maxImages: 20 } },
  translate: { translate: { target: "简体中文", temperature: 0.2, retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 } } },
  ocr: { ocr: { lang: "eng" } },
  convert: { convert: { to: "image", quality: 85 } },
  search: { search: { query: "", provider: "duckduckgo", maxResults: 5, retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 } } },
  notify: { notify: { provider: "feishu", format: "text", message: "", retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 } } },
  vcs: { vcs: { provider: "github", action: "list_issues", body: "", retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 } } },
  human: { human: { prompt: "" } },
  subprocess: { subprocess: { graphId: "", maxDepth: 3 } },
  generic: { generic: { model: "", prompt: "", skills: [], modality: "text", retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 } } },
  compliance: { compliance: { platform: "xiaohongshu", extraBanned: "", autoFix: true, failOnViolation: false } },
  publish: { publish: { platform: "xiaohongshu" } },
  fanout: { fanout: { count: 3, strategy: "prompt", angleBrief: "" } },
  select: { select: { mode: "llm_score", topK: 1, rubric: "", passThroughAll: false } },
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const historyBatch = { depth: 0, start: null as Graph | null };

// Saves are serialized: a debounced auto-save and a flushSave issued while the
// auto-save's PUT is still in flight would race on the server (the unconditional
// upsert bumps the version, the conditional PUT then 409s on the stale If-Match).
let saveChain: Promise<unknown> = Promise.resolve();
function enqueueSave(task: () => Promise<void>): Promise<void> {
  const run = saveChain.then(task, task);
  saveChain = run.catch(() => undefined);
  return run;
}

function scheduleSave(graph: Graph) {
  if (useGraph.getState().readOnly) return;
  if (saveTimer) clearTimeout(saveTimer);
  useGraph.setState({ saveState: "saving" });
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void enqueueSave(async () => {
      try {
        const res = await api.saveGraph(graph);
        // Track the server version: the upsert bumped it, and the next
        // conditional save (flushSave) would 409 on a stale If-Match.
        useGraph.setState({ saveState: "saved", serverVersion: res.version });
      } catch (err) {
        console.error("auto-save failed", err);
        useGraph.setState({ saveState: "error" });
      }
    });
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
      readOnly: false,
      collapsedFans: {},

      // Accepts a graph possibly carrying a server-injected `version` field
      // (from GET /api/graphs/:id). Strip it from the document (it is not part
      // of the Graph schema) and remember it for the next conditional save.
      setGraph: (graph) => {
        const withVersion = graph as Graph & { version?: number };
        const version = typeof withVersion.version === "number" ? withVersion.version : undefined;
        // 打开一张图不再改它的模型字段（理由见 remapNodeModel 原位留下的注释）：
        // 版本快照与 contentHash 认的是文档字节，读取时重写会同时毁掉它们和
        // "跟随默认"的空槽。
        const doc = (version != null ? (() => {
          const { version: _v, ...rest } = withVersion;
          void _v;
          return rest;
        })() : graph) as Graph;
        if (version != null) {
          set({ graph: doc, serverVersion: version, saveState: "saved" });
        } else {
          set({ graph: doc });
        }
      },
      syncServerVersion: (serverVersion) => set({ serverVersion }),
      setReadOnly: (v: boolean) => set({ readOnly: v }),

      reloadGraph: async () => {
        const id = get().graph.id;
        const fresh = await api.getGraph(id);
        const { version, ...doc } = fresh;
        set({ graph: doc as Graph, serverVersion: version, saveState: "saved" });
      },
      select: (id) => set({ selectedId: id, selectedNodeIds: id ? [id] : [], selectedEdgeIds: [] }),

      inspectorOpen: false,
      setInspectorOpen: (open) => set({ inspectorOpen: open }),

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
        // Warm the cache if the first add raced the background fetch; the model
        // options arrive via the settings-changed event, nothing is rewritten.
        if (cachedModelOptions.length === 0) void refreshDefaultModel();
        const wanted = modalityForKind(kind);
        const id = nextId(kind[0]!);
        const node: GraphNode = {
          id,
          kind,
          name: `${kind.toUpperCase()}-${id.slice(-4)}`,
          x: snap(x),
          y: snap(y),
          ...DEFAULTS[kind],
        };
        // 新建节点带的是空模型槽（DEFAULTS 里 `model: ""`）：派发时由服务端的
        // resolveModelSlots 换成「该模态的当前默认」（design-model-catalog 规则
        // B），所以换内置模型不需要用户回来点一遍。defaultModelFor 在这里只是
        // 探针——该模态一个可用模型都没有时，返回 missingModality 让调用方给出
        // "先去模型设置里添加"的提示，而不是往节点里写名字。
        set((s) => {
          useGraph.temporal.getState().resume();
          const graph = { ...s.graph, nodes: [...s.graph.nodes, node] };
          scheduleSave(graph);
          return { graph, selectedId: id, selectedNodeIds: [id], selectedEdgeIds: [] };
        });
        return {
          id,
          missingModality: wanted && !defaultModelFor(kind) ? wanted : null,
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
          name: i18n.t("canvas:copySuffix", { name: src.name }),
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
          if (from === to) return { ok: false, reason: i18n.t("errors:graph.selfLoop") };
          const exists = state.graph.edges.some((e) => e.from === from && e.to === to);
          if (exists) return { ok: false, reason: i18n.t("errors:graph.duplicateEdge") };
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

      arrangeLanes: (fanoutId) => {
        useGraph.temporal.getState().resume();
        set((s) => {
          const graph = arrangeVariantLanes(s.graph, fanoutId);
          scheduleSave(graph);
          return { graph };
        });
      },

      duplicateLanes: (fanoutId) => {
        useGraph.temporal.getState().resume();
        set((s) => {
          const graph = duplicateLaneStructure(s.graph, fanoutId);
          scheduleSave(graph);
          return { graph };
        });
      },

      toggleLaneCollapse: (fanoutId) =>
        set((s) => ({
          collapsedFans: { ...s.collapsedFans, [fanoutId]: !s.collapsedFans[fanoutId] },
        })),

      assignModel: (ids, model) => {
        if (!model.trim() || ids.length === 0) return 0;
        const idSet = new Set(ids);
        let changed = 0;
        useGraph.temporal.getState().resume();
        set((s) => {
          const nodes = s.graph.nodes.map((n) => {
            if (!idSet.has(n.id)) return n;
            // Write only the model field of the kind's sub-config; every
            // other setting (prompt, skills, n, voice…) stays as-is.
            let next: GraphNode = n;
            if (n.kind === "textGen" && n.textGen) {
              if (n.textGen.model === model) return n;
              next = { ...n, textGen: { ...n.textGen, model } };
            } else if (n.kind === "imageGen" && n.imageGen) {
              if (n.imageGen.model === model) return n;
              next = { ...n, imageGen: { ...n.imageGen, model } };
            } else if (n.kind === "videoGen" && n.videoGen) {
              if (n.videoGen.model === model) return n;
              next = { ...n, videoGen: { ...n.videoGen, model } };
            } else if (n.kind === "audioGen" && n.audioGen) {
              if (n.audioGen.model === model) return n;
              next = { ...n, audioGen: { ...n.audioGen, model } };
            } else {
              // Non-AI kinds carry no model field — skip silently.
              return n;
            }
            changed += 1;
            return next;
          });
          const graph = { ...s.graph, nodes };
          if (changed > 0) scheduleSave(graph);
          return changed > 0 ? { graph } : s;
        });
        return changed;
      },

      updateGraphVariables: (variables) =>
        set((s) => {
          const graph = {
            ...s.graph,
            variables: Object.keys(variables).length ? variables : undefined,
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
        if (get().readOnly) return;
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        // Serialized with pending auto-saves so this conditional PUT carries an
        // If-Match that reflects every save the server has already accepted.
        await enqueueSave(async () => {
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
            throw err; // M22: rethrow so callers (switch-graph) can react to failure
          }
        });
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
