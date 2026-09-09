import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserSkillCard, UserSkillCardKind } from "../lib/api";

/**
 * Settings → 自建技能卡: cards the user writes themselves.
 *
 * Three kinds, all of them data — a prompt fragment, a judging clause, a field
 * table. Nothing here executes, which is why it needs no sandbox. `tool` kind
 * is absent for exactly the opposite reason and is refused server-side too.
 *
 * The output-contract editor is a field table rather than a JSON-schema box
 * because the validator only ever reads field names, their type, and which are
 * required — offering a raw schema would imply support that does not exist.
 *
 * Visual language mirrors the model/MCP cards (collapsible head / body).
 */

interface Props {
  cards: UserSkillCard[];
  onChange: (cards: UserSkillCard[]) => void;
}

const KINDS: UserSkillCardKind[] = ["prompt-module", "output-contract", "judge"];
const FIELD_TYPES = ["string", "number", "boolean", "object", "array"] as const;

function blankCard(kind: UserSkillCardKind, id: string, name: string): UserSkillCard {
  if (kind === "prompt-module") return { id, name, kind, prompt: "" };
  if (kind === "judge") return { id, name, kind, criterion: "" };
  return { id, name, kind, fields: [{ name: "", type: "string", required: false }] };
}

function slug(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "-");
}

export function SkillCardSettings({ cards, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<UserSkillCardKind>("prompt-module");

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const replace = (id: string, next: UserSkillCard) => onChange(cards.map((c) => (c.id === id ? next : c)));

  const add = () => {
    const name = draftName.trim();
    if (!name) return;
    // Non-latin names (the common case here) slugify to dashes, so derive the
    // id from content when nothing readable survives.
    const base = slug(draftName);
    const idBase = /[a-z0-9]/.test(base) ? base.replace(/^-+|-+$/g, "") : `card-${cards.length + 1}`;
    const id = `local:${idBase}`;
    if (cards.some((c) => c.id === id)) return;
    onChange([...cards, blankCard(draftKind, id, name)]);
    setOpen(new Set([id]));
    setDraftName("");
  };

  return (
    <>
      <div className="settings-section-head">
        <h3 className="label">{t("settings:cards.title")}</h3>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("settings:cards.description")}
      </p>

      {cards.length === 0 && <p className="muted">{t("settings:cards.empty")}</p>}

      {cards.map((card) => {
        const isOpen = open.has(card.id);
        return (
          <div key={card.id} className={`model-card${isOpen ? " model-card--open" : ""}`} data-testid={`card-${card.id}`}>
            <div className="model-card__head" onClick={() => toggleOpen(card.id)}>
              <span className="model-card__chevron">{isOpen ? "▼" : "▶"}</span>
              <code className="model-card__name">{card.name}</code>
              <span className="badge ext-badge">{t(`settings:cards.kind.${card.kind}`)}</span>
              <div className="model-card__head-actions" onClick={(e) => e.stopPropagation()}>
                <button className="link link--sm link--danger" onClick={() => onChange(cards.filter((c) => c.id !== card.id))}>
                  {t("settings:cards.remove")}
                </button>
              </div>
            </div>

            {isOpen && (
              <div className="model-card__body">
                <label className="field">
                  <span>{t("settings:cards.name")}</span>
                  <input value={card.name} onChange={(e) => replace(card.id, { ...card, name: e.target.value })} />
                </label>

                {card.kind === "prompt-module" && (
                  <label className="field">
                    <span>{t("settings:cards.prompt")}</span>
                    <textarea
                      rows={4}
                      value={card.prompt}
                      onChange={(e) => replace(card.id, { ...card, prompt: e.target.value })}
                      placeholder={t("settings:cards.promptPlaceholder")}
                    />
                  </label>
                )}

                {card.kind === "judge" && (
                  <label className="field">
                    <span>{t("settings:cards.criterion")}</span>
                    <textarea
                      rows={3}
                      value={card.criterion}
                      onChange={(e) => replace(card.id, { ...card, criterion: e.target.value })}
                      placeholder={t("settings:cards.criterionPlaceholder")}
                    />
                  </label>
                )}

                {card.kind === "output-contract" && (
                  <div className="field">
                    <span>{t("settings:cards.fields")}</span>
                    {card.fields.map((field, i) => (
                      <div key={i} className="card-fields">
                        <input
                          value={field.name}
                          aria-label={t("settings:cards.fieldName")}
                          placeholder={t("settings:cards.fieldName")}
                          onChange={(e) =>
                            replace(card.id, {
                              ...card,
                              fields: card.fields.map((f, j) => (j === i ? { ...f, name: e.target.value } : f)),
                            })
                          }
                        />
                        <select
                          className="select"
                          value={field.type}
                          aria-label={t("settings:cards.fieldType")}
                          onChange={(e) =>
                            replace(card.id, {
                              ...card,
                              fields: card.fields.map((f, j) =>
                                j === i ? { ...f, type: e.target.value as (typeof FIELD_TYPES)[number] } : f,
                              ),
                            })
                          }
                        >
                          {FIELD_TYPES.map((ty) => (
                            <option key={ty} value={ty}>
                              {ty}
                            </option>
                          ))}
                        </select>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(e) =>
                              replace(card.id, {
                                ...card,
                                fields: card.fields.map((f, j) => (j === i ? { ...f, required: e.target.checked } : f)),
                              })
                            }
                          />
                          <span className="muted">{t("settings:cards.fieldRequired")}</span>
                        </label>
                        <button
                          className="link link--sm link--danger"
                          onClick={() => replace(card.id, { ...card, fields: card.fields.filter((_, j) => j !== i) })}
                        >
                          {t("settings:cards.removeField")}
                        </button>
                      </div>
                    ))}
                    <button
                      className="link link--sm"
                      onClick={() =>
                        replace(card.id, { ...card, fields: [...card.fields, { name: "", type: "string", required: false }] })
                      }
                    >
                      + {t("settings:cards.addField")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="ext-add-row">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && draftName.trim() && add()}
          placeholder={t("settings:cards.newPlaceholder")}
          aria-label={t("settings:cards.add")}
        />
        <select
          className="select"
          value={draftKind}
          aria-label={t("settings:cards.newKind")}
          onChange={(e) => setDraftKind(e.target.value as UserSkillCardKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`settings:cards.kind.${k}`)}
            </option>
          ))}
        </select>
        <button className="btn" onClick={add} disabled={!draftName.trim()}>
          {t("settings:cards.add")}
        </button>
      </div>
      <p className="muted">{t("settings:cards.note")}</p>
    </>
  );
}
