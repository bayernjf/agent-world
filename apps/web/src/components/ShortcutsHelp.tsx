import { useRef, useState } from "react";
import Popover, { type Rect } from "./Popover";

const GROUPS: { title: string; items: { keys: string; desc: string }[] }[] = [
  {
    title: "画布",
    items: [
      { keys: "拖动画布 / 空格拖拽", desc: "移动画布" },
      { keys: "滚轮", desc: "缩放画布" },
      { keys: "↑ ↓ ← →", desc: "方向键平移画布（Shift 加速）" },
      { keys: "F", desc: "缩放并居中到选中厂房" },
    ],
  },
  {
    title: "编辑",
    items: [
      { keys: "⌘/Ctrl + C", desc: "复制选中厂房" },
      { keys: "⌘/Ctrl + V", desc: "粘贴厂房（连续粘贴自动错位）" },
      { keys: "⌘/Ctrl + Z", desc: "撤销" },
      { keys: "⌘/Ctrl + Shift + Z", desc: "重做" },
      { keys: "Delete / Backspace", desc: "删除选中管道" },
    ],
  },
  {
    title: "工具",
    items: [
      { keys: "选择", desc: "拖动厂房、点选管道锁定高亮" },
      { keys: "连线", desc: "依次点两个厂房建立正向管道" },
      { keys: "返工", desc: "建立回退管道（质检打回）" },
      { keys: "拆除", desc: "点击厂房或管道删除" },
    ],
  },
  {
    title: "其他",
    items: [
      { keys: "悬停厂房", desc: "查看模型、状态、Token、电费" },
      { keys: "悬停管道", desc: "高亮整条上下游流向" },
    ],
  },
];

export default function ShortcutsHelp() {
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
        title="快捷键说明"
        onClick={updateAnchor}
      >
        快捷键 ?
      </button>
      <Popover open={open} anchor={anchor} placement="bottom" className="shortcuts__pop">
        <div
          className="shortcuts__panel"
          role="dialog"
          aria-label="快捷键说明"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="shortcuts__head">快捷键</div>
          <div className="shortcuts__grid">
            {GROUPS.map((group) => (
              <div key={group.title} className="shortcuts__group">
                <div className="shortcuts__group-title">{group.title}</div>
                {group.items.map((item) => (
                  <div key={item.keys} className="shortcuts__row">
                    <kbd className="shortcuts__keys">{item.keys}</kbd>
                    <span className="shortcuts__desc">{item.desc}</span>
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
