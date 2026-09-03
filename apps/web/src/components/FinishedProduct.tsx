import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Artifact, Graph, RuntimeState } from "@agent-world/core";
import { incoming, parseProductDocument } from "@agent-world/core";
import ProductBlocks from "./ProductBlocks";
import { productToHtml, productToLongImage } from "../lib/product-html";
import { ArtifactCard, renderMarkdown } from "../lib/artifact-renderers";

interface Props {
  sinkId: string;
  graph: Graph;
  runtime: RuntimeState;
}

/**
 * Collect every artifact reachable from upstream nodes of a sink by walking
 * flow edges backwards. Images come first so they render as a gallery, other
 * kinds follow in execution order.
 */
function collectUpstreamArtifacts(sinkId: string, graph: Graph, runtime: RuntimeState): Artifact[] {
  const visited = new Set<string>();
  const out: Artifact[] = [];
  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const arts = runtime.nodes[id]?.artifacts ?? [];
    out.push(...arts);
    for (const e of incoming(graph, id, "flow")) walk(e.from);
  };
  walk(sinkId);
  return out;
}

export default function FinishedProduct({ sinkId, graph, runtime }: Props) {
  const { t } = useTranslation();
  const sinkRt = runtime.nodes[sinkId];
  const output = sinkRt?.outputs ? Math.max(...Object.keys(sinkRt.outputs).map(Number)) : -1;
  const text = output >= 0 ? sinkRt!.outputs[output] ?? "" : "";

  const artifacts = useMemo(
    () =>
      collectUpstreamArtifacts(sinkId, graph, runtime).filter(
        (a) =>
          !((a.kind === "text" || a.kind === "json") && a.content?.includes("```product-json")),
      ),
    [sinkId, graph, runtime],
  );
  const productDoc = useMemo(() => parseProductDocument(text), [text]);

  const [copied, setCopied] = useState(false);
  const [htmlCopied, setHtmlCopied] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const copyText = () => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const copyRichText = async () => {
    const html = productToHtml(productDoc, text, graph.name);
    try {
      if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        navigator.clipboard?.writeText(html).catch(() => undefined);
      }
      setHtmlCopied(true);
      setTimeout(() => setHtmlCopied(false), 1500);
    } catch {
      navigator.clipboard?.writeText(html).catch(() => undefined);
      setHtmlCopied(true);
      setTimeout(() => setHtmlCopied(false), 1500);
    }
  };
  const downloadMd = () => {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${graph.name || "product"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const downloadHtml = () => {
    const html = productToHtml(productDoc, text, graph.name);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${graph.name || "product"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const downloadLongImage = async () => {
    if (imgBusy) return;
    setImgBusy(true);
    try {
      const png = await productToLongImage(productDoc, text, graph.name);
      const a = document.createElement("a");
      a.href = png;
      a.download = `${graph.name || "product"}.png`;
      a.click();
    } finally {
      setImgBusy(false);
    }
  };

  if (!text && artifacts.length === 0) {
    return (
      <div className="product product--empty">
        <p className="empty">{t("run:product.empty")}</p>
      </div>
    );
  }

  return (
    <div className="product">
      <div className="product__bar">
        <div className="product__title">
          <span className="product__label">{t("run:product.label")}</span>
          <span className="product__name">
            {graph.name ?? t("run:product.unnamedGraph")}
          </span>
        </div>
        <div className="product__actions">
          <div className="product__action-group">
            <button className="chip chip--export" onClick={downloadHtml}>
              <span className="chip__icon">⤓</span> HTML
            </button>
            <button className="chip chip--export" onClick={downloadMd}>
              <span className="chip__icon">⤓</span> MD
            </button>
            <button className="chip chip--export" onClick={downloadLongImage} disabled={imgBusy}>
              <span className="chip__icon">⤓</span>{" "}
              {imgBusy ? t("run:product.generating") : t("run:product.longImage")}
            </button>
          </div>
          <div className="product__action-group">
            <button className="chip chip--copy" onClick={copyRichText}>
              <span className="chip__icon">⧉</span>{" "}
              {htmlCopied ? t("common.copied") : t("run:product.richText")}
            </button>
            <button className="chip chip--copy" onClick={copyText}>
              <span className="chip__icon">⧉</span>{" "}
              {copied ? t("common.copied") : t("run:product.rawText")}
            </button>
          </div>
        </div>
      </div>

      <div className="product__artifacts">
        {artifacts.map((a) => (
          <ArtifactCard key={a.id} a={a} showMeta={false} />
        ))}
      </div>

      <article className="product__body">
        {productDoc ? <ProductBlocks doc={productDoc} /> : renderMarkdown(text)}
      </article>
    </div>
  );
}
