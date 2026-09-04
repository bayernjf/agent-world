import type { FieldsProps } from "./types";

export default function SearchFields({
  node,
  updateNode,
  beginEdit,
  commitEdit,
  t,
}: FieldsProps) {
  if (!node.search) return null;
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
          <option value="tavily">Tavily</option>
          <option value="serpapi">SerpAPI</option>
          <option value="google">Google CSE</option>
        </select>
      </label>
      {node.search.provider !== "duckduckgo" && (
        <>
          <label className="field">
            <span>{t("nodes:inspector.search.apiKey")}</span>
            <input
              type="password"
              placeholder={t("nodes:inspector.search.apiKeyPh")}
              value={node.search.apiKey ?? ""}
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) =>
                updateNode(node.id, {
                  search: {
                    ...node.search!,
                    apiKey: e.target.value || undefined,
                  },
                })
              }
            />
          </label>
          {node.search.provider === "google" && (
            <label className="field">
              <span>{t("nodes:inspector.search.cx")}</span>
              <input
                className="input"
                type="text"
                placeholder="e.g. a1b2c3d4e5"
                value={node.search.cx ?? ""}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, {
                    search: {
                      ...node.search!,
                      cx: e.target.value || undefined,
                    },
                  })
                }
              />
            </label>
          )}
        </>
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
