# Handoff

State of Agent World as of 2026-08-25. Everything below is committed on `main`;
nothing since the initial 22-commit push has been pushed to `origin`.

## What works today

The whole loop runs end to end against a deterministic fake worker, verified in a
browser and not just typechecked:

press 派发任务 → intake lights up → forge runs → critic rejects it → a striped truck
runs backwards down the rework line → forge runs again and wears a `×2` badge → critic
passes → shipyard → depot → 全部出厂. The power meter reads a real metered cost, the
timeline scrubs the finished run back through its event stream, and the inspector diffs
forge's attempt 1 against attempt 2 word by word.

Also working: laying and deleting pipes, dragging plants, adding plants and gates,
undo/redo, live compile diagnostics that disable dispatch on an invalid graph, run
cancellation, and SSE resume from a sequence number.

## Where the design decisions live

The two hard questions are settled in code, not just in discussion. `README.md` has the
reasoning; the short version:

- **Rework is a construct, not a cycle.** A gate owns a `rework` edge. The compiler in
  `packages/core/src/compile.ts` enforces that dropping every rework edge leaves a DAG
  and that each rework edge lands on an ancestor of its gate. Gates that exhaust their
  attempts follow `onExhausted`: `pass`, `scrap`, or `halt`.
- **An attempt is identity.** `(runId, nodeId, attempt)` is the primary key in
  `packages/server/src/db.ts` and outputs are keyed by attempt in the reducer, so both
  attempts survive and can be compared.
- **Skills are not a paywall.** They are capability toggles on a node with no unlock
  cost. Nothing in the schema charges for them.

The event stream is the single source of truth; runtime state is a pure fold over it, so
replay is just re-folding a prefix. The live view and the scrubber run the same reducer,
which is why they cannot disagree.

## Layout

```
packages/core     graph schema, compiler, event schema, runtime reducer (zero deps, runs both sides)
packages/server   execution engine, worker seam, SQLite persistence, HTTP + SSE
apps/web          the board: plants, pipes, trucks, control panel, replay scrubber
```

## Running it

Requires Node >= 24 and pnpm. Only node@26 is installed on this machine, at
`/opt/homebrew/opt/node@26/bin` — prefix it onto `PATH` if the shell's default node is
older, or the Vite and Astro toolchains will refuse to start.

```bash
pnpm install
pnpm dev
```

Engine on `http://localhost:8791`, board on `http://localhost:5183`.

```bash
pnpm -r test        # 13 tests in core, 6 in server
pnpm -r typecheck
```

## Deviations from the stack originally chosen

1. **`node:sqlite` instead of better-sqlite3 + Drizzle.** pnpm 10 would not build
   better-sqlite3's native bindings even with `onlyBuiltDependencies` set and an explicit
   rebuild. `node:sqlite` is built in and needs no native step, at the cost of requiring
   Node >= 24, which is now in `engines`.
2. **Port 8791, not 8787.** 8787 is held by two of the user's other long-running
   processes (`agent-dev`, `bayjf`), which were left alone.

## The next real piece of work

**A provider-backed worker.** `packages/server/src/worker.ts` is the seam — the engine
knows only that interface, so a real implementation drops in without touching
orchestration. Everything downstream of it is already wired for streaming text, metered
usage and per-attempt output, so this is the change that turns the sandbox into a
product. The fake worker should stay; the tests depend on it being offline and
deterministic.

After that, in rough order of how much they'd add:

- **Make the gate's criterion mean something.** `gate.criterion` exists in the schema but
  has no field in the inspector and `fakeWorker.judge` ignores it, passing on a fixed
  attempt number instead. A real judge should read it, and the operator needs a way to
  write it.
- **Prompt editing that survives a reload.** The inspector edits `agent.prompt` in the
  graph store and `PUT /api/graphs/:id` persists it, but only on dispatch. Editing a
  prompt and reloading without running loses it.
- **Parallel branches.** The compiler emits a linear topological order, so two
  independent plants run one after the other rather than at once. The plan shape can hold
  levels; the engine's cursor is what assumes a single file.
- **`halt` has no resume.** A halted run is a terminal state with no way to approve the
  work and continue. The event stream can express it; there is no command for it.
- **Skill cards.** `agent.skills` is a string array with no UI. This is where the
  equippable-card idea would land.

## Things worth knowing before touching the canvas

- `apps/web/src/canvas/PacketLayer.tsx` draws trucks on a canvas overlay in board user
  units. It has to sit on exactly the same letterboxed box as the SVG — see `fitOf` in
  `Canvas.tsx`. Getting this wrong makes freight drift off its pipes, which is subtle
  enough to miss without checking pixels.
- Trucks live in refs behind one animation loop on purpose. Putting them in component
  state re-renders the tree every frame.
- The truck de-dup set is keyed by `edgeId:seq` and resets when `runId` changes. Packet
  sequence numbers restart per run, so without that reset a second run draws nothing.
- Deselect lives on the backdrop rect, not the `<svg>`. An svg-level click handler also
  catches the click that just picked a plant, which makes laying a pipe impossible.
