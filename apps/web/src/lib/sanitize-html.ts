import DOMPurify from "dompurify";

/**
 * Tags allowed in AI-produced rich-text product layouts. Everything outside
 * this set (script/iframe/object/embed/form/event handlers…) is dropped.
 */
const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr", "span", "div",
  "b", "strong", "i", "em", "u", "s", "del", "mark", "small", "sub", "sup",
  "blockquote", "ul", "ol", "li",
  "img", "a", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "td", "th",
  "code", "pre",
];

const ALLOWED_ATTR = ["style", "class", "src", "alt", "title", "href", "width", "height", "colspan", "rowspan"];

// Only these URI schemes survive on src/href — blocks javascript:/vbscript:/data:text/html.
const SAFE_URI = /^(?:https?:|mailto:|data:image\/|blob:|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** Pure predicate (no DOM) so the URI-scheme policy is unit-testable. */
export function isSafeUri(uri: string | null | undefined): boolean {
  if (uri == null) return true;
  const trimmed = uri.trim();
  if (!trimmed) return true;
  return SAFE_URI.test(trimmed);
}

let configured = false;
function ensureHooks(): void {
  if (configured) return;
  configured = true;
  // Belt-and-braces: drop any attribute that begins with "on" (inline handlers).
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName.toLowerCase().startsWith("on")) {
      data.keepAttr = false;
    }
  });
}

/**
 * Sanitize untrusted rich text (model output that may echo user input) before
 * it is injected into the DOM / SVG foreignObject for long-image rendering
 * (audit L6/M8). The trusted <style> block is injected by the caller *after*
 * sanitization, so it is intentionally not in the allowed-tag set here.
 */
export function sanitizeProductHtml(dirty: string): string {
  if (!dirty) return "";
  ensureHooks();
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI,
    FORBID_CONTENTS: ["script", "style", "iframe", "object", "embed", "form"],
  });
}
