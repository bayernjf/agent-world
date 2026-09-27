import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSession, type SessionUser } from "../store/session";
import MustChangePassword from "./MustChangePassword";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const setSession = useSession((s) => s.setSession);
  const email = useSession((s) => s.user?.email);
  const [status, setStatus] = useState<"loading" | "ok" | "unauthorized" | "mustChange">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setStatus("loading");
    fetch("/api/auth/me", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          setSession(null);
          setStatus("unauthorized");
          return;
        }
        // ok means authenticated; the body is best-effort — older callers and
        // tests may return 200 without a JSON body, in which case we still render.
        let user: SessionUser | null = null;
        try {
          const data = (await res.json()) as { user?: SessionUser } | null;
          user = data?.user ?? null;
        } catch {
          user = null;
        }
        setSession(user);
        // A cookie minted before the password was replaced still lands here, so
        // the gate is re-checked on every mount rather than only at login.
        setStatus(user?.mustChangePassword ? "mustChange" : "ok");
      })
      .catch(() => setStatus("unauthorized"));
  }, [setSession, attempt]);

  if (status === "loading") {
    return (
      <div className="auth-page">
        <p className="status">{t("modals:protectedRoute.loading")}</p>
      </div>
    );
  }

  if (status === "unauthorized") {
    return <Navigate to="/login" replace />;
  }

  if (status === "mustChange") {
    // Re-probe /me rather than flipping local state: the server decides when the
    // gate opens, and this way it cannot be talked out of it.
    return <MustChangePassword email={email} onDone={() => setAttempt((a) => a + 1)} />;
  }

  return <>{children}</>;}
