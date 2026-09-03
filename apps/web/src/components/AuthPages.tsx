import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import i18n from "../i18n";
import Logo from "./Logo";

async function postAuth(url: string, body: Record<string, string | boolean>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Outside React, so only the singleton knows the current language.
    throw new Error(
      (data as any).error ?? i18n.t("errors:api.requestFailed", { status: res.status }),
    );
  }
  return data;
}

const LAST_EMAIL_KEY = "agent-world.lastEmail";

function readLastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState(readLastEmail);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await postAuth("/api/auth/login", { email, password, remember });
      try {
        if (remember) localStorage.setItem(LAST_EMAIL_KEY, email);
        else localStorage.removeItem(LAST_EMAIL_KEY);
      } catch {
        /* private mode etc. — non-fatal */
      }
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__head">
          <Logo size={28} />
          <h1 className="auth-card__title">{t("app.name")}</h1>
        </div>
        <p className="auth-card__sub">
          {/* Not named `link`: react-i18next parses HTML void elements as self-closing. */}
          <Trans i18nKey="auth:login.noAccount" components={{ routerLink: <Link to="/register" /> }} />
        </p>
        <form className="auth-card__body" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}
          <label className="field">
            <span>{t("auth:login.email")}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={email === ""} />
          </label>
          <label className="field">
            <span>{t("auth:login.password")}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={email !== ""} />
          </label>
          <label className="auth-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>{t("auth:login.remember")}</span>
            <span className="auth-remember__hint">{t("auth:login.rememberHint")}</span>
          </label>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? t("auth:login.submitting") : t("auth:login.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("auth:register.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      await postAuth("/api/auth/register", { email, password });
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__head">
          <Logo size={28} />
          <h1 className="auth-card__title">{t("app.name")}</h1>
        </div>
        <p className="auth-card__sub">
          <Trans i18nKey="auth:register.hasAccount" components={{ routerLink: <Link to="/login" /> }} />
        </p>
        <form className="auth-card__body" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}
          <label className="field">
            <span>{t("auth:register.email")}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span>{t("auth:register.password")}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          <label className="field">
            <span>{t("auth:register.confirmPassword")}</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} />
          </label>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? t("auth:register.submitting") : t("auth:register.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}
