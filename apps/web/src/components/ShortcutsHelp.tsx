import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Popover, { type Rect } from "./Popover";

const GROUPS: { title: string; items: { keys: string; desc: string }[] }[] = [
  {
    title: "modals:shortcutsHelp.groups.canvas",
    items: [
      { keys: "modals:shortcutsHelp.canvas.panKeys", desc: "modals:shortcutsHelp.canvas.panDesc" },
      { keys: "modals:shortcutsHelp.canvas.wheelKeys", desc: "modals:shortcutsHelp.canvas.wheelDesc" },
      { keys: "modals:shortcutsHelp.canvas.arrowsKeys", desc: "modals:shortcutsHelp.canvas.arrowsDesc" },
      { keys: "modals:shortcutsHelp.canvas.fitKeys", desc: "modals:shortcutsHelp.canvas.fitDesc" },
    ],
  },
  {
    title: "modals:shortcutsHelp.groups.edit",
    items: [
      { keys: "modals:shortcutsHelp.edit.copyKeys", desc: "modals:shortcutsHelp.edit.copyDesc" },
      { keys: "modals:shortcutsHelp.edit.pasteKeys", desc: "modals:shortcutsHelp.edit.pasteDesc" },
      { keys: "modals:shortcutsHelp.edit.undoKeys", desc: "modals:shortcutsHelp.edit.undoDesc" },
      { keys: "modals:shortcutsHelp.edit.redoKeys", desc: "modals:shortcutsHelp.edit.redoDesc" },
      { keys: "modals:shortcutsHelp.edit.deleteKeys", desc: "modals:shortcutsHelp.edit.deleteDesc" },
    ],
  },
  {
    title: "modals:shortcutsHelp.groups.tools",
    items: [
      { keys: "modals:shortcutsHelp.tools.selectKeys", desc: "modals:shortcutsHelp.tools.selectDesc" },
      { keys: "modals:shortcutsHelp.tools.connectKeys", desc: "modals:shortcutsHelp.tools.connectDesc" },
      { keys: "modals:shortcutsHelp.tools.reworkKeys", desc: "modals:shortcutsHelp.tools.reworkDesc" },
      { keys: "modals:shortcutsHelp.tools.removeKeys", desc: "modals:shortcutsHelp.tools.removeDesc" },
    ],
  },
  {
    title: "modals:shortcutsHelp.groups.other",
    items: [
      { keys: "modals:shortcutsHelp.other.hoverNodeKeys", desc: "modals:shortcutsHelp.other.hoverNodeDesc" },
      { keys: "modals:shortcutsHelp.other.hoverPipeKeys", desc: "modals:shortcutsHelp.other.hoverPipeDesc" },
      { keys: "modals:shortcutsHelp.other.nameplateKeys", desc: "modals:shortcutsHelp.other.nameplateDesc" },
      { keys: "modals:shortcutsHelp.other.drawerKeys", desc: "modals:shortcutsHelp.other.drawerDesc" },
    ],
  },
];

export default function ShortcutsHelp() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const updateAnchor = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r)
      setAnchor({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
        right: r.right,
      });
  };

  return (
    <div
      className="shortcuts"
      onMouseEnter={() => {
        updateAnchor();
        setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => {
        updateAnchor();
        setOpen(true);
      }}
      onBlur={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        className="chip shortcuts__trigger"

        onClick={updateAnchor}
      >
        {t("modals:shortcutsHelp.trigger")}
      </button>
      <Popover open={open} anchor={anchor} placement="bottom" className="shortcuts__pop">
        <div
          className="shortcuts__panel"
          role="dialog"
          aria-label={t("modals:shortcutsHelp.ariaLabel")}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="shortcuts__head">{t("modals:shortcutsHelp.title")}</div>
          <div className="shortcuts__grid">
            {GROUPS.map((group) => (
              <div key={group.title} className="shortcuts__group">
                <div className="shortcuts__group-title">{t(group.title)}</div>
                {group.items.map((item) => (
                  <div key={item.keys} className="shortcuts__row">
                    <kbd className="shortcuts__keys">{t(item.keys)}</kbd>
                    <span className="shortcuts__desc">{t(item.desc)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Popover>
    </div>
  );
}
