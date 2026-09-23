# End-to-end tests (Playwright)

Black-box coverage for the whole stack: the **vite web app** talks to the
**Hono server** (`packages/server`) backed by SQLite. Two spec files cover the
paths that must never be broken:

**`smoke.spec.ts`**
1. a guest opening the app is redirected to the login page;
2. the one-click **demo** entry (`POST /api/auth/demo`) provisions a real
   account and lands the user inside the actual product, with the demo banner
   shown and no uncaught client error.

**`flows.spec.ts`** — authenticated core flows, again **without running a
pipeline** (no AI provider key or paid-plan flag needed):
3. self-service **registration** lands a new user on the template onboarding
   screen (blank-line card present);
4. creating a **blank line** enters the real canvas, and the settings dialog
   tabs (Models / Integrations / Skills / Plan & Usage) switch;
5. **log out → log back in** keeps the created line (persistence across the
   session boundary).

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
pnpm e2e flows    # only the authenticated-flow specs
pnpm e2e:ui       # interactive UI mode
pnpm e2e:report   # open the last HTML report
```

`playwright.config.ts` starts both processes itself and tears them down on
**isolated ports**, so E2E never shares a developer's already-running dev
server or its real database:

- server: `tsx src/index.ts` on **:8792** (override with `E2E_SERVER_PORT`)
  with `ALLOW_DEMO=1`, `ALLOW_REGISTRATION=1` and a **unique temp `DB_FILE`**
  under the OS temp dir (DB, JWT secret, encryption keys, artifacts and logs
  all derive from that directory, so real data is never touched; the dir is
  deleted on exit). `ALLOW_REGISTRATION=1` keeps self-registration open after
  the first account bootstraps the throwaway DB, so each flow spec can
  provision a unique account;
- web: the vite dev server on **:5174** (override with `E2E_WEB_PORT`), with
  `VITE_API_PROXY_TARGET` pointing its `/api` proxy at the isolated backend
  (the default proxy target remains :8791 for ordinary local dev).

`reuseExistingServer` is always `false` for E2E: the isolated ports should be
free, and every run gets a clean, throwaway stack.

## Scope / CI

The browser suite runs in CI (the workflow installs Chromium, builds the
workspace, then runs `pnpm e2e` against the same throwaway stack described
above). It stays deliberately AI-free — it never executes a pipeline — so it
needs no secrets. Candidate future flows that *do* need extra setup and are not
yet covered: billing/Stripe test mode, and RPA platform (Doubao) auth.
