import type { VideoGenConfig } from "@agent-world/core";
import type { FieldsProps } from "./types";
import { MissingModelHint, ModelSelect } from "./shared";
import { defaultModelFor } from "../../store/graph";

export default function VideoGenFields({
  node,
  updateNode,
  beginEdit,
  commitEdit,
  t,
  onOpenSettings,
  videoModelOptions,
}: FieldsProps) {
  if (!node.videoGen) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.videoGen.model")}</span>
        <ModelSelect
          value={node.videoGen.model}
          options={videoModelOptions}
          modalityLabel={t("nodes:modality.video")}
          followTarget={defaultModelFor("videoGen")?.model ?? null}
          t={t}
          onChange={(model) => updateNode(node.id, { videoGen: { ...node.videoGen!, model } })}
        />
        <MissingModelHint
          hasModels={videoModelOptions.length > 0}
          onOpenSettings={onOpenSettings}
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.videoGen.prompt")}</span>
        <textarea
          rows={4}
          placeholder={t("nodes:inspector.videoGen.promptPh")}
          value={node.videoGen.prompt ?? ""}
          onFocus={beginEdit}
          onBlur={commitEdit}
          onChange={(e) =>
            updateNode(node.id, {
              videoGen: { ...node.videoGen!, prompt: e.target.value },
            })
          }
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>{t("nodes:inspector.videoGen.duration")}</span>
          <input
            type="number"
            min={1}
            max={60}
            placeholder={t("nodes:inspector.videoGen.durationPh")}
            value={node.videoGen.duration ?? ""}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                videoGen: {
                  ...node.videoGen!,
                  duration: e.target.value
                    ? Math.min(60, Math.max(1, Number(e.target.value)))
                    : undefined,
                },
              })
            }
          />
        </label>
        <label className="field">
          <span>{t("nodes:inspector.videoGen.aspect")}</span>
          <select
            className="select"
            value={node.videoGen.aspect ?? ""}
            onChange={(e) =>
              updateNode(node.id, {
                videoGen: {
                  ...node.videoGen!,
                  aspect: (e.target.value ||
                    undefined) as VideoGenConfig["aspect"],
                },
              })
            }
          >
            <option value="">
              {t("nodes:inspector.videoGen.aspectDefault")}
            </option>
            <option value="16:9">{t("nodes:inspector.videoGen.aspect169")}</option>
            <option value="9:16">{t("nodes:inspector.videoGen.aspect916")}</option>
            <option value="1:1">{t("nodes:inspector.videoGen.aspect11")}</option>
            <option value="4:3">4:3</option>
            <option value="3:4">3:4</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>{t("nodes:inspector.videoGen.count")}</span>
        <input
          type="number"
          min={1}
          max={4}
          value={node.videoGen.n ?? 1}
          onFocus={beginEdit}
          onBlur={commitEdit}
          onChange={(e) =>
            updateNode(node.id, {
              videoGen: {
                ...node.videoGen!,
                n: Math.min(4, Math.max(1, Number(e.target.value) || 1)),
              },
            })
          }
        />
      </label>
      <details className="adv">
        <summary>{t("nodes:inspector.common.customEndpoint")}</summary>
        <label className="field">
          <span>{t("nodes:inspector.videoGen.baseUrl")}</span>
          <input
            type="text"
            placeholder="https://your-video-server/v1"
            value={node.videoGen.baseUrl ?? ""}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                videoGen: {
                  ...node.videoGen!,
                  baseUrl: e.target.value || undefined,
                },
              })
            }
          />
        </label>
        <label className="field">
          <span>{t("nodes:inspector.common.apiKey")}</span>
          <input
            type="password"
            placeholder="sk-..."
            value={node.videoGen.apiKey ?? ""}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                videoGen: {
                  ...node.videoGen!,
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
