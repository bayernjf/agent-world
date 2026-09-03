import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Skill, SkillMount } from "@agent-world/core";
import { api } from "../lib/api";

interface Props {
  mounted: SkillMount[];
  onChange: (mounts: SkillMount[]) => void;
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

export default function SkillPicker({ mounted, onChange }: Props) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);

  useEffect(() => {
    api.listSkills().then(setSkills).catch(() => {});
  }, []);

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
      <span>{t("modals:skillPicker.label")}</span>
      <div className="skill-list">
        {skills.map((skill) => {
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
    </div>
  );
}
