import type { FieldsProps } from "./types";

export default function VcsFields({
  node,
  updateNode,
  beginEdit,
  commitEdit,
  t,
}: FieldsProps) {
  if (!node.vcs) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.vcs.provider")}</span>
        <select
          className="select"
          value={node.vcs.provider}
          onChange={(e) =>
            updateNode(node.id, {
              vcs: {
                ...node.vcs!,
                provider: e.target.value as "github" | "gitlab",
              },
            })
          }
        >
          <option value="github">{t("nodes:inspector.vcs.providerGithub")}</option>
          <option value="gitlab">{t("nodes:inspector.vcs.providerGitlab")}</option>
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.vcs.action")}</span>
        <select
          className="select"
          value={node.vcs.action}
          onChange={(e) =>
            updateNode(node.id, {
              vcs: {
                ...node.vcs!,
                action: e.target.value as
                  | "create_pr"
                  | "comment_issue"
                  | "trigger_workflow"
                  | "list_issues",
              },
            })
          }
        >
          <option value="create_pr">
            {t("nodes:inspector.vcs.actionCreatePr")}
          </option>
          <option value="comment_issue">
            {t("nodes:inspector.vcs.actionCommentIssue")}
          </option>
          <option value="trigger_workflow">
            {t("nodes:inspector.vcs.actionTriggerWorkflow")}
          </option>
          <option value="list_issues">
            {t("nodes:inspector.vcs.actionListIssues")}
          </option>
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.vcs.token")}</span>
        <input
          type="password"
          placeholder="ghp_... / glpat-..."
          value={node.vcs.token ?? ""}
          onFocus={beginEdit}
          onBlur={commitEdit}
          onChange={(e) =>
            updateNode(node.id, {
              vcs: { ...node.vcs!, token: e.target.value || undefined },
            })
          }
        />
      </label>
      {node.vcs.provider === "gitlab" && (
        <label className="field">
          <span>{t("nodes:inspector.vcs.baseUrl")}</span>
          <input
            className="input"
            type="text"
            placeholder="https://git.corp.example/api/v4"
            value={node.vcs.baseUrl ?? ""}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                vcs: { ...node.vcs!, baseUrl: e.target.value || undefined },
              })
            }
          />
        </label>
      )}
      {node.vcs.provider === "github" ? (
        <div className="field-row">
          <label className="field">
            <span>Owner</span>
            <input
              className="input"
              type="text"
              value={node.vcs.owner ?? ""}
              onChange={(e) =>
                updateNode(node.id, {
                  vcs: { ...node.vcs!, owner: e.target.value || undefined },
                })
              }
            />
          </label>
          <label className="field">
            <span>Repo</span>
            <input
              className="input"
              type="text"
              value={node.vcs.repo ?? ""}
              onChange={(e) =>
                updateNode(node.id, {
                  vcs: { ...node.vcs!, repo: e.target.value || undefined },
                })
              }
            />
          </label>
        </div>
      ) : (
        <label className="field">
          <span>{t("nodes:inspector.vcs.projectId")}</span>
          <input
            className="input"
            type="text"
            placeholder={t("nodes:inspector.vcs.projectIdPh")}
            value={node.vcs.projectId ?? ""}
            onChange={(e) =>
              updateNode(node.id, {
                vcs: { ...node.vcs!, projectId: e.target.value || undefined },
              })
            }
          />
        </label>
      )}
      {(node.vcs.action === "create_pr" ||
        node.vcs.action === "comment_issue") && (
        <label className="field">
          <span>
            {node.vcs.action === "create_pr"
              ? t("nodes:inspector.vcs.prTitle")
              : t("nodes:inspector.vcs.commentBody")}
          </span>
          <input
            className="input"
            type="text"
            value={
              node.vcs.action === "create_pr"
                ? (node.vcs!.title ?? "")
                : (node.vcs!.body ?? "")
            }
            onChange={(e) =>
              updateNode(node.id, {
                vcs: {
                  ...node.vcs!,
                  ...(node.vcs!.action === "create_pr"
                    ? { title: e.target.value }
                    : { body: e.target.value }),
                },
              })
            }
          />
        </label>
      )}
      {node.vcs.action === "create_pr" && (
        <div className="field-row">
          <label className="field">
            <span>{t("nodes:inspector.vcs.head")}</span>
            <input
              className="input"
              type="text"
              value={node.vcs.head ?? ""}
              onChange={(e) =>
                updateNode(node.id, {
                  vcs: { ...node.vcs!, head: e.target.value || undefined },
                })
              }
            />
          </label>
          <label className="field">
            <span>{t("nodes:inspector.vcs.base")}</span>
            <input
              className="input"
              type="text"
              value={node.vcs.base ?? ""}
              onChange={(e) =>
                updateNode(node.id, {
                  vcs: { ...node.vcs!, base: e.target.value || undefined },
                })
              }
            />
          </label>
        </div>
      )}
      {node.vcs.action === "comment_issue" && (
        <label className="field">
          <span>{t("nodes:inspector.vcs.number")}</span>
          <input
            className="input"
            type="number"
            min={1}
            value={node.vcs.number ?? ""}
            onChange={(e) =>
              updateNode(node.id, {
                vcs: {
                  ...node.vcs!,
                  number: e.target.value ? Number(e.target.value) : undefined,
                },
              })
            }
          />
        </label>
      )}
      {node.vcs.action === "trigger_workflow" && (
        <div className="field-row">
          {node.vcs.provider === "github" && (
            <label className="field">
              <span>{t("nodes:inspector.vcs.workflowId")}</span>
              <input
                className="input"
                type="text"
                value={node.vcs.workflowId ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    vcs: {
                      ...node.vcs!,
                      workflowId: e.target.value || undefined,
                    },
                  })
                }
              />
            </label>
          )}
          <label className="field">
            <span>{t("nodes:inspector.vcs.ref")}</span>
            <input
              className="input"
              type="text"
              value={node.vcs.ref ?? ""}
              onChange={(e) =>
                updateNode(node.id, {
                  vcs: { ...node.vcs!, ref: e.target.value || undefined },
                })
              }
            />
          </label>
        </div>
      )}
      {node.vcs.action === "list_issues" && (
        <label className="field">
          <span>{t("nodes:inspector.vcs.state")}</span>
          <select
            className="select"
            value={node.vcs.state ?? "open"}
            onChange={(e) =>
              updateNode(node.id, {
                vcs: {
                  ...node.vcs!,
                  state: e.target.value as "open" | "closed" | "all",
                },
              })
            }
          >
            <option value="open">open</option>
            <option value="closed">closed</option>
            <option value="all">all</option>
          </select>
        </label>
      )}
      <p className="note">{t("nodes:inspector.vcs.note")}</p>
    </>
  );
}
