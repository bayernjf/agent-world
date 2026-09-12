/**
 * i18next-parser configuration.
 *
 * Scans src/**/*.{ts,tsx} for t("namespace:key") literals and syncs
 * the JSON locale files under src/i18n/locales/$LOCALE/$NAMESPACE.json.
 *
 * Usage:
 *   pnpm --filter @agent-world/web i18n:extract
 *
 * The parser is additive: it adds missing keys but never removes existing
 * ones (keepRemoved: true). Run keys.test.ts to catch unused keys.
 */
module.exports = {
  input: ["src/**/*.{ts,tsx}"],
  output: "src/i18n/locales/$LOCALE/$NAMESPACE.json",
  locales: ["zh", "en"],
  defaultNamespace: "common",
  // Match the project convention: t("namespace:key") with ":" separator
  namespaceSeparator: ":",
  keySeparator: ".",
  interpolation: {
    prefix: "{{",
    suffix: "}}",
  },
  sort: true,
  createOldCatalogs: false,
  keepRemoved: true,
  // Don't parse test files — they may contain t() mocks or fixtures
  // that aren't real translation keys.
  inputExclude: ["src/**/*.test.{ts,tsx}", "src/test/**/*"],
  // Custom lexers: the default jsx-lexer handles t() calls in TSX.
  // We also scan plain .ts files (stores, utils) for t() usage.
  lexers: {
    ts: ["JsLexer"],
    tsx: ["JsxLexer"],
  },
};
