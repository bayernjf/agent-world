import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PRICING_FIELDS } from "@agent-world/core";
import type { Modality, ModelPricing } from "@agent-world/core";
import { api, type ModelCatalogChange, type ModelCatalogImpact, type ModelCatalogOverlay, type ModelCatalogView } from "../lib/api";
import Tooltip from "./Tooltip";

const MODALITIES: Modality[] = ["text", "image", "video", "audio", "embedding"];

/**
 * Platform-admin screen for the built-in model catalog
 * (docs/design-model-catalog.md 阶段 ④).
 *
 * It edits an **overlay**: each row shows the shipped default next to the value
 * in force, and clearing a provider's overlay reverts it to code. The endpoint
 * and the credential are deliberately absent — they are env/code territory and
 * the API would refuse them anyway (builtin-catalog.ts's allow-list).
 *
 * Retiring a model is not destructive here: the response lists the pipelines
 * still naming it (`affected`), and those pipelines then fail dispatch with a
 * message that names the model, so the owner re-picks. That answer replaces the
 * alias table the v1 design proposed.
 */
export function ModelCatalogAdmin() {
  const { t } = useTranslation(["settings"]);
  const [view, setView] = useState<ModelCatalogView | null>(null);
  const [draft, setDraft] = useState<ModelCatalogOverlay>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [changes, setChanges] = useState<ModelCatalogChange[]>([]);
  const [affected, setAffected] = useState<ModelCatalogImpact[]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let alive = true;
    void api.getModelCatalog().then((v) => {
      // null means "not a catalog admin" (403) — the panel simply is not there.
      if (alive && v) {
        setView(v);
        setDraft(v.overlay ?? {});
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!view) return null;

  const patchOf = (provider: string) => draft[provider] ?? {};
  const setPatch = (provider: string, patch: ModelCatalogOverlay[string]) =>
    setDraft((d) => ({ ...d, [provider]: { ...d[provider], ...patch } }));

  const eff = (provider: string) => {
    const p = patchOf(provider);
    const base = view!.providers[provider]!;
    return {
      models: p.models ?? base.models,
      modalities: { ...base.modalities, ...(p.modalities ?? {}) },
      pricing: { ...base.pricing, ...(p.pricing ?? {}) },
      enabled: p.enabled ?? base.enabled,
    };
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(view.overlay ?? {});

  async function save() {
    setStatus("saving");
    setError("");
    const res = await api.putModelCatalog(draft);
    if (!res.ok) {
      setStatus("error");
      setError(res.error);
      return;
    }
    setView(res.view);
    setDraft(res.view.overlay ?? {});
    setChanges(res.changes);
    setAffected(res.affected);
    setTruncated(res.affectedTruncated);
    setStatus("saved");
  }

  async function revert() {
    setStatus("saving");
    const res = await api.putModelCatalog({});
    if (!res.ok) {
      setStatus("error");
      setError(res.error);
      return;
    }
    setView(res.view);
    setDraft({});
    setChanges([]);
    setAffected([]);
    setStatus("saved");
  }

  function renameModel(provider: string, from: string, to: string) {
    const cur = eff(provider);
    const models = cur.models.map((m) => (m === from ? to : m));
    const modalities = Object.fromEntries(
      Object.entries(cur.modalities).map(([k, v]) => [k === from ? to : k, v]),
    );
    const pricing = Object.fromEntries(
      Object.entries(cur.pricing).map(([k, v]) => [k === from ? to : k, v]),
    );
    setPatch(provider, { models, modalities, pricing });
  }

  function setPrice(provider: string, model: string, field: keyof ModelPricing, raw: string) {
    const cur = eff(provider);
    const entry = { ...(cur.pricing[model] ?? {}) };
    const num = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(num) || num < 0) delete entry[field];
    else entry[field] = num;
    setPatch(provider, { pricing: { ...cur.pricing, [model]: entry } });
  }

  return (
    <section className="model-catalog">
      <header className="model-catalog__head">
        <h3>{t("settings:modelKeys.catalogTitle")}</h3>
        <p className="muted">{t("settings:modelKeys.catalogHint")}</p>
      </header>

      {view.gaps.length > 0 && (
        <p className="model-catalog__warn">
          {t("settings:modelKeys.catalogGaps", {
            models: [...new Set(view.gaps.map((g) => g.model))].join("、"),
          })}
        </p>
      )}

      {Object.entries(view.providers).map(([provider, base]) => {
        const cur = eff(provider);
        const shipped = view.code[provider];
        const overridden = JSON.stringify(draft[provider] ?? {}) !== "{}";
        return (
          <div className="provider-card" key={provider}>
            <div className="provider-card__head">
              <strong>{provider}</strong>
              <Badge label={overridden ? t("settings:modelKeys.catalogOverridden") : t("settings:modelKeys.catalogShipped")} />
              {!base.hasKey && <span className="muted">{t("settings:modelKeys.catalogNoKey")}</span>}
              <label className="model-catalog__enabled">
                <input
                  type="checkbox"
                  checked={cur.enabled}
                  onChange={(e) => setPatch(provider, { enabled: e.target.checked })}
                />
                {t("settings:modelKeys.catalogEnabled")}
              </label>
            </div>

            <ul className="model-catalog__models">
              {cur.models.map((model) => {
                const modality = cur.modalities[model] ?? "text";
                return (
                  <li className="model-catalog__row" key={model}>
                    <input
                      className="input"
                      value={model}
                      onChange={(e) => renameModel(provider, model, e.target.value)}
                      aria-label={t("settings:modelKeys.modelName")}
                    />
                    <select
                      className="select"
                      value={modality}
                      onChange={(e) =>
                        setPatch(provider, {
                          modalities: { ...cur.modalities, [model]: e.target.value as Modality },
                        })
                      }
                    >
                      {MODALITIES.map((m) => (
                        <option key={m} value={m}>
                          {t(`settings:modelKeys.modality.${m}`)}
                        </option>
                      ))}
                    </select>
                    <div className="price-row">
                      {PRICING_FIELDS[modality].map((field) => (
                        <input
                          key={field.key}
                          type="number"
                          step={field.step ?? "0.01"}
                          min="0"
                          placeholder={`${field.label} ${field.unit}`}
                          value={cur.pricing[model]?.[field.key] ?? ""}
                          onChange={(e) => setPrice(provider, model, field.key, e.target.value)}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        setPatch(provider, {
                          models: cur.models.filter((m) => m !== model),
                          modalities: Object.fromEntries(Object.entries(cur.modalities).filter(([k]) => k !== model)),
                          pricing: Object.fromEntries(Object.entries(cur.pricing).filter(([k]) => k !== model)),
                        })
                      }
                    >
                      {t("settings:modelKeys.catalogRemoveModel")}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="model-catalog__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setPatch(provider, { models: [...cur.models, ""] })}
              >
                {t("settings:modelKeys.catalogAddModel")}
              </button>
              {overridden && shipped && (
                <Tooltip content={t("settings:modelKeys.catalogRevertHint")}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setDraft((d) => {
                        const next = { ...d };
                        delete next[provider];
                        return next;
                      })
                    }
                  >
                    {t("settings:modelKeys.catalogRevert")}
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        );
      })}

      <footer className="model-catalog__foot">
        <button type="button" className="btn btn--primary" disabled={!dirty || status === "saving"} onClick={() => void save()}>
          {status === "saving" ? t("settings:modelKeys.catalogSaving") : t("settings:modelKeys.catalogSave")}
        </button>
        {dirty && Object.keys(view.overlay).length > 0 && (
          <button type="button" className="btn btn--ghost" onClick={() => void revert()}>
            {t("settings:modelKeys.catalogRevertAll")}
          </button>
        )}
        {status === "saved" && !dirty && <span className="muted">{t("settings:modelKeys.catalogSaved")}</span>}
        {status === "error" && <span className="model-catalog__warn">{error}</span>}
      </footer>

      {changes.length > 0 && (
        <div className="model-catalog__result">
          {changes.map((c) => (
            <p key={c.provider}>
              <strong>{c.provider}</strong>{" "}
              {[
                c.added.length && t("settings:modelKeys.catalogAdded", { names: c.added.join("、") }),
                c.removed.length && t("settings:modelKeys.catalogRemoved", { names: c.removed.join("、") }),
                c.priceEdited.length && t("settings:modelKeys.catalogRepriced", { names: c.priceEdited.join("、") }),
                c.modalityEdited.length && t("settings:modelKeys.catalogRemodality", { names: c.modalityEdited.join("、") }),
                c.enabledChanged && t("settings:modelKeys.catalogToggled"),
              ]
                .filter(Boolean)
                .join("；")}
            </p>
          ))}
          {affected.length > 0 && (
            <p className="model-catalog__warn">
              {t("settings:modelKeys.catalogAffected", { count: affected.length })}
              <ul>
                {affected.map((a) => (
                  <li key={a.graphId}>
                    {a.graphName} — {a.nodes.join("、")}（{a.models.join("、")}）
                  </li>
                ))}
              </ul>
              {truncated && <span className="muted">{t("settings:modelKeys.catalogAffectedTruncated")}</span>}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Badge({ label }: { label: string }) {
  return <span className="badge badge--builtin">{label}</span>;
}
