#!/usr/bin/env node
/**
 * check-i18n.cjs — supplementary i18n validation.
 *
 * Complements src/i18n/keys.test.ts (which runs in vitest and guards
 * t() resolution, key-set parity, empty values, and hard-coded Chinese).
 *
 * This script checks:
 *   1. Interpolation variable parity — every {{var}} in zh must appear in en
 *      and vice versa (catches a translation that drops or renames a variable).
 *   2. Unused keys — keys present in locale files but never referenced in
 *      source code (t("ns:key") or "ns:key" string literal).
 *
 * Usage:
 *   node scripts/check-i18n.cjs
 *   pnpm --filter @agent-world/web i18n:check
 *
 * Exit code 0 = pass, 1 = failures found.
 */

const { readFileSync, readdirSync, existsSync } = require("node:fs");
const { join, relative } = require("node:path");

const WEB_ROOT = join(__dirname, "..");
const LOCALES_ROOT = join(WEB_ROOT, "src", "i18n", "locales");
const SRC_ROOT = join(WEB_ROOT, "src");
const NAMESPACES = ["common", "canvas", "nodes", "modals", "settings", "run", "errors", "auth", "reviews", "park", "tour", "feedback", "announcements"];

// --- helpers ---

function walk(dir, predicate) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "i18n" || entry.name === "node_modules") continue;
      out.push(...walk(p, predicate));
    } else if (predicate(entry.name)) {
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

function extractInterpolations(value) {
  if (typeof value !== "string") return new Set();
  const matches = value.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g);
  return new Set([...matches].map((m) => m[1]));
}

// --- 1. Interpolation variable parity ---

function checkInterpolations() {
  const failures = [];
  for (const ns of NAMESPACES) {
    const zhPath = join(LOCALES_ROOT, "zh", `${ns}.json`);
    const enPath = join(LOCALES_ROOT, "en", `${ns}.json`);
    if (!existsSync(zhPath) || !existsSync(enPath)) continue;
    const zh = JSON.parse(readFileSync(zhPath, "utf8"));
    const en = JSON.parse(readFileSync(enPath, "utf8"));
    const zhKeys = flatten(zh);
    for (const key of zhKeys) {
      const zhVal = key.split(".").reduce((o, k) => o?.[k], zh);
      const enVal = key.split(".").reduce((o, k) => o?.[k], en);
      const zhVars = extractInterpolations(zhVal);
      const enVars = extractInterpolations(enVal);
      for (const v of zhVars) {
        if (!enVars.has(v)) {
          failures.push(`${ns}:${key} — zh has {{${v}}} but en does not`);
        }
      }
      for (const v of enVars) {
        if (!zhVars.has(v)) {
          failures.push(`${ns}:${key} — en has {{${v}}} but zh does not`);
        }
      }
    }
  }
  return failures;
}

// --- 2. Unused keys ---

function checkUnusedKeys() {
  // Collect all keys referenced in source
  const used = new Set();
  const tCall = /\bt\(\s*["']([^"']+)["']/g;
  const nsKeyLiteral = new RegExp(`["'](?:${NAMESPACES.join("|")}):[^"']+["']`, "g");
  for (const file of walk(SRC_ROOT, (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(tCall)) used.add(m[1]);
    for (const m of src.matchAll(nsKeyLiteral)) used.add(m[0].slice(1, -1));
  }
  // Collect all keys in locale files
  const all = new Set();
  for (const ns of NAMESPACES) {
    const zhPath = join(LOCALES_ROOT, "zh", `${ns}.json`);
    if (!existsSync(zhPath)) continue;
    const zh = JSON.parse(readFileSync(zhPath, "utf8"));
    for (const key of flatten(zh)) all.add(`${ns}:${key}`);
  }
  // Find unused
  const unused = [];
  for (const key of all) {
    if (!used.has(key)) unused.push(key);
  }
  return unused;
}

// --- main ---

function main() {
  let failed = false;

  console.log("🔍 i18n check\n");

  // 1. Interpolation parity
  console.log("1/2  Interpolation variable parity…");
  const interpFailures = checkInterpolations();
  if (interpFailures.length === 0) {
    console.log("  ✅ all {{variables}} match between zh and en\n");
  } else {
    failed = true;
    console.log(`  ❌ ${interpFailures.length} mismatch(es):`);
    for (const f of interpFailures) console.log(`    - ${f}`);
    console.log();
  }

  // 2. Unused keys
  console.log("2/2  Unused keys (in locale files but not referenced in source)…");
  const unused = checkUnusedKeys();
  if (unused.length === 0) {
    console.log("  ✅ no unused keys\n");
  } else {
    // Unused keys are a warning, not a hard failure — some keys may be
    // referenced dynamically (e.g. through computed lookup tables).
    console.log(`  ⚠️  ${unused.length} potentially unused key(s):`);
    for (const k of unused.slice(0, 30)) console.log(`    - ${k}`);
    if (unused.length > 30) console.log(`    … and ${unused.length - 30} more`);
    console.log("  (warnings only — dynamically-referenced keys may appear here)\n");
  }

  if (failed) {
    console.log("❌ i18n check FAILED");
    process.exit(1);
  } else {
    console.log("✅ i18n check passed");
    process.exit(0);
  }
}

main();
