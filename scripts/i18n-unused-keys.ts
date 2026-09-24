/**
 * Report (and optionally delete) web language-pack keys that no source file
 * references.
 *
 * Dry-run by default: prints one line per namespace. Pass --apply to rewrite
 * both zh/ and en/ packs, dropping empty groups with the leaves.
 *
 * The guard this leans on: `apps/web/src/i18n/keys.test.ts` fails if any `t()`
 * literal in source is missing from either pack, so deleting keys it does not
 * know about is safe — but deleting a key reached through a template literal
 * (`t(\`billing:plans.${id}\`)`) is NOT, because no literal names it. Those
 * prefixes are listed in DYNAMIC below and always kept. Keep that list in sync
 * when a component starts building a key at runtime.
 *
 * Usage:  npx tsx scripts/i18n-unused-keys.ts [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(fileURLToPath(import.meta.url), "../../apps/web/src");
const LOCALES = path.join(SRC, "i18n/locales");
const APPLY = process.argv.includes("--apply");

/** Key prefixes whose leaf names are constructed at runtime. */
const DYNAMIC: string[] = [
  // Node kinds resolved from `n.kind` (VersionPanel) and node config tables.
  "nodes:inspector.source.shortcutHint.",
  "nodes:inspector.compliance.platform",
  "modals:batchManager.status.",
  "modals:batchManager.itemStatus.",
  "modals:brandAssets.types.",
  "modals:calendar.status.",
  "modals:calendar.weekdays.",
  "modals:operations.summary.",
  "modals:performance.groupBy",
  "run:timeline.status.",
  "billing:plans.",
  "billing:gate.metric.",
  "billing:invoices.status",
  "feedback:form.categories.",
  "feedback:status.",
  "settings:cards.kind.",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** Every `.ts`/`.tsx` under src, tests included: a key only a test names still
 *  cannot be deleted without rewriting that test. */
const haystack = sourceFiles(SRC)
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

function leaves(obj: Record<string, unknown>, prefix: string, out: string[] = []): string[] {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") leaves(v as Record<string, unknown>, p, out);
    else out.push(p);
  }
  return out;
}

function removeLeaf(obj: Record<string, unknown>, parts: string[]): void {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!next || typeof next !== "object") return;
    cur = next as Record<string, unknown>;
  }
  delete cur[parts[parts.length - 1]];
}

function dropEmptyGroups(obj: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      const child = v as Record<string, unknown>;
      dropEmptyGroups(child);
      if (Object.keys(child).length === 0) delete obj[k];
    }
  }
}

const nsFiles = fs.readdirSync(path.join(LOCALES, "zh")).filter((f) => f.endsWith(".json"));
let total = 0;
let keptDynamic = 0;

for (const file of nsFiles) {
  const ns = file.replace(".json", "");
  const zhPath = path.join(LOCALES, "zh", file);
  const enPath = path.join(LOCALES, "en", file);
  const zh = JSON.parse(fs.readFileSync(zhPath, "utf8")) as Record<string, unknown>;
  const en = JSON.parse(fs.readFileSync(enPath, "utf8")) as Record<string, unknown>;
  const all = leaves(zh, "", []);
  const dead: string[] = [];
  const kept: string[] = [];
  for (const k of all) {
    const full = `${ns}:${k}`;
    if (haystack.includes(`"${full}"`) || haystack.includes(`"${k}"`)) continue;
    if (DYNAMIC.some((p) => full.startsWith(p))) {
      kept.push(full);
      continue;
    }
    dead.push(k);
  }
  keptDynamic += kept.length;
  for (const k of kept) console.log(`  kept (dynamic): ${k}`);
  if (!dead.length) continue;
  total += dead.length;
  console.log(`${ns}: ${dead.length} unreferenced of ${all.length}`);
  for (const k of dead) {
    removeLeaf(zh, k.split("."));
    removeLeaf(en, k.split("."));
  }
  dropEmptyGroups(zh);
  dropEmptyGroups(en);
  if (APPLY) {
    fs.writeFileSync(zhPath, JSON.stringify(zh, null, 2) + "\n");
    fs.writeFileSync(enPath, JSON.stringify(en, null, 2) + "\n");
  }
}

console.log(`\ntotal unreferenced: ${total}  kept as dynamic: ${keptDynamic}  ${APPLY ? "APPLIED" : "dry run"}`);
