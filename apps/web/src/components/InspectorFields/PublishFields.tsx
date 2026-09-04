import type { FieldsProps } from "./types";

export default function PublishFields({
  node,
  updateNode,
  beginEdit,
  commitEdit,
  t,
}: FieldsProps) {
  if (!node.publish) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.publish.platform")}</span>
        <select
          value={node.publish.platform}
          onChange={(e) =>
            updateNode(node.id, {
              publish: {
                ...node.publish!,
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
        <span>{t("nodes:inspector.publish.title")}</span>
        <input
          value={node.publish.title ?? ""}
          placeholder={t("nodes:inspector.publish.titlePh")}
          onFocus={beginEdit}
          onBlur={commitEdit}
          onChange={(e) =>
            updateNode(node.id, {
              publish: { ...node.publish!, title: e.target.value },
            })
          }
        />
      </label>
      <div className="field__hint">{t("nodes:inspector.publish.hint")}</div>
    </>
  );
}
