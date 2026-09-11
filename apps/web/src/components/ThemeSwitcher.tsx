import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getTheme, toggleTheme, type Theme } from "../theme";

/**
 * Toggle between dark and light themes. Mirrors LanguageSwitcher: the label
 * names the theme you would switch *to*. The current theme is read from the
 * data-theme attribute managed by ../theme; local state only drives re-render.
 */
export default function ThemeSwitcher() {
  const { t } = useTranslation();
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="link"
      onClick={() => setThemeState(toggleTheme())}
      title={isDark ? t("common:app.themeToLight") : t("common:app.themeToDark")}
    >
      {isDark ? t("common:app.themeLight") : t("common:app.themeDark")}
    </button>
  );
}
