# End-to-end smoke tests (Playwright)

Minimal black-box smoke coverage for the whole stack: the **vite web app**
(`apps/web`, :5173) talks to the **Hono server** (`packages/server`, :8791)
backed by SQLite. It verifies the two paths that must never be broken:

1. a guest opening the app is redirected to the login page;
2. the one-click **demo** entry (`POST /api/auth/demo`) provisions a real
   account and lands the user inside the actual product, with the demo banner
   shown and no uncaught client error.

The suite only opens the app and starts a demo — it **never runs a pipeline**,
so no AI provider key and no paid-plan flag are needed.

## Prerequisites

- Node 24 (the repo requires it; the server uses `node:sqlite`). With fnm:
  `fnm use 24` (or prefix commands with `fnm exec --using=24 --`).
- Install workspace deps: `pnpm install`.
- The browser binary once (may already be cached by the server's RPA tests):
  `pnpm e2e:install` (= `playwright install chromium`).
- After a fresh checkout, make sure `@agent-world/core` is built once
  (`pnpm -r build`), since the server runs from TS via `tsx` and imports core.

## Run

```bash
pnpm e2e          # headless chromium, auto-starts server + web
pnpm e2e:ui       # interactive UI mode
pnpm e2e:report   # open the last HTML report
```

`playwright.config.ts` starts both processes itself and tears them down:

- server: `tsx src/index.ts` with `ALLOW_DEMO=1` and a **unique temp
  `DB_FILE`** under the OS temp dir (DB, JWT secret, encryption keys,
  artifacts and logs all derive from that directory, so real data is never
  touched; the dir is deleted on exit);
- web: the vite dev server (its `/api` proxy already targets :8791).

Outside CI, `reuseExistingServer` reuses a server you already have running on
those ports instead of failing.

## Scope / CI

This is a deliberately small, manually-run smoke skeleton. Per
`docs/engineering-blueprint.md`, CI currently only builds and runs unit tests
(it does not launch browsers); the browser smoke is meant to be wired into CI
later (around open registration) and extended with the higher-value flows:
template gallery → canvas, billing/Stripe test mode, RPA platform auth.
