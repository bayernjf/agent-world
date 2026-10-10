import type { FieldsProps } from "./types";
import { RetryField } from "./shared";

/**
 * Config panel for `generic` nodes (B1): the 18 fields of GenericConfig were
 * previously reachable only by re-creating the node from tpl-custom-model.
 * All fields are always rendered; `modality` only hints which group the
 * engine will use (auto-detected when absent).
 */
export default function GenericFields({
  node,
  updateNode,
  t,
}: FieldsProps) {
  if (!node.generic) return null;
  const cfg = node.generic;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.common.model")}</span>
        <input
          type="text"
          placeholder={t("nodes:inspector.generic.modelPh")}
          value={cfg.model}
          onChange={(e) =>
            updateNode(node.id, { generic: { ...cfg, model: e.target.value } })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.generic.modality")}</span>
        <select
          className="select"
          value={cfg.modality ?? "text"}
          onChange={(e) =>
            updateNode(node.id, {
              generic: {
                ...cfg,
                modality: e.target.value as
                  | "text"
                  | "image"
                  | "video"
                  | "audio",
              },
            })
          }
        >
          <option value="text">{t("nodes:inspector.generic.modalityText")}</option>
          <option value="image">{t("nodes:inspector.generic.modalityImage")}</option>
          <option value="video">{t("nodes:inspector.generic.modalityVideo")}</option>
          <option value="audio">{t("nodes:inspector.generic.modalityAudio")}</option>
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.textGen.prompt")}</span>
        <textarea
          rows={4}
          value={cfg.prompt ?? ""}
          onChange={(e) =>
            updateNode(node.id, { generic: { ...cfg, prompt: e.target.value } })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.common.customEndpoint")}</span>
        <input
          type="text"
          value={cfg.baseUrl ?? ""}
          onChange={(e) =>
            updateNode(node.id, { generic: { ...cfg, baseUrl: e.target.value } })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.common.apiKey")}</span>
        <input
          type="password"
          autoComplete="off"
          value={cfg.apiKey ?? ""}
          onChange={(e) =>
            updateNode(node.id, { generic: { ...cfg, apiKey: e.target.value } })
          }
        />
      </label>
      <label className="field">
        <span>
          {t("nodes:inspector.textGen.temperature", {
            temp: (cfg.temperature ?? 0.7).toFixed(2),
          })}
        </span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={cfg.temperature ?? 0.7}
          onChange={(e) =>
            updateNode(node.id, {
              generic: { ...cfg, temperature: Number(e.target.value) },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.common.timeoutMs")}</span>
        <input
          type="number"
          min="1000"
          step="1000"
          value={cfg.timeoutMs ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              generic: {
                ...cfg,
                timeoutMs:
                  e.target.value === "" ? undefined : Number(e.target.value),
              },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.textGen.budget")}</span>
        <input
          type="number"
          min="0"
          step="0.001"
          placeholder={t("nodes:inspector.textGen.budgetPh")}
          value={cfg.budgetUsd ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              generic: {
                ...cfg,
                budgetUsd: e.target.value === "" ? null : Number(e.target.value),
              },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.textGen.inputPolicy")}</span>
        <select
          className="select"
          value={cfg.inputPolicy?.mode ?? "all"}
          onChange={(e) =>
            updateNode(node.id, {
              generic: {
                ...cfg,
                inputPolicy: {
                  ...(cfg.inputPolicy ?? { mode: "all" as const }),
                  mode: e.target.value as
                    | "all"
                    | "last"
                    | "truncate"
                    | "summary",
                },
              },
            })
          }
        >
          <option value="all">{t("nodes:inspector.textGen.inputPolicyAll")}</option>
          <option value="last">{t("nodes:inspector.textGen.inputPolicyLast")}</option>
          <option value="truncate">{t("nodes:inspector.textGen.inputPolicyTruncate")}</option>
          <option value="summary">{t("nodes:inspector.textGen.inputPolicySummary")}</option>
        </select>
      </label>
      <p className="note">
        {(() => {
          switch (cfg.inputPolicy?.mode ?? "all") {
            case "all":
              return t("nodes:inspector.textGen.inputPolicyNoteAll");
            case "last":
              return t("nodes:inspector.textGen.inputPolicyNoteLast");
            case "truncate":
              return t("nodes:inspector.textGen.inputPolicyNoteTruncate");
            case "summary":
              return t("nodes:inspector.textGen.inputPolicyNoteSummary");
            default:
              return "";
          }
        })()}
      </p>
      {(cfg.inputPolicy?.mode === "truncate" ||
        cfg.inputPolicy?.mode === "summary") && (
        <label className="field">
          <span>{t("nodes:inspector.textGen.maxChars")}</span>
          <input
            type="number"
            min="500"
            step="500"
            value={cfg.inputPolicy?.maxChars ?? 8000}
            onChange={(e) =>
              updateNode(node.id, {
                generic: {
                  ...cfg,
                  inputPolicy: {
                    mode: cfg.inputPolicy?.mode ?? "truncate",
                    maxChars: Number(e.target.value),
                  },
                },
              })
            }
          />
        </label>
      )}
      <label className="field">
        <span>{t("nodes:inspector.imageGen.size")}</span>
        <input
          type="text"
          placeholder={t("nodes:inspector.imageGen.sizePh")}
          value={cfg.size ?? ""}
          onChange={(e) =>
            updateNode(node.id, { generic: { ...cfg, size: e.target.value } })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.imageGen.aspect")}</span>
        <select
          className="select"
          value={cfg.aspect ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              generic: {
                ...cfg,
                aspect: e.target.value === "" ? undefined : (e.target.value as "1:1" | "3:4" | "4:3" | "16:9"),
              },
            })
          }
        >
          <option value="">{t("nodes:inspector.imageGen.aspectDefault")}</option>
          <option value="1:1">{t("nodes:inspector.imageGen.aspect11")}</option>
          <option value="3:4">{t("nodes:inspector.imageGen.aspect34")}</option>
          <option value="4:3">{t("nodes:inspector.imageGen.aspect43")}</option>
          <option value="16:9">{t("nodes:inspector.imageGen.aspect169")}</option>
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.imageGen.count")}</span>
        <input
          type="number"
          min="1"
          max="8"
          step="1"
          value={cfg.n ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              generic: {
                ...cfg,
                n: e.target.value === "" ? undefined : Number(e.target.value),
              },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.videoGen.duration")}</span>
        <input
          type="number"
          min="1"
          max="60"
          step="1"
          placeholder={t("nodes:inspector.videoGen.durationPh")}
          value={cfg.duration ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              generic: {
                ...cfg,
                duration:
                  e.target.value === "" ? undefined : Number(e.target.value),
              },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.audioGen.voice")}</span>
        <input
          type="text"
          placeholder={t("nodes:inspector.audioGen.voicePh")}
          value={cfg.voice ?? ""}
          onChange={(e) =>
            updateNode(node.id, { generic: { ...cfg, voice: e.target.value } })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.audioGen.format")}</span>
        <select
          className="select"
          value={cfg.format ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              generic: {
                ...cfg,
                format: e.target.value === "" ? undefined : (e.target.value as "mp3" | "wav" | "opus" | "aac" | "flac"),
              },
            })
          }
        >
          <option value="">{t("nodes:inspector.generic.formatDefault")}</option>
          <option value="mp3">mp3</option>
          <option value="wav">wav</option>
          <option value="opus">opus</option>
          <option value="aac">aac</option>
          <option value="flac">flac</option>
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.audioGen.speed")}</span>
        <input
          type="number"
          min="0.25"
          max="4"
          step="0.05"
          placeholder={t("nodes:inspector.audioGen.speedPh")}
          value={cfg.speed ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              generic: {
                ...cfg,
                speed: e.target.value === "" ? undefined : Number(e.target.value),
              },
            })
          }
        />
      </label>
      <RetryField
        value={cfg.retry?.maxRetries ?? 2}
        onChange={(maxRetries) =>
          updateNode(node.id, {
            generic: {
              ...cfg,
              retry: {
                ...(cfg.retry ?? {
                  maxRetries: 2,
                  baseDelayMs: 1000,
                  maxDelayMs: 30000,
                }),
                maxRetries,
              },
            },
          })
        }
        t={t}
      />
      <p className="note">{t("nodes:inspector.generic.note")}</p>
    </>
  );
}
