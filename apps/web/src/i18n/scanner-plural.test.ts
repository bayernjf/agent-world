import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const { DEFAULT_NS, isReferenced, references } = requireCjs("../../scripts/i18n-scan.cjs");

type RefShape = { literal?: string[]; bare?: string[]; dynamic?: string[] };

function refs({ literal = [], bare = [], dynamic = [] }: RefShape) {
  return { literal: new Set(literal), bare: new Set(bare), dynamic: new Set(dynamic) };
}

describe("i18n scanner: CLDR plural forms", () => {
  it("reaches the announcement plurals that no source file names", () => {
    const real = references();
    // Assembled from fragments: this file must not be the reference that keeps
    // these keys alive, or the assertion would prove nothing.
    const bases = [
      ["feedback", "admin.announce.templateTitleEn"].join(":"),
      ["feedback", "admin.announce.templateBodyEn"].join(":"),
    ];
    for (const base of bases) {
      // The call sites pass {count}, so they name only the base key.
      expect(isReferenced(base, real)).toBe(true);
    }
    for (const base of bases) {
      for (const suffix of ["_one", "_other"]) {
        expect(real.literal.has(base + suffix)).toBe(false);
        expect(isReferenced(base + suffix, real)).toBe(true);
      }
    }
  });

  it("resolves a suffixed form back to its referenced base", () => {
    const r = refs({ literal: ["common:group.label"] });
    for (const suffix of ["zero", "one", "two", "few", "many", "other"]) {
      expect(isReferenced(`common:group.label_${suffix}`, r)).toBe(true);
    }
  });

  it("still reports a plural form whose base nothing references", () => {
    const r = refs({ literal: ["common:group.label"] });
    expect(isReferenced("common:group.ghost_one", r)).toBe(false);
    expect(isReferenced("common:group.ghost_other", r)).toBe(false);
  });

  it("does not exempt keys that merely end in one of those words", () => {
    const r = refs({ literal: ["common:group.label"] });
    expect(isReferenced("common:group.label_otherwise", r)).toBe(false);
    expect(isReferenced("common:group.label_money", r)).toBe(false);
  });

  it("follows the base through the defaultNS and dynamic rules too", () => {
    const r = refs({ bare: ["group.label"], dynamic: ["billing:plans."] });
    expect(isReferenced(`${DEFAULT_NS}:group.label_other`, r)).toBe(true);
    expect(isReferenced("billing:plans.anything_one", r)).toBe(true);
  });
});
