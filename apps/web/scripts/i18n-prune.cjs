#!/usr/bin/env node
/**
 * i18n-prune.cjs — delete language-pack keys no source file can reach.
 *
 * Dry-run by default and prints one line per namespace; --apply rewrites both
 * zh/ and en/ in the same pass (the packs must stay symmetric) and drops groups
 * that end up empty.
 *
 * What counts as reachable is decided once, in i18n-scan.cjs, so this tool and
 * `pnpm i18n:check` can never disagree — and keys addressed through a runtime
 * prefix (`t(`billing:plans.${id}`)`) are protected automatically rather than
 * by a hand-maintained allowlist that goes stale.
 *
 * After --apply, run the guard and the suite: `pnpm --filter @agent-world/web
 * exec vitest run src/i18n/keys.test.ts` then the full web run.
 *
 * Usage:
 *   pnpm --filter @agent-world/web i18n:prune
 *   pnpm --filter @agent-world/web i18n:prune -- --apply
 */

const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  LOCALES_ROOT,
  flatten,
  isReferenced,
  namespaces,
  readPack,
  references,
} = require("./i18n-scan.cjs");

const APPLY = process.argv.includes("--apply");
const refs = references();

function removeLeaf(obj, parts) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!next || typeof next !== "object") return;
    cur = next;
  }
  delete cur[parts[parts.length - 1]];
}

function dropEmptyGroups(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      dropEmptyGroups(v);
      if (Object.keys(v).length === 0) delete obj[k];
    }
  }
}

let total = 0;
for (const ns of namespaces()) {
  const zhPath = join(LOCALES_ROOT, "zh", `${ns}.json`);
  const enPath = join(LOCALES_ROOT, "en", `${ns}.json`);
  const zh = readPack(ns, "zh");
  const en = readPack(ns, "en");
  const dead = flatten(zh).filter((key) => !isReferenced(`${ns}:${key}`, refs));
  if (dead.length === 0) continue;
  total += dead.length;
  console.log(`${ns}: ${dead.length} unreferenced`);
  for (const key of dead) {
    removeLeaf(zh, key.split("."));
    removeLeaf(en, key.split("."));
  }
  dropEmptyGroups(zh);
  dropEmptyGroups(en);
  if (APPLY) {
    writeFileSync(zhPath, JSON.stringify(zh, null, 2) + "\n");
    writeFileSync(enPath, JSON.stringify(en, null, 2) + "\n");
  }
}

const protectedPrefixes = [...refs.dynamic].sort();
console.log(`\nruntime-addressed prefixes kept (${protectedPrefixes.length}):`);
for (const p of protectedPrefixes) console.log(`  ${p}`);
console.log(`\ntotal unreferenced: ${total}  ${APPLY ? "APPLIED" : "dry run — pass --apply"}`);
