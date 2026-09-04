import type { FanoutConfig } from "@agent-world/core";
import type { FieldsProps } from "./types";

export default function FanoutFields({
  node,
  updateNode,
  t,
  duplicateLanes,
  arrangeLanes,
}: FieldsProps) {
  if (!node.fanout) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.fanout.count")}</span>
        <input
          type="number"
          min={2}
          max={8}
          value={node.fanout.count}
          onChange={(e) =>
            updateNode(node.id, {
              fanout: {
                ...node.fanout!,
                count: Math.max(2, Number(e.target.value) || 2),
              },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.fanout.strategy")}</span>
        <select
          value={node.fanout.strategy}
          onChange={(e) =>
            updateNode(node.id, {
              fanout: {
                ...node.fanout!,
                strategy: e.target.value as FanoutConfig["strategy"],
              },
            })
          }
        >
          <option value="prompt">{t("nodes:inspector.fanout.strategyPrompt")}</option>
          <option value="temperature">
            {t("nodes:inspector.fanout.strategyTemperature")}
          </option>
          <option value="model">{t("nodes:inspector.fanout.strategyModel")}</option>
        </select>
      </label>
      {node.fanout.strategy === "prompt" && (
        <label className="field">
          <span>{t("nodes:inspector.fanout.prompts")}</span>
          <textarea
            rows={3}
            value={node.fanout.prompts?.join("\n") ?? ""}
            onChange={(e) =>
              updateNode(node.id, {
                fanout: {
                  ...node.fanout!,
                  prompts: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </label>
      )}
      {node.fanout.strategy === "temperature" && (
        <label className="field">
          <span>{t("nodes:inspector.fanout.temperatures")}</span>
          <input
            type="text"
            value={node.fanout.temperatures?.join(", ") ?? ""}
            onChange={(e) =>
              updateNode(node.id, {
                fanout: {
                  ...node.fanout!,
                  temperatures: e.target.value
                    .split(",")
                    .map((s) => Number(s.trim()))
                    .filter((n) => !Number.isNaN(n)),
                },
              })
            }
          />
        </label>
      )}
      {node.fanout.strategy === "model" && (
        <label className="field">
          <span>{t("nodes:inspector.fanout.models")}</span>
          <input
            type="text"
            value={node.fanout.models?.join(", ") ?? ""}
            onChange={(e) =>
              updateNode(node.id, {
                fanout: {
                  ...node.fanout!,
                  models: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </label>
      )}
      {node.fanout.strategy === "prompt" && node.fanout.prompts?.length === 0 && (
        <label className="field">
          <span>{t("nodes:inspector.fanout.angleBrief")}</span>
          <textarea
            rows={2}
            value={node.fanout.angleBrief}
            onChange={(e) =>
              updateNode(node.id, {
                fanout: { ...node.fanout!, angleBrief: e.target.value },
              })
            }
          />
        </label>
      )}
      <div className="field__hint">{t("nodes:inspector.fanout.hint")}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn--sm"
          onClick={() => duplicateLanes(node.id)}
        >
          {t("nodes:inspector.fanout.duplicateLanes")}
        </button>
        <button className="btn btn--sm" onClick={() => arrangeLanes(node.id)}>
          {t("nodes:inspector.fanout.arrangeLanes")}
        </button>
      </div>
    </>
  );
}
