import { useEffect, useState, type FormEvent } from "react";
import type { Me } from "./UserMenu";

interface Props {
  open: boolean;
  me: Me | null;
  onClose: () => void;
}

export default function AccountDialog({ open, me, onClose }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setError("");
      setOk(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setOk(false);
    if (next !== confirm) {
      setError("两次输入的新密码不一致");
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
      if (!res.ok) throw new Error((data as any).error ?? `请求失败 (${res.status})`);
      setOk(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const joined = me?.createdAt ? new Date(me.createdAt).toLocaleDateString("zh-CN") : "";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal account-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>个人中心</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal__body">
          <div className="account-info">
            <div className="account-info__avatar">
              {me?.email ? me.email[0]!.toUpperCase() : "?"}
            </div>
            <div className="account-info__text">
              <div className="account-info__email">{me?.email ?? "…"}</div>
              {joined && <div className="account-info__sub">注册于 {joined}</div>}
            </div>
          </div>
          <form className="account-form" onSubmit={submit}>
            <h3 className="label">修改密码</h3>
            {error && <div className="auth-error">{error}</div>}
            {ok && <div className="account-ok">密码已更新</div>}
            <label className="field">
              <span>当前密码</span>
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            <label className="field">
              <span>新密码</span>
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
              <span>确认新密码</span>
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
              {busy ? "提交中…" : "更新密码"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
