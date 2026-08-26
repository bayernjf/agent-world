import type { ProductBlock, ProductDocument } from "@agent-world/core";

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

function Block({ block }: { block: ProductBlock }) {
  switch (block.type) {
    case "hero":
      return (
        <header className="pb-hero">
          {block.image && <img className="pb-hero__img" src={block.image} alt="" loading="lazy" />}
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
        <figure className="pb-image">
          <img src={block.src} alt={block.caption ?? ""} loading="lazy" />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    case "imageCards":
      return (
        <div className="pb-cards">
          {block.items.map((it, i) => (
            <figure className="pb-card" key={i}>
              <img src={it.src} alt={it.caption ?? ""} loading="lazy" />
              {it.caption && <figcaption>{it.caption}</figcaption>}
              {it.title && <p className="pb-card__title">{it.title}</p>}
            </figure>
          ))}
        </div>
      );
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
