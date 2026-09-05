import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Diagnostic, FormConnector, Graph } from "@agent-world/core";

type FormField = FormConnector["fields"][number];
import Canvas, { type Mode } from "./canvas/Canvas";
import { KIND_KEY } from "./canvas/Plants";
import Minimap from "./canvas/Minimap";
import CanvasToolbar from "./components/CanvasToolbar";
import ControlPanel from "./components/ControlPanel";
import Inspector from "./components/Inspector";
import Logo from "./components/Logo";
import Settings from "./components/Settings";
import ShortcutsHelp from "./components/ShortcutsHelp";
import GraphSwitcher, { type GraphSummary } from "./components/GraphSwitcher";
import ConfirmDialog from "./components/ConfirmDialog";
import NewGraphDialog from "./components/NewGraphDialog";
import UndoRedo from "./components/UndoRedo";
import Toast from "./components/Toast";
import Timeline from "./components/Timeline";
import RunHistory from "./components/RunHistory";
import ReviewQueue from "./components/ReviewQueue";
import ModelAssignModal from "./components/ModelAssignModal";
import VariablesModal from "./components/VariablesModal";
import Tooltip from "./components/Tooltip";
import { useTips } from "./store/tips";
import FailurePanel from "./components/FailurePanel";
import FormConnectorModal from "./components/FormConnectorModal";
import CostReport from "./components/CostReport";
import EvalReport from "./components/EvalReport";
import ABDialog from "./components/ABDialog";
import ABReport from "./components/ABReport";
import BrandTermsModal from "./components/BrandTermsModal";
import ProductLibrary from "./components/ProductLibrary";
import BrandAssets from "./components/BrandAssets";
import BatchManager from "./components/BatchManager";
import CalendarView from "./components/CalendarView";
import PerformanceDashboard from "./components/PerformanceDashboard";
import PublishTargets from "./components/PublishTargets";
import TriggersPanel from "./components/TriggersPanel";
import ProductGallery from "./components/ProductGallery";
import Onboarding from "./components/Onboarding";
import UserMenu from "./components/UserMenu";
import AnnouncementBell from "./components/AnnouncementBell";
import KnowledgePanel from "./components/KnowledgePanel";
import GlossaryModal from "./components/GlossaryModal";
import VersionPanel from "./components/VersionPanel";
import RunCompare from "./components/RunCompare";
import CommandPalette, { type CommandItem } from "./components/CommandPalette";
import { api, DuplicateGraphNameError } from "./lib/api";
import { useToast } from "./store/toast";
import { getTemplate } from "@agent-world/core";
import { useGraph } from "./store/graph";
import { useRun } from "./store/run";

/** How often the HUD badge re-counts runs waiting on a human. */
const REVIEW_POLL_MS = 20_000;

