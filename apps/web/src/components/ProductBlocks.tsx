import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProductBlock, ProductDocument } from "@agent-world/core";
import { proxyImageUrl } from "../lib/api";

const ASPECT_RATIO: Record<string, string> = {
  "1:1": "1 / 1",
  "3:4": "3 / 4",
  "4:3": "4 / 3",
  "16:9": "16 / 9",
};

type ImageBlock = Extract<ProductBlock, { type: "image" }>;

function imageWrapperStyle(block: ImageBlock): React.CSSProperties {
  const style: React.CSSProperties = {};
  const align = block.align ?? "full";
  if (block.width != null) {
    style.width = typeof block.width === "number" ? `${block.width}px` : block.width;
  } else if (align === "left" || align === "right") {
    style.width = "55%";
  } else if (align === "center") {
    style.width = "70%";
    style.marginLeft = "auto";
    style.marginRight = "auto";
  }
  if (align === "right") style.alignSelf = "flex-end";
  else if (align === "left") style.alignSelf = "flex-start";
  return style;
}

function imageImgStyle(block: ImageBlock): React.CSSProperties {
  const style: React.CSSProperties = {};
  const ratio = block.aspect ? ASPECT_RATIO[block.aspect] : undefined;
  if (ratio) {
    style.aspectRatio = ratio;
    style.objectFit = "cover";
    style.height = "auto";
  }
  if (block.rounded) style.borderRadius = "14px";
  return style;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<strong key={k++}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Image with same-origin proxy loading + graceful fallback. External URLs are
 * routed through `/api/proxy` (bypasses browser hotlink/CORS blocks); if the
 * source is unreachable we show a placeholder instead of a broken-image icon.
 */
function ProductImage({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useTranslation();
  const [broken, setBroken] = useState(false);
  if (broken)
    return <div className="pb-image-fallback">{t("run:product.imageLoadFailed")}</div>;
  const u = proxyImageUrl(src);
  if (!u) return <div className="pb-image-fallback">{t("run:product.noImage")}</div>;
  return (
    <img
      src={u}
      alt={alt ?? ""}
      loading="lazy"
      className={className}
      style={style}
      onError={() => setBroken(true)}
    />
  );
}

function Block({ block }: { block: ProductBlock }) {
  switch (block.type) {
    case "hero":
      return (
        <header className="pb-hero">
          {block.image && <ProductImage src={block.image} className="pb-hero__img" alt="" />}
          <h1 className="pb-hero__title">{block.title}</h1>
          {block.subtitle && <p className="pb-hero__subtitle">{block.subtitle}</p>}
        </header>
      );
    case "heading":
      return <h2 className="pb-heading">{block.text}</h2>;
    case "paragraph":
      return <p className="pb-paragraph">{renderInline(block.text)}</p>;
    case "quote":
      return <blockquote className="pb-quote">{block.text}</blockquote>;
    case "bullets":
      return (
        <ul className="pb-bullets">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case "specs":
      return (
        <table className="pb-specs">
          <tbody>
            {block.rows.map((r, i) => (
              <tr key={i}>
                <th>{r.name}</th>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "image":
      return (
        <figure className="pb-image" style={imageWrapperStyle(block)}>
          <ProductImage src={block.src} alt={block.caption ?? ""} style={imageImgStyle(block)} />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    case "imageCards": {
      const layout = block.layout ?? "grid";
      const gridStyle: React.CSSProperties =
        layout === "grid" && block.columns ? { gridTemplateColumns: `repeat(${block.columns}, minmax(0, 1fr))` } : {};
      return (
        <div className={`pb-cards pb-cards--${layout}`} style={gridStyle}>
          {block.items.map((it, i) => (
            <figure
              className="pb-card"
              key={i}
              style={layout === "grid" && it.span ? { gridColumn: `span ${it.span}` } : undefined}
            >
              <ProductImage src={it.src} alt={it.caption ?? ""} />
              {it.caption && <figcaption>{it.caption}</figcaption>}
              {it.title && <p className="pb-card__title">{it.title}</p>}
            </figure>
          ))}
        </div>
      );
    }
    case "cta":
      return (
        <div className="pb-cta">
          <button type="button" disabled>{block.text}</button>
        </div>
      );
    case "divider":
      return <hr className="pb-divider" />;
    default:
      return null;
  }
}

export default function ProductBlocks({ doc }: { doc: ProductDocument }) {
  return (
    <div className={`product-doc product-doc--${doc.platform ?? "default"}`}>
      {doc.title && !doc.blocks.some((b) => b.type === "hero") && (
        <h1 className="pb-doc-title">{doc.title}</h1>
      )}
      {doc.blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
