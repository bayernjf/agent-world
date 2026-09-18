// Prohibited-term detection with precise, rewrite-ready context.
//
// The gate deterministically rejects copy containing any term declared on an
// upstream source node and sends the rejection back upstream for a rewrite.
// The feedback must name EVERY occurrence and quote the enclosing clause:
// showing only the first hit via a fixed ±12-char window let the model fix that
// one spot, fail the next gate on the remaining occurrences, and burn the
// rework budget until the whole line halted with zero output (observed
// 2026-08-28 on the xiaohongshu pipeline, run qc-k7qhs: term 「最」 hit three
// times across attempts and then hit onExhausted=halt).

/** One prohibited term with every occurrence located in the artifact. */
export interface ProhibitedHit {
  term: string;
  /** How many times the term occurs (substring "contains" match). */
  count: number;
  /** Enclosing clauses for the first few occurrences (capped, de-duplicated). */
  snippets: string[];
}

// Clause boundaries used to quote the exact clause a banned word sits in.
// Richer than a fixed-width window: the model can rewrite the whole clause
// instead of deleting a single token. A Chinese comma (，) is intentionally
// NOT a boundary so the model sees the full sentence containing the hit.
const CLAUSE_BOUNDARY = /[。！？!?；;\n\r]/;
const MAX_SNIPPET_CHARS = 60;
const WINDOW = 16;

/** Normalize whitespace for compact, readable feedback snippets. */
function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Return the clause enclosing [index, index + termLen). Over-long clauses with
 * no punctuation at all (one giant paragraph) fall back to a window around the
 * hit so the feedback stays compact.
 */
function enclosingClause(text: string, index: number, termLen: number): string {
  let start = index;
  while (start > 0 && !CLAUSE_BOUNDARY.test(text[start - 1] ?? "")) start--;
  let end = index + termLen;
  while (end < text.length && !CLAUSE_BOUNDARY.test(text[end] ?? "")) end++;
  if (end < text.length) end++; // keep the trailing boundary punctuation
  const clause = clean(text.slice(start, end));
  if (clause.length <= MAX_SNIPPET_CHARS) return clause;
  const a = Math.max(start, index - WINDOW);
  const b = Math.min(end, index + termLen + WINDOW);
  return `${a > start ? "…" : ""}${clean(text.slice(a, b))}${b < end ? "…" : ""}`;
}

/**
 * Locate every prohibited-term occurrence (not just the first).
 *
 * @returns per-term hits with counts and enclosing clauses, plus the total
 * number of occurrences. Snippets are capped per term and overall so a term
 * repeated dozens of times can't flood the rework prompt, while `count` always
 * reports the true number so the model knows the full scale of the rewrite.
 */
export function prohibitedHitsWithContext(
  text: string,
  terms: string[],
  opts: { perTerm?: number; totalSnippets?: number } = {},
): { hits: ProhibitedHit[]; total: number } {
  const perTerm = opts.perTerm ?? 2;
  const totalSnippets = opts.totalSnippets ?? 6;
  const hits: ProhibitedHit[] = [];
  let total = 0;
  let budget = totalSnippets;
  for (const term of terms) {
    if (!term) continue;
    const snippets: string[] = [];
    let count = 0;
    let from = 0;
    let idx = text.indexOf(term, from);
    while (idx >= 0) {
      count++;
      if (budget > 0 && snippets.length < perTerm) {
        const clause = enclosingClause(text, idx, term.length);
        if (clause && !snippets.includes(clause)) {
          snippets.push(clause);
          budget--;
        }
      }
      from = idx + term.length;
      idx = text.indexOf(term, from);
    }
    if (count > 0) hits.push({ term, count, snippets });
    total += count;
  }
  return { hits, total };
}