export default function App() {
  const { t } = useTranslation();
  const {
    graph,
    setGraph,
    addNode,
    flushSave,
    undo,
    redo,
    selectedId,
    updateGraphVariables,
    inspectorOpen,
  } = useGraph();
  const { connect, reset, runId, loadRun } = useRun();
  const runStatus = useRun((s) => s.live.status);

  const [mode, setMode] = useState<Mode>("select");
  const [budget, setBudget] = useState(0.01);
  const [rawMaterial, setRawMaterial] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [canRun, setCanRun] = useState(false);
  /** Pop a center-screen error toast with a one-click copy button. */
  const showError = (msg: string) => {
    useToast.getState().show(msg, { ttlMs: 6000 });
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newGraphOpen, setNewGraphOpen] = useState(false);
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<GraphSummary | null>(null);
  const [controlCollapsed, setControlCollapsed] = useState(false);
  // 默认收起，与"无选中节点"状态一致——初始展开会在刷新首帧闪一下又被
  // selectedId effect 收起（下方 421-424 行），造成"出现又收起"的视觉闪烁。
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const saved = localStorage.getItem("inspector-width");
    return saved ? Number(saved) : 420;
  });
  const dragging = useRef(false);
  const dragWidth = useRef(420);
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      dragWidth.current = inspectorWidth;
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const w = Math.min(720, Math.max(280, window.innerWidth - ev.clientX));
        dragWidth.current = w;
        setInspectorWidth(w);
      };
      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        localStorage.setItem("inspector-width", String(dragWidth.current));
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [inspectorWidth],
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  /** Runs parked on a human decision across every line — the HUD badge. */
  const [pendingReviews, setPendingReviews] = useState(0);
  const [modelAssignOpen, setModelAssignOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [abOpen, setABOpen] = useState(false);
  const [abGroup, setABGroup] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [brandAssetsOpen, setBrandAssetsOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [publishTargetsOpen, setPublishTargetsOpen] = useState(false);
  const [triggersOpen, setTriggersOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [graphsReady, setGraphsReady] = useState(false);

  /** Case-insensitive, trimmed duplicate check across the local graph list. */
  const nameTaken = (name: string, excludeId?: string): GraphSummary | null => {
    const target = name.trim().toLowerCase();
    if (!target) return null;
    return (
      graphs.find(
        (g) => g.id !== excludeId && g.name.trim().toLowerCase() === target,
      ) ?? null
    );
  };

  /** Surface a friendly "name already used" message and bail. */
  const reportDuplicate = (
    name: string,
    dup: { name: string } | null,
  ): boolean => {
    if (!dup) return false;
    showError(t("common:app.duplicateName", { name }));
    return true;
  };

  const tipsEnabled = useTips((s) => s.enabled);
  const toggleTips = useTips((s) => s.toggle);
  const bothCollapsed = controlCollapsed && inspectorCollapsed;
  const toggleBoth = () => {
    const next = !bothCollapsed;
    setControlCollapsed(next);
    setInspectorCollapsed(next);
  };

  const MODALITY_PROMPT_LABEL: Record<string, string> = {
    text: "nodes:modality.text",
    image: "nodes:modality.image",
    video: "nodes:modality.video",
    audio: "nodes:modality.audio",
    embedding: "nodes:modality.embedding",
  };

  /** Soft warning when the user adds a node whose modality has no configured
   *  model. Adding still succeeds (model is left empty); dispatch is the
   *  gatekeeper that will refuse to run a graph with empty models. */
  const addNodeOrReport = (
    kind: Parameters<typeof addNode>[0],
    x: number,
    y: number,
  ) => {
    const r = addNode(kind, x, y);
    if (r.missingModality) {
      const label =
        MODALITY_PROMPT_LABEL[r.missingModality] ?? "nodes:modalityFallback";
      showError(t("nodes:missingModality", { modality: t(label) }));
    }
  };

  const commandItems: CommandItem[] = [
    // 节点
    {
      id: "add-source",
      label: t("modals:commandPalette.commands.addSource.label"),
      hint: t("modals:commandPalette.commands.addSource.hint"),
      group: "node",
      onSelect: () => addNodeOrReport("source", 300, 360),
    },
    {
      id: "add-textgen",
      label: t("modals:commandPalette.commands.addTextGen.label"),
      hint: t("modals:commandPalette.commands.addTextGen.hint"),
      group: "node",
      onSelect: () => addNodeOrReport("textGen", 300, 480),
    },
    {
      id: "add-gate",
      label: t("modals:commandPalette.commands.addGate.label"),
      hint: t("modals:commandPalette.commands.addGate.hint"),
      group: "node",
      onSelect: () => addNodeOrReport("gate", 500, 480),
    },
    {
      id: "add-image",
      label: t("modals:commandPalette.commands.addImage.label"),
      hint: t("modals:commandPalette.commands.addImage.hint"),
      group: "node",
      onSelect: () => addNodeOrReport("imageGen", 300, 600),
    },
    {
      id: "add-http",
      label: t("modals:commandPalette.commands.addHttp.label"),
      hint: t("modals:commandPalette.commands.addHttp.hint"),
      group: "node",
      onSelect: () => addNodeOrReport("http", 300, 720),
    },
    {
      id: "add-sink",
      label: t("modals:commandPalette.commands.addSink.label"),
      hint: t("modals:commandPalette.commands.addSink.hint"),
      group: "node",
      onSelect: () => addNodeOrReport("sink", 300, 840),
    },
    {
      id: "add-video",
      label: t("modals:commandPalette.commands.addVideo.label"),
      hint: t("modals:commandPalette.commands.addVideo.hint"),
      group: "node",
      onSelect: () => addNodeOrReport("videoGen", 300, 720),
    },
    {
      id: "add-audio",
      label: t("modals:commandPalette.commands.addAudio.label"),
      hint: t("modals:commandPalette.commands.addAudio.hint"),
      group: "node",
      onSelect: () => addNodeOrReport("audioGen", 300, 840),
    },
    {
      id: "new-graph",
      label: t("modals:commandPalette.commands.newGraph.label"),
      hint: t("modals:commandPalette.commands.newGraph.hint"),
      group: "node",
      onSelect: () => setNewGraphOpen(true),
    },
    // 查看
    {
      id: "history",
      label: t("modals:commandPalette.commands.history.label"),
      hint: t("modals:commandPalette.commands.history.hint"),
      group: "view",
      onSelect: () => setHistoryOpen(true),
    },
    {
      id: "reviews",
      label: t("reviews:command.label"),
      hint: t("reviews:command.hint"),
      group: "view",
      onSelect: () => setReviewOpen(true),
    },
    {
      id: "cost",
      label: t("modals:commandPalette.commands.cost.label"),
      hint: t("modals:commandPalette.commands.cost.hint"),
      group: "view",
      onSelect: () => setCostOpen(true),
    },
    {
      id: "eval",
      label: t("modals:commandPalette.commands.eval.label"),
      hint: t("modals:commandPalette.commands.eval.hint"),
      group: "view",
      onSelect: () => setEvalOpen(true),
    },
    {
      id: "gallery",
      label: t("modals:commandPalette.commands.gallery.label"),
      hint: t("modals:commandPalette.commands.gallery.hint"),
      group: "view",
      onSelect: () => setGalleryOpen(true),
    },
    {
      id: "glossary",
      label: t("modals:commandPalette.commands.glossary.label"),
      hint: t("modals:commandPalette.commands.glossary.hint"),
      group: "view",
      onSelect: () => setGlossaryOpen(true),
    },
    {
      id: "compare",
      label: t("modals:commandPalette.commands.compare.label"),
      hint: t("modals:commandPalette.commands.compare.hint"),
      group: "view",
      onSelect: () => setCompareOpen(true),
    },
    // 自动化
    {
      id: "triggers",
      label: t("modals:commandPalette.commands.triggers.label"),
      hint: t("modals:commandPalette.commands.triggers.hint"),
      group: "automation",
      onSelect: () => setTriggersOpen(true),
    },
    {
      id: "ab",
      label: t("modals:commandPalette.commands.ab.label"),
      hint: t("modals:commandPalette.commands.ab.hint"),
      group: "automation",
      onSelect: () => setABOpen(true),
    },
    // 管理
    {
      id: "settings",
      label: t("modals:commandPalette.commands.settings.label"),
      hint: t("modals:commandPalette.commands.settings.hint"),
      group: "manage",
      onSelect: () => setSettingsOpen(true),
    },
    {
      id: "model-assign",
      label: t("modals:commandPalette.commands.modelAssign.label"),
      hint: t("modals:commandPalette.commands.modelAssign.hint"),
      group: "manage",
      onSelect: () => setModelAssignOpen(true),
    },
    {
      id: "brand",
      label: t("modals:commandPalette.commands.brand.label"),
      hint: t("modals:commandPalette.commands.brand.hint"),
      group: "manage",
      onSelect: () => setBrandOpen(true),
    },
    {
      id: "product",
      label: t("modals:commandPalette.commands.product.label"),
      hint: t("modals:commandPalette.commands.product.hint"),
      group: "manage",
      onSelect: () => setProductOpen(true),
    },
    {
      id: "brand-assets",
      label: t("modals:commandPalette.commands.brandAssets.label"),
      hint: t("modals:commandPalette.commands.brandAssets.hint"),
      group: "manage",
      onSelect: () => setBrandAssetsOpen(true),
    },
    {
      id: "batch",
      label: t("modals:commandPalette.commands.batch.label"),
      hint: t("modals:commandPalette.commands.batch.hint"),
      group: "manage",
      onSelect: () => setBatchOpen(true),
    },
    {
      id: "calendar",
      label: t("modals:commandPalette.commands.calendar.label"),
      hint: t("modals:commandPalette.commands.calendar.hint"),
      group: "manage",
      onSelect: () => setCalendarOpen(true),
    },
    {
      id: "performance",
      label: t("modals:commandPalette.commands.performance.label"),
      hint: t("modals:commandPalette.commands.performance.hint"),
      group: "manage",
      onSelect: () => setPerformanceOpen(true),
    },
    {
      id: "publishTargets",
      label: t("modals:commandPalette.commands.publishTargets.label"),
      hint: t("modals:commandPalette.commands.publishTargets.hint"),
      group: "manage",
      onSelect: () => setPublishTargetsOpen(true),
    },
    {
      id: "knowledge",
      label: t("modals:commandPalette.commands.knowledge.label"),
      hint: t("modals:commandPalette.commands.knowledge.hint"),
      group: "manage",
      onSelect: () => setKnowledgeOpen(true),
    },
    {
      id: "version",
      label: t("modals:commandPalette.commands.version.label"),
      hint: t("modals:commandPalette.commands.version.hint"),
      group: "manage",
      onSelect: () => setVersionOpen(true),
    },
    {
      id: "variables",
      label: t("modals:commandPalette.commands.variables.label"),
      hint: t("modals:commandPalette.commands.variables.hint"),
      group: "manage",
      onSelect: () => setVariablesOpen(true),
    },
    // 画布
    {
      id: "undo",
      label: t("modals:commandPalette.commands.undo.label"),
      group: "canvas",
      shortcut: "⌘Z",
      onSelect: () => undo(),
    },
    {
      id: "redo",
      label: t("modals:commandPalette.commands.redo.label"),
      group: "canvas",
      shortcut: "⇧⌘Z",
      onSelect: () => redo(),
    },
    {
      id: "toggle-panels",
      label: bothCollapsed
        ? t("modals:commandPalette.commands.togglePanels.expand")
        : t("modals:commandPalette.commands.togglePanels.collapse"),
      group: "canvas",
      onSelect: toggleBoth,
    },
    {
      id: "toggle-tips",
      label: tipsEnabled
        ? t("modals:commandPalette.commands.toggleTips.off")
        : t("modals:commandPalette.commands.toggleTips.on"),
      group: "canvas",
      shortcut: "T",
      onSelect: toggleTips,
    },
  ];

  const refreshGraphs = useCallback(async () => {
    try {
      const list = await api.listGraphs();
      setGraphs(list);
      return list;
    } catch (e) {
      showError(String(e));
      return [];
    }
  }, []);

  /** Only the count is read here; the queue itself fetches the rows. */
  const refreshPendingReviews = useCallback(() => {
    api
      .listPendingReviews({ limit: 1 })
      .then((d) => setPendingReviews(d.total))
      // The badge is cosmetic: a failed poll must not toast every 20s.
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshPendingReviews();
    const timer = setInterval(refreshPendingReviews, REVIEW_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshPendingReviews]);

  // A run halting on the canvas lights the badge at once instead of at the next poll.
  useEffect(() => {
    if (runStatus === "halted") refreshPendingReviews();
  }, [runStatus, refreshPendingReviews]);

  const switchGraph = useCallback(
    async (id: string) => {
      if (id === graph.id) return;
      await flushSave();
      reset();
      try {
        const g = await api.getGraph(id);
        setGraph(g);
        useGraph.temporal.getState().clear();
        /* toast cleared by the producer */
      } catch (e) {
        showError(String(e));
      }
    },
    [graph.id, flushSave, reset, setGraph],
  );

  const createGraph = useCallback(
    async (template?: string, fieldValues?: Record<string, string>) => {
      if (template) {
        const tpl = getTemplate(template);
        if (tpl && nameTaken(tpl.name))
          return reportDuplicate(
            tpl.name,
            graphs.find(
              (g) =>
                g.name.trim().toLowerCase() === tpl.name.trim().toLowerCase(),
            ) ?? null,
          );
      }
      try {
        const g = await api.createGraph(
          template ? { template, fieldValues } : undefined,
        );
        await refreshGraphs();
        reset();
        setGraph(g);
        useGraph.temporal.getState().clear();
      } catch (e) {
        if (e instanceof DuplicateGraphNameError) {
          showError(e.message);
          await refreshGraphs();
          return;
        }
        showError(String(e));
      }
    },
    [refreshGraphs, reset, setGraph, graphs, nameTaken],
  );

  const duplicateGraph = useCallback(
    async (id: string) => {
      try {
        const g = await api.createGraph({ from: id });
        await refreshGraphs();
        reset();
        setGraph(g);
        useGraph.temporal.getState().clear();
      } catch (e) {
        if (e instanceof DuplicateGraphNameError) {
          showError(e.message);
          await refreshGraphs();
          return;
        }
        showError(String(e));
      }
    },
    [refreshGraphs, reset, setGraph],
  );

  const renameGraph = useCallback(
    async (id: string, name: string) => {
      const dup = nameTaken(name, id);
      if (dup) return reportDuplicate(name, dup);
      try {
        if (id === graph.id) {
          setGraph({ ...graph, name });
          await flushSave();
        } else {
          const g = await api.getGraph(id);
          await api.saveGraph({ ...g, name });
        }
        await refreshGraphs();
      } catch (e) {
        if (e instanceof DuplicateGraphNameError) {
          showError(e.message);
          await refreshGraphs();
          return;
        }
        showError(String(e));
      }
    },
    [graph, refreshGraphs, setGraph, flushSave, nameTaken],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await api.deleteGraph(targetId);
      let list = await refreshGraphs();
      if (targetId === graph.id) {
        if (list.length === 0) {
          let g: Graph;
          try {
            g = await api.createGraph();
          } catch (e) {
            if (e instanceof DuplicateGraphNameError) {
              showError(e.message);
              return;
            }
            throw e;
          }
          list = await refreshGraphs();
          reset();
          setGraph(g);
        } else {
          await switchGraph(list[0]!.id);
        }
      }
      useGraph.temporal.getState().clear();
    } catch (e) {
      showError(String(e));
    }
  }, [deleteTarget, graph.id, refreshGraphs, reset, setGraph, switchGraph]);

  useEffect(() => {
    refreshGraphs()
      .then((list) => {
        if (list.length > 0) {
          api
            .getGraph(list[0]!.id)
            .then((g) => {
              setGraph(g);
              useGraph.temporal.getState().clear();
            })
            .catch((e) => showError(String(e)));
        }
      })
      .finally(() => setGraphsReady(true));
  }, [refreshGraphs, setGraph]);

  // The compiler is dependency-free, so diagnostics could run locally; going
  // through the server keeps one implementation authoritative while we settle it.
  useEffect(() => {
    if (graph.nodes.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .compile(graph)
        .then((r) => {
          if (cancelled) return;
          setDiagnostics(r.diagnostics);
          setCanRun(r.plan !== null);
        })
        .catch((e) => {
          if (cancelled) return;
          setDiagnostics([
            {
              severity: "error",
              message: t("common:app.compileFailed", { error: String(e) }),
            },
          ]);
          setCanRun(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [graph]);

  // 4B.4: collect form-connector fields from every source node, if any.
  const collectFormFields = useCallback((): FormField[] => {
    const out: FormField[] = [];
    for (const n of graph.nodes) {
      if (n.kind === "source" && n.source?.connector?.type === "form") {
        out.push(...(n.source.connector.form?.fields ?? []));
      }
    }
    return out;
  }, [graph]);

  const [formFields, setFormFields] = useState<FormField[] | null>(null);

  const startRunWith = useCallback(
    async (connectorValues?: Record<string, string>) => {
      try {
        /* toast cleared by the producer */ reset();
        await api.saveGraph(graph);
        const { runId: id } = await api.startRun(
          graph.id,
          budget,
          rawMaterial.trim() || undefined,
          connectorValues,
        );
        connect(id);
      } catch (e) {
        showError(String(e));
      }
    },
    [graph, budget, rawMaterial, connect, reset],
  );

  const onRun = useCallback(() => {
    const fields = collectFormFields();
    if (fields.length) {
      setFormFields(fields);
      return;
    }
    void startRunWith();
  }, [collectFormFields, startRunWith]);

  const onFormSubmit = useCallback(
    (values: Record<string, string>) => {
      setFormFields(null);
      void startRunWith(values);
    },
    [startRunWith],
  );

  const onCancel = useCallback(async () => {
    if (runId) await api.cancelRun(runId).catch(() => undefined);
  }, [runId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // The Inspector panel is opened by an explicit canvas click
  // (store.inspectorOpen, see Canvas.onPointerUp), not by selection alone —
  // otherwise dragging a node into place would pop the panel open too.
  // Deselecting still collapses the panel.
  useEffect(() => {
    if (!selectedId) setInspectorCollapsed(true);
  }, [selectedId]);

  useEffect(() => {
    if (inspectorOpen) {
      setInspectorCollapsed(false);
      useGraph.getState().setInspectorOpen(false);
    }
  }, [inspectorOpen]);

  return (
    <>
      {graphsReady && graphs.length === 0 && (
        <Onboarding onCreate={createGraph} />
      )}
      <div className="app">
        <header className="hud">
          <div className="hud__brand">
            <Logo />
            <span className="hud__brand-text">
              AGENT<span>WORLD</span>
            </span>
          </div>
          <div className="hud__meta">
            <GraphSwitcher
              graphs={graphs}
              currentId={graph.id}
              onSwitch={switchGraph}
              onCreate={() => setNewGraphOpen(true)}
              onDuplicate={duplicateGraph}
              onDelete={(id) =>
                setDeleteTarget(graphs.find((g) => g.id === id) ?? null)
              }
              onRename={renameGraph}
            />
            <span className="muted">
              {graph.nodes.length > 0
                ? Object.entries(
                    graph.nodes.reduce<Record<string, number>>((acc, n) => {
                      acc[n.kind] = (acc[n.kind] ?? 0) + 1;
                      return acc;
                    }, {}),
                  )
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => {
                      const key = KIND_KEY[k as keyof typeof KIND_KEY];
                      return `${v} ${key ? t(key) : k}`;
                    })
                    .join(" · ")
                : t("common:app.zeroNodes")}
            </span>
            <span className="muted">
              {t("common:app.pipeCount", { n: graph.edges.length })}
            </span>
          </div>
          <div className="hud__actions">
            <div className="hud__undo-redo">
              <UndoRedo />
            </div>
            <Tooltip
              content={
                bothCollapsed
                  ? t("common:app.expandPanels")
                  : t("common:app.collapsePanels")
              }
            >
              <button className="chip stage__panel-toggle" onClick={toggleBoth}>
                {bothCollapsed
                  ? t("common:app.expandPanel")
                  : t("common:app.collapsePanel")}
              </button>
            </Tooltip>
            <Tooltip
              content={t("common:app.tipsToggle", {
                state: tipsEnabled
                  ? t("common:app.tipsOn")
                  : t("common:app.tipsOff"),
              })}
            >
              <button
                className={`chip ${tipsEnabled ? "" : "chip--muted"}`}
                onClick={toggleTips}
              >
                {t("common:app.tips")}
              </button>
            </Tooltip>
            <Tooltip content={t("reviews:nav.tooltip")}>
              <button
                className="chip"
                onClick={() => setReviewOpen(true)}
                aria-label={
                  pendingReviews > 0
                    ? t("reviews:nav.badge", { n: pendingReviews })
                    : t("reviews:nav.label")
                }
              >
                {t("reviews:nav.label")}
                {pendingReviews > 0 && (
                  <span className="chip__badge">{pendingReviews}</span>
                )}
              </button>
            </Tooltip>
            <Tooltip content={t("common:app.galleryTooltip")}>
              <button className="chip" onClick={() => setGalleryOpen(true)}>
                {t("common:app.gallery")}
              </button>
            </Tooltip>
            <Tooltip content={t("common:app.glossaryTooltip")}>
              <button className="chip" onClick={() => setGlossaryOpen(true)}>
                {t("common:app.glossary")}
              </button>
            </Tooltip>
            <ShortcutsHelp />
            <Tooltip content={t("common:app.paletteTooltip")}>
              <button
                className="chip hud__menu"
                onClick={() => setPaletteOpen(true)}
                aria-label={t("common:app.paletteAria")}
              >
                {t("common:app.palette")} <kbd className="kbd-inline">⌘K</kbd>
              </button>
            </Tooltip>
            <UserMenu />
            <AnnouncementBell />
          </div>
        </header>

        <div
          className={`workspace ${controlCollapsed ? "workspace--control-collapsed" : ""}`}
        >
          <ControlPanel
            mode={mode}
            setMode={setMode}
            budget={budget}
            setBudget={setBudget}
            rawMaterial={rawMaterial}
            setRawMaterial={setRawMaterial}
            diagnostics={diagnostics}
            canRun={canRun}
            onRun={onRun}
            onCancel={onCancel}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenHistory={() => setHistoryOpen(true)}
            onOpenModelAssign={() => setModelAssignOpen(true)}
          />

          <main className="stage">
            <div className="canvas-toolbar-row">
              <CanvasToolbar onError={showError} />
            </div>
            <Timeline />
            <FailurePanel onRerun={onRun} />
            <Canvas mode={mode} diagnostics={diagnostics} />
            <button
              className={`stage__control-toggle ${controlCollapsed ? "is-collapsed" : ""}`}
              onClick={() => setControlCollapsed((v) => !v)}
              title={
                controlCollapsed
                  ? t("common:app.expandControl")
                  : t("common:app.collapseControl")
              }
            >
              {controlCollapsed ? "›" : "‹"}
            </button>
            <button
              className={`stage__inspector-toggle ${inspectorCollapsed ? "is-collapsed" : ""}`}
              style={
                inspectorCollapsed
                  ? undefined
                  : { right: `${inspectorWidth}px` }
              }
              onClick={() => setInspectorCollapsed((v) => !v)}
              title={
                inspectorCollapsed
                  ? t("common:app.expandInspector")
                  : t("common:app.collapseInspector")
              }
            >
              {inspectorCollapsed ? "‹" : "›"}
            </button>
            <Minimap />
            <div
              className={`inspector-slot ${inspectorCollapsed ? "inspector-slot--hidden" : ""}`}
              style={
                {
                  "--inspector-width": `${inspectorWidth}px`,
                } as React.CSSProperties
              }
            >
              <div
                className="inspector-drag-handle"
                onMouseDown={onDragStart}
              />
              <Inspector onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          </main>
        </div>

        <RunHistory
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onOpen={(id) => {
            setHistoryOpen(false);
            void loadRun(id);
          }}
        />
        <ReviewQueue
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          onOpenRun={(id) => {
            setReviewOpen(false);
            void loadRun(id);
          }}
          onChanged={refreshPendingReviews}
        />
        <ModelAssignModal
          open={modelAssignOpen}
          onClose={() => setModelAssignOpen(false)}
          onOpenSettings={() => {
            setModelAssignOpen(false);
            setSettingsOpen(true);
          }}
        />
        <CostReport open={costOpen} onClose={() => setCostOpen(false)} />
        <EvalReport
          open={evalOpen}
          onClose={() => setEvalOpen(false)}
          graphId={graph.id}
        />
        <ABDialog
          open={abOpen}
          graph={graph}
          onClose={() => setABOpen(false)}
          onLaunched={(gid) => {
            setABOpen(false);
            setABGroup(gid);
          }}
        />
        <ABReport
          open={abGroup !== null}
          groupId={abGroup ?? ""}
          onClose={() => setABGroup(null)}
        />
        <ProductGallery
          open={galleryOpen}
          onClose={() => setGalleryOpen(false)}
        />
        <BrandTermsModal open={brandOpen} onClose={() => setBrandOpen(false)} />
        <ProductLibrary open={productOpen} onClose={() => setProductOpen(false)} />
        <BrandAssets open={brandAssetsOpen} onClose={() => setBrandAssetsOpen(false)} />
        <BatchManager open={batchOpen} onClose={() => setBatchOpen(false)} />
        <CalendarView open={calendarOpen} onClose={() => setCalendarOpen(false)} />
        <PerformanceDashboard open={performanceOpen} onClose={() => setPerformanceOpen(false)} />
        <PublishTargets open={publishTargetsOpen} onClose={() => setPublishTargetsOpen(false)} />
        <TriggersPanel
          open={triggersOpen}
          onClose={() => setTriggersOpen(false)}
          graphId={graph.id}
        />
        <KnowledgePanel
          open={knowledgeOpen}
          onClose={() => setKnowledgeOpen(false)}
        />
        <GlossaryModal
          open={glossaryOpen}
          onClose={() => setGlossaryOpen(false)}
        />
        <VariablesModal
          open={variablesOpen}
          variables={graph.variables}
          onClose={() => setVariablesOpen(false)}
          onSave={updateGraphVariables}
        />
        <VersionPanel
          open={versionOpen}
          graphId={graph.id}
          graphName={graph.name}
          onClose={() => setVersionOpen(false)}
          onRestored={() => {
            void refreshGraphs();
            setTimeout(() => window.location.reload(), 300);
          }}
        />
        <RunCompare
          open={compareOpen}
          graphId={graph.id}
          onClose={() => setCompareOpen(false)}
        />
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          items={commandItems}
        />
        {formFields && (
          <FormConnectorModal
            fields={formFields}
            onSubmit={onFormSubmit}
            onCancel={() => setFormFields(null)}
          />
        )}
        <Toast />
        <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <NewGraphDialog
          open={newGraphOpen}
          onClose={() => setNewGraphOpen(false)}
          onPick={(templateId, fieldValues) => {
            setNewGraphOpen(false);
            void createGraph(templateId, fieldValues);
          }}
        />
        <ConfirmDialog
          open={deleteTarget !== null}
          title={t("common:app.deleteGraphTitle")}
          description={
            deleteTarget
              ? t("common:app.deleteGraphDesc", { name: deleteTarget.name })
              : ""
          }
          confirmLabel={t("common.delete")}
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </>
  );
}
