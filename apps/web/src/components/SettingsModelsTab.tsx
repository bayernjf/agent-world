/** Model-keys tab body of the Settings modal (audit P2 follow-up split out of
 * Settings.tsx). The component stays presentational: every piece of state and
 * every handler still lives in the modal, which owns the unsaved-changes guard
 * and the single save path. Splitting the markup keeps the tab readable without
 * changing save/dirty semantics. */
import type { Dispatch, DragEvent, MutableRefObject, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { AppConfig, Modality } from "../lib/api";
import type { ModelPricing } from "@agent-world/core";
import { PRICING_FIELDS, PRICING_HEADING } from "@agent-world/core";
import Tooltip from "./Tooltip";
import KeyInput from "./KeyInput";
import { ModelCatalogAdmin } from "./ModelCatalogAdmin";

export interface ModelCard {
  providerName: string;
  model: string;
}

export interface TestState {
  status: "idle" | "testing" | "ok" | "fail";
  message?: string;
}

export interface ModelForm {
  model: string;
  providerName: string;
  connectTo: string;
  type: string;
  modality: Modality;
  baseUrl: string;
  apiKey: string;
  prices: Record<string, string>;
}

export const MODALITY_LABELS: Record<Modality, string> = {
  text: "settings:modelKeys.modality.text",
  image: "settings:modelKeys.modality.image",
  video: "settings:modelKeys.modality.video",
  audio: "settings:modelKeys.modality.audio",
  embedding: "settings:modelKeys.modality.embedding",
};

const MODALITY_OPTIONS = Object.entries(MODALITY_LABELS) as [
  Modality,
  string,
][];

export interface SettingsModelsTabProps {
  t: TFunction;
  config: AppConfig;
  adding: boolean;
  setAdding: Dispatch<SetStateAction<boolean>>;
  startAdd: () => void;
  form: ModelForm;
  setForm: Dispatch<SetStateAction<ModelForm>>;
  formError: string;
  setFormError: Dispatch<SetStateAction<string>>;
  newKey: Record<string, string>;
  setNewKey: Dispatch<SetStateAction<Record<string, string>>>;
  testStates: Record<string, TestState>;
  cardSaved: Set<string>;
  revealKeys: Set<string>;
  toggleReveal: (id: string) => void;
  dragKey: string | null;
  dragKeyRef: MutableRefObject<string | null>;
  beginDrag: (k: string, e: DragEvent<HTMLElement>) => void;
  endDrag: () => void;
  overKey: string | null;
  setOverKey: Dispatch<SetStateAction<string | null>>;
  expanded: string | null;
  cards: ModelCard[];
  customProviders: Array<[string, AppConfig["providers"][string]]>;
  cardKey: (c: ModelCard) => string;
  reorderCards: (fromKey: string, toKey: string) => void;
  toggleExpand: (key: string) => void;
  patchProvider: (name: string, patch: Partial<AppConfig["providers"][string]>) => void;
  setPrice: (
    providerName: string,
    model: string,
    field: keyof ModelPricing,
    value: string,
  ) => void;
  testConnection: (c: ModelCard) => Promise<void>;
  testFormConnection: () => Promise<void>;
  addModel: () => void;
  updateCard: (c: ModelCard) => Promise<void>;
  revertCard: (c: ModelCard) => void;
  setDefault: (c: ModelCard) => void;
  replacementCandidates: (
    providerName: string,
    modelName: string,
    modality: Modality | null,
  ) => Array<{ provider: string; model: string }>;
  setDeleteTarget: Dispatch<SetStateAction<ModelCard | null>>;
  setDeleteReplacement: Dispatch<SetStateAction<string>>;
  providerExists: boolean;
  providerSlug: string;
}

export default function SettingsModelsTab(props: SettingsModelsTabProps) {
  const {
    t, config, adding, setAdding, startAdd, form, setForm, formError,
    setFormError, newKey, setNewKey, testStates, cardSaved, revealKeys,
    toggleReveal, dragKey, dragKeyRef, beginDrag, endDrag, overKey, setOverKey,
    expanded, cards, customProviders, cardKey, reorderCards, toggleExpand,
    patchProvider, setPrice, testConnection, testFormConnection, addModel,
    updateCard, revertCard, setDefault, replacementCandidates,
    setDeleteTarget, setDeleteReplacement, providerExists, providerSlug,
  } = props;
  return (
            <>
              <div className="settings-section-head">
                <h3 className="label">{t("settings:modelKeys.models")}</h3>
            <button
              className="btn btn--ghost btn--icon"
              onClick={() => (adding ? setAdding(false) : startAdd())}
            >
              {adding ? "×" : "+"}
            </button>
          </div>

          {adding && (
            <div className="model-form">
              <label className="field">
                <span>{t("settings:modelKeys.modelName")}</span>
                <input
                  autoFocus
                  placeholder={t("settings:modelKeys.modelNamePlaceholder")}
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("settings:modelKeys.modalityLabel")}</span>
                <select
                  className="select"
                  value={form.modality}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      modality: e.target.value as Modality,
                      prices: {},
                    })
                  }
                >
                  {MODALITY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("settings:modelKeys.provider")}</span>
                <select
                  className="select"
                  value={form.connectTo}
                  onChange={(e) =>
                    setForm({ ...form, connectTo: e.target.value })
                  }
                >
                  {customProviders.length === 0 && (
                    <option value="__new__">
                      {t("settings:modelKeys.newProvider")}
                    </option>
                  )}
                  {customProviders.map(([pname, pp]) => (
                    <option key={pname} value={pname}>
                      {pname} — {pp.baseUrl ?? t("settings:modelKeys.noUrl")}
                    </option>
                  ))}
                  <option value="__new__">
                    {t("settings:modelKeys.newProviderEllipsis")}
                  </option>
                </select>
              </label>

              {form.connectTo !== "__new__" ? (
                <p className="diag diag--ok form-hint">
                  {t("settings:modelKeys.reuseHint", {
                    provider: form.connectTo,
                  })}
                </p>
              ) : (
                <>
                  <label className="field">
                    <span>{t("settings:modelKeys.providerNameLabel")}</span>
                    <input
                      className={providerExists ? "input--error" : undefined}
                      placeholder={t("settings:modelKeys.providerNamePlaceholder")}
                      value={form.providerName}
                      onChange={(e) => {
                        setForm({ ...form, providerName: e.target.value });
                        if (formError) setFormError("");
                      }}
                    />
                    {providerExists ? (
                      <span className="field__error">
                        {t("settings:modelKeys.providerExists", {
                          slug: providerSlug,
                        })}
                      </span>
                    ) : form.providerName.trim() ? (
                      <span className="field__hint">
                        {t("settings:modelKeys.willSaveAs", { slug: providerSlug })}
                      </span>
                    ) : null}
                  </label>
                  <label className="field">
                    <span>{t("settings:modelKeys.providerType")}</span>
                    <select
                      className="select"
                      value={form.type}
                      onChange={(e) =>
                        setForm({ ...form, type: e.target.value })
                      }
                    >
                      <option value="openai-compatible">
                        openai-compatible
                      </option>
                      <option value="anthropic" disabled>
                        {t("settings:modelKeys.anthropicSoon")}
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    <span>{t("settings:modelKeys.baseUrl")}</span>
                    <input
                      placeholder="https://api.example.com/v1"
                      value={form.baseUrl}
                      onChange={(e) =>
                        setForm({ ...form, baseUrl: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("settings:modelKeys.apiKey")}</span>
                    <KeyInput
                      reveal={revealKeys.has("__form__")}
                      onToggle={() => toggleReveal("__form__")}
                      placeholder="sk-..."
                      value={form.apiKey}
                      onChange={(v) => setForm({ ...form, apiKey: v })}
                    />
                  </label>
                </>
              )}
              <div className="field">
                <span>{PRICING_HEADING[form.modality]}</span>
                <div className="price-row">
                  <code className="price-name">
                    {form.model || t("settings:modelKeys.modelPlaceholder")}
                  </code>
                  {PRICING_FIELDS[form.modality].map((field) => (
                    <input
                      key={field.key}
                      type="number"
                      step={field.step ?? "0.01"}
                      min="0"
                      placeholder={`${field.label} ${field.unit}`}
                      value={form.prices[field.key] ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          prices: {
                            ...form.prices,
                            [field.key]: e.target.value,
                          },
                        })
                      }
                    />
                  ))}
                </div>
              </div>
              {formError && <p className="diag diag--error">{formError}</p>}
              {(testStates["__form__"]?.status === "ok" ||
                testStates["__form__"]?.status === "fail") && (
                <p
                  className={`diag ${
                    testStates["__form__"]?.status === "ok"
                      ? "diag--ok"
                      : "diag--error"
                  }`}
                >
                  {testStates["__form__"]!.message}
                </p>
              )}
              <div className="model-form__actions">
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={testFormConnection}
                  disabled={testStates["__form__"]?.status === "testing"}
                >
                  {testStates["__form__"]?.status === "testing"
                    ? t("settings:modelKeys.testing")
                    : t("settings:modelKeys.test")}
                </button>
                <div className="model-form__actions-right">
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setAdding(false);
                      setFormError("");
                    }}
                  >
                    {t("settings:modelKeys.cancel")}
                  </button>
                  <button className="btn btn--sm" onClick={addModel}>
                    {t("settings:modelKeys.addModel")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {cards.length === 0 && !adding && (
            <p className="muted settings-empty">{t("settings:modelKeys.empty")}</p>
          )}

          {cards.map((c) => {
            const p = config.providers[c.providerName]!;
            const key = cardKey(c);
            const isOpen = expanded === key;
            const isEnabled = p.enabled !== false;
            const ts = testStates[key];
            const isDefault =
              config.defaultModel === c.model &&
              config.defaultProvider === c.providerName;

            return (
              <div
                key={key}
                className={`model-card ${!isEnabled ? "model-card--disabled" : ""} ${
                  isOpen ? "model-card--open" : ""
                } ${dragKey === key ? "model-card--dragging" : ""} ${
                  overKey === key && dragKey && dragKey !== key
                    ? "model-card--over"
                    : ""
                }`}
                onDragOver={(e) => {
                  if (dragKeyRef.current && dragKeyRef.current !== key) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overKey !== key) setOverKey(key);
                  }
                }}
                onDragEnter={(e) => {
                  if (dragKeyRef.current && dragKeyRef.current !== key) {
                    e.preventDefault();
                    setOverKey(key);
                  }
                }}
                onDragLeave={(e) => {
                  // Only clear when leaving the card entirely (not moving to a child).
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setOverKey((cur) => (cur === key ? null : cur));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragKeyRef.current;
                  endDrag();
                  if (from && from !== key) reorderCards(from, key);
                }}
              >
                <div
                  className="model-card__head"
                  onClick={() => toggleExpand(key)}
                >
                  <span
                    className="model-card__grip"
                    draggable
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      beginDrag(key, e);
                      e.dataTransfer.effectAllowed = "move";
                      try {
                        e.dataTransfer.setData("text/plain", key);
                      } catch {}
                    }}
                    onDragEnd={endDrag}
                  >
                    ⠿
                  </span>
                  <span className="model-card__chevron">
                    {isOpen ? "▼" : "▶"}
                  </span>
                  <label
                    className="toggle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) =>
                        patchProvider(c.providerName, {
                          enabled: e.target.checked,
                        })
                      }
                    />
                  </label>
                  <code className="model-card__name">{c.model}</code>
                  <span className="muted model-card__provider">
                    {c.providerName}
                  </span>
                  <span
                    className={`modality-badge modality--${p.modalities?.[c.model] ?? "text"}`}
                  >
                    {t(
                      MODALITY_LABELS[
                        (p.modalities?.[c.model] ?? "text") as Modality
                      ],
                    )}
                  </span>
                  {p.source === "builtin" && (
                    <Tooltip content={t("settings:modelKeys.builtinTooltip")}>
                      <span className="badge badge--builtin">
                        {t("settings:modelKeys.builtin")}
                      </span>
                    </Tooltip>
                  )}
                  {isDefault && (
                    <span className="badge badge--default">
                      {t("settings:modelKeys.default")}
                    </span>
                  )}
                  <div
                    className="model-card__head-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isDefault && (
                      <button
                        className="link link--sm"
                        onClick={() => setDefault(c)}
                      >
                        {t("settings:modelKeys.setDefault")}
                      </button>
                    )}
                    {p.source !== "builtin" && (
                      <button
                        className="link link--sm link--danger"
                        onClick={() => {
                          setDeleteTarget(c);
                          // Pre-seed the replacement dropdown with the first
                          // same-modality candidate so the dialog is one
                          // click away from confirming when there is one.
                          const prov = config.providers[c.providerName];
                          const mod = prov?.modalities?.[c.model] as
                            Modality | undefined;
                          const candidates = replacementCandidates(
                            c.providerName,
                            c.model,
                            mod ?? null,
                          );
                          setDeleteReplacement(candidates[0]?.model ?? "");
                        }}
                      >
                        {t("settings:modelKeys.delete")}
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="model-card__body">
                    <label className="field">
                      <span>{t("settings:modelKeys.modalityLabel")}</span>
                      <select
                        className="select"
                        disabled
                        value={p.modalities?.[c.model] ?? "text"}
                      >
                        {MODALITY_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>{t("settings:modelKeys.providerType")}</span>
                      <select className="select" disabled value={p.type}>
                        <option value="openai-compatible">
                          openai-compatible
                        </option>
                        <option value="anthropic" disabled>
                          {t("settings:modelKeys.anthropicSoon")}
                        </option>
                        <option value="fake">
                          {t("settings:modelKeys.fakeBuiltin")}
                        </option>
                      </select>
                    </label>
                    <label className="field">
                      <span>{t("settings:modelKeys.baseUrl")}</span>
                      <input
                        disabled
                        value={p.baseUrl ?? ""}
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                    <label className="field">
                      <span>{t("settings:modelKeys.apiKey")}</span>
                      <KeyInput
                        reveal={revealKeys.has(c.providerName)}
                        onToggle={() => toggleReveal(c.providerName)}
                        disabled={p.source === "builtin"}
                        placeholder={
                          p.source === "builtin"
                            ? p.apiKey
                              ? t("settings:modelKeys.builtinKeyReadonly")
                              : t("settings:modelKeys.builtinNoKey")
                            : p.apiKey
                              ? t("settings:modelKeys.keyConfigured")
                              : t("settings:modelKeys.keyNotConfigured")
                        }
                        value={newKey[c.providerName] ?? ""}
                        onChange={(v) => setNewKey({ ...newKey, [c.providerName]: v })}
                      />
                    </label>
                    <div className="field">
                      <span>
                        {
                          PRICING_HEADING[
                            (p.modalities?.[c.model] ?? "text") as Modality
                          ]
                        }
                      </span>
                      <div className="price-row">
                        <code className="price-name">{c.model}</code>
                        {PRICING_FIELDS[
                          (p.modalities?.[c.model] ?? "text") as Modality
                        ].map((field) => (
                          <input
                            key={field.key}
                            type="number"
                            step={field.step ?? "0.01"}
                            min="0"
                            disabled={p.source === "builtin"}
                            placeholder={`${field.label} ${field.unit}`}
                            value={p.pricing?.[c.model]?.[field.key] ?? ""}
                            onChange={(e) =>
                              setPrice(
                                c.providerName,
                                c.model,
                                field.key,
                                e.target.value,
                              )
                            }
                          />
                        ))}
                      </div>
                    </div>
                    <div className="provider-card__actions">
                      {p.source !== "builtin" && (
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => testConnection(c)}
                          disabled={ts?.status === "testing"}
                        >
                          {ts?.status === "testing"
                            ? t("settings:modelKeys.testing")
                            : t("settings:modelKeys.test")}
                        </button>
                      )}
                      {ts?.status === "ok" && (
                        <span className="diag diag--ok">{ts.message}</span>
                      )}
                      {ts?.status === "fail" && (
                        <span className="diag diag--error">{ts.message}</span>
                      )}
                    </div>
                    {p.source !== "builtin" && (
                      <div className="model-card__footer-actions">
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => revertCard(c)}
                        >
                          {t("settings:modelKeys.revert")}
                        </button>
                        <button
                          className="btn btn--sm"
                          onClick={() => updateCard(c)}
                        >
                          {cardSaved.has(key)
                            ? t("settings:modelKeys.updated")
                            : t("settings:modelKeys.update")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

            {/* 平台管理员专属：内置模型目录（非管理员拿到 403 时自行不渲染） */}
            <ModelCatalogAdmin />
            </>
  );
}
