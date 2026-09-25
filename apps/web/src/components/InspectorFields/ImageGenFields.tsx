import type { FieldsProps } from "./types";
import { MissingModelHint, ModelSelect } from "./shared";
import { defaultModelFor } from "../../store/graph";

export default function ImageGenFields({
  node,
  updateNode,
  beginEdit,
  commitEdit,
  t,
  onOpenSettings,
  imageModelOptions,
}: FieldsProps) {
  if (!node.imageGen) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.imageGen.model")}</span>
        <ModelSelect
          value={node.imageGen.model}
          options={imageModelOptions}
          modalityLabel={t("nodes:modality.image")}
          followTarget={defaultModelFor("imageGen")?.model ?? null}
          t={t}
          onChange={(model) => updateNode(node.id, { imageGen: { ...node.imageGen!, model } })}
        />
        <MissingModelHint
          hasModels={imageModelOptions.length > 0}
          onOpenSettings={onOpenSettings}
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.imageGen.size")}</span>
        <input
          type="text"
          placeholder={t("nodes:inspector.imageGen.sizePh")}
          value={node.imageGen.size ?? ""}
          onFocus={beginEdit}
          onBlur={commitEdit}
          onChange={(e) =>
            updateNode(node.id, {
              imageGen: { ...node.imageGen!, size: e.target.value || undefined },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.imageGen.prompt")}</span>
        <textarea
          rows={4}
          placeholder={t("nodes:inspector.imageGen.promptPh")}
          value={node.imageGen.prompt ?? ""}
          onFocus={beginEdit}
          onBlur={commitEdit}
          onChange={(e) =>
            updateNode(node.id, {
              imageGen: { ...node.imageGen!, prompt: e.target.value },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.imageGen.count")}</span>
        <input
          type="number"
          min={1}
          max={8}
          value={node.imageGen.n ?? 1}
          onFocus={beginEdit}
          onBlur={commitEdit}
          onChange={(e) =>
            updateNode(node.id, {
              imageGen: {
                ...node.imageGen!,
                n: Math.min(8, Math.max(1, Number(e.target.value) || 1)),
              },
            })
          }
        />
      </label>
      <details className="adv">
        <summary>{t("nodes:inspector.common.customEndpoint")}</summary>
        <label className="field">
          <span>{t("nodes:inspector.imageGen.baseUrl")}</span>
          <input
            type="text"
            placeholder="https://your-sd-server/v1"
            value={node.imageGen.baseUrl ?? ""}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                imageGen: {
                  ...node.imageGen!,
                  baseUrl: e.target.value || undefined,
                },
              })
            }
          />
        </label>
        <label className="field">
          <span>{t("nodes:inspector.common.apiKeyOptional")}</span>
          <input
            type="password"
            placeholder="sk-..."
            value={node.imageGen.apiKey ?? ""}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                imageGen: {
                  ...node.imageGen!,
                  apiKey: e.target.value || undefined,
                },
              })
            }
          />
        </label>
      </details>
    </>
  );
}
