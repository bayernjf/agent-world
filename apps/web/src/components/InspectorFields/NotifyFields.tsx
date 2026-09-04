import type { FieldsProps } from "./types";

export default function NotifyFields({ node, updateNode, t }: FieldsProps) {
  if (!node.notify) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.notify.provider")}</span>
        <select
          className="select"
          value={node.notify.provider}
          onChange={(e) =>
            updateNode(node.id, {
              notify: {
                ...node.notify!,
                provider: e.target.value as
                  | "feishu"
                  | "dingtalk"
                  | "wecom"
                  | "slack"
                  | "email",
              },
            })
          }
        >
          <option value="feishu">{t("nodes:inspector.notify.providerFeishu")}</option>
          <option value="dingtalk">
            {t("nodes:inspector.notify.providerDingtalk")}
          </option>
          <option value="wecom">{t("nodes:inspector.notify.providerWecom")}</option>
          <option value="slack">{t("nodes:inspector.notify.providerSlack")}</option>
          <option value="email">{t("nodes:inspector.notify.providerEmail")}</option>
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.notify.format")}</span>
        <select
          className="select"
          value={node.notify.format}
          onChange={(e) =>
            updateNode(node.id, {
              notify: {
                ...node.notify!,
                format: e.target.value as "text" | "markdown",
              },
            })
          }
        >
          <option value="text">{t("nodes:inspector.notify.formatText")}</option>
          <option value="markdown">
            {t("nodes:inspector.notify.formatMarkdown")}
          </option>
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.notify.message")}</span>
        <textarea
          rows={3}
          placeholder={t("nodes:inspector.notify.messagePh")}
          value={node.notify.message}
          onChange={(e) =>
            updateNode(node.id, {
              notify: { ...node.notify!, message: e.target.value },
            })
          }
        />
      </label>
      {node.notify.provider !== "email" && (
        <label className="field">
          <span>{t("nodes:inspector.notify.webhookUrl")}</span>
          <input
            className="input"
            type="text"
            placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
            value={node.notify.webhookUrl ?? ""}
            onChange={(e) =>
              updateNode(node.id, {
                notify: {
                  ...node.notify!,
                  webhookUrl: e.target.value || undefined,
                },
              })
            }
          />
        </label>
      )}
      {node.notify.provider === "dingtalk" && (
        <label className="field">
          <span>{t("nodes:inspector.notify.secret")}</span>
          <input
            className="input"
            type="text"
            placeholder={t("nodes:inspector.notify.secretPh")}
            value={node.notify.secret ?? ""}
            onChange={(e) =>
              updateNode(node.id, {
                notify: { ...node.notify!, secret: e.target.value || undefined },
              })
            }
          />
        </label>
      )}
      {node.notify.provider === "slack" && (
        <label className="field">
          <span>{t("nodes:inspector.notify.channel")}</span>
          <input
            className="input"
            type="text"
            placeholder="C…（Slack channel id）"
            value={node.notify.channel ?? ""}
            onChange={(e) =>
              updateNode(node.id, {
                notify: {
                  ...node.notify!,
                  channel: e.target.value || undefined,
                },
              })
            }
          />
        </label>
      )}
      {node.notify.provider === "email" && (
        <>
          <label className="field">
            <span>{t("nodes:inspector.notify.to")}</span>
            <input
              className="input"
              type="text"
              placeholder="someone@example.com"
              value={node.notify.to ?? ""}
              onChange={(e) =>
                updateNode(node.id, {
                  notify: { ...node.notify!, to: e.target.value || undefined },
                })
              }
            />
          </label>
          <label className="field">
            <span>{t("nodes:inspector.notify.subject")}</span>
            <input
              className="input"
              type="text"
              placeholder={t("nodes:inspector.notify.subjectPh")}
              value={node.notify.subject ?? ""}
              onChange={(e) =>
                updateNode(node.id, {
                  notify: {
                    ...node.notify!,
                    subject: e.target.value || undefined,
                  },
                })
              }
            />
          </label>
        </>
      )}
      <p className="note">{t("nodes:inspector.notify.note")}</p>
    </>
  );
}
