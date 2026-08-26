import { useRef, useState } from "react";
import Popover, { type Rect } from "./Popover";
import Tooltip from "./Tooltip";

export interface GraphSummary {
  id: string;
  name: string;
  updated_at: number;
}

interface Props {
  graphs: GraphSummary[];
  currentId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

export default function GraphSwitcher({
  graphs,
  currentId,
  onSwitch,
  onCreate,
  onDuplicate,
  onDelete,
  onRename,
}: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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

  return (
    <>
      <button ref={btnRef} className="chip hud__graph-switcher" onClick={toggle}>
        <span className="hud__graph-name">{graphs.find((g) => g.id === currentId)?.name ?? "产线"}</span>
        <span className="caret">{open ? "▾" : "▾"}</span>
      </button>

      <Popover open={open} anchor={anchor} placement="bottom" className="graph-popover">
        <div className="graph-popover__list">
          {graphs.map((g) => (
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
                </span>
              )}
              <span className="graph-row__actions" onClick={(e) => e.stopPropagation()}>
                <Tooltip content="重命名">
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
                <Tooltip content="复制">
                  <button
                    className="icon-btn"
                    onClick={() => onDuplicate(g.id)}
                  >
                    ⧉
                  </button>
                </Tooltip>
                <Tooltip content="删除">
                  <button
                    className="icon-btn icon-btn--danger"
                    onClick={() => onDelete(g.id)}
                  >
                    ✕
                  </button>
                </Tooltip>
              </span>
            </div>
          ))}
        </div>
        <button
          className="btn graph-popover__new"
          onClick={() => {
            onCreate();
            setOpen(false);
          }}
        >
          + 新建产线
        </button>
      </Popover>
    </>
  );
}
