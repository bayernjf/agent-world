/**
 * Sanitize error text before it lands in the append-only event stream.
 * Provider error bodies can echo request details, internal URLs, or key
 * fragments — truncate and redact anything that looks like a secret.
 *
 * Pattern order matters: more specific patterns (bearer) must run before
 * broader ones (authorization: <value>) or the broad pattern will eat the
 * scheme keyword and leave the token exposed.
 */
const MAX_ERROR_LEN = 500;

const SECRET_PATTERNS: RegExp[] = [
  /(bearer\s+)[A-Za-z0-9._\-]+/gi,
  /(authorization\s*[:=]\s*)\S+/gi,
  /(api[_-]?key\s*[:=]\s*)\S+/gi,
  /sk-[A-Za-z0-9]{6,}/g,
  /ark-[A-Za-z0-9]{6,}/g,
  /"apiKey"\s*:\s*"[^"]+"/gi,
];

export function sanitizeError(raw: unknown): string {
  let text: string;
  if (raw instanceof Error) text = raw.message;
  else if (typeof raw === "string") text = raw;
  else text = JSON.stringify(raw);

  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "$1****");
  }
  if (text.length > MAX_ERROR_LEN) text = text.slice(0, MAX_ERROR_LEN) + "…";
  return text;
}
