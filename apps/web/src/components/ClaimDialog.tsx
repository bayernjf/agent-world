import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSession } from "../store/session";
import { useToast } from "../store/toast";

/**
 * Global "convert demo to a real account" dialog. State lives in useSession so
 * any blocked action (lib/api.ts) or the DemoBanner / UserMenu can open it.
 * Works both inside the app and on /login?claim=1 (navigates into the app on
 * success when invoked from an auth page).
 */
export default function ClaimDialog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { claimOpen, claimReason, closeClaim, refresh } = useSession();
  const showToast = useToast((s) => s.show);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!claimOpen) return;
    setEmail("");
    setPassword("");
    setConfirm("");
    setError("");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeClaim();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [claimOpen, closeClaim]);

  if (!claimOpen) return null;

  const onAuthPage = location.pathname === "/login" || location.pathname === "/register";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("auth:demo.claim.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setError(body.code === "EMAIL_TAKEN" ? t("auth:demo.claim.emailTaken") : t("auth:demo.claim.genericError"));
        return;
      }
      await refresh();
      closeClaim();
      showToast(t("auth:demo.claim.success"), { ttlMs: 4000 });
      if (onAuthPage) navigate("/", { replace: true });
    } catch {
      setError(t("auth:demo.claim.genericError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={closeClaim}>
      <div className="modal-confirm claim-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <p className="modal-confirm__title">{t("auth:demo.claim.title")}</p>
        <p className="modal-confirm__desc">
          {claimReason === "quota" ? t("auth:demo.claim.reasonQuota") : claimReason === "locked" ? t("auth:demo.claim.reasonLocked") : t("auth:demo.claim.desc")}
        </p>
        <form className="claim-dialog__form" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}
          <label className="field">
            <span>{t("auth:demo.claim.email")}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span>{t("auth:demo.claim.password")}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          <label className="field">
            <span>{t("auth:demo.claim.confirm")}</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} />
          </label>
          <div className="modal-confirm__actions">
            <button type="button" className="btn" onClick={closeClaim}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? t("auth:demo.claim.submitting") : t("auth:demo.claim.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
