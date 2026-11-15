/** Command-palette descriptors for the app shell (audit P2 follow-up split
 * out of App.tsx). Pure data: every entry only closes over the handler or the
 * dialog setter it needs, so keeping the list here keeps App.tsx about wiring
 * instead of about 40 repeated menu rows. */
import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { NodeKind } from "@agent-world/core";
import type { CommandItem } from "../components/CommandPalette";
import type { SettingsTab } from "../components/Settings";
import type { ABCompareSample } from "../components/ABDialog";
import { TOURS } from "../tours";
import { useGuidedTour } from "../store/guided-tour";

export interface CommandDeps {
  t: TFunction;
  addNodeOrReport: (kind: NodeKind, x: number, y: number) => void;
  undo: () => void;
  redo: () => void;
  bothCollapsed: boolean;
  toggleBoth: () => void;
  tipsEnabled: boolean;
  toggleTips: () => void;
  enterPark: () => void;
  setNewGraphOpen: Dispatch<SetStateAction<boolean>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setReviewOpen: Dispatch<SetStateAction<boolean>>;
  setModelAssignOpen: Dispatch<SetStateAction<boolean>>;
  setCostOpen: Dispatch<SetStateAction<boolean>>;
  setEvalOpen: Dispatch<SetStateAction<boolean>>;
  setABOpen: Dispatch<SetStateAction<boolean>>;
  setABSample: Dispatch<SetStateAction<ABCompareSample | null>>;
  setGalleryOpen: Dispatch<SetStateAction<boolean>>;
  setBrandOpen: Dispatch<SetStateAction<boolean>>;
  setProductOpen: Dispatch<SetStateAction<boolean>>;
  setBrandAssetsOpen: Dispatch<SetStateAction<boolean>>;
  setBatchOpen: Dispatch<SetStateAction<boolean>>;
  setCalendarOpen: Dispatch<SetStateAction<boolean>>;
  setPerformanceOpen: Dispatch<SetStateAction<boolean>>;
  setOperationsOpen: Dispatch<SetStateAction<boolean>>;
  setPublishTargetsOpen: Dispatch<SetStateAction<boolean>>;
  setTriggersOpen: Dispatch<SetStateAction<boolean>>;
  setKnowledgeOpen: Dispatch<SetStateAction<boolean>>;
  setGlossaryOpen: Dispatch<SetStateAction<boolean>>;
  setVersionOpen: Dispatch<SetStateAction<boolean>>;
  setVariablesOpen: Dispatch<SetStateAction<boolean>>;
  setCompareOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsTab: Dispatch<SetStateAction<SettingsTab | undefined>>;
}

export function buildCommandItems(deps: CommandDeps): CommandItem[] {
  const {
    t, addNodeOrReport, undo, redo, bothCollapsed, toggleBoth, tipsEnabled,
    toggleTips, enterPark, setNewGraphOpen, setHistoryOpen, setReviewOpen,
    setModelAssignOpen, setCostOpen, setEvalOpen, setABOpen, setABSample,
    setGalleryOpen, setBrandOpen, setProductOpen, setBrandAssetsOpen,
    setBatchOpen, setCalendarOpen, setPerformanceOpen, setOperationsOpen,
    setPublishTargetsOpen, setTriggersOpen, setKnowledgeOpen, setGlossaryOpen,
    setVersionOpen, setVariablesOpen, setCompareOpen, setSettingsOpen,
    setSettingsTab,
  } = deps;
  return [

    // Nodes
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
    // View
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
    // Automation
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
      onSelect: () => {
        setABSample(null);
        setABOpen(true);
      },
    },
    // Manage
    {
      id: "settings",
      label: t("modals:commandPalette.commands.settings.label"),
      hint: t("modals:commandPalette.commands.settings.hint"),
      group: "manage",
      onSelect: () => {
        setSettingsTab(undefined);
        setSettingsOpen(true);
      },
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
      id: "operations",
      label: t("modals:commandPalette.commands.operations.label"),
      hint: t("modals:commandPalette.commands.operations.hint"),
      group: "manage",
      onSelect: () => setOperationsOpen(true),
    },
    {
      id: "macroPark",
      label: t("park:title"),
      group: "manage",
      onSelect: () => enterPark(),
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
    // Guided tours: one replay command per registered tour (auto-generated).
    ...TOURS.map((tour) => ({
      id: `replay-tour:${tour.id}`,
      label: t(tour.titleKey),
      hint: t("tour:commands.replayHint"),
      group: "manage" as const,
      onSelect: () => useGuidedTour.getState().start(tour.id),
    })),
    // Canvas
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
}
