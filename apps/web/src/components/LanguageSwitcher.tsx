import { useTranslation } from "react-i18next";

/**
 * Toggle between the two supported languages. Shows the language you would
 * switch *to*, so the label stays self-explanatory in either locale.
 */
export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const isZh = (i18n.language ?? "zh").startsWith("zh");
  return (
    <button
      type="button"
      className="link"
      onClick={() => i18n.changeLanguage(isZh ? "en" : "zh")}
      title={isZh ? "Switch to English" : "切换到中文"}
    >
      {isZh ? "English" : "中文"}
    </button>
  );
}
