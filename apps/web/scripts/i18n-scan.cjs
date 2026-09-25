#!/usr/bin/env node
/**
 * i18n-scan.cjs — shared "does any source file reference this key" scanner.
 *
 * Used by check-i18n.cjs (reports unused keys) and i18n-prune.cjs (deletes
 * them). Both must agree, so the resolution rules live here once.
 *
 * Rules, matching what i18next actually does at runtime:
 *   - `t("ns:path")` and any quoted `"ns:path"` literal reference that key.
 *   - An unqualified key resolves inside `defaultNS` only. The app never calls
 *     `useTranslation("ns")`, so `t("common.search")` refers to common.json's
 *     nested `common.search` and nothing else. Assuming otherwise flags every
 *     defaultNS-referenced key as unused, which is how this scanner used to
 *     over-report.
 *   - A key stored in a lookup table and handed to `t()` later
 *     (`const RANGE_KEY = { all: "common.all" }`) counts as referenced, so any
 *     quoted string equal to a defaultNS key path is one.
 *   - A key under a prefix that source builds at runtime (`t(`billing:plans.${id}`)`)
 *     has no literal naming it, so those prefixes are derived from source and
 *     never reported. When a prefix stops being built, its keys become
 *     reportable again automatically.
 *   - Test files count as references: a key only a test names cannot be
 *     deleted without rewriting that test.
 */

