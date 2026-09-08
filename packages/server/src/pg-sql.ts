/**
 * SQLite → PostgreSQL SQL translation helpers (design-postgres-migration.md
 * §4 / §4.1). The PgDriver applies these at the driver layer so business SQL
 * stays written in the SQLite dialect (`?` placeholders) and is translated only
 * at execution time — route A of §4.1.
 */

/**
 * Rewrite SQLite positional `?` placeholders to PostgreSQL `$1, $2, …`.
 *
 * Skips `?` inside single-quoted string literals (and their doubled `''`
 * escapes) so a literal question mark is never rewritten. Built as a small
 * char-level tokenizer rather than a bare `replace` so it stays safe for future
 * SQL that happens to embed a `?` literal.
 */
export function toPgPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (inString) {
      out += c;
      if (c === "'") {
        if (sql[i + 1] === "'") {
          // Escaped quote: keep the pair and skip the second one.
          out += "'";
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (c === "'") {
      inString = true;
      out += c;
    } else if (c === "?") {
      n++;
      out += "$" + n;
    } else {
      out += c;
    }
  }
  return out;
}
