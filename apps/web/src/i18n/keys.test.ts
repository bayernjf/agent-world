import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import i18n from "./index";

const SRC_ROOT = join(__dirname, "..");
// Read from the instance so a newly registered namespace is guarded automatically.
const NAMESPACES = (i18n.options.ns ?? []) as string[];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "i18n" || entry.name === "node_modules") continue;
      yield* walk(p);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield p;
    }
  }
}

const KEY_LITERAL = /\bt\(\s*"([^"]+)"/g;
// Keys can also reach t() through a lookup table (SkillPicker maps a permission
// id to its label key), so scan every namespace-qualified literal, not just the
// ones inside t(). Dot-qualified literals stay out on purpose: "run.started" is
// an SSE event name, not a key.
const NS_KEY_LITERAL = new RegExp(`"(?:${NAMESPACES.join("|")}):[^"]+"`, "g");

function usedKeys(): Map<string, string[]> {
  const found = new Map<string, Set<string>>();
  const add = (key: string, file: string) => {
    const files = found.get(key) ?? new Set<string>();
    files.add(file);
    found.set(key, files);
  };
  for (const file of walk(SRC_ROOT)) {
    const src = readFileSync(file, "utf8");
    const where = relative(SRC_ROOT, file);
    for (const m of src.matchAll(KEY_LITERAL)) add(m[1]!, where);
    for (const m of src.matchAll(NS_KEY_LITERAL)) add(m[0].slice(1, -1), where);
  }
  return new Map([...found].map(([key, files]) => [key, [...files]]));
}

function flatten(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return prefix ? [prefix] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("i18n language packs", () => {
  it("every t() key used in source resolves in both zh and en", () => {
    const unresolved: string[] = [];
    for (const [key, files] of usedKeys()) {
      for (const lng of ["zh", "en"] as const) {
        if (!i18n.exists(key, { lng })) {
          unresolved.push(`${key} (${lng}) <- ${files.join(", ")}`);
        }
      }
    }
    // A key that does not resolve renders as its own raw text in the UI, which
    // is how "canvas.undoWithShortcut" once shipped as a tooltip.
    expect(unresolved).toEqual([]);
  });

  it("zh and en expose the same key set per namespace", () => {
    const diffs: string[] = [];
    for (const ns of NAMESPACES) {
      const zh = new Set(flatten(i18n.getResourceBundle("zh", ns)));
      const en = new Set(flatten(i18n.getResourceBundle("en", ns)));
      for (const k of zh) if (!en.has(k)) diffs.push(`${ns}: ${k} missing in en`);
      for (const k of en) if (!zh.has(k)) diffs.push(`${ns}: ${k} missing in zh`);
    }
    expect(diffs).toEqual([]);
  });

  it("translated values are never empty or equal to their key", () => {
    const bad: string[] = [];
    for (const ns of NAMESPACES) {
      for (const lng of ["zh", "en"] as const) {
        for (const key of flatten(i18n.getResourceBundle(lng, ns))) {
          const value = i18n.getResource(lng, ns, key);
          if (typeof value !== "string" || value.trim() === "" || value === key) {
            bad.push(`${ns}:${key} (${lng})`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
