import { useEffect, useRef, useState } from "react";
import Tooltip from "./Tooltip";
import AccountDialog from "./AccountDialog";
import { logout } from "./AuthPages";

export interface Me {
  id: string;
  email: string;
  createdAt?: string;
}

export default function UserMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMe(d.user))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleLogout = async () => {
    await logout();
    window.location.assign("/login");
  };

  const initial = me?.email ? me.email[0]!.toUpperCase() : "·";

  return (
    <div className="user-menu" ref={rootRef}>
      <Tooltip content={me ? `已登录：${me.email}` : "账户"}>
        <button
          className="chip user-menu__chip"
          onClick={() => setOpen((v) => !v)}
          aria-label="账户菜单"
        >
          <span className="user-menu__avatar">{initial}</span>
          账户
        </button>
      </Tooltip>
      {open && (
        <div className="user-menu__pop">
          <div className="user-menu__email" title={me?.email}>
            {me?.email ?? "…"}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setAccountOpen(true);
            }}
          >
            个人中心
          </button>
          <button type="button" className="user-menu__logout" onClick={handleLogout}>
            退出登录
          </button>
        </div>
      )}
      <AccountDialog open={accountOpen} me={me} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
