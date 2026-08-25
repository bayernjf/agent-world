import { useEffect, useState } from "react";
import type { Skill, SkillMount } from "@agent-world/core";
import { api } from "../lib/api";

interface Props {
  mounted: SkillMount[];
  onChange: (mounts: SkillMount[]) => void;
}

function permLabels(skill: Skill): string[] {
  const out: string[] = [];
  if (skill.permissions?.network?.domains?.length) out.push("网络");
  if (skill.permissions?.fs?.read || skill.permissions?.fs?.write) out.push("文件");
  if (skill.permissions?.subprocess) out.push("子进程");
  if (skill.permissions?.env?.length) out.push("环境变量");
  return out;
}

export default function SkillPicker({ mounted, onChange }: Props) {
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
      <span>技能卡</span>
      <div className="skill-list">
        {skills.map((skill) => {
          const on = isOn(skill.id);
          const perms = permLabels(skill);
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
                  {on ? "已装备" : "装备"}
                </span>
              </span>
              <span className="skill-card__desc">{skill.description}</span>
              {perms.length > 0 && (
                <span className="skill-card__perms">
                  {perms.map((p) => (
                    <span key={p} className="perm-badge">{p}</span>
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
