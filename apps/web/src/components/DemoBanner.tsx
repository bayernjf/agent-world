import { useTranslation } from "react-i18next";
import { useSession } from "../store/session";
import { formatTime } from "../i18n/utils";
import { logout } from "./AuthPages";

/**
 * Slim global bar shown only while a demo session is active: states the demo
 * limits and offers the primary path (claim/convert, keeps the work) plus an
 * exit action (drops the demo cookie back to the login page).
 */
export default function DemoBanner() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const openClaim = useSession((s) => s.openClaim);

  if (!user?.isDemo || !user.demo) return null;
  const { quota, expiresAt } = user.demo;
  const endDate = new Date(expiresAt);
  const end = Number.isNaN(endDate.getTime()) ? "" : formatTime(endDate);

  const handleExit = async () => {
    await logout();
    window.location.assign("/login");
  };

  return (
    <div className="demo-banner" role="status">
      <span className="demo-banner__label">{t("auth:demo.banner.label")}</span>
      <span className="demo-banner__meta">{t("auth:demo.banner.runsLimit", { runs: quota.maxRunsTotal })}</span>
      {end && <span className="demo-banner__meta">{t("auth:demo.banner.expiresAt", { time: end })}</span>}
      <span className="demo-banner__spacer" />
      <button type="button" className="btn demo-banner__claim" onClick={() => openClaim("manual")}>
        {t("auth:demo.banner.claim")}
      </button>
      <button type="button" className="chip chip--muted demo-banner__exit" onClick={handleExit}>
        {t("auth:demo.banner.exit")}
      </button>
    </div>
  );
}
