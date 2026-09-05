/**
 * Key-rotation re-encryption (design-key-rotation.md P2).
 *
 * After a rotation the keyring holds `[new, old]`: new writes go to the new
 * key while existing rows still carry old-key ciphertext. This tool converges
 * them — every row is decrypted with the ring (old key) and re-sealed with the
 * primary (new) key — so the old key can eventually be dropped.
 *
 * Ground rules inherited from the design:
 *  - re-uses `encryptString`/`decryptString`/`sealDocString`/`openDocString`
 *    rather than a second set of cipher rules (at-rest §4.3: a detector and a
 *    mutator drifting apart is how fixes get missed);
 *  - idempotent: rows already sealed with the primary key are skipped, so a
 *    second run rewrites nothing and an interrupted run can simply re-run;
 *  - fail-closed: a row no ring key can decrypt stops the whole run with the
 *    offending table + primary key in the error — never silently skipped.
 *
 * The ciphertext surfaces are the five columns the app seals on write:
 * settings.data and publish_targets.config_encrypted (whole-column
 * `encryptString`), graphs.doc / graph_versions.snapshot / runs.snapshot
 * (document-walk `sealDocString`). The scan is text-level over those columns:
 * it counts `enc:v1:` and `enc:v2:<keyId>` occurrences in both raw and
 * percent-encoded (URL query) form. That is deliberately conservative — a
 * literal `enc:v1:` inside plaintext content would keep a row flagged — but it
 * can never miss real ciphertext, and the failure direction is "look again",
 * not "ship the old key".
 */
import { DatabaseSync } from "node:sqlite";
import {
  decryptString,
  encryptString,
  getEncryptionRing,
  openDocString,
  sealDocString,
} from "./at-rest.js";

/** One encrypted column and how it was sealed. */
interface Surface {
  table: string;
  pk: string;
  column: string;
  /** "whole": the column is a single ciphertext; "doc": ciphertexts inside JSON. */
  kind: "whole" | "doc";
}

const SURFACES: Surface[] = [
  { table: "settings", pk: "user_id", column: "data", kind: "whole" },
  { table: "publish_targets", pk: "id", column: "config_encrypted", kind: "whole" },
  { table: "graphs", pk: "id", column: "doc", kind: "doc" },
  { table: "graph_versions", pk: "id", column: "snapshot", kind: "doc" },
  { table: "runs", pk: "id", column: "snapshot", kind: "doc" },
];

/** Count non-overlapping occurrences of a literal needle. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Text-level ciphertext census of one stored value. */
function scan(text: string): { v1: number; v2ById: Map<string, number> } {
  const v2ById = new Map<string, number>();
  const bump = (id: string) => v2ById.set(id, (v2ById.get(id) ?? 0) + 1);
  for (const m of text.matchAll(/enc:v2:([0-9a-f]{6}):/g)) bump(m[1]!);
  // Ciphertext sealed inside a URL query string is percent-encoded.
  for (const m of text.matchAll(/enc%3Av2%3A([0-9a-f]{6})%3A/g)) bump(m[1]!);
  return {
    v1: count(text, "enc:v1:") + count(text, "enc%3Av1%3A"),
    v2ById,
  };
}

/** Rows needing convergence: any v1, any non-primary v2, or (whole-column
 * surfaces only) legacy plaintext, which the runbook's literal
 * decrypt→encrypt flow seals as a bonus. */
function needsRewrite(text: string, primaryId: string, kind: "whole" | "doc"): boolean {
  if (kind === "whole" && !text.startsWith("enc:")) return true;
  const s = scan(text);
  if (s.v1 > 0) return true;
  for (const id of s.v2ById.keys()) if (id !== primaryId) return true;
  return false;
}

/** Re-seal one stored value against the primary key. */
function reencryptValue(text: string, kind: "whole" | "doc"): string {
  return kind === "whole" ? encryptString(decryptString(text)) : sealDocString(openDocString(text));
}

export interface ReencryptTableReport {
  table: string;
  rows: number;
  /** Rows rewritten this run (under --dry-run: rows a real run would rewrite). */
  rewritten: number;
  /** v1 ciphertext occurrences found before rewriting. */
  v1: number;
  /** v2 ciphertext occurrences sealed with a non-primary key, before rewriting. */
  oldKeyV2: number;
  /** Legacy plaintext rows sealed (whole-column surfaces only). */
  legacyPlaintextSealed: number;
}