const { readFileSync, readdirSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const WEB_ROOT = join(__dirname, "..");
const SRC_ROOT = join(WEB_ROOT, "src");
const LOCALES_ROOT = join(SRC_ROOT, "i18n", "locales");

/** src/i18n/index.ts — i18next resolves keys without an `ns:` here. */
const DEFAULT_NS = "common";

/** Namespace list is the pack directory itself: a hardcoded copy drifted and
 *  went blind to `billing`. */
function namespaces() {
  return readdirSync(join(LOCALES_ROOT, "zh"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    // Skip the packs themselves, not every file under src/i18n: index.ts and
    // utils.ts hold real references.
    if (entry.isDirectory()) {
      if (p === LOCALES_ROOT) continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

function flatten(obj, prefix = "") {
  if (obj === null || typeof obj !== "object") return prefix ? [prefix] : [];
  return Object.entries(obj).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

function readPack(ns, lang) {
  return JSON.parse(readFileSync(join(LOCALES_ROOT, lang, `${ns}.json`), "utf8"));
}

/** `{{var}}` names a value interpolates. */
function extractInterpolations(value) {
  if (typeof value !== "string") return new Set();
  return new Set([...value.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]));
}

const HAS_CJK = /[㐀-鿿぀-ヿ]/;

/** Key names ending in Zh/En carry the text of one specific language (the
 *  announcement templates, the translate node's target examples), not a label
 *  to translate. Without this the check reports them as untranslated. */
const LANGUAGE_CONTENT = /(Zh|En)$/;

/**
 * CJK in an English value is only a problem when the value *is* Chinese. A
 * translate-target placeholder legitimately lists 日本語, so the bar is two or
 * more CJK characters making up at least 30% of the value; below that the
 * check would cry wolf and the gate gets ignored.
 */
function untranslated(value) {
  const cjk = [...value].filter((c) => HAS_CJK.test(c)).length;
  if (cjk < 2) return null;
  const total = Math.max(1, value.trim().length);
  return cjk / total >= 0.3 ? `${cjk}/${total} chars CJK` : null;
}

/**
 * Value-level drift the key checks cannot see: an English pack entry still in
 * Chinese, or a side left empty / missing. Returns human-readable findings.
 */
function valueDrift() {
  const findings = [];
  for (const ns of namespaces()) {
    const zh = readPack(ns, "zh");
    const enPath = join(LOCALES_ROOT, "en", `${ns}.json`);
    if (!existsSync(enPath)) {
      findings.push(`${ns}: en pack is missing entirely`);
      continue;
    }
    const en = JSON.parse(readFileSync(enPath, "utf8"));
    const zhLeaves = new Set(flatten(zh));
    const enLeaves = new Set(flatten(en));
    // Union, not zh's keys alone: an en-side orphan is exactly the one-sided
    // drift this check advertises, and iterating zh never looked at it.
    for (const key of [...new Set([...zhLeaves, ...enLeaves])].sort()) {
      const zhVal = readPackValue(zh, key);
      const enVal = readPackValue(en, key);
      const qualified = `${ns}:${key}`;
      if (!zhLeaves.has(key)) {
        findings.push(`${qualified} — key exists only in the en pack`);
      } else if (typeof zhVal !== "string" || !zhVal.trim()) {
        findings.push(`${qualified} — zh value is empty`);
      }
      if (!enLeaves.has(key)) {
        findings.push(`${qualified} — key absent from the en pack`);
        continue;
      }
      if (typeof enVal !== "string" || !enVal.trim()) {
        findings.push(`${qualified} — en value is empty`);
        continue;
      }
      if (LANGUAGE_CONTENT.test(key)) continue;
      const drift = untranslated(enVal);
      if (drift) {
        findings.push(
          `${qualified} — en value is still Chinese (${drift}): ${enVal.replace(/\n/g, " ").slice(0, 60)}`,
        );
      }
    }
  }
  return findings;
}

function readPackValue(pack, dottedKey) {
  return dottedKey.split(".").reduce((o, k) => (o == null ? o : o[k]), pack);
}

/** Every leaf key of the zh packs, qualified as `ns:path`. */
function packKeys() {
  const out = [];
  for (const ns of namespaces()) {
    for (const key of flatten(readPack(ns, "zh"))) out.push(`${ns}:${key}`);
  }
  return out;
}

/**
 * `ns:path` strings written literally in source, plus the runtime prefixes that
 * source builds with template literals.
 */
function references() {
  const literal = new Set();
  const bare = new Set();
  const dynamic = new Set();
  const tCall = /\bt\(\s*["']([^"']+)["']/g;
  const nsKeyLiteral = /["']([a-z][a-z-]*):([^"']+)["']/g;
  // Any quoted string: a key stored in a lookup table and handed to t() later
  // (const RANGE_KEY = { all: "common.all" }) never appears in a t() call.
  const anyString = /["']([^"'`\n]+)["']/g;
  // `ns:whatever.${  — the static head of a key assembled at runtime.
  const templateKey = /["'`]([a-z][a-z-]*):([^`$'"]*)\$\{/g;
  for (const file of walk(SRC_ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(tCall)) literal.add(m[1]);
    for (const m of src.matchAll(nsKeyLiteral)) literal.add(`${m[1]}:${m[2]}`);
    for (const m of src.matchAll(templateKey)) dynamic.add(`${m[1]}:${m[2]}`);
    for (const m of src.matchAll(anyString)) bare.add(m[1]);
  }
  return { literal, bare, dynamic };
}

function isReferenced(qualified, refs) {
  const [ns, ...rest] = qualified.split(":");
  const path = rest.join(":");
  if (refs.literal.has(qualified)) return true;
  // Unqualified source lookups land in defaultNS and nowhere else.
  if (ns === DEFAULT_NS && (refs.literal.has(path) || refs.bare.has(path))) return true;
  for (const prefix of refs.dynamic) if (qualified.startsWith(prefix)) return true;
  return false;
}

/** `ns:path` keys that no source file can reach. */
function unusedKeys(refs = references()) {
  return packKeys().filter((k) => !isReferenced(k, refs));
}

module.exports = {
  DEFAULT_NS,
  LOCALES_ROOT,
  SRC_ROOT,
  WEB_ROOT,
  extractInterpolations,
  flatten,
  isReferenced,
  namespaces,
  packKeys,
  readPack,
  readPackValue,
  references,
  unusedKeys,
  valueDrift,
  walk,
};
