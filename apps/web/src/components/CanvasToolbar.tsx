import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGraph } from "../store/graph";
import { useCanvas } from "../store/canvas";
import { VIEW_W, VIEW_H } from "../canvas/board";
import { KIND_KEY } from "../canvas/Plants";
import {
  NODE_CATEGORIES,
  NODE_CATEGORY,
  type NodeKind,
} from "@agent-world/core";
import Tooltip from "./Tooltip";

/**
 * Palette hints, in menu order — `Object.keys` is what lays the palette out.
 * Labels are not repeated here: they come from the shared kind table so the
 * palette and the canvas plants cannot drift apart.
 */
const NODE_HINT_KEY: Record<NodeKind, string> = {
  textGen: "nodes:hints.textGen",
  imageGen: "nodes:hints.imageGen",
  videoGen: "nodes:hints.videoGen",
  audioGen: "nodes:hints.audioGen",
  gate: "nodes:hints.gate",
  branch: "nodes:hints.branch",
  map: "nodes:hints.map",
  loop: "nodes:hints.loop",
  parallel: "nodes:hints.parallel",
  subprocess: "nodes:hints.subprocess",
  table: "nodes:hints.table",
  database: "nodes:hints.database",
  fileParse: "nodes:hints.fileParse",
  convert: "nodes:hints.convert",
  translate: "nodes:hints.translate",
  ocr: "nodes:hints.ocr",
  code: "nodes:hints.code",
  http: "nodes:hints.http",
  search: "nodes:hints.search",
  notify: "nodes:hints.notify",
  vcs: "nodes:hints.vcs",
  human: "nodes:hints.human",
  source: "nodes:hints.source",
  sink: "nodes:hints.sink",
  generic: "nodes:hints.generic",
  compliance: "nodes:hints.compliance",
  publish: "nodes:hints.publish",
  fanout: "nodes:hints.fanout",
  select: "nodes:hints.select",
};

/** High-frequency kinds shown directly in the toolbar; the rest live in the palette. */
const PRIMARY_KINDS: NodeKind[] = [
  "source",
  "textGen",
  "gate",
  "imageGen",
  "http",
  "sink",
];

const MODALITY_KEY: Record<string, string> = {
  text: "nodes:modality.text",
  image: "nodes:modality.image",
  video: "nodes:modality.video",
  audio: "nodes:modality.audio",
  embedding: "nodes:modality.embedding",
};

/** Core owns the category ids; the pack owns how they read on screen. */
const CATEGORY_KEY: Record<string, string> = {
  generation: "nodes:categories.generation",
  control: "nodes:categories.control",
  data: "nodes:categories.data",
  integrations: "nodes:categories.integrations",
  io: "nodes:categories.io",
};

interface Props {
  onError?: (msg: string) => void;
}

export default function CanvasToolbar({ onError }: Props = {}) {
  const { t } = useTranslation();
  const addNode = useGraph((s) => s.addNode);
  const { zoom, panX, panY } = useCanvas((s) => s.viewport);
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState("");
  const moreRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
        setQuery("");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Focus the search box as soon as the palette opens.
  useEffect(() => {
    if (moreOpen) searchRef.current?.focus();
  }, [moreOpen]);

  // Add at the current view center, in canvas coordinates.
  function addAtViewCenter(kind: NodeKind) {
    const cx = (VIEW_W / 2 - panX) / zoom;
    const cy = (VIEW_H / 2 - panY) / zoom;
    const r = addNode(kind, cx, cy);
    if (r.missingModality) {
      const key = MODALITY_KEY[r.missingModality];
      onError?.(
        t("nodes:missingModality", {
          modality: key ? t(key) : t("nodes:modalityFallback"),
        }),
      );
    }
  }

  function addFromPalette(kind: NodeKind) {
    addAtViewCenter(kind);
    setMoreOpen(false);
    setQuery("");
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = NODE_CATEGORIES.map((cat) => {
      const catKey = CATEGORY_KEY[cat.id];
      return {
        id: cat.id,
        label: catKey ? t(catKey) : cat.label,
        items: (Object.keys(NODE_HINT_KEY) as NodeKind[])
          .filter((kind) => NODE_CATEGORY[kind] === cat.id)
          .map((kind) => ({
            kind,
            label: t(KIND_KEY[kind]),
            hint: t(NODE_HINT_KEY[kind]),
          })),
      };
    });
    if (!q) return all;
    return all
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (it) =>
            it.label.toLowerCase().includes(q) ||
            it.hint.toLowerCase().includes(q) ||
            it.kind.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [query, t]);

  const totalItems = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups],
  );

  return (
    <div className="canvas-toolbar" role="toolbar" aria-label={t("canvas:addNode")}>
      <span className="canvas-toolbar__prefix">▌</span>
      {PRIMARY_KINDS.map((kind) => (
        <button
          key={kind}
          className="canvas-toolbar__btn"
          onClick={() => addAtViewCenter(kind)}
          title={t(NODE_HINT_KEY[kind])}
        >
          + {t(KIND_KEY[kind])}
        </button>
      ))}
      <div className="canvas-toolbar__more" ref={moreRef}>
        <button
          className="canvas-toolbar__btn canvas-toolbar__btn--more"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
        >
          {t("canvas:toolbar.more")} <span className="canvas-toolbar__caret">▾</span>
        </button>
        {moreOpen && (
          <div
            className="canvas-toolbar__menu"
            role="dialog"
            aria-label={t("canvas:toolbar.palette")}
          >
            <div className="canvas-toolbar__search">
              <input
                ref={searchRef}
                className="canvas-toolbar__search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("canvas:toolbar.searchPlaceholder")}
                aria-label={t("canvas:toolbar.search")}
              />
            </div>
            <div className="canvas-toolbar__groups">
              {groups.map((g) => (
                <div key={g.id} className="canvas-toolbar__group">
                  <div className="canvas-toolbar__group-title">{g.label}</div>
                  {g.items.map((b) => (
                    <button
                      key={b.kind}
                      className="canvas-toolbar__menu-item"
                      onClick={() => addFromPalette(b.kind)}
                      title={b.hint}
                    >
                      <span className="canvas-toolbar__menu-label">
                        + {b.label}
                      </span>
                      <span className="canvas-toolbar__menu-hint">
                        {b.hint}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {totalItems === 0 && (
                <div className="canvas-toolbar__empty">{t("canvas:toolbar.noMatch")}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