export interface ReencryptReport {
  /** The key id every row is converged to after this run. */
  primaryId: string;
  /** All key ids in the ring, newest first. Materials are never reported. */
  ringIds: string[];
  dryRun: boolean;
  tables: ReencryptTableReport[];
  /** Post-run verification census over every row (0 is the green state). */
  residue: { v1: number; oldKeyV2: number };
}

/**
 * Converge every ciphertext surface of a database onto the primary key of the
 * current keyring (env/file, same loader as the app). Rows already sealed
 * with the primary key are skipped; a row no ring key can decrypt aborts the
 * run with table + primary key in the error. Interrupted runs re-run safely.
 */
export function reencrypt(opts: {
  dbFile: string;
  /** Restrict to named tables (subset of the five surfaces). */
  tables?: string[];
  dryRun?: boolean;
}): ReencryptReport {
  const ring = getEncryptionRing();
  const primaryId = ring[0]!.id;
  const dryRun = opts.dryRun ?? false;
  const wanted = opts.tables
    ? SURFACES.filter((s) => opts.tables!.includes(s.table))
    : SURFACES;
  const unknown = opts.tables?.filter((t) => !SURFACES.some((s) => s.table === t)) ?? [];
  if (unknown.length) {
    throw new Error(`unknown tables: ${unknown.join(", ")} (known: ${SURFACES.map((s) => s.table).join(", ")})`);
  }

  const db = new DatabaseSync(opts.dbFile);
  const reports: ReencryptTableReport[] = [];
  const residue = { v1: 0, oldKeyV2: 0 };
  try {
    for (const surface of wanted) {
      const exists = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(surface.table);
      if (!exists) continue; // older db without this surface yet
      const report: ReencryptTableReport = {
        table: surface.table,
        rows: 0,
        rewritten: 0,
        v1: 0,
        oldKeyV2: 0,
        legacyPlaintextSealed: 0,
      };
      const rows = db
        .prepare(`SELECT ${surface.pk} AS pk, ${surface.column} AS val FROM ${surface.table} ORDER BY ${surface.pk}`)
        .all() as Array<{ pk: string | number; val: string }>;
      report.rows = rows.length;
      for (const row of rows) {
        const text = String(row.val);
        const before = scan(text);
        report.v1 += before.v1;
        for (const [id, n] of before.v2ById) if (id !== primaryId) report.oldKeyV2 += n;
        const legacy = surface.kind === "whole" && !text.startsWith("enc:");
        if (legacy) report.legacyPlaintextSealed++;
        if (!needsRewrite(text, primaryId, surface.kind)) continue;
        if (dryRun) {
          // Census only: count what a real run would rewrite, without
          // attempting a decrypt (a dry run must not abort on bad rows).
          report.rewritten++;
          continue;
        }
        let next: string;
        try {
          next = reencryptValue(text, surface.kind);
        } catch (err) {
          // Fail closed: name the row, abort the run, leave the rest untouched.
          throw new Error(
            `${surface.table}.${surface.pk}=${String(row.pk)} could not be decrypted with the current keyring — add the missing key to AGENT_WORLD_ENCRYPTION_KEYS and retry: ${(err as Error).message}`,
          );
        }
        db.prepare(`UPDATE ${surface.table} SET ${surface.column} = ? WHERE ${surface.pk} = ?`).run(next, row.pk);
        report.rewritten++;
      }
      reports.push(report);
    }

    // Verification census (post-run, or the pre-run state under --dry-run):
    // the operator's "no old-key ciphertext residue" check, printed by the CLI.
    for (const surface of wanted) {
      const exists = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(surface.table);
      if (!exists) continue;
      const rows = db
        .prepare(`SELECT ${surface.column} AS val FROM ${surface.table}`)
        .all() as Array<{ val: string }>;
      for (const row of rows) {
        const s = scan(String(row.val));
        residue.v1 += s.v1;
        for (const [id, n] of s.v2ById) if (id !== primaryId) residue.oldKeyV2 += n;
      }
    }
  } finally {
    db.close();
  }

  return { primaryId, ringIds: ring.map((k) => k.id), dryRun, tables: reports, residue };
}
