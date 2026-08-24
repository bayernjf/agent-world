# Agent World

A game-style workbench for multi-agent orchestration. Each agent is a plant on an
industrial line, tokens are electricity, and output moves between plants on pipes and
trucks. This repo is the product; the marketing site lives separately.

## The two decisions this codebase encodes

**Rework loops are a construct, not an arbitrary cycle.** A critic that sends work back
to a builder makes the graph non-acyclic, which would make it unschedulable. Instead a
gate owns a `rework` edge, and the compiler enforces one invariant: dropping every
rework edge must leave a DAG, and each rework edge must land on an ancestor of its gate
within that DAG. That buys a real execution plan (topological order plus a bounded loop
body) while still letting work flow backwards. A gate that runs out of attempts follows
its `onExhausted` policy — `pass`, `scrap`, or `halt` for a human to pick up.

**An attempt is part of a node run's identity.** `(runId, nodeId, attempt)` is the
primary key, not a counter that gets overwritten. Attempt 1 and attempt 2 both survive,
so the inspector can show them side by side and diff them.

Electricity is metered after each call returns, never charged up front, because token
cost is only knowable once the model responds. The budget is a hard ceiling on top of
that meter: cross it and the whole line trips.

## Layout

```
packages/core     graph schema, compiler, event schema, runtime reducer (zero deps, runs both sides)
packages/server   execution engine, worker seam, SQLite persistence, HTTP + SSE
apps/web          the board: plants, pipes, trucks, control panel, replay scrubber
```

The event stream is the single source of truth. Runtime state is a pure fold over it,
which means replay is just re-folding a prefix — the scrubber and the live view run the
same reducer.

`packages/server/src/worker.ts` is the seam between orchestration and model calls. The
fake worker in that file is deterministic and offline, which is what the tests and the
canvas are wired against today.

## Running it

Requires Node >= 24 (for `node:sqlite`) and pnpm.

```bash
pnpm install
pnpm dev
```

The engine listens on `http://localhost:8791` and the board on
`http://localhost:5183`.

```bash
pnpm -r test
pnpm -r typecheck
```
