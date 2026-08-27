import { useEffect } from "react";
import { copyToClipboard, useToast, type ToastAction } from "../store/toast";

/**
 * Center-screen toast. Replaces the old full-width top banner for transient
 * feedback. Auto-hides after `toast.ttlMs` (default 4s); actions rendered on
 * the right (e.g. 撤销 / 复制) clear the toast when clicked. The copy action
 * is the default for error / info toasts so the user can grab the message
 * with one click when they need to report it.
 */
export default function Toast() {
  const toast = useToast((s) => s.toast);
  const clear = useToast((s) => s.clear);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clear, toast.ttlMs ?? 4000);
    return () => clearTimeout(t);
  }, [toast, clear]);

  if (!toast) return null;

  // Errors / info messages get a copy action by default; producers that want
  // an undo button can pass `actions: [{ label: "撤销", onClick }]`.
  const actions: ToastAction[] =
    toast.actions ?? [
      {
        label: "复制",
        onClick: async () => {
          const ok = await copyToClipboard(toast.message);
          if (ok) {
            useToast.setState({
              toast: {
                ...toast,
                id: toast.id + 1,
                message: "已复制",
                ttlMs: 1500,
                actions: [],
              },
            });
          }
        },
      },
    ];

  return (
    <div className="toast" role="status">
      <span className="toast__message">{toast.message}</span>
      <span className="toast__actions">
        {actions.map((a) => (
          <button
            key={a.label}
            className="link toast__action"
            onClick={() => {
              a.onClick();
              clear();
            }}
          >
            {a.label}
          </button>
        ))}
      </span>
    </div>
  );
}
