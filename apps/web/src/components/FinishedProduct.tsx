import { useMemo, useState, type ElementType } from "react";
import type { Artifact, Graph, RuntimeState } from "@agent-world/core";
import { incoming, parseProductDocument } from "@agent-world/core";
import ProductBlocks from "./ProductBlocks";
import { productToHtml } from "../lib/product-html";

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

/** Very small Markdown → React renderer for finished-product output. */
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={key++}>
          {list.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,3}\s/.test(line)) {
      flushList();
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s/, "");
      const Tag = `h${Math.min(level, 3)}` as ElementType;
      blocks.push(<Tag key={key++}>{renderInline(text)}</Tag>);
    } else if (/^[-*]\s/.test(line)) {
      list.push(line.replace(/^[-*]\s/, ""));
    } else if (/^\d+\.\s/.test(line)) {
      list.push(line.replace(/^\d+\.\s/, ""));
    } else if (line === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={key++}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return blocks;
}

/** Inline formatting: **bold**, *italic*, `code`, [text](url), ![alt](url). */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0]!;
    if (tok.startsWith("![")) {
      const mm = tok.match(/!\[([^\]]*)\]\(([^)]+)\)/)!;
      parts.push(<img key={k++} src={mm[2]} alt={mm[1]} loading="lazy" />);
    } else if (tok.startsWith("[")) {
      const mm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      parts.push(
        <a key={k++} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>,
      );
    } else if (tok.startsWith("**")) {
      parts.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("*")) {
      parts.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function FinishedProduct({ sinkId, graph, runtime }: Props) {
  const sinkRt = runtime.nodes[sinkId];
  const output = sinkRt?.outputs ? Math.max(...Object.keys(sinkRt.outputs).map(Number)) : -1;
  const text = output >= 0 ? sinkRt!.outputs[output] ?? "" : "";

  const artifacts = useMemo(
    () => collectUpstreamArtifacts(sinkId, graph, runtime),
    [sinkId, graph, runtime],
  );
  const images = artifacts.filter((a) => a.kind === "image");
  const videos = artifacts.filter((a) => a.kind === "video");
  const audios = artifacts.filter((a) => a.kind === "audio");
  const others = artifacts.filter((a) => !["image", "video", "audio"].includes(a.kind));
  const productDoc = useMemo(() => parseProductDocument(text), [text]);

  const [copied, setCopied] = useState(false);
  const [htmlCopied, setHtmlCopied] = useState(false);
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

  if (!text && artifacts.length === 0) {
    return (
      <div className="product product--empty">
        <p className="empty">产线运行后，成品将在这里展示。</p>
      </div>
    );
  }

  return (
    <div className="product">
      <div className="product__bar">
        <span>成品</span>
        <div className="product__actions">
          <button className="chip" onClick={downloadHtml}>导出 HTML</button>
          <button className="chip" onClick={downloadMd}>导出 MD</button>
          <button className="chip" onClick={copyRichText}>{htmlCopied ? "已复制富文本" : "复制富文本"}</button>
          <button className="chip" onClick={copyText}>{copied ? "已复制" : "复制原文"}</button>
        </div>
      </div>

      {images.length > 0 && (
        <div className="product__gallery">
          {images.map((img) => (
            <a key={img.id} href={img.uri} target="_blank" rel="noreferrer">
              <img src={img.uri} alt={img.label ?? ""} loading="lazy" />
            </a>
          ))}
        </div>
      )}

      {videos.length > 0 && (
        <div className="product__videos">
          {videos.map((v) => (
            <video key={v.id} src={v.uri} controls preload="metadata" />
          ))}
        </div>
      )}

      {audios.length > 0 && (
        <div className="product__audios">
          {audios.map((a) => (
            <audio key={a.id} src={a.uri} controls preload="none" />
          ))}
        </div>
      )}

      <article className="product__body">
        {productDoc ? <ProductBlocks doc={productDoc} /> : renderMarkdown(text)}
      </article>

      {others.length > 0 && (
        <div className="product__files">
          {others.map((a) => (
            <a key={a.id} className="product__file" href={a.uri} target="_blank" rel="noreferrer">
              {a.label ?? a.kind} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
