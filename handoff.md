# Handoff

State of Agent World as of 2026-08-25.

## Project documents

- [PRD.md](PRD.md) — phased roadmap and architectural guardrails
- [README.md](README.md) — two core design decisions, layout, running instructions
- [docs/product-vision-discussion.md](docs/product-vision-discussion.md) — full product vision
- [docs/technical-design.md](docs/technical-design.md) — architecture, data models, API
- [docs/roadmap-tasks.md](docs/roadmap-tasks.md) — per-phase task breakdown

## Phase 1 status: complete

The sandbox is wired to a real model. Verified end-to-end against the Agnes AI
OpenAI-compatible endpoint (`agnes-2.0-flash`): a dispatched run streams real text
and reasoning tokens, the judge reads `gate.criterion`, rework fires on rejection
(and the rejection reason is fed back so the next attempt improves), halt waits for
a human, and resume continues the line to completion. Token/cost metering, retry,
error classification, heartbeat and redaction are all in.

## What changed since Phase 0

### Core (`packages/core`)

- **pricing.ts** (new) — single source of truth for billing across server and
  web. Defines `Modality`/`MODALITY_ENDPOINT`, `ModelPricing` (token fields plus
  `perImage`/`perSecond`/`perKiloChar`), `PRICING_FIELDS`/`PRICING_HEADING`
  (which price inputs to show per modality), and `computeCost(usage, pricing)`
  which prices token and non-token dimensions in one call. `addUnits()` merges
  the free-form `UsageUnits` map (`images`/`seconds`/`characters`, extensible
  without a schema migration).
- **events.ts** — added `node.reasoning` event (hidden thinking tokens),
  `errorCode` on `node.failed`, optional `cachedTokens`/`reasoningTokens` on `Usage`,
  optional `units` (non-token counters) on `Usage`, optional `artifactId`/`metadata`
  on `packet.sent`.
- **graph.ts** — `AgentConfig` gained `temperature`, `timeoutMs`, `retry` (technical
  retry, distinct from rework attempts). Added `SourceConfig` with a reserved
  `connector` field. Default model changed to `agnes-2.0-flash`.
- **runtime.ts** — reducer handles `node.reasoning`; `NodeRuntime` tracks reasoning
  text per attempt, cached/reasoning token counts, and errorCode. `RuntimeState`
  tracks total token counts (in/out/cached) and aggregated `totalUnits` for the
  token-vs-cost meter.

### Server (`packages/server`)

- **config.ts** (new) — loads/saves provider config from
  `$AGENT_WORLD_CONFIG`, `~/.agent-world/config.json`, or walks up from cwd looking
  for `agent-world.config.json`. API keys are redacted in the settings API.
  Re-exports the shared `ModelPricing`/`Modality`/`computeCost` from core.
- **worker.ts** — `Worker` interface now yields `AgentChunk`
  (text-delta | reasoning-delta | tool-call | tool-result) and returns
  `{ output, usage }`. `judge()` now receives `output` and `criterion`. Fake worker
  updated; it reads criterion for deterministic verdicts.
- **providers/openai-compatible.ts** (new) — one worker covering any OpenAI-
  compatible Chat Completions API (Agnes, OpenAI, Volcengine Ark, vLLM, Ollama).
  Handles SSE streaming, reasoning_content, prompt-cache usage, timeout via
  AbortController, and maps HTTP errors to `ProviderError` codes
  (TIMEOUT/RATE_LIMIT/PROVIDER_ERROR/AUTH/UNKNOWN). `computeUsage()` delegates to
  the shared `computeCost()`, so per-image/second/character pricing is wired the
  day a non-text worker reports `units`.
- **providers/index.ts** (new) — `routingWorker()` picks the provider for each node
  by its model name; workers are cached per provider+model+connection tuple.
  Config is re-read fresh per call so saved keys/URLs/enabled state take effect
  without a restart (the cache key incorporates them to avoid stale workers);
  disabled providers fall back to the fake worker with a warning.
- **engine.ts** — consumes `AgentChunk`, emits `node.delta`/`node.reasoning`,
  passes `signal` to workers, wraps agent calls in exponential-backoff retry for
  transient errors (retries do NOT increment attempt), passes output+criterion to
  judge. Added `reconstructState()` and `resume()` generator for continuing a
  halted run — yields only new events, seq continues from the existing log.
  Accepts `input` (raw material) for the source node. On rework, the judge's
  rejection reason is appended to the reworked node's next input. Errors pass
  through `sanitizeError()` before landing in the event stream. The fallback
  model is now injected from live config (`defaultModel`) rather than hard-coded,
  and `UNSUPPORTED` is recognised as a terminal error code.
