/** HUD header of the app shell (audit P2 follow-up split out of App.tsx).
 * Purely presentational: every handler and every list comes in through props,
 * so the shell keeps the wiring and the header keeps the layout.
 */
import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { Graph } from "@agent-world/core";
import { KIND_KEY } from "../canvas/Plants";
import Logo from "../components/Logo";
import GraphSwitcher, { type GraphSummary } from "../components/GraphSwitcher";
import UndoRedo from "../components/UndoRedo";
import Tooltip from "../components/Tooltip";
import ShortcutsHelp from "../components/ShortcutsHelp";
import AnnouncementBell from "../components/AnnouncementBell";
import UserMenu from "../components/UserMenu";

export interface AppHudProps {
  t: TFunction;
  graph: Graph;
  graphs: GraphSummary[];
  switchGraph: (id: string) => Promise<void>;
  setNewGraphOpen: Dispatch<SetStateAction<boolean>>;
  duplicateGraph: (id: string) => Promise<void>;
  setDeleteTarget: Dispatch<SetStateAction<GraphSummary | null>>;
  renameGraph: (id: string, name: string) => Promise<void | boolean>;
  setShareTargetId: Dispatch<SetStateAction<string | null>>;
  bothCollapsed: boolean;
  toggleBoth: () => void;
  tipsEnabled: boolean;
  toggleTips: () => void;
  pendingReviews: number;
  setReviewOpen: Dispatch<SetStateAction<boolean>>;
  setGalleryOpen: Dispatch<SetStateAction<boolean>>;
  setGlossaryOpen: Dispatch<SetStateAction<boolean>>;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
}

export default function AppHud(props: AppHudProps) {
  const {
    t, graph, graphs, switchGraph, setNewGraphOpen, duplicateGraph,
    setDeleteTarget, renameGraph, setShareTargetId, bothCollapsed, toggleBoth,
    tipsEnabled, toggleTips, pendingReviews, setReviewOpen, setGalleryOpen,
    setGlossaryOpen, setPaletteOpen,
  } = props;
  return (
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
  );
}
