import { useRef, useState, type ReactNode } from "react";
import Popover, { type Rect } from "./Popover";

interface Props {
  content: ReactNode;
  children: ReactNode;
  placement?: "top" | "bottom";
  /** Show after this many ms (avoids flicker sweeping across controls). */
  delay?: number;
  className?: string;
}

/**
 * Reusable hover tooltip built on the shared Popover (portal + edge detection,
 * never clipped by side panels). Use this everywhere instead of the native
 * `title` attribute.
 */
export default function Tooltip({
  content,
  children,
  placement = "bottom",
  delay = 120,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
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
      setOpen(true);
    }, delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      ref={triggerRef}
      className={`tooltip-trigger ${className}`}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <Popover open={open} anchor={anchor} placement={placement} className="tooltip">
        {content}
      </Popover>
    </span>
  );
}