- **db.ts** — `runs` gained `trigger` column; `node_runs` gained `reasoning`,
  `error_code`, `cached_tokens`, `reasoning_tokens`, `units_json`. Additive
  migrations run on open. `markZombiesInterrupted()` runs at startup so a server
  restart doesn't leave runs forever "running". `nextSeq()` and `listRuns()` added.
- **index.ts** — uses `routingWorker()`, marks zombies on boot, adds
  `GET/PUT /api/settings`, `GET /api/runs`, `POST /api/runs/:id/resume`
  (continue | scrap), `GET /api/health`. Config file is `agent-world.config.json`
  at repo root (gitignored). SSE loop sends a `: ping` heartbeat every 15s of
  idle so proxies don't drop the connection during long model calls. Added
  `POST /api/providers/test` — a modality-aware connectivity probe (shaped
  payload per endpoint, longer timeout for image/video/audio) that resolves
  redacted keys server-side and sanitises error bodies. Settings PUT merges
  providers (always keeping the internal `fake` provider) and preserves real
  keys when the UI echoes redacted ones. Runs/execute/resume pass through the
  live default model.
- **sanitize.ts** (new) — truncates error text to 500 chars and strips
  `authorization`/`api_key`/`sk-...`/`ark-...` patterns before persistence.

### Web (`apps/web`)

- **store/graph.ts** — edits auto-save (500ms debounce PUT) with a save-state
  indicator; no more "only saves on dispatch".
- **store/run.ts** — SSE auto-reconnects with exponential backoff (resumes from
  last seq); exported `resumeRun(action)`.
- **Inspector.tsx** — gate criterion textarea, agent temperature slider, error
  panel with code + message, collapsible reasoning view, cache token display,
  save indicator.
- **ControlPanel.tsx** — halted state shows "人工放行/报废" buttons, reconnecting
  indicator, settings button, interrupted status, a "原料" textarea for dispatch
  input, and a 电费/Token meter toggle (cost view only when a unit price is
  configured; token view always). Stop button notes already-spent tokens still bill.
- **Settings.tsx** (new) — full provider/model manager. Multiple providers, each
  with N models; cards are collapsed by default and only one expands at a time.
  Add form supports reusing a saved provider's Base URL/API key (only the model
  name is needed) or creating a new provider. Per model: modality, per-modality
  unit prices (driven by `PRICING_FIELDS[modality]` — text 输入/输出 per 1M token,
  image 每张, video 每秒, audio 每秒 + 每千字符; heading/step change with type;
  switching modality clears the stale price card), enable/disable toggle,
  "设为默认" (provider-aware, single default, validated case-insensitively),
  drag-to-reorder (persisted in `modelOrder`, with a dragged-row placeholder),
  test-connection (works before and after save; resolves redacted keys
  server-side), update/revert per card, and delete with a custom confirm modal
  (deletes the provider when its last model goes). Connection fields (model
  type, provider type, Base URL) are disabled once a model is saved — only API
  key and prices stay editable — to avoid desyncing sibling models. Keys are
  redacted; editing replaces them; password-autofill is suppressed. Closing
  with unsaved changes prompts via a custom confirm.
- **api.ts** — `resumeRun`, `getSettings`, `saveSettings`, `testProvider`;
  `startRun` takes optional dispatch `input`; pricing type is the shared
  `ModelPricing` from core.
- **styles.css** — modal, error box, reasoning, provider card, button row,
  segmented meter toggle, price-row styles.

## Verified behaviour

```
dispatch → forge streams reasoning + text → critic judges against criterion
  → rejected → rework truck back to forge → forge runs again (×N)
  → on exhaustion with halt policy → line halts
  → POST /resume {action:"continue"} → critic approved by human
  → shipyard runs → depot → run.finished(done)
```

Failures: a 503 from an unknown model name is classified as PROVIDER_ERROR; the
engine retries per `retry` policy, then emits `node.failed` with the errorCode.

## Known gaps / next work

- **Cost is metered as $0 for Agnes.** Token counts are correct (in/out/cached/
  reasoning), but no `pricing` entry is configured for `agnes-2.0-flash` in
  `agent-world.config.json`. Add `pricing: { "agnes-2.0-flash": { input, output,
  cacheRead } }` (USD per 1M tokens) once the rates are known. The UI shows
  token counts until a price is set; once set, the 电费 view and budget trip
  activate automatically off `costUsd`.
