# Contributing

Thanks for helping build Agent World. This is a local-first, multi-agent
orchestration studio — a pnpm monorepo with a zero-dependency core, a Hono
server, and a React board.

## Prerequisites

- **Node >= 24** (the server uses `node:sqlite`)
- **pnpm** (`npm i -g pnpm` or your version manager)

## Develop

```bash
pnpm install
pnpm dev          # server :8791 + board :5183
```

Useful scripts (run per package with `pnpm --filter <pkg>`, or `-r` for all):

```bash
pnpm -r test       # unit tests (vitest)
pnpm -r typecheck  # tsc --noEmit
pnpm -r build      # production build
```

Before opening a PR, make all three pass for the packages you touched.

## Project layout

- `packages/core` — graph schema, compiler, event schema, runtime reducer
  (zero deps, runs on both client and server).
- `packages/server` — execution engine, worker seam, SQLite persistence, HTTP + SSE.
- `apps/web` — the board: canvas, control panel, inspector, dialogs.

## Commit messages

- Write commit messages in **English**, in the **imperative** mood
  (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- Keep commits **atomic** — one logical change per commit.
- Reference the issue/phase when relevant (e.g. `feat(core): implement rework loop (2.1)`).

## Coding conventions

- The **event stream is the single source of truth**: runtime state is a pure fold
  over events. Add events, don't mutate state ad hoc.
- **An attempt is part of a node run's identity** — `(runId, nodeId, attempt)` is
  the primary key. Keep historical attempts immutable.
- **Worker seam**: model calls go through `routingWorker` / the worker interface.
  Never call a provider directly from the engine.
- Token cost is metered **after** a call returns, never charged up front.

## Tests

- Unit tests live next to the code (`*.test.ts`) and use vitest.
- When you change engine behavior, add or update an `engine.*.test.ts` case.
- The deterministic **fake worker** is the default for tests — keep new features
  testable without a live model provider.

## Opening a PR

- Push your branch and open a PR against `main` (or the relevant feature branch).
- Describe what changed and why; link the relevant phase/task from
  `docs/roadmap-tasks.md`.
- CI runs `test` + `typecheck` + `build`; all must be green.

## License

By contributing, you agree your contributions are licensed under the MIT License.
