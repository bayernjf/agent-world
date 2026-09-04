import type { FieldsProps } from "./types";

export default function HumanFields({ node, updateNode, t }: FieldsProps) {
  if (!node.human) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.human.prompt")}</span>
        <input
          className="input"
          type="text"
          value={node.human.prompt}
          placeholder={t("nodes:inspector.human.promptPh")}
          onChange={(e) =>
            updateNode(node.id, {
              human: { ...node.human!, prompt: e.target.value },
            })
          }
        />
      </label>
      <p className="note">{t("nodes:inspector.human.note")}</p>
    </>
  );
}
