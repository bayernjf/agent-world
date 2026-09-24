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
 *   2. Unused keys — keys present in locale files that no source file can
 *      reach. Resolution rules (defaultNS, runtime-built prefixes, test files)
 *      live in i18n-scan.cjs; scripts/i18n-prune.cjs deletes what this reports.
 *
 * Usage:
 *   node scripts/check-i18n.cjs
 *   pnpm --filter @agent-world/web i18n:check
 *
 * Exit code 0 = pass, 1 = failures found.
 */

const { existsSync } = require("node:fs");
const { join } = require("node:path");
const {
  LOCALES_ROOT,
  extractInterpolations,
  flatten,
  namespaces,
  readPack,
  readPackValue,
  unusedKeys,
  valueDrift,
} = require("./i18n-scan.cjs");

const NS_LIST = namespaces();

// --- 1. Interpolation variable parity ---

function checkInterpolations() {
  const failures = [];
  for (const ns of NS_LIST) {
    const zhPath = join(LOCALES_ROOT, "zh", `${ns}.json`);
    const enPath = join(LOCALES_ROOT, "en", `${ns}.json`);
    if (!existsSync(zhPath) || !existsSync(enPath)) continue;
    const zh = readPack(ns, "zh");
    const en = readPack(ns, "en");
    for (const key of flatten(zh)) {
      const zhVars = extractInterpolations(readPackValue(zh, key));
      const enVars = extractInterpolations(readPackValue(en, key));
      for (const v of zhVars) {
        if (!enVars.has(v)) failures.push(`${ns}:${key} — zh has {{${v}}} but en does not`);
      }
      for (const v of enVars) {
        if (!zhVars.has(v)) failures.push(`${ns}:${key} — en has {{${v}}} but zh does not`);
      }
    }
  }
  return failures;
}

// --- 2. Unused keys ---

function checkUnusedKeys() {
  return unusedKeys().sort();
}

// --- 3. Value-level drift ---

function checkValues() {
  return valueDrift();
}

// --- main ---

function main() {
  let failed = false;

  console.log("🔍 i18n check\n");

  // 1. Interpolation parity
  console.log("1/3  Interpolation variable parity…");
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
  console.log("2/3  Unused keys (in locale files but not referenced in source)…");
  const unused = checkUnusedKeys();
  if (unused.length === 0) {
    console.log("  ✅ no unused keys\n");
  } else {
    // Warning only: unreachable keys are dead weight, not broken UI. Deletion
    // is a separate, deliberate step (scripts/i18n-prune.cjs --apply).
    console.log(`  ⚠️  ${unused.length} unused key(s) — run "pnpm i18n:prune" to list them:`);
    for (const k of unused.slice(0, 30)) console.log(`    - ${k}`);
    if (unused.length > 30) console.log(`    … and ${unused.length - 30} more`);
    console.log();
  }

  // 3. Value-level drift
  console.log("3/3  Value drift (untranslated, empty, one-sided)…");
  const drift = checkValues();
  if (drift.length === 0) {
    console.log("  ✅ no value-level drift\n");
  } else {
    failed = true;
    console.log(`  ❌ ${drift.length} finding(s):`);
    for (const f of drift) console.log(`    - ${f}`);
    console.log();
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
