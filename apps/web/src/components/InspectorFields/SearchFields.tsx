import type { FieldsProps } from "./types";

/** A keyed provider is selectable only once the user has saved its key in Settings. */
function hasProviderKey(
  searchConfig: FieldsProps["searchConfig"],
  provider: "tavily" | "serpapi" | "google",
): boolean {
  return !!searchConfig?.[provider]?.apiKey;
}

export default function SearchFields({
  node,
  updateNode,
  t,
  searchConfig,
  onOpenSettings,
}: FieldsProps) {
  if (!node.search) return null;
  const keyed = [
    { value: "tavily", label: "Tavily" },
    { value: "serpapi", label: "SerpAPI" },
    { value: "google", label: "Google CSE" },
  ] as const;
  const missingKeys = keyed
    .filter(({ value }) => !hasProviderKey(searchConfig, value))
    .map(({ label }) => label);
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.search.query")}</span>
        <input
          className="input"
          type="text"
          placeholder={t("nodes:inspector.search.queryPh")}
          value={node.search.query}
          onChange={(e) =>
            updateNode(node.id, {
              search: { ...node.search!, query: e.target.value },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.search.provider")}</span>
        <select
          className="select"
          value={node.search.provider}
          onChange={(e) =>
            updateNode(node.id, {
              search: {
                ...node.search!,
                provider: e.target.value as
                  | "duckduckgo"
                  | "tavily"
                  | "serpapi"
                  | "google",
              },
            })
          }
        >
          <option value="duckduckgo">
            {t("nodes:inspector.search.providerDdg")}
          </option>
          {keyed.map(({ value, label }) => {
            const ready = hasProviderKey(searchConfig, value);
            return (
              <option key={value} value={value} disabled={!ready}>
                {label}
                {!ready ? ` ${t("nodes:inspector.search.providerNoKey")}` : ""}
              </option>
            );
          })}
        </select>
      </label>
      {missingKeys.length > 0 && (
        <p className="field__hint">
          {t("nodes:inspector.search.noKeyHint", { providers: missingKeys.join(" / ") })}
          <button type="button" className="link" onClick={onOpenSettings}>
            {t("nodes:inspector.search.goSearchSettings")}
          </button>
        </p>
      )}
      <label className="field">
        <span>{t("nodes:inspector.search.maxResults")}</span>
        <input
          className="input"
          type="number"
          min={1}
          max={20}
          value={node.search.maxResults}
          onChange={(e) =>
            updateNode(node.id, {
              search: { ...node.search!, maxResults: Number(e.target.value) || 5 },
            })
          }
        />
      </label>
      <p className="note">{t("nodes:inspector.search.note")}</p>
    </>
  );
}
