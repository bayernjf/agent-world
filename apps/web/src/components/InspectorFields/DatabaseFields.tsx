import type { FieldsProps } from "./types";

export default function DatabaseFields({ node, updateNode, t }: FieldsProps) {
  if (!node.database) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.database.path")}</span>
        <input
          className="input mono"
          placeholder={t("nodes:inspector.database.pathPh")}
          value={node.database.path ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              database: { ...node.database!, path: e.target.value || undefined },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.database.setupSql")}</span>
        <textarea
          className="textarea mono"
          rows={4}
          placeholder={
            "CREATE TABLE people (name TEXT, age INTEGER);\nINSERT INTO people VALUES ('Alice', 30);"
          }
          value={node.database.setupSql ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              database: { ...node.database!, setupSql: e.target.value },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.database.sql")}</span>
        <textarea
          className="textarea mono"
          rows={5}
          placeholder="SELECT * FROM people WHERE age >= ?"
          value={node.database.sql ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              database: { ...node.database!, sql: e.target.value },
            })
          }
        />
      </label>
      <p className="note">{t("nodes:inspector.database.note")}</p>
    </>
  );
}