- **Non-text runtime is not executed yet.** The billing model, modality routing,
  price-card UI, usage `units`, and `units_json` column all support image/video/
  audio models, and test-connection probes each modality's endpoint — but
  `openAICompatibleWorker.runAgent` still throws `UNSUPPORTED` for non-text
  models. Stage 4 adds the image/video/audio generation workers; when they
  return `units` (e.g. `{ images: n }`, `{ seconds: n }`, `{ characters: n }`)
  billing lights up with no further schema work.
- **Dispatch input is wired.** `POST /api/runs` accepts `input`; the source node
  emits it as raw material, and the control panel has a "原料" textarea. If empty,
  it falls back to the old placeholder.
- **Rework reason is fed back to the forge.** On rejection, the critic's `reason`
  is noted on the rework entry node and appended to that node's next input as
  `[质检站退回原因] ...`, then cleared once consumed. Verified end-to-end: a
  rejected first draft added the required content on attempt 2 and passed.
- **Tool calls are reserved but not executed.** The `AgentChunk` union has
  tool-call/tool-result; the engine currently ignores them. Phase 2 skill cards
  wire this up.
- **tsx watch restarts can race on port 8791** (EADDRINUSE) when edits land in
  quick succession. `busy_timeout` was added; if it sticks, `lsof -ti :8791 |
  xargs kill -9` and restart.

### Tracked for later (see docs/technical-design.md §12)

- DB migrations are try/catch ADD COLUMN — need a `schema_version` table before
  open-sourcing, plus SQLite startup backup.
- Event endpoint returns all events; add range pagination for long runs.
- Graph autosave is last-write-wins — needs version/ETag optimistic lock for
  multi-tab safety.
- CORS allows all origins; tighten before hosted/private deployments.
- Structured logging with runId (currently console.error only).
- **Phase 2 parallelism hazard:** event emission must be serialized (single
  emit queue), and budget checks must happen at that serialization point, or
  concurrent nodes race past the budget. `inputFor` concatenation also needs a
  context-window strategy (truncation/rolling summary) before long workflows.

## Running it

Requires Node >= 24. Node 26 is at `/opt/homebrew/opt/node@26/bin`.

```bash
pnpm install
pnpm --filter @agent-world/core build   # server imports from dist
pnpm dev
```

The dev config lives in `agent-world.config.json` at the repo root (gitignored).
Set `AGENT_WORLD_CONFIG` to override the path. Use `WORKER=fake` to force the
offline deterministic worker.

Engine on `http://localhost:8791`, board on `http://localhost:5183`.

```bash
pnpm -r test        # 22 core + 32 server, all green
pnpm -r typecheck   # all green
```

## Canvas workspace overhaul (post-Phase-1)

The board is now a pan/zoom workspace with game-factory readability.

### Viewport & navigation (`store/canvas.ts`, `Canvas.tsx`, `Minimap.tsx`)
- Pan: select-mode drag, middle-mouse drag, or Space-drag anywhere (even over
  plants/pipes). Arrow keys nudge the canvas (Shift = 120px, else 40px).
- Zoom: cursor-anchored wheel zoom (0.3×–3×), minimap +/−, `F` to frame the
  selected node. The minimap shows nodes/edges/viewport and is draggable; its
  zoom controls sit bottom-left, the "适应" (fit) button bottom-right with
  matching 20px button height.
- `fitToBounds`/`centerOn` account for both the SVG letterbox (`fit.scale`) and
  the pan/zoom transform. A run start resets the viewport.

### Pipes (`geometry.ts`, `Pipes.tsx`)
- `edgeAnchors()` distributes fan-out/fan-in pins vertically on node faces
  (`PIN_GAP=14`, clamped to half the node height) so parallel pipes no longer
  overlap at a single pin.
- `pipePath()` is an orthogonal dogleg (rounded corners) for forward pipes;
  rework pipes arc over the top. Signature is now `(from, to, kind)`.
- `pipeCrossings()` detects where a vertical pipe segment crosses a horizontal
  one and draws a circuit-style bridge arc (vertical over horizontal), giving
  unambiguous crossings without a full autorouter.
- `pipeArrow()` places a direction triangle on the last horizontal segment of
  each forward pipe (rework pipes get none — the arc already reads as loopback).
- Hover or click a pipe to highlight its whole flow (transitive upstream +
  downstream); other pipes dim. Click locks the highlight; Delete/Backspace
  removes the selected pipe. A pipe hit area also starts a pan in select mode.
- Highlight/dim/live states are applied consistently to casings, cores, arrows
  and bridges, using the existing design tokens.

