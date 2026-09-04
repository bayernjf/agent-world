import type { FieldsProps } from "./types";

export default function ComplianceFields({
  node,
  updateNode,
  beginEdit,
  commitEdit,
  t,
}: FieldsProps) {
  if (!node.compliance) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.compliance.platform")}</span>
        <select
          value={node.compliance.platform}
          onChange={(e) =>
            updateNode(node.id, {
              compliance: {
                ...node.compliance!,
                platform: e.target.value as
                  | "taobao"
                  | "xiaohongshu"
                  | "douyin"
                  | "wechat"
                  | "custom",
              },
            })
          }
        >
          <option value="taobao">
            {t("nodes:inspector.compliance.platformTaobao")}
          </option>
          <option value="xiaohongshu">
            {t("nodes:inspector.compliance.platformXiaohongshu")}
          </option>
          <option value="douyin">
            {t("nodes:inspector.compliance.platformDouyin")}
          </option>
          <option value="wechat">
            {t("nodes:inspector.compliance.platformWechat")}
          </option>
          <option value="custom">
            {t("nodes:inspector.compliance.platformCustom")}
          </option>
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.compliance.extraBanned")}</span>
        <textarea
          rows={2}
          placeholder={t("nodes:inspector.compliance.extraBannedPh")}
          value={node.compliance.extraBanned}
          onFocus={beginEdit}
          onBlur={commitEdit}
          onChange={(e) =>
            updateNode(node.id, {
              compliance: { ...node.compliance!, extraBanned: e.target.value },
            })
          }
        />
      </label>
      <label className="field field--row">
        <span>{t("nodes:inspector.compliance.autoFix")}</span>
        <input
          type="checkbox"
          checked={node.compliance.autoFix}
          onChange={(e) =>
            updateNode(node.id, {
              compliance: { ...node.compliance!, autoFix: e.target.checked },
            })
          }
        />
      </label>
      <label className="field field--row">
        <span>{t("nodes:inspector.compliance.failOnViolation")}</span>
        <input
          type="checkbox"
          checked={node.compliance.failOnViolation}
          onChange={(e) =>
            updateNode(node.id, {
              compliance: {
                ...node.compliance!,
                failOnViolation: e.target.checked,
              },
            })
          }
        />
      </label>
      <div className="field__hint">{t("nodes:inspector.compliance.hint")}</div>
    </>
  );
}
