import type { FieldsProps } from "./types";
import SourceImages from "../SourceImages";
import SourceFiles from "../SourceFiles";
import ConnectorEditor from "../ConnectorEditor";
import { api } from "../../lib/api";

export default function SourceFields({
  node,
  updateNode,
  beginEdit,
  commitEdit,
  t,
}: FieldsProps) {
  return (
    <>
      <SourceImages
        nodeId={node.id}
        images={node.source?.images ?? []}
        onBeginEdit={beginEdit}
        onCommitEdit={commitEdit}
      />
      <SourceFiles
        nodeId={node.id}
        files={node.source?.files ?? []}
        onBeginEdit={beginEdit}
        onCommitEdit={commitEdit}
      />
      <div className="source-brief">
        <div className="source-brief__head label">
          {t("nodes:inspector.source.briefTitle")}
        </div>
        <label className="field">
          <span>{t("nodes:inspector.source.productName")}</span>
          <input
            value={node.source?.productName ?? ""}
            placeholder={t("nodes:inspector.source.productName")}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                source: {
                  ...(node.source ?? {}),
                  productName: e.target.value,
                },
              })
            }
          />
        </label>
        <label className="field">
          <span>{t("nodes:inspector.source.brand")}</span>
          <input
            value={node.source?.brand ?? ""}
            placeholder={t("nodes:inspector.source.brand")}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                source: { ...(node.source ?? {}), brand: e.target.value },
              })
            }
          />
        </label>
        {node.source?.connector?.type === "product" && (
          <span className="field__hint">{t("nodes:inspector.source.dataHint")}</span>
        )}
        <label className="field">
          <span>{t("nodes:inspector.source.audience")}</span>
          <input
            value={node.source?.audience ?? ""}
            placeholder={t("nodes:inspector.source.audience")}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                source: { ...(node.source ?? {}), audience: e.target.value },
              })
            }
          />
        </label>
        <label className="field">
          <span>{t("nodes:inspector.source.priceRange")}</span>
          <input
            value={node.source?.priceRange ?? ""}
            placeholder={t("nodes:inspector.source.priceRange")}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                source: { ...(node.source ?? {}), priceRange: e.target.value },
              })
            }
          />
        </label>
        <label className="field">
          <span>{t("nodes:inspector.source.tone")}</span>
          <input
            value={node.source?.tone ?? ""}
            placeholder={t("nodes:inspector.source.tone")}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                source: { ...(node.source ?? {}), tone: e.target.value },
              })
            }
          />
        </label>
        <label className="field">
          <span>{t("nodes:inspector.source.prohibited")}</span>
          <textarea
            rows={2}
            value={node.source?.prohibited ?? ""}
            placeholder={t("nodes:inspector.source.prohibitedPh")}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                source: { ...(node.source ?? {}), prohibited: e.target.value },
              })
            }
          />
        </label>
        <label className="field">
          <span>{t("nodes:inspector.source.brandTerms")}</span>
          <textarea
            rows={2}
            value={node.source?.brandTerms ?? ""}
            placeholder={t("nodes:inspector.source.brandTermsPh")}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                source: { ...(node.source ?? {}), brandTerms: e.target.value },
              })
            }
          />
          <button
            type="button"
            className="ghost-btn"
            onClick={async () => {
              const terms = await api.listBrandTerms();
              const cur = (node.source?.brandTerms ?? "")
                .split(/[\n,，、;；\s]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              const merged = [
                ...new Set([...cur, ...terms.map((t) => t.term)]),
              ].join("、");
              updateNode(node.id, {
                source: {
                  ...(node.source ?? {}),
                  brandTerms: merged,
                },
              });
            }}
          >
            {t("nodes:inspector.source.loadBrandTerms")}
          </button>
        </label>
        <label className="field">
          <span>{t("nodes:inspector.source.notes")}</span>
          <textarea
            rows={3}
            value={node.source?.notes ?? ""}
            placeholder={t("nodes:inspector.source.notesPh")}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) =>
              updateNode(node.id, {
                source: { ...(node.source ?? {}), notes: e.target.value },
              })
            }
          />
        </label>
      </div>
      <ConnectorEditor
        connector={node.source?.connector}
        onChange={(c) =>
          updateNode(node.id, {
            source: { ...(node.source ?? {}), connector: c },
          })
        }
        onBeginEdit={beginEdit}
        onCommitEdit={commitEdit}
      />
    </>
  );
}
