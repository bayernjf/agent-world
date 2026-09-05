import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Tooltip from "./Tooltip";
import AccountDialog from "./AccountDialog";
import AdminPanel from "./AdminPanel";
import FeedbackModal from "./FeedbackModal";
import { logout } from "./AuthPages";
import LanguageSwitcher from "./LanguageSwitcher";

export interface Me {
  id: string;
  email: string;
  createdAt?: string;
  role?: string;
}

export default function UserMenu() {
  const { t } = useTranslation();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
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
      <Tooltip
        content={
          me
            ? t("modals:userMenu.loggedInAs", { email: me.email })
            : t("modals:userMenu.account")
        }
      >
        <button
          className="chip user-menu__chip"
          onClick={() => setOpen((v) => !v)}
          aria-label={t("modals:userMenu.accountMenu")}
        >
          <span className="user-menu__avatar">{initial}</span>
          {t("modals:userMenu.account")}
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
            {t("modals:userMenu.profile")}
          </button>
          {(me?.role === "owner" || me?.role === "admin") && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setAdminOpen(true);
              }}
            >
              {t("modals:userMenu.admin")}
            </button>
          )}
          {me && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setFeedbackOpen(true);
              }}
            >
              {t("feedback:entry.button")}
            </button>
          )}
          <LanguageSwitcher />
          <button type="button" className="user-menu__logout" onClick={handleLogout}>
            {t("modals:userMenu.logout")}
          </button>
        </div>
      )}
      <AccountDialog open={accountOpen} me={me} onClose={() => setAccountOpen(false)} />
      <AdminPanel open={adminOpen} me={me} onClose={() => setAdminOpen(false)} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}
