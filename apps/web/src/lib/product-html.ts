import type { ProductDocument, ProductBlock } from "@agent-world/core";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function blockToHtml(b: ProductBlock): string {
  switch (b.type) {
    case "hero":
      return [
        '<section class="hero">',
        b.image ? `<img src="${escapeHtml(b.image)}" alt="" />` : "",
        `<h1>${inlineHtml(b.title)}</h1>`,
        b.subtitle ? `<p class="subtitle">${inlineHtml(b.subtitle)}</p>` : "",
        "</section>",
      ].join("");
    case "heading":
      return `<h2>${inlineHtml(b.text)}</h2>`;
    case "paragraph":
      return `<p>${inlineHtml(b.text)}</p>`;
    case "quote":
      return `<blockquote>${inlineHtml(b.text)}</blockquote>`;
    case "bullets":
      return `<ul>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</ul>`;
    case "specs":
      return `<table class="specs"><tbody>${b.rows
        .map((r) => `<tr><th>${escapeHtml(r.name)}</th><td>${inlineHtml(r.value)}</td></tr>`)
        .join("")}</tbody></table>`;
    case "image":
      return [
        "<figure>",
        `<img src="${escapeHtml(b.src)}" alt="" loading="lazy" />`,
        b.caption ? `<figcaption>${inlineHtml(b.caption)}</figcaption>` : "",
        "</figure>",
      ].join("");
    case "imageCards":
      return `<div class="image-cards">${b.items
        .map(
          (c) =>
            `<figure><img src="${escapeHtml(c.src)}" alt="" loading="lazy" />${
              c.title ? `<h3>${inlineHtml(c.title)}</h3>` : ""
            }${c.caption ? `<figcaption>${inlineHtml(c.caption)}</figcaption>` : ""}</figure>`,
        )
        .join("")}</div>`;
    case "cta":
      return `<div class="cta">${inlineHtml(b.text)}</div>`;
    case "divider":
      return "<hr />";
  }
}

function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let list: string[] = [];
  let listOrdered = false;

  const flush = () => {
    if (!list.length) return;
    const tag = listOrdered ? "ol" : "ul";
    out.push(`<${tag}>${list.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${tag}>`);
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,3}\s/.test(line)) {
      flush();
      const level = line.match(/^#+/)![0].length;
      out.push(`<h${level}>${inlineHtml(line.replace(/^#+\s/, ""))}</h${level}>`);
    } else if (/^[-*]\s/.test(line)) {
      if (listOrdered) flush();
      listOrdered = false;
      list.push(line.replace(/^[-*]\s/, ""));
    } else if (/^\d+\.\s/.test(line)) {
      if (!listOrdered) flush();
      listOrdered = true;
      list.push(line.replace(/^\d+\.\s/, ""));
    } else if (line === "") {
      flush();
    } else {
      flush();
      out.push(`<p>${inlineHtml(line)}</p>`);
    }
  }
  flush();
  return out.join("");
}

const STYLES = `
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;max-width:760px;margin:0 auto;padding:24px 20px 60px;color:#1a1a1a;line-height:1.7;}
  h1{font-size:28px;margin:0 0 8px;}
  h2{font-size:21px;margin:28px 0 12px;border-bottom:1px solid #eee;padding-bottom:8px;}
  p{margin:12px 0;}
  .subtitle{color:#666;font-size:15px;margin:0 0 16px;}
  blockquote{border-left:3px solid #ddd;margin:16px 0;padding:8px 16px;color:#555;background:#fafafa;}
  ul,ol{padding-left:22px;margin:12px 0;}
  li{margin:6px 0;}
  img{max-width:100%;height:auto;border-radius:6px;display:block;margin:12px 0;}
  .hero img{width:100%;border-radius:10px;}
  .hero h1{margin-top:16px;}
  .specs{width:100%;border-collapse:collapse;margin:16px 0;}
  .specs th{text-align:left;width:35%;background:#f7f7f7;padding:10px 12px;font-weight:600;border:1px solid #eee;}
  .specs td{padding:10px 12px;border:1px solid #eee;}
  .image-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin:16px 0;}
  .image-cards figure{margin:0;}
  .image-cards img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;}
  .image-cards h3{font-size:14px;margin:8px 0 2px;}
  .image-cards figcaption{font-size:12px;color:#888;}
  figure{margin:16px 0;}
  figcaption{font-size:12px;color:#888;text-align:center;margin-top:6px;}
  .cta{display:block;text-align:center;background:#1a1a1a;color:#fff;padding:14px;border-radius:8px;font-weight:600;margin:24px 0;}
  hr{border:none;border-top:1px solid #eee;margin:24px 0;}
  a{color:#0066cc;}
  code{background:#f4f4f4;padding:1px 5px;border-radius:3px;font-size:0.9em;}
`;

export function productDocumentToHtml(doc: ProductDocument): string {
  const title = doc.title ? `<title>${escapeHtml(doc.title)}</title>` : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />${title}
<style>${STYLES}</style></head>
<body>
${doc.blocks.map(blockToHtml).join("\n")}
</body></html>`;
}

export function markdownToStandaloneHtml(md: string, title?: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />${title ? `<title>${escapeHtml(title)}</title>` : ""}
<style>${STYLES}</style></head>
<body>
${markdownToHtml(md)}
</body></html>`;
}

export function productToHtml(doc: ProductDocument | null, text: string, title?: string): string {
  return doc ? productDocumentToHtml(doc) : markdownToStandaloneHtml(text, title);
}
