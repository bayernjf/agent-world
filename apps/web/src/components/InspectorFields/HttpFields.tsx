import type { HttpNodeConfig } from "@agent-world/core";
import type { FieldsProps } from "./types";
import { formatPairs, parsePairs } from "./shared";

export default function HttpFields({ node, updateNode, t }: FieldsProps) {
  if (!node.http) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.http.method")}</span>
        <select
          className="select"
          value={node.http.method}
          onChange={(e) =>
            updateNode(node.id, {
              http: {
                ...node.http!,
                method: e.target.value as HttpNodeConfig["method"],
              },
            })
          }
        >
          {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.http.url")}</span>
        <input
          type="text"
          placeholder={t("nodes:inspector.http.urlPh")}
          value={node.http.url}
          onChange={(e) =>
            updateNode(node.id, {
              http: { ...node.http!, url: e.target.value },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.http.query")}</span>
        <textarea
          rows={3}
          placeholder="page: 1&#10;limit: 10"
          value={formatPairs(node.http.query ?? {})}
          onChange={(e) =>
            updateNode(node.id, {
              http: { ...node.http!, query: parsePairs(e.target.value) },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.http.headers")}</span>
        <textarea
          rows={3}
          placeholder="Authorization: Bearer xxx"
          value={formatPairs(node.http.headers ?? {})}
          onChange={(e) =>
            updateNode(node.id, {
              http: { ...node.http!, headers: parsePairs(e.target.value) },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.http.body")}</span>
        <textarea
          rows={4}
          placeholder='{"foo": "${source}"}'
          value={node.http.body ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              http: { ...node.http!, body: e.target.value },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.common.timeoutMs")}</span>
        <input
          type="number"
          min={1000}
          step={1000}
          value={node.http.timeoutMs}
          onChange={(e) =>
            updateNode(node.id, {
              http: { ...node.http!, timeoutMs: Number(e.target.value) },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.http.outputMode")}</span>
        <select
          className="select"
          value={node.http.outputMode}
          onChange={(e) =>
            updateNode(node.id, {
              http: {
                ...node.http!,
                outputMode: e.target.value as HttpNodeConfig["outputMode"],
              },
            })
          }
        >
          <option value="auto">{t("nodes:inspector.http.outputModeAuto")}</option>
          <option value="json">{t("nodes:inspector.http.outputModeJson")}</option>
          <option value="text">{t("nodes:inspector.http.outputModeText")}</option>
          <option value="file">{t("nodes:inspector.http.outputModeFile")}</option>
        </select>
      </label>
      <label className="field field--row">
        <input
          type="checkbox"
          checked={node.http.failOnError}
          onChange={(e) =>
            updateNode(node.id, {
              http: { ...node.http!, failOnError: e.target.checked },
            })
          }
        />
        <span>{t("nodes:inspector.http.failOnError")}</span>
      </label>
      <p className="note">{t("nodes:inspector.http.note")}</p>
    </>
  );
}
