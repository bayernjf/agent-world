import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { Diagnostic, FormConnector, Graph } from "@agent-world/core";

type FormField = FormConnector["fields"][number];
import Canvas, { type Mode } from "./canvas/Canvas";
import { KIND_KEY } from "./canvas/Plants";
import Minimap from "./canvas/Minimap";
import CanvasToolbar from "./components/CanvasToolbar";
import ControlPanel from "./components/ControlPanel";
import Inspector from "./components/Inspector";
import Logo from "./components/Logo";
import Settings, { type SettingsTab } from "./components/Settings";
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
import type { ABCompareSample } from "./components/ABDialog";
import ABReport from "./components/ABReport";
import BrandTermsModal from "./components/BrandTermsModal";
import ProductLibrary from "./components/ProductLibrary";
import BrandAssets from "./components/BrandAssets";
import BatchManager from "./components/BatchManager";
import CalendarView from "./components/CalendarView";
import PerformanceDashboard from "./components/PerformanceDashboard";
import OperationsDashboard from "./components/OperationsDashboard";
import PublishTargets from "./components/PublishTargets";
import TriggersPanel from "./components/TriggersPanel";
import ProductGallery from "./components/ProductGallery";
import Onboarding from "./components/Onboarding";
import UserMenu from "./components/UserMenu";
import DemoBanner from "./components/DemoBanner";
import ClaimDialog from "./components/ClaimDialog";
import GuidedTour from "./components/GuidedTour";
import { registerTourAction } from "./components/guided-tour-engine";
import AnnouncementBell from "./components/AnnouncementBell";
import { GlobalAnnouncementBar, GraphAnnouncementBar } from "./components/AnnouncementAlerts";
import KnowledgePanel from "./components/KnowledgePanel";
import GlossaryModal from "./components/GlossaryModal";
import VersionPanel from "./components/VersionPanel";
import RunCompare from "./components/RunCompare";
import CollaboratorsModal from "./components/CollaboratorsModal";
import CommandPalette from "./components/CommandPalette";
import { api, DuplicateGraphNameError, type OperationsOverview } from "./lib/api";
import { parseBillingReturn } from "./lib/billingReturn";
import { useToast } from "./store/toast";
import { parseQuotaError, useUpgradeGate } from "./store/upgrade-gate";
import UpgradeGate from "./components/UpgradeGate";
import { getTemplate } from "@agent-world/core";
import { useGraph } from "./store/graph";
import { useRun } from "./store/run";
import { useViewMode } from "./store/view-mode";
import { TOURS } from "./tours";
import {
  buildTourContext,
  migrateLegacySeen,
  pickAutoTour,
  setLastAutoAt,
  useGuidedTour,
} from "./store/guided-tour";

const Canvas3D = lazy(() => import("./canvas/Canvas3D"));
// RTS stage-B L0 macro park: separate chunk so 2D/3D users never load three.js twice for it.
const CanvasPark = lazy(() => import("./canvas/CanvasPark"));
import ParkEconomyBar from "./canvas/ParkEconomyBar";
import ParkScheduleAxis from "./canvas/ParkScheduleAxis";
import { buildCommandItems } from "./app/commandItems";
import { usePanelLayout } from "./app/usePanelLayout";
import { useGraphLibrary } from "./app/useGraphLibrary";
import { useParkView } from "./app/useParkView";

