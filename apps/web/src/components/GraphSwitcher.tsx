import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Popover, { type Rect } from "./Popover";
import Tooltip from "./Tooltip";

export interface GraphSummary {
  id: string;
  name: string;
  updated_at: number;
  sharedRole?: string | null;
}

/** Pinned-graph ids are stored per browser, keeping the switcher client-only. */
const PINNED_KEY = "aw-pinned-graphs";

function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function savePinned(ids: string[]) {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
  } catch {
    /* private mode */
  }
}

interface Props {
  graphs: GraphSummary[];
  currentId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onShare: (id: string) => void;
}

const SHARED_ROLE_LABEL: Record<string, string> = {
  editor: "modals:sharedRole.editor",
  viewer: "modals:sharedRole.viewer",
};

export default function GraphSwitcher({
  graphs,
  currentId,
  onSwitch,
  onCreate,
  onDuplicate,
  onDelete,
  onRename,
  onShare,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<string[]>(loadPinned);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open && btnRef.current) setAnchor(btnRef.current.getBoundingClientRect());
    setOpen((v) => !v);
    setEditingId(null);
  };

  const commitRename = (id: string) => {
    const name = draft.trim();
    if (name) onRename(id, name);
    setEditingId(null);
  };

  const togglePin = (id: string) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      savePinned(next);
      return next;
    });
  };

  // Filter by name (case-insensitive), then stable-sort pinned graphs to the
  // top in pin order while preserving the incoming order for the rest.
  const visibleGraphs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? graphs.filter((g) => g.name.toLowerCase().includes(q)) : graphs;
    const pinRank = new Map(pinned.map((id, i) => [id, i]));
    return filtered
      .map((g, i) => ({ g, i }))
      .sort((a, b) => {
        const ra = pinRank.get(a.g.id);
        const rb = pinRank.get(b.g.id);
        if (ra === undefined && rb === undefined) return a.i - b.i;
        if (ra === undefined) return 1;
        if (rb === undefined) return -1;
        return ra - rb;
      })
      .map((x) => x.g);
  }, [graphs, query, pinned]);

  return (
    <>
      <button
        ref={btnRef}
        className="hud__graph-switcher"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="hud__graph-name">
          {graphs.find((g) => g.id === currentId)?.name ??
            t("modals:graphSwitcher.fallbackName")}
        </span>
        <span className="caret">{open ? "▾" : "▾"}</span>
      </button>

      <Popover open={open} anchor={anchor} placement="bottom" className="graph-popover">
        <div className="graph-popover__search">
          <input
            type="text"
            className="graph-popover__search-input"
            placeholder={t("modals:graphSwitcher.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="graph-popover__list">
          {visibleGraphs.length === 0 && (
            <p className="graph-popover__empty muted">{t("modals:graphSwitcher.noResults")}</p>
          )}
          {visibleGraphs.map((g) => (
            <div
              key={g.id}
              className={`graph-row ${g.id === currentId ? "is-current" : ""}`}
              onClick={() => {
                if (editingId) return;
                onSwitch(g.id);
                setOpen(false);
              }}
            >
              {editingId === g.id ? (
                <input
                  className="graph-row__input"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commitRename(g.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(g.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span
                  className="graph-row__name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(g.id);
                    setDraft(g.name);
                  }}
                >
                  {g.name}
                  {(() => {
                    const role = g.sharedRole;
                    if (!role) return null;
                    const labelKey = SHARED_ROLE_LABEL[role];
                    if (!labelKey) return null;
                    return (
                      <span className={`graph-row__badge graph-row__badge--${role}`}>
                        {t(labelKey)}
                      </span>
                    );
                  })()}
                </span>
              )}
              <span className="graph-row__actions" onClick={(e) => e.stopPropagation()}>
                <Tooltip content={pinned.includes(g.id) ? t("modals:graphSwitcher.unpin") : t("modals:graphSwitcher.pin")}>
                  <button
                    className={`icon-btn graph-row__pin ${pinned.includes(g.id) ? "is-pinned" : ""}`}
                    aria-pressed={pinned.includes(g.id)}
                    onClick={() => togglePin(g.id)}
                  >
                    {pinned.includes(g.id) ? "★" : "☆"}
                  </button>
                </Tooltip>
                {!g.sharedRole && (
                  <Tooltip content={t("modals:shareButton.label")}>
                    <button
                      className="icon-btn"
                      onClick={() => onShare(g.id)}
                    >
                      ⤴
                    </button>
                  </Tooltip>
                )}
                {!g.sharedRole && (
                  <Tooltip content={t("common.rename")}>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        setEditingId(g.id);
                        setDraft(g.name);
                      }}
                    >
                      ✎
                    </button>
                  </Tooltip>
                )}
                <Tooltip content={t("common.duplicate")}>
                  <button
                    className="icon-btn"
                    onClick={() => onDuplicate(g.id)}
                  >
                    ⧉
                  </button>
                </Tooltip>
                {!g.sharedRole && (
                  <Tooltip content={t("common.delete")}>
                    <button
                      className="icon-btn icon-btn--danger"
                      onClick={() => onDelete(g.id)}
                    >
                      ✕
                    </button>
                  </Tooltip>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="graph-popover__divider" />
        <button
          className="graph-popover__new"
          onClick={() => {
            onCreate();
            setOpen(false);
          }}
        >
          {t("modals:graphSwitcher.create")}
        </button>
      </Popover>
    </>
  );
}
