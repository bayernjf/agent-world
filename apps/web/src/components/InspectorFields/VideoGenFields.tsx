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
        <span>{t("nodes:inspector.videoGen.mode")}</span>
        <select
          className="select"
          value={node.videoGen.mode ?? "text"}
          onChange={(e) => {
            const mode = e.target.value as VideoGenConfig["mode"];
            updateNode(node.id, {
              videoGen: {
                ...node.videoGen!,
                mode,
                // A text-mode request never reads the frame source; leaving the
                // flag set would make the stored config imply a behaviour that
                // will not happen.
                imageSource: mode === "text" ? undefined : node.videoGen!.imageSource,
              },
            });
          }}
        >
          <option value="text">{t("nodes:inspector.videoGen.modeText")}</option>
          <option value="keyframe">
            {t("nodes:inspector.videoGen.modeKeyframe")}
          </option>
          <option value="reference">
            {t("nodes:inspector.videoGen.modeReference")}
          </option>
        </select>
      </label>
      {(node.videoGen.mode ?? "text") !== "text" && (
        <>
          <label className="field field--row">
            <input
              type="checkbox"
              checked={node.videoGen.imageSource === "upstream"}
              onChange={(e) =>
                updateNode(node.id, {
                  videoGen: {
                    ...node.videoGen!,
                    imageSource: e.target.checked ? "upstream" : undefined,
                  },
                })
              }
            />
            <span>{t("nodes:inspector.videoGen.useUpstreamImage")}</span>
          </label>
          <div className="field__hint">
            {node.videoGen.imageSource === "upstream"
              ? t("nodes:inspector.videoGen.upstreamOnHint")
              : t("nodes:inspector.videoGen.upstreamOffHint")}
          </div>
        </>
      )}
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
