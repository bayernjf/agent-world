import type { FieldsProps } from "./types";

export default function OcrFields({ node, graph, updateNode, t }: FieldsProps) {
  if (!node.ocr) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.common.source")}</span>
        <select
          className="select"
          value={node.ocr.source ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              ocr: { ...node.ocr!, source: e.target.value || undefined },
            })
          }
        >
          <option value="">{t("nodes:inspector.common.sourceAuto")}</option>
          {graph.nodes
            .filter((n) => n.id !== node.id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name || n.id}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.ocr.lang")}</span>
        <select
          className="select"
          value={node.ocr.lang}
          onChange={(e) =>
            updateNode(node.id, {
              ocr: { ...node.ocr!, lang: e.target.value },
            })
          }
        >
          <option value="eng">{t("nodes:inspector.ocr.langEng")}</option>
          <option value="chi_sim">{t("nodes:inspector.ocr.langChiSim")}</option>
          <option value="chi_tra">{t("nodes:inspector.ocr.langChiTra")}</option>
          <option value="jpn">{t("nodes:inspector.ocr.langJpn")}</option>
          <option value="kor">{t("nodes:inspector.ocr.langKor")}</option>
          <option value="spa">{t("nodes:inspector.ocr.langSpa")}</option>
          <option value="fra">{t("nodes:inspector.ocr.langFra")}</option>
          <option value="deu">{t("nodes:inspector.ocr.langDeu")}</option>
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.ocr.langPath")}</span>
        <input
          className="input"
          type="text"
          placeholder={t("nodes:inspector.ocr.langPathPh")}
          value={node.ocr.langPath ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              ocr: { ...node.ocr!, langPath: e.target.value || undefined },
            })
          }
        />
      </label>
      <p className="note">{t("nodes:inspector.ocr.note")}</p>
    </>
  );
}
