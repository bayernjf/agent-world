import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "./Logo";

async function postAuth(url: string, body: Record<string, string | boolean>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? `请求失败 (${res.status})`);
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
          <h1 className="auth-card__title">Agent World</h1>
        </div>
        <p className="auth-card__sub">
          还没有账号？ <Link to="/register">注册</Link>
        </p>
        <form className="auth-card__body" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}
          <label className="field">
            <span>邮箱</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={email === ""} />
          </label>
          <label className="field">
            <span>密码</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={email !== ""} />
          </label>
          <label className="auth-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>记住我</span>
            <span className="auth-remember__hint">记住账号 · 7 天内免登录</span>
          </label>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function RegisterPage() {
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
      setError("两次输入的密码不一致");
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
          <h1 className="auth-card__title">Agent World</h1>
        </div>
        <p className="auth-card__sub">
          已有账号？ <Link to="/login">登录</Link>
        </p>
        <form className="auth-card__body" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}
          <label className="field">
            <span>邮箱</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span>密码</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          <label className="field">
            <span>确认密码</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} />
          </label>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "注册中…" : "注册"}
          </button>
        </form>
      </div>
    </div>
  );
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}
