import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"loading" | "ok" | "unauthorized">("loading");

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => setStatus(res.ok ? "ok" : "unauthorized"))
      .catch(() => setStatus("unauthorized"));
  }, []);

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
