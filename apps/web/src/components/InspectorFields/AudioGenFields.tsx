import type { AudioGenConfig } from "@agent-world/core";
import type { FieldsProps } from "./types";
import { MissingModelHint, ModelSelect } from "./shared";
import { defaultModelFor } from "../../store/graph";

export default function AudioGenFields({
  node,
  updateNode,
  beginEdit,
  commitEdit,
  t,
  onOpenSettings,
  audioModelOptions,
}: FieldsProps) {
  if (!node.audioGen) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.audioGen.model")}</span>
        <ModelSelect
          value={node.audioGen.model}
          options={audioModelOptions}
          modalityLabel={t("nodes:modality.audio")}
          followTarget={defaultModelFor("audioGen")?.model ?? null}
          t={t}
          onChange={(model) => updateNode(node.id, { audioGen: { ...node.audioGen!, model } })}
        />
        <MissingModelHint
          hasModels={audioModelOptions.length > 0}
          onOpenSettings={onOpenSettings}
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.audioGen.prompt")}</span>
        <textarea
          rows={4}
          placeholder={t("nodes:inspector.audioGen.promptPh")}
          value={node.audioGen.prompt ?? ""}
          onFocus={beginEdit}
          onBlur={commitEdit}
          onChange={(e) =>
            updateNode(node.id, {
              audioGen: { ...node.audioGen!, prompt: e.target.value },
            })
          }
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>{t("nodes:inspector.audioGen.voice")}</span>
          <input
            type="text"
            placeholder={t("nodes:inspector.audioGen.voicePh")}
            value={node.audioGen.voice ?? ""}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                audioGen: {
                  ...node.audioGen!,
                  voice: e.target.value || undefined,
                },
              })
            }
          />
        </label>
        <label className="field">
          <span>{t("nodes:inspector.audioGen.format")}</span>
          <select
            className="select"
            value={node.audioGen.format ?? "mp3"}
            onChange={(e) =>
              updateNode(node.id, {
                audioGen: {
                  ...node.audioGen!,
                  format: e.target.value as AudioGenConfig["format"],
                },
              })
            }
          >
            <option value="mp3">mp3</option>
            <option value="wav">wav</option>
            <option value="opus">opus</option>
            <option value="aac">aac</option>
            <option value="flac">flac</option>
          </select>
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>{t("nodes:inspector.audioGen.speed")}</span>
          <input
            type="number"
            min={0.25}
            max={4}
            step={0.25}
            placeholder={t("nodes:inspector.audioGen.speedPh")}
            value={node.audioGen.speed ?? ""}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                audioGen: {
                  ...node.audioGen!,
                  speed: e.target.value
                    ? Math.min(4, Math.max(0.25, Number(e.target.value)))
                    : undefined,
                },
              })
            }
          />
        </label>
        <label className="field">
          <span>{t("nodes:inspector.audioGen.count")}</span>
          <input
            type="number"
            min={1}
            max={4}
            value={node.audioGen.n ?? 1}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                audioGen: {
                  ...node.audioGen!,
                  n: Math.min(4, Math.max(1, Number(e.target.value) || 1)),
                },
              })
            }
          />
        </label>
      </div>
      <details className="adv">
        <summary>{t("nodes:inspector.common.customEndpoint")}</summary>
        <label className="field">
          <span>{t("nodes:inspector.audioGen.baseUrl")}</span>
          <input
            type="text"
            placeholder="https://your-audio-server/v1"
            value={node.audioGen.baseUrl ?? ""}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                audioGen: {
                  ...node.audioGen!,
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
            value={node.audioGen.apiKey ?? ""}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                audioGen: {
                  ...node.audioGen!,
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