### Plants (`Plants.tsx`)
- Hover shows a large fixed-size nameplate (title 21px, rows 15px) with type,
  model, status, rework count, tokens and cost. The group counter-scales by
  `1 / (viewport.zoom * fit.scale)` so text stays screen-constant at any zoom;
  the native SVG `<title>` tooltip was removed to avoid a duplicate popup.
- Drag snapping: nodes snap to a 20px grid (`GRID`/`snap` in `store/graph.ts`)
  on both move and add, so plants on the same row line up and pipes stay straight.

### Editing affordances (`store/graph.ts`, `Canvas.tsx`)
- Grid snap for `moveNode`/`addNode`.
- `duplicateNode(id)` copies a plant (offset 30px, grid-snapped, "原名 副本",
  auto-selected); ⌘/Ctrl+C copies the selected plant, ⌘/Ctrl+V pastes (repeated
  pastes step-diagonal so they don't overlap). Input fields are unaffected.
- `addEdge` returns `{ ok, reason }`; self-loops ("不能连接到自身") and
  duplicates ("这条管道已经存在") surface as toasts instead of silently failing.
- `F` frames the selected node; Delete/Backspace removes the selected pipe.
- Undo/redo (zundo) with the top-left `UndoRedo` buttons; the temporal store
  uses `equality: (a,b)=>a.graph===b.graph` so a single undo doesn't need two
  clicks. Delete actions flash a toast with an undo action (`store/toast.ts`,
  `Toast.tsx`).

### Layout (`App.tsx`, `ControlPanel.tsx`, styles.css)
- Collapsible left control panel and right inspector, plus a "收起/展开侧栏"
  toggle. The CSS grid sets explicit `grid-column` per track so collapsing a
  panel doesn't let the stage slide into a 0px track.
- `PacketLayer.tsx` still draws trucks on a canvas overlay on the same
  letterboxed box (`fitOf`); trucks live in refs behind one animation loop and
  the de-dup set is keyed by `edgeId:seq`, reset on `runId` change.
- A "快捷键 ?" button in the HUD (`ShortcutsHelp.tsx`) opens a hover panel
  listing all canvas/edit/tool shortcuts.

### Deferred (full autorouter)
Crossing curvature/obstacle avoidance is intentionally NOT a full orthogonal
router yet. Pin distribution + bridge arcs resolve overlap and crossing
ambiguity at low risk. A real router (obstacle avoidance, loops, stable packet
paths) is a standalone chunk to schedule once the graph gets denser.

## Node-level budget (roadmap 2.5)

- `AgentConfig.budgetUsd?: number | null` (core/graph.ts) and a `BUDGET`
  `ErrorCode` (core/events.ts).
- The engine tracks `nodeCostUsd: Map<nodeId, number>` cumulative across a
  nodes attempts (rework), in BOTH `execute()` and `reconstructState()`/
  `resume()`. After each `node.finished`, if the node exceeds its budget it
  emits `node.failed` with `errorCode: "BUDGET"` (Chinese message) and stops the
  line. The whole-line `budgetUsd` trip runs after it.
- Web: Inspector has a "节点预算 (USD)" number input (empty = no limit); each
  plant shows a bottom-left `$budget` chip that turns red when over; the hover
  nameplate shows `$spent / $budget`; the failure label maps BUDGET to
  "节点预算超限".
- Test: server phase1 test sets a forge budget of 0.0001 and asserts
  `node.failed` BUDGET + run failed. Server is now 35 tests.
- Caveat: the roadmap exit criterion says an over-budget node shouldnt affect
  other plants. The linear engine can only stop the whole line (status=failed);
  true node isolation requires Phase 2 parallel/branch execution. That checkbox
  is left open in roadmap-tasks.md on purpose.

## Multi-graph management (roadmap 2.3)

- Server: `db.deleteGraph()`; `POST /api/graphs` creates an empty graph or
  deep-copies `?from=<id>` (new UUID, cloned nodes/edges); `DELETE
  /api/graphs/:id`. `GET /api/graphs` already listed them.
- Web api client: `listGraphs`, `createGraph(name?, from?)`, `deleteGraph`.
- `store/graph.ts` gained `flushSave()` — it flushes the 500ms autosave timer
  and awaits the PUT, so switching graphs never drops edits.
- New components:
  - `GraphSwitcher.tsx` — HUD popover (uses the unified portal `Popover`, so it
    edge-detects and isnt clipped) listing every graph with switch, double-
    click-to-rename, duplicate, and delete. A "+ 新建产线" button at the bottom.
  - `ConfirmDialog.tsx` — reusable backdrop modal (Escape to cancel, danger
    variant), the projects own component instead of `window.confirm`.
- App.tsx no longer hardcodes `GRAPH_ID = "seed"`. On mount it lists graphs and
  loads the most recently updated; switching flushes the old graph, resets the
  run store, loads the new one, and clears undo history. Deleting the current
  graph loads another, or creates a fresh one if none remain. Run dispatch now
  uses `graph.id`.
- `graphs.test.ts` covers create/list/delete and deep-copy isolation.

## Canvas polish folded in

- Timeline moved to the top of the stage; undo/redo grouped in the HUD next to
  the panel toggle.
- Same-column stacked plants now draw a straight vertical pipe down the center
  (`SAME_COLUMN_TOLERANCE = 4` in geometry.ts), with a downward flow arrow,
  instead of a dogleg overlapping the node bodies.
- Delete/Backspace removes the selected plant (previously only pipes), with an
  undo toast.

## Templates & image input (roadmap 2.4, partial)

- `packages/core/src/templates.ts` (new) — `GraphTemplate`, `TEMPLATES`,
  `getTemplate`, `instantiateTemplate()` (replaces every node/edge id with fresh
  short ids so instances never collide). Ships `tpl-product` (商品详情页:
  原料台→卖点提炼→文案撰写→排版整理→质检站→成品库 with a copy rework loop) and
  `tpl-blank`. Covered by `templates.test.ts` (core now 26 tests).
- Server: `GET /api/templates` lists id/name/description/category;
  `POST /api/graphs` accepts `{ template }` to instantiate (alongside existing
  `from` duplicate and blank create).
- Web: new-graph is now a template picker (`NewGraphDialog.tsx`) opened from the
  graph switcher; `api.createGraph` takes `{ name?, from?, template? }`.
- **Image input (text→text with vision):** `SourceConfig.images: string[]`.
  The engine resolves images reachable from a node via flow edges (memoized,
  diamonds dedupe) and passes them as `Worker.runAgent({ images })`. The
  OpenAI-compatible worker sends them as multimodal `image_url` content parts.
  Inspector edits the source URL list. This covers product detail pages where
  the model looks at reference photos and writes copy. `engine.test.ts` asserts
  source images reach the downstream agent (server now 36 tests).
- **Still text-only output.** Image/video/audio *generation* (non-text output
  modalities) remains Phase 4; the worker still throws UNSUPPORTED when running
  a model whose modality isn't text. Video is currently handled only as a URL or
  text description in the raw material, not as decoded frames.

## Parallel branches (roadmap 2.1)

- **core/compile.ts**: `Plan` now carries `levels[][]` (longest-path topological
  rank over flow edges; `computeLevels()`). Nodes in the same level have no flow
  dependency on each other. `order[]` is kept for rework-body rank calculations.
- **engine.ts rewrite**: the linear cursor is replaced by a concurrent dataflow
  scheduler shared by `execute()` and `resume()`. A plant starts the moment all
  its flow predecessors are `done`; independent plants run in parallel bounded
  by `MAX_CONCURRENCY=6`. Key mechanics:
  - Single `EventQueue` + synchronous `emit()` assigns monotonically increasing
    `seq`, so events from concurrent plants never race or reorder.
  - Cost accounting (`totalCostUsd`, per-node `nodeCostUsd`, both budget checks)
    runs in one synchronous block at node completion — no budget race.
  - Barrier: a multi-input node waits until every flow predecessor is `done`;
    `inputFor()` concatenates all upstream artifacts.
  - Rework resets the loop body to `pending` (clearing their artifacts) so they
    re-weld; reworkNotes still feeds the rejection reason to the entry.
  - **Failure isolation**: a node failing (e.g. BUDGET) only blocks its own
    downstream; unrelated branches keep running. The whole run is marked
    `failed` at the end because a node failed, but other work completes. The
    whole-line budget and external abort still trip the entire run.
  - Resume seeds `states` from reconstructed artifacts and pre-approves the
    halted gate, then runs the same scheduler downstream.
  - `runScheduler` is async and returns the queue generator; `execute`/`resume`
    yield from it. External abort flips the run to `cancelled` via a signal
    listener.
- Tests: `engine.parallel.test.ts` (3 tests) verifies level grouping, A+B run
  concurrently (maxConcurrent≥2), JOIN sees both inputs at the barrier, and an
  over-budget node A does not stop branch B. All 39 server + 26 core tests pass.
- Web needed no change: `PacketLayer` keys trucks by `edgeId:seq`, so concurrent
  `packet.sent` events on different edges already animate as multiple trucks.
- Remaining 2.1 item: context-window strategy (input truncation / rolling
  summary) for long lines and large parallel merges.
