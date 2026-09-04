import type { FieldsProps } from "./types";

export default function CodeFields({ node, updateNode, t }: FieldsProps) {
  if (!node.code) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.code.language")}</span>
        <select
          className="select"
          value={node.code.language}
          onChange={(e) =>
            updateNode(node.id, {
              code: {
                ...node.code!,
                language: e.target.value as "javascript" | "python",
              },
            })
          }
        >
          <option value="javascript">
            {t("nodes:inspector.code.languageJs")}
          </option>
          <option value="python">
            {t("nodes:inspector.code.languagePy")}
          </option>
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.code.script")}</span>
        <textarea
          className="mono"
          rows={9}
          placeholder={
            'const fs = require("fs");\nconst input = JSON.parse(fs.readFileSync(0, "utf8"));\n// 上游数据在 input.inputs.<上游节点id>\nconsole.log(JSON.stringify({ doubled: Number(input.inputs.source) * 2 }));'
          }
          value={node.code.code}
          onChange={(e) =>
            updateNode(node.id, {
              code: { ...node.code!, code: e.target.value },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.common.timeoutMs")}</span>
        <input
          type="number"
          min={1000}
          step={1000}
          value={node.code.timeoutMs}
          onChange={(e) =>
            updateNode(node.id, {
              code: { ...node.code!, timeoutMs: Number(e.target.value) },
            })
          }
        />
      </label>
      <p className="note">{t("nodes:inspector.code.note")}</p>
    </>
  );
}
