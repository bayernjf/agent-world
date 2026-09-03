import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export type CommandGroup = "node" | "view" | "automation" | "manage" | "canvas";

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  group: CommandGroup;
  onSelect: () => void;
  keywords?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
}

const STORAGE_KEY = "agent-world.commandPalette.recents";

function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecents(ids: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, 6)));
  } catch {
    /* ignore */
  }
}

const GROUP_ORDER: CommandGroup[] = ["node", "view", "automation", "manage", "canvas"];

const GROUP_LABELS: Record<CommandGroup, string> = {
  node: "modals:commandPalette.groups.node",
  view: "modals:commandPalette.groups.view",
  automation: "modals:commandPalette.groups.automation",
  manage: "modals:commandPalette.groups.manage",
  canvas: "modals:commandPalette.groups.canvas",
};

export default function CommandPalette({ open, onClose, items }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setRecents(loadRecents());
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // When empty, show recents first then all
      const recentItems = recents
        .map((id) => items.find((it) => it.id === id))
        .filter((it): it is CommandItem => Boolean(it));
      const seen = new Set(recentItems.map((it) => it.id));
      const rest = items.filter((it) => !seen.has(it.id));
      return {
        sections: [
          { label: t("modals:commandPalette.recent"), items: recentItems },
          ...groupByGroup(rest),
        ],
        flat: [...recentItems, ...rest],
      };
    }
    const matches = items.filter((it) => {
      const hay = `${it.label} ${it.hint ?? ""} ${it.keywords ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
    return { sections: groupByGroup(matches), flat: matches };
  }, [items, query, recents, t]);

  function groupByGroup(list: CommandItem[]): { label: string; items: CommandItem[] }[] {
    const out: { label: string; items: CommandItem[] }[] = [];
    for (const g of GROUP_ORDER) {
      const inGroup = list.filter((it) => it.group === g);
      if (inGroup.length) out.push({ label: t(GROUP_LABELS[g]), items: inGroup });
    }
    return out;
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered.flat[active];
        if (item) runItem(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtered, active]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-cmd-index="${active}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [active]);

  function runItem(item: CommandItem) {
    const nextRecents = [item.id, ...recents.filter((id) => id !== item.id)].slice(0, 6);
    setRecents(nextRecents);
    saveRecents(nextRecents);
    onClose();
    // Defer to next tick so the modal closes before the action runs.
    requestAnimationFrame(() => item.onSelect());
  }

  if (!open) return null;

  let flatIdx = 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("modals:commandPalette.ariaLabel")}
      >
        <input
          ref={inputRef}
          className="palette__input"
          placeholder={t("modals:commandPalette.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div ref={listRef} className="palette__list">
          {filtered.sections.length === 0 && (
            <p className="palette__empty">{t("modals:commandPalette.empty")}</p>
          )}
          {filtered.sections.map((section) => (
            <div key={section.label} className="palette__section">
              <p className="palette__group">{section.label}</p>
              {section.items.map((item) => {
                const idx = flatIdx++;
                const isActive = idx === active;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-cmd-index={idx}
                    className={`palette__item ${isActive ? "is-active" : ""}`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => runItem(item)}
                  >
                    <span className="palette__item-label">{item.label}</span>
                    {item.hint && <span className="palette__item-hint">{item.hint}</span>}
                    {item.shortcut && <kbd className="palette__shortcut">{item.shortcut}</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t("modals:commandPalette.foot.move")}</span>
          <span><kbd>↵</kbd> {t("modals:commandPalette.foot.run")}</span>
          <span><kbd>Esc</kbd> {t("modals:commandPalette.foot.close")}</span>
        </div>
      </div>
    </div>
  );
}