export default function App() {
  const { t } = useTranslation();
  // L19: subscribe to individual slices instead of the whole store so App
  // only re-renders when a field it actually reads changes.
  const graph = useGraph((s) => s.graph);
  const addNode = useGraph((s) => s.addNode);
  const flushSave = useGraph((s) => s.flushSave);
  const undo = useGraph((s) => s.undo);
  const redo = useGraph((s) => s.redo);
  const selectedId = useGraph((s) => s.selectedId);
  const updateGraphVariables = useGraph((s) => s.updateGraphVariables);
  const inspectorOpen = useGraph((s) => s.inspectorOpen);
  const { connect, reset, runId, loadRun } = useRun();
  const viewMode = useViewMode((s) => s.viewMode);
  const toggleViewMode = useViewMode((s) => s.toggle);
  const setViewMode = useViewMode((s) => s.setViewMode);
  const setDrilledFromPark = useViewMode((s) => s.setDrilledFromPark);
  const drilledFromPark = useViewMode((s) => s.drilledFromPark);
  const requestDrillAnim = useViewMode((s) => s.requestDrillAnim);

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
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  const navigate = useNavigate();
  // M3 S6 A5: on a full-page return from Stripe Checkout/Portal (?billing=…),
  // open the billing settings tab + toast once, then strip the marker so a
  // refresh does not re-fire it. Runs once on mount.
  useEffect(() => {
    const marker = parseBillingReturn(window.location.search);
    if (!marker) return;
    if (marker === "success") {
      setSettingsTab("billing");
      setSettingsOpen(true);
      useToast.getState().show(t("billing:stripe.returnSuccess"), { ttlMs: 8000 });
    } else if (marker === "cancel") {
      useToast.getState().show(t("billing:stripe.returnCancel"), { ttlMs: 6000 });
    }
    navigate("/", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const {
    newGraphOpen, setNewGraphOpen, graphs, deleteTarget, setDeleteTarget,
    shareTargetId, setShareTargetId, graphsReady, pendingReviews,
    refreshGraphs, refreshPendingReviews, switchGraph, createGraph,
    duplicateGraph, renameGraph, confirmDelete,
  } = useGraphLibrary();
  const currentSharedRole = graphs.find((g) => g.id === graph.id)?.sharedRole ?? null;
  const isViewer = currentSharedRole === "viewer";
  const {
    controlCollapsed, setControlCollapsed,
    inspectorCollapsed, setInspectorCollapsed,
    inspectorWidth, onDragStart, bothCollapsed, toggleBoth,
  } = usePanelLayout();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  /** Runs parked on a human decision across every line — the HUD badge. */
  const [modelAssignOpen, setModelAssignOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [abOpen, setABOpen] = useState(false);
  const [abGroup, setABGroup] = useState<string | null>(null);
  const [abSample, setABSample] = useState<ABCompareSample | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [brandAssetsOpen, setBrandAssetsOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [publishTargetsOpen, setPublishTargetsOpen] = useState(false);
  const [triggersOpen, setTriggersOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  /** Case-insensitive, trimmed duplicate check across the local graph list. */
  const tipsEnabled = useTips((s) => s.enabled);
  const toggleTips = useTips((s) => s.toggle);

  // Guided tour: register before-step side effects and migrate the legacy
  // single-tour seen key once (see docs/design-guided-tour.md §12.5).
  useEffect(() => {
    migrateLegacySeen();
    registerTourAction("panel:expandControl", () => setControlCollapsed(false));
    registerTourAction("inspector:expandAndSelect", () => {
      setInspectorCollapsed(false);
      const gs = useGraph.getState();
      if (!gs.selectedId && gs.graph.nodes.length > 0) {
        gs.select(gs.graph.nodes[0]!.id);
      }
      gs.setInspectorOpen(true);
    });
  }, [setControlCollapsed, setInspectorCollapsed]);

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



  const {
    parkOverview, parkFactories, enterFactory, backToPark, enterPark,
    retryFactory, refreshParkOverview, toggleFactoryCron, reschedulePlan,
  } = useParkView({
    graphId: graph.id,
    switchGraph,
    setInspectorCollapsed,
    viewMode,
    setViewMode,
    setDrilledFromPark,
    requestDrillAnim,
  });

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
        // Go through the serialized store save (not a raw api.saveGraph) so the
        // server version is tracked and can't drift: an unconditional save here
        // would bump the version without recording it, and a later conditional
        // save (switch-graph flush) would 409 on the stale If-Match.
        await flushSave();
        const { runId: id } = await api.startRun(
          graph.id,
          budget,
          rawMaterial.trim() || undefined,
          connectorValues,
        );
        connect(id);
      } catch (e) {
        // A structured subscription 402 opens the upgrade modal instead of a
        // raw error toast; every other failure keeps the normal toast path.
        const block = parseQuotaError(e);
        if (block) useUpgradeGate.getState().open(block);
        else showError(String(e));
      }
    },
    [graph, budget, rawMaterial, connect, reset, flushSave],
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
      if (e.key === "v" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleViewMode();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, toggleViewMode]);

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

  const commandItems = buildCommandItems({
    t,
    addNodeOrReport,
    undo,
    redo,
    bothCollapsed,
    toggleBoth,
    tipsEnabled,
    toggleTips,
    enterPark,
    setNewGraphOpen,
    setHistoryOpen,
    setReviewOpen,
    setModelAssignOpen,
    setCostOpen,
    setEvalOpen,
    setABOpen,
    setABSample,
    setGalleryOpen,
    setBrandOpen,
    setProductOpen,
    setBrandAssetsOpen,
    setBatchOpen,
    setCalendarOpen,
    setPerformanceOpen,
    setOperationsOpen,
    setPublishTargetsOpen,
    setTriggersOpen,
    setKnowledgeOpen,
    setGlossaryOpen,
    setVersionOpen,
    setVariablesOpen,
    setCompareOpen,
    setSettingsOpen,
    setSettingsTab,
  });

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
              onShare={(id) => setShareTargetId(id)}
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
          <div className="hud__actions" data-tour="hud:actions">
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
            <AnnouncementBell />
            <UserMenu />
          </div>
        </header>

        <DemoBanner />
        <div
          className="announcements__stack"
          style={
            {
              "--notice-inset": inspectorCollapsed
                ? "0px"
                : `${inspectorWidth}px`,
            } as React.CSSProperties
          }
        >
          <GlobalAnnouncementBar />
          <GraphAnnouncementBar graphId={graph.id} />
        </div>

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
            onOpenSettings={() => {
              setSettingsTab(undefined);
              setSettingsOpen(true);
            }}
            onOpenHistory={() => setHistoryOpen(true)}
            onOpenModelAssign={() => setModelAssignOpen(true)}
            readOnly={isViewer}
          />

          <main className="stage" data-tour="workspace:stage">
            <div className="canvas-toolbar-row" data-tour="workspace:toolbar">
              <CanvasToolbar onError={showError} />
            </div>
            <Timeline />
            <FailurePanel onRerun={onRun} />
            {viewMode === "2d" ? (
              <Canvas mode={mode} diagnostics={diagnostics} />
            ) : viewMode === "park" ? (
              <Suspense fallback={null}>
                <CanvasPark
                  factories={parkFactories}
                  crossEdges={parkOverview?.crossEdges ?? []}
                  onEnter={(id) => void enterFactory(id)}
                  onRetry={(id, runId) => void retryFactory(id, runId)}
                  onToggleCron={(id) => void toggleFactoryCron(id)}
                  onReviewDecided={() => void refreshParkOverview()}
                />
              </Suspense>
            ) : (
              <Suspense fallback={null}>
                <Canvas3D />
              </Suspense>
            )}
            {viewMode === "park" && <ParkEconomyBar totals={parkOverview?.totals} />}
            {viewMode === "park" && (
              <ParkScheduleAxis
                plans={parkOverview?.plans ?? []}
                factories={parkFactories}
                cronState={parkOverview?.cronState ?? {}}
                onReschedule={(planId, at) => void reschedulePlan(planId, at)}
              />
            )}
            {viewMode === "3d" && drilledFromPark && (
              <button type="button" className="park-back-btn" onClick={backToPark}>
                {t("park:backToPark")}
              </button>
            )}
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
              data-tour="inspector:panel"
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
              <Inspector
                onOpenSettings={(tab) => {
                  setSettingsTab(tab);
                  setSettingsOpen(true);
                }}
              />
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
          onComparePrompt={(o) => {
            setHistoryOpen(false);
            setABSample(o);
            setABOpen(true);
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
            setSettingsTab(undefined);
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
          sample={abSample}
          onClose={() => {
            setABOpen(false);
            setABSample(null);
          }}
          onLaunched={(gid) => {
            setABOpen(false);
            setABSample(null);
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
        <OperationsDashboard
          open={operationsOpen}
          onClose={() => setOperationsOpen(false)}
          onEnterPark={enterPark}
          onOpenReviews={() => setReviewOpen(true)}
          onOpenCalendar={() => setCalendarOpen(true)}
          onOpenPerformance={() => setPerformanceOpen(true)}
          onOpenRun={(id) => {
            setOperationsOpen(false);
            void loadRun(id);
          }}
        />
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
        <GuidedTour />
        {formFields && (
          <FormConnectorModal
            fields={formFields}
            onSubmit={onFormSubmit}
            onCancel={() => setFormFields(null)}
          />
        )}
        <Toast />
        <Settings
          open={settingsOpen}
          initialTab={settingsTab}
          onClose={() => setSettingsOpen(false)}
        />
        <UpgradeGate
          onUpgrade={() => {
            setSettingsTab("billing");
            setSettingsOpen(true);
          }}
          onUseCustomModel={() => {
            setSettingsTab("models");
            setSettingsOpen(true);
          }}
        />
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
        <CollaboratorsModal
          open={shareTargetId !== null}
          graphId={shareTargetId ?? ""}
          graphName={graphs.find((g) => g.id === shareTargetId)?.name ?? ""}
          onClose={() => setShareTargetId(null)}
        />
        <ClaimDialog />
      </div>
    </>
  );
}
