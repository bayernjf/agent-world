import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Language packs
import zhCommon from "./locales/zh/common.json";
import zhCanvas from "./locales/zh/canvas.json";
import zhNodes from "./locales/zh/nodes.json";
import zhModals from "./locales/zh/modals.json";
import zhSettings from "./locales/zh/settings.json";
import zhRun from "./locales/zh/run.json";
import zhErrors from "./locales/zh/errors.json";
import zhAuth from "./locales/zh/auth.json";

import enCommon from "./locales/en/common.json";
import enCanvas from "./locales/en/canvas.json";
import enNodes from "./locales/en/nodes.json";
import enModals from "./locales/en/modals.json";
import enSettings from "./locales/en/settings.json";
import enRun from "./locales/en/run.json";
import enErrors from "./locales/en/errors.json";
import enAuth from "./locales/en/auth.json";

const STORAGE_KEY = "agent-world.language";

function detectLanguage(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* private mode */
  }
  // Follow browser language
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith("zh")) return "zh";
  return "en";
}

i18n.use(initReactI18next).init({
  resources: {
    zh: {
      common: zhCommon,
      canvas: zhCanvas,
      nodes: zhNodes,
      modals: zhModals,
      settings: zhSettings,
      run: zhRun,
      errors: zhErrors,
      auth: zhAuth,
    },
    en: {
      common: enCommon,
      canvas: enCanvas,
      nodes: enNodes,
      modals: enModals,
      settings: enSettings,
      run: enRun,
      errors: enErrors,
      auth: enAuth,
    },
  },
  lng: detectLanguage(),
  fallbackLng: "zh",
  ns: ["common", "canvas", "nodes", "modals", "settings", "run", "errors", "auth"],
  defaultNS: "common",
  interpolation: {
    escapeValue: false, // React already escapes
  },
  returnNull: false,
  returnEmptyString: false,
});

// Persist language change
i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* private mode */
  }
  document.documentElement.setAttribute("lang", lng);
});

// Set initial lang attribute
document.documentElement.setAttribute("lang", i18n.language);

export default i18n;
