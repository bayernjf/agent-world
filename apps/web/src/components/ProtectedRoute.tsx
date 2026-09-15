import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSession, type SessionUser } from "../store/session";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const setSession = useSession((s) => s.setSession);
  const [status, setStatus] = useState<"loading" | "ok" | "unauthorized">("loading");

  useEffect(() => {
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
        setStatus("ok");
      })
      .catch(() => setStatus("unauthorized"));
  }, [setSession]);

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

  return <>{children}</>;}
