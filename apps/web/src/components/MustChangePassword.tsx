import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import Logo from "./Logo";

interface Props {
  /** Email of the account whose one-time password is being replaced. */
  email?: string;
  /** Called after the server accepted the new password. */
  onDone: () => void;
}

/**
 * First-login gate for an account an owner opened. The server refuses every
 * non-auth route while must_change_password is set, so this is the only screen
 * such a session reaches; it posts to the same /api/auth/password route the
 * account dialog uses, because replacing the password IS the way out.
 */
export default function MustChangePassword({ email, onDone }: Props) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (next !== confirm) {
      setError(t("auth:account.passwordMismatch"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as any).error ?? t("errors:api.requestFailed", { status: res.status }),
        );
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__head">
          <Logo size={28} />
          <h1 className="auth-card__title">{t("auth:mustChange.title")}</h1>
        </div>
        <p className="auth-card__sub">
          {t("auth:mustChange.hint", { email: email ?? "" })}
        </p>
        <form className="auth-card__body" onSubmit={submit}>
          {error && <div className="auth-error">{error}</div>}
          <label className="field">
            <span>{t("auth:account.currentPassword")}</span>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoFocus
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            <span>{t("auth:account.newPassword")}</span>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span>{t("auth:account.confirmNewPassword")}</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? t("auth:mustChange.submitting") : t("auth:mustChange.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
