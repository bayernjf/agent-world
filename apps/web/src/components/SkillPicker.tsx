import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Skill, SkillKind, SkillMount } from "@agent-world/core";
import { api } from "../lib/api";

interface Props {
  mounted: SkillMount[];
  onChange: (mounts: SkillMount[]) => void;
  /** Restrict the catalog to these kinds. Omit to offer every kind (agent nodes). */
  kinds?: SkillKind[];
  /** Opens Settings on the Skills tab — when provided, an "add card" entry shows. */
  onOpenSettings?: () => void;
}

type PermId = "network" | "fs" | "subprocess" | "env";

const PERM_LABELS: Record<PermId, string> = {
  network: "modals:skillPicker.perms.network",
  fs: "modals:skillPicker.perms.fs",
  subprocess: "modals:skillPicker.perms.subprocess",
  env: "modals:skillPicker.perms.env",
};

function permIds(skill: Skill): PermId[] {
  const out: PermId[] = [];
  if (skill.permissions?.network?.domains?.length) out.push("network");
  if (skill.permissions?.fs?.read || skill.permissions?.fs?.write) out.push("fs");
  if (skill.permissions?.subprocess) out.push("subprocess");
  if (skill.permissions?.env?.length) out.push("env");
  return out;
}

export default function SkillPicker({ mounted, onChange, kinds, onOpenSettings }: Props) {
  const { t } = useTranslation();
  const [all, setAll] = useState<Skill[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.listSkills().then(setAll).catch(() => {});
  }, []);

  const skills = useMemo(
    () => (kinds ? all.filter((s) => kinds.includes(s.kind)) : all),
    [all, kinds],
  );

  const q = query.trim().toLowerCase();
  const visible = q
    ? skills.filter((s) =>
        `${s.name} ${s.id} ${s.description}`.toLowerCase().includes(q),
      )
    : skills;

  const isOn = (id: string) => mounted.some((m) => m.id === id && m.enabled);

  const toggle = (id: string) => {
    if (isOn(id)) {
      onChange(mounted.filter((m) => m.id !== id));
    } else {
      onChange([...mounted, { id, config: {}, enabled: true }]);
    }
  };

  if (skills.length === 0) return null;

  return (
    <div className="field">
      <span className="skill-picker__head">
        <span>{t("modals:skillPicker.label")}</span>
        {onOpenSettings && (
          <button
            type="button"
            className="link link--sm"
            onClick={onOpenSettings}
          >
            + {t("modals:skillPicker.addCard")}
          </button>
        )}
      </span>
      <input
        className="skill-picker__search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("modals:skillPicker.searchPlaceholder")}
        aria-label={t("modals:skillPicker.searchPlaceholder")}
      />
      {visible.length === 0 ? (
        <p className="muted skill-picker__empty">
          {t("modals:skillPicker.noMatch")}
        </p>
      ) : (
        <div className="skill-list">
          {visible.map((skill) => {
            const on = isOn(skill.id);
            const perms = permIds(skill);
            return (
              <button
                key={skill.id}
                type="button"
                className={`skill-card ${on ? "is-on" : ""}`}
                onClick={() => toggle(skill.id)}
                title={skill.description}
              >
                <span className="skill-card__head">
                  <span className="skill-card__name">{skill.name}</span>
                  <span className={`skill-card__toggle ${on ? "is-on" : ""}`}>
                    {on ? t("modals:skillPicker.equipped") : t("modals:skillPicker.equip")}
                  </span>
                </span>
                <span className="skill-card__desc">{skill.description}</span>
                {perms.length > 0 && (
                  <span className="skill-card__perms">
                    {perms.map((p) => (
                      <span key={p} className="perm-badge">
                        {t(PERM_LABELS[p])}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
