import { describe, it, expect } from "vitest";
import { productDocumentToHtml, markdownToStandaloneHtml, productToHtml } from "./product-html";
import type { ProductDocument, ProductBlock } from "@agent-world/core";

describe("productDocumentToHtml", () => {
  it("renders a full HTML document with doctype, head, styles and body", () => {
    const doc: ProductDocument = { title: "Test Product", blocks: [] };
    const html = productDocumentToHtml(doc);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain("<meta charset=\"utf-8\" />");
    expect(html).toContain("<title>Test Product</title>");
    expect(html).toContain("<style>");
    expect(html).toContain("</body></html>");
  });

  it("omits the <title> tag when doc has no title", () => {
    const doc: ProductDocument = { blocks: [] };
    const html = productDocumentToHtml(doc);
    expect(html).not.toContain("<title>");
  });

  it("escapes HTML in the document title (XSS protection)", () => {
    const doc: ProductDocument = { title: '<script>alert("xss")</script>', blocks: [] };
    const html = productDocumentToHtml(doc);
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("renders a hero block with title, subtitle and image", () => {
    const block: ProductBlock = {
      type: "hero",
      title: "My Product",
      subtitle: "Best in class",
      image: "https://example.com/hero.jpg",
    };
    const html = productDocumentToHtml({ blocks: [block] });
    expect(html).toContain('<section class="hero">');
    expect(html).toContain('<img src="https://example.com/hero.jpg" alt="" />');
    expect(html).toContain("<h1>My Product</h1>");
    expect(html).toContain('<p class="subtitle">Best in class</p>');
  });

  it("renders a hero block without optional image and subtitle", () => {
    const block: ProductBlock = { type: "hero", title: "Minimal Hero" };
    const html = productDocumentToHtml({ blocks: [block] });
    expect(html).toContain("<h1>Minimal Hero</h1>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('class="subtitle"');
  });

  it("renders heading, paragraph and quote blocks", () => {
    const blocks: ProductBlock[] = [
      { type: "heading", text: "Section Title" },
      { type: "paragraph", text: "Some body text." },
      { type: "quote", text: "A famous quote." },
    ];
    const html = productDocumentToHtml({ blocks });
    expect(html).toContain("<h2>Section Title</h2>");
    expect(html).toContain("<p>Some body text.</p>");
    expect(html).toContain("<blockquote>A famous quote.</blockquote>");
  });

  it("renders a bullets block as an unordered list", () => {
    const block: ProductBlock = { type: "bullets", items: ["First", "Second", "Third"] };
    const html = productDocumentToHtml({ blocks: [block] });
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>First</li>");
    expect(html).toContain("<li>Second</li>");
    expect(html).toContain("<li>Third</li>");
    expect(html).toContain("</ul>");
  });

  it("renders a specs block as a table with rows", () => {
    const block: ProductBlock = {
      type: "specs",
      rows: [
        { name: "Weight", value: "200g" },
        { name: "Battery", value: "4000mAh" },
      ],
    };
    const html = productDocumentToHtml({ blocks: [block] });
    expect(html).toContain('<table class="specs">');
    expect(html).toContain("<tr><th>Weight</th><td>200g</td></tr>");
    expect(html).toContain("<tr><th>Battery</th><td>4000mAh</td></tr>");
  });

  it("renders an image block with optional caption", () => {
    const withCaption: ProductBlock = { type: "image", src: "https://example.com/a.jpg", caption: "Photo A" };
    const withoutCaption: ProductBlock = { type: "image", src: "https://example.com/b.jpg" };
    const html = productDocumentToHtml({ blocks: [withCaption, withoutCaption] });
    expect(html).toContain("<figure>");
    expect(html).toContain('<img src="https://example.com/a.jpg" alt="" loading="lazy" />');
    expect(html).toContain("<figcaption>Photo A</figcaption>");
    expect(html).toContain('<img src="https://example.com/b.jpg" alt="" loading="lazy" />');
  });

  it("renders imageCards block with titles and captions", () => {
    const block: ProductBlock = {
      type: "imageCards",
      items: [
        { src: "https://example.com/c1.jpg", title: "Card 1", caption: "Desc 1" },
        { src: "https://example.com/c2.jpg" },
      ],
    };
    const html = productDocumentToHtml({ blocks: [block] });
    expect(html).toContain('<div class="image-cards">');
    expect(html).toContain("<h3>Card 1</h3>");
    expect(html).toContain("<figcaption>Desc 1</figcaption>");
    expect(html).toContain('<img src="https://example.com/c2.jpg"');
  });

  it("renders cta and divider blocks", () => {
    const blocks: ProductBlock[] = [
      { type: "cta", text: "Buy Now" },
      { type: "divider" },
    ];
    const html = productDocumentToHtml({ blocks });
    expect(html).toContain('<div class="cta">Buy Now</div>');
    expect(html).toContain("<hr />");
  });

  it("applies inline formatting (bold, italic, code) inside block text", () => {
    const block: ProductBlock = {
      type: "paragraph",
      text: "This is **bold**, *italic*, and `code`.",
    };
    const html = productDocumentToHtml({ blocks: [block] });
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
  });

  it("escapes raw HTML in block text before applying inline formatting", () => {
    const block: ProductBlock = { type: "paragraph", text: '<div>not a real div</div>' };
    const html = productDocumentToHtml({ blocks: [block] });
    expect(html).toContain("&lt;div&gt;not a real div&lt;/div&gt;");
    expect(html).not.toContain("<div>not");
  });
});

describe("markdownToStandaloneHtml", () => {
  it("renders a full HTML document from markdown", () => {
    const html = markdownToStandaloneHtml("# Hello\n\nWorld", "My Title");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>My Title</title>");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<p>World</p>");
  });

  it("omits the <title> tag when no title is provided", () => {
    const html = markdownToStandaloneHtml("Just text");
    expect(html).not.toContain("<title>");
  });

  it("renders h1, h2 and h3 headings", () => {
    const md = "# H1\n\n## H2\n\n### H3";
    const html = markdownToStandaloneHtml(md);
    expect(html).toContain("<h1>H1</h1>");
    expect(html).toContain("<h2>H2</h2>");
    expect(html).toContain("<h3>H3</h3>");
  });

  it("renders an unordered list from dash or asterisk items", () => {
    const md = "- Item A\n- Item B\n* Item C";
    const html = markdownToStandaloneHtml(md);
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Item A</li>");
    expect(html).toContain("<li>Item B</li>");
    expect(html).toContain("<li>Item C</li>");
    expect(html).toContain("</ul>");
  });

  it("renders an ordered list from numbered items", () => {
    const md = "1. First\n2. Second\n3. Third";
    const html = markdownToStandaloneHtml(md);
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>First</li>");
    expect(html).toContain("<li>Second</li>");
    expect(html).toContain("<li>Third</li>");
    expect(html).toContain("</ol>");
  });

  it("flushes the list when a paragraph follows", () => {
    const md = "- List item\n\nParagraph after";
    const html = markdownToStandaloneHtml(md);
    expect(html).toContain("<ul><li>List item</li></ul>");
    expect(html).toContain("<p>Paragraph after</p>");
  });

  it("switches from unordered to ordered list correctly", () => {
    const md = "- Unordered\n1. Ordered";
    const html = markdownToStandaloneHtml(md);
    expect(html).toContain("<ul><li>Unordered</li></ul>");
    expect(html).toContain("<ol><li>Ordered</li></ol>");
  });

  it("applies inline formatting inside markdown paragraphs", () => {
    const md = "Text with **bold** and *italic* and `code`.";
    const html = markdownToStandaloneHtml(md);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
  });

  it("renders a markdown link as an anchor with target=_blank", () => {
    const md = "Visit [Example](https://example.com) now.";
    const html = markdownToStandaloneHtml(md);
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Example</a>');
  });

  it("renders a markdown image as an img with loading=lazy", () => {
    const md = "![Alt text](https://example.com/img.jpg)";
    const html = markdownToStandaloneHtml(md);
    expect(html).toContain('<img src="https://example.com/img.jpg" alt="Alt text" loading="lazy" />');
  });

  it("handles empty markdown gracefully", () => {
    const html = markdownToStandaloneHtml("");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body></html>");
  });

  it("escapes raw HTML in markdown text", () => {
    const md = '<script>alert(1)</script>';
    const html = markdownToStandaloneHtml(md);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
  });
});

describe("productToHtml", () => {
  it("uses productDocumentToHtml when a structured doc is provided", () => {
    const doc: ProductDocument = { title: "Structured", blocks: [{ type: "heading", text: "Hi" }] };
    const html = productToHtml(doc, "fallback text");
    expect(html).toContain("<title>Structured</title>");
    expect(html).toContain("<h2>Hi</h2>");
    expect(html).not.toContain("fallback text");
  });

  it("falls back to markdownToStandaloneHtml when doc is null", () => {
    const html = productToHtml(null, "# Markdown Title\n\nBody text", "Fallback Title");
    expect(html).toContain("<title>Fallback Title</title>");
    expect(html).toContain("<h1>Markdown Title</h1>");
    expect(html).toContain("<p>Body text</p>");
  });

  it("passes the optional title through to the markdown fallback", () => {
    const html = productToHtml(null, "text only");
    expect(html).not.toContain("<title>");
  });
});
