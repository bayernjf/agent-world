# Handoff

State of Agent World as of 2026-08-27.

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
  the shared `computeCost()`, so per-image/second/character pricing is wired —
  image generation already reports `units` (see Stage D / imageGen below) and is
  metered per image (commit `2f0e3a3` reads `provider.pricing` instead of `0`).
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

> **Status refresh (2026-08-27):** the three items below that earlier read as
> "not done" are in fact shipped — image generation and tool execution are wired
> end-to-end, and image billing now meters per-image cost. See the bullets
> marked ✅ for what changed.

- **✅ Cost now lights up for both tokens and images.** Token counts were always
  correct (in/out/cached/reasoning). Agnes is configured at GPT-equivalent rates
  in `agent-world.config.json` (gitignored). Image generation now meters
  `perImage` cost (commit `2f0e3a3`: `openai-compatible.ts` reads
  `provider.pricing` instead of `0`). Verify both token and image cost show `> 0`
  in a real run; a model with **no** `pricing` entry still bills as $0.
- **✅ Image generation is wired end-to-end** (no longer a gap). `worker.generateImage`
  (`openai-compatible.ts`) → engine dispatch at `engine.ts:750` → binary artifacts
  saved in `run.ts` → rendered in frontend Inspector / FinishedProduct /
  ProductGallery. Covered by `imagegen.test.ts`.
  - *Design nuance:* an `imageGen` node generates only when its upstream source has
    **no** images (`engine.ts:743` skips generation if the source already has
    photos). It is **text→image banner generation, not image-to-image editing**.
  - *Silent-degrade trap:* a failed generation degrades to `done` with zero usage
    (`engine.ts:779`), so "run finished" ≠ "image produced" — always check the
    artifact actually appeared and cost `> 0`.
- **✅ Tool calls execute.** `runWithTools` + the engine consume `tool-call` chunks
  and emit `tool.called` / `tool.result` into the event stream (Phase 2; the
  dangerous-tool halt is in E.4). Not a gap.
- **Dispatch input is wired.** `POST /api/runs` accepts `input`; the source node
  emits it as raw material, and the control panel has a "原料" textarea. If empty,
  it falls back to the old placeholder.
- **Rework reason is fed back to the forge.** On rejection, the critic's `reason`
  is noted on the rework entry node and appended to that node's next input as
  `[质检站退回原因] ...`, then cleared once consumed. Verified end-to-end: a
  rejected first draft added the required content on attempt 2 and passed.
- **tsx watch restarts can race on port 8791** (EADDRINUSE) when edits land in
  quick succession. `busy_timeout` was added; if it sticks, `lsof -ti :8791 |
  xargs kill -9` and restart.

### Tracked for later (see docs/technical-design.md §12)

- DB migrations are versioned via `schema_migrations` + ordered `MIGRATIONS`
  (done in 3.5); SQLite startup backup (`VACUUM INTO`) also done in 3.5.
- Event endpoint returns all events; range pagination added in 3.5
  (`GET /api/runs/:id/events?after=&limit=`).
- Graph autosave is last-write-wins with a version/`If-Match` optimistic lock
  (done in 3.5) — multi-tab safe now.
- CORS is restricted to `CORS_ORIGINS` (done in 4.9); allow-all `*` only when the
  env var is unset (local dev). Set it before any hosted/private deployment.
- Structured logging with runId is done (3.5 `logger.ts`, `LOG_LEVEL`/`LOG_FILE`).
- **Phase 2 parallelism hazard:** event emission must be serialized (single
  emit queue), and budget checks must happen at that serialization point, or
  concurrent nodes race past the budget. (The `inputFor` context-window strategy
  is addressed by E.1 rolling summary — `inputPolicy.mode = "summary"`.)

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
pnpm -r test        # 54 core + 209 server, all green
pnpm -r typecheck   # all green
pnpm -r build       # core + server + web all build
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
- **Output modalities.** Image *generation* is wired end-to-end: an `imageGen`
  node calls `worker.generateImage`, persists the bytes as an `image` artifact, and
  folds the URI into downstream vision inputs (see Stage D below). Video/audio
  *generation* remains Phase 4 — `runAgent` still throws `UNSUPPORTED` for those
  modalities, and video is only handled as a URL/text description in raw material,
  not decoded frames.

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

## Skill cards & tool execution (roadmap 2.2, partial)

- **core**: `agent.skills` migrated from `string[]` to `SkillMount[]` via a zod
  transform that accepts old string arrays (backward compatible). New event
  types `tool.called` and `tool.result` in events.ts; runtime reducer tracks
  `NodeRuntime.toolCalls: ToolCallRecord[]` for replay/inspector.
- **server/skills/registry.ts** (new): built-in catalog — `web_fetch` (HTTPS
  only, HTML stripped, 8k char cap; requires network permission), `json_extract`
  (dot/bracket path extraction), `current_time`. Each declares permissions
  honestly. `resolveTools()` maps enabled mounts to model-facing tool
  definitions; `executeBuiltinTool()` runs them.
- **Worker interface**: added `ToolDefinition`, `ToolExecutor`, and optional
  `tools`/`executeTool` params to `runAgent`. Agent chunks now carry structured
  `arguments` (unknown) and `name` on tool-result.
- **OpenAI-compatible worker**: new `runWithTools()` implements the standard
  function-calling loop (non-streaming round trips, max 8 rounds). When the
  model returns `tool_calls`, the worker yields `tool-call`, invokes
  `executeTool`, yields `tool-result`, feeds the result back as a `role:tool`
  message, and repeats until the model produces text.
- **Engine**: resolves mounted skills to tool definitions per node, passes them
  with an `executeTool` callback to the worker, and forwards tool-call/
  tool-result chunks as audited events.
- **Web**: `SkillPicker.tsx` lists available skills with permission badges
  (网络/文件/子进程/环境变量) and toggle-to-equip. Inspector shows tool calls
  (name, args, result/error) in the node output area. `GET /api/skills` endpoint.
- Tests: `skills/registry.test.ts` (7 tests) and `engine.tools.test.ts`
  (end-to-end tool call + audit). Server now 47 tests, core 26.
- Remaining 2.2 items: prompt-module cards, output-contract cards, and
  halt-on-dangerous-action (deferred until write-capable tools exist).

## Input policy / context window (roadmap 2.1 remaining)

- `AgentConfig.inputPolicy` (core/graph.ts): `{ mode: "all" | "last" | "truncate", maxChars? }`,
  defaulting to `all` (backward compatible). `all` concatenates every upstream
  artifact; `last` takes only the most recent (useful for long sequential
  pipelines); `truncate` caps to `maxChars` keeping the tail with a
  "...[前 N 字符已截断]..." marker.
- Engine `assembleInput()` helper used by `inputFor()` in the scheduler; the
  rework rejection note is still appended after assembly.
- Web Inspector gets an "输入策略" select plus a "最大字符数" input when
  truncate is chosen. New nodes default to `all`.
- Test: `engine.inputpolicy.test.ts` verifies truncation caps length with the
  marker and that `all` passes input through unchanged. Server now 49 tests.
- Deferred: true rolling summaries (LLM-based compaction) — truncation is the
  cheap guard; a summarizer skill/agent can come later.

## More templates (roadmap 2.4)

- Added `tpl-draft` (写草稿: 主题→初稿→润色→质检→成稿), `tpl-translation`
  (翻译流水线: 原文→初译→校对→质检→译文), `tpl-doc-review` (文档审查:
  待审文档→问题清单→修订建议→质检→审查报告). All have rework loops.
- Catalog now ships 4 practical templates plus blank; core test asserts every
  non-blank template compiles to an executable plan. Core now 27 tests.
- Remaining 2.4 item: template preview thumbnails.

## Run history (roadmap 3.1, partial)

- Server `db.ts`: `listRuns` now LEFT JOINs `graphs` and returns `graph_name`
  (falls back to "(已删除产线)" when the graph was deleted). Added
  `deleteRun`/`deleteEvents`/`deleteNodeRuns` prepared statements plus a
  transactional `db.deleteRun(runId)` helper that wipes events, node_runs, and
  the run row together.
- Server `index.ts`: `DELETE /api/runs/:id` — 404 if missing, 409 if the run is
  still live (must cancel first), otherwise removes the live map entry and all
  persisted rows.
- Web `lib/api.ts`: `RunSummary` interface, `listRuns(limit, offset)`,
  `deleteRun(id)`.
- Web `store/run.ts`: `loadRun(runId)` disconnects any SSE, fetches the event
  log + folded state via `getEvents`, and seeds the store so the canvas and
  Timeline render a finished run without opening a stream.
- Web `components/RunHistory.tsx` (new): modal table of runs (graph, status
  badge, trigger, start time, duration), double-click or "回放" to load graph +
  replay, delete with custom ConfirmDialog. Escape closes; refresh button.
- Wired into `App.tsx` as a "历史" chip in the HUD next to ShortcutsHelp.
- Status badges follow design tokens (ok/alert/power/data); table uses
  `--steel-*`, `--mono`, `--hair`.
- Tests still green: core 27, server 49. Typecheck clean.
- Remaining 3.1: pagination UI + server-side filtering (by graph/status),
  run-to-run comparison, and a "return to live / clear replay" affordance.

## Cost report (roadmap 3.2, mostly done)

- Server `db.costReport({ from?, to? })` aggregates the `node_runs` projection
  (joined with `runs`, excluding still-running runs) into five buckets:
  `totals`, `byGraph` (LEFT JOIN graphs for name), `byNode` (Top 50 by cost with
  attempt/rework counts), `byAttempt` (attempt 1 = first try, >1 = rework), and
  `byDay` (daily via `date(started_at/1000,'unixepoch','localtime')`). All
  numbers come from persisted `cost_usd`/`tokens_*` columns — no event replay.
- `GET /api/costs?from=&to=` (ms timestamps) exposes it.
- Web `lib/api.ts`: `CostReport` interface + `api.costReport(from,to)`.
- Web `components/CostReport.tsx` (new): modal launched from HUD "成本" chip.
  Range toggle (7d/30d/all), six stat cards (总电费/运行/输入/输出/缓存/返工电费),
  daily cost bar chart (inline SVG-free divs, power gradient), per-plant table,
  Top-N plant table. Modal uses `.modal--wide`, all tokens, `.num` right-align.
- Tests: `costs.test.ts` covers aggregation math, time filtering, and running-run
  exclusion. Server now 51 tests, core 27. Typecheck clean.
- Remaining 3.2: CSV export, weekly/monthly rollups, resolve node labels from
  the graph snapshot instead of showing raw `node_id`.

## SSE reconnect hardening (roadmap 3.3)

- `apps/web/src/store/run.ts`: introduced `connection` state machine
  (`idle|connecting|live|reconnecting`) with derived `connecting`/`reconnecting`
  booleans. Initial connect shows "连接中…", a backoff reconnect shows
  "重连中…" (ControlPanel). Reconnect now reads the last seq from the live
  store inside the setTimeout callback, fixing a stale-closure bug that could
  re-fetch events delivered just before the drop. `resumeRun` now closes any
  existing stream before reopening (previously two EventSources could fold the
  same events twice after halt→resume).
- `packages/server/src/index.ts`: `/api/runs/:id/stream` honors the native
  `Last-Event-ID` request header in addition to `?after=`; query param takes
  precedence. The browser sends `Last-Event-ID` automatically because every
  frame carries `id:`. Heartbeat (`: ping` every 15s) unchanged.
- Tests still green: core 27, server 51; typecheck clean.
- Remaining: a real-world kill-switch/network-drop test against a proxy is the
  only unchecked item; the logic itself is covered by inspection.

## Structured failure panel (roadmap 3.4)

- Core `runtime.ts`: added append-only `failures: FailureRecord[]` to
  `RuntimeState`. `node.failed` records `kind:"node"` (nodeId, attempt,
  errorCode, error, seq, ts); `gate.exhausted` with policy `scrap` records
  `kind:"gate"`; `power.tripped` records `kind:"budget"`. `run.started` resets
  the list (fresh run). Core now 29 tests.
- Engine `resume()` gained `resetFrom?: string`. When set, the node and every
  flow-descendant have their artifacts/attempts/nodeCost deleted from the
  reconstructed state, so the scheduler re-runs them while keeping upstream
  artifacts. This powers "重试该节点" (resetFrom = failed node) and "返工到上游"
  (resetFrom = chosen upstream node).
- Bug fix: `runScheduler` now only emits `run.started` when `opts.resuming` is
  false. Previously resume/retry re-emitted `run.started`, which reset the
  client's folded runtime (wiping failure history and accumulated cost) even
  though only new events were being appended.
- Server: `/api/runs/:id/resume` accepts `resetFrom`; retries from failed/
  tripped runs flip the row back to `running` via new `db.markRunning()`.
- Web `FailurePanel.tsx` (new): docks top-center of the stage when
  `runtime.status` is `failed`/`tripped`. Lists each failure with node name,
  localized error-code badge, attempt, timestamp, message, and stranded-
  downstream count. Per-failure actions: "重试该节点" and a "返工到上游" popover
  listing upstream done nodes. Footer: "整条重跑" (re-runs with same raw
  material via `onRun`) and close/ignore. Uses design tokens; error badges
  timeout/rate-limit show power (retryable), others alert.
- Tests: added core reducer tests for failure history and a server test
  (`engine.reliability.test.ts`) covering resetFrom retry of a failed node
  through to depot, asserting failures are preserved after a successful retry.
  Server now 52 tests. Typecheck clean.

## Run history / cost report wrap-up (roadmap 3.1–3.2)

- "退出回放" affordance: `store/run.ts` gained `view: "live" | "replay"`.
  `loadRun()` (history replay) sets `view:"replay"`; connect/disconnect/resume
  reset it to `"live"`. Timeline shows a "退出回放" chip in replay mode that
  calls `reset()`, so viewing a finished run no longer leaves the canvas stuck
  on historical state with no way back.
- Cost report node names: `db.costReport()` now resolves each node's display
  name from the most recent run snapshot per graph (`node_name`), so renamed or
  deleted graphs still show the plant name as it was when it ran. Falls back to
  `node_id`.
- CSV export: `GET /api/costs.csv?from=&to=` streams a flat CSV with graph /
  node / day sections (RFC-4180 quoting). CostReport modal header has an
  "导出 CSV" link scoped to the selected range.

## Ordered schema migrations (roadmap 3.5)

- Replaced the try/catch ADD COLUMN routine in `db.ts` with a versioned
  `schema_migrations(version, applied_at)` table + ordered `MIGRATIONS` array
  (versions 1–7, one per added column). Each migration runs once inside a
  `BEGIN/COMMIT` and is recorded; `node:sqlite` DatabaseSync has no
  `.transaction()` helper, so it's manual.
- One-time baselining: when the table is empty (an older DB from before this
  change, or a fresh DB whose DDL already includes every column), each
  migration's `detect()` checks `PRAGMA table_info`; already-present columns are
  recorded as applied without ALTER. New migrations should omit `detect` so
  they always run. `SCHEMA_VERSION` is exported for diagnostics/backups.
- Fresh DBs baseline straight to v7; old Phase-0/1 DBs get only the missing
  columns. Reopening is idempotent.
- Tests: `migrations.test.ts` (fresh baseline, old-schema upgrade, reopen
  no-op). Server now 54 tests, core 29. Typecheck clean.
- Remaining 3.5: startup backup (VACUUM INTO), events pagination, multi-tab
  optimistic lock, structured logger.

## Budget warning at 80% (roadmap 3.6, partial)

- New `power.warning` event (core/events.ts) with `{ totalCostUsd, budgetUsd, threshold }`.
- Engine emits it once per run when accumulated cost crosses 80% of `budgetUsd`
  (a `budgetWarned` flag, seeded from reconstructed state on resume so a resumed
  run doesn't re-fire). It does NOT stop the line; 100% still trips via
  `power.tripped`.
- Reducer sets `RuntimeState.budgetWarned` (reset on `run.started`); initial
  runtime defaults it to false.
- ControlPanel: gauge turns amber (`is-warn`, power gradient) and shows a
  "电费已达预算的 N%" note when warned; >85% stays red `is-hot`.
- Tests: core reducer (warning sets flag + cost) and an engine test (fixed-cost
  worker at 0.0008 under a 0.001 budget emits power.warning, completes without
  tripping). Core now 30, server 55.
- Remaining 3.6: monthly budget aggregation.

## 3.8 Artifact layering (partial — core + engine + UI)

- New `packages/core/src/artifact.ts`: Artifact zod schema (text/image/video/audio/file/json/uri),
  `artifactLabel()`, `ARTIFACT_COLORS`, and `extractArtifacts()` that scans output text for
  markdown images, bare media URLs (png/jpg/mp4/mp3 etc.), and fenced JSON blocks.
- New `artifact.produced` event carries `{ nodeId, attempt?, artifact }`. Runtime state gains
  `NodeRuntime.artifacts: Artifact[]`.
- `packet.sent` gains optional `artifactKind` so trucks can colour-code by freight type.
- Engine: after each node finishes, calls `produceArtifacts()` to extract and emit typed
  artifacts. Source reference images emit image artifacts directly. Packets carry the
  primary artifact kind.
- Frontend: PacketLayer trucks use `ARTIFACT_COLORS[artifactKind]`; Inspector shows an
  "产出物" section with image thumbnails, video, audio player, links, and JSON previews.
- Tests: core artifact extraction (8 cases), runtime reducer for artifact.produced and
  packet.artifactKind, engine end-to-end test verifying image URL extraction and packet
  colour metadata. Core now 42, server 56.
- Remaining: file/blob storage (currently URI passthrough), ArtifactRef upgrade of engine
  artifacts Map, cross-run artifact queries.

## 3.5 Startup database backup (VACUUM INTO)

- `openDb()` now snapshots the live database with `VACUUM INTO` before any DDL/migrations
  run. Snapshots land in `backups/pre-migration-<ISO timestamp>.db` next to the DB file and
  are pruned to the newest `BACKUP_RETENTION` (5) copies.
- Backup runs right after `new DatabaseSync(file)` and before the WAL pragma so a brand-new
  file (size 0) is skipped; only databases that already contain data are snapshotted. Any
  backup error is swallowed so it can never block startup.
- The `Db` wrapper now exposes `close()`. `backups/` is gitignored.
- Tests in `migrations.test.ts`: snapshot is openable and contains the events table;
  reopening beyond the retention window prunes to <=5 files. Server now 58 tests.
- Remaining 3.5: events pagination, multi-tab optimistic lock, structured logger.

## 3.5 Events API pagination

- `db.eventsRange(runId, after, limit)` returns a bounded window using
  `WHERE run_id=? AND seq > ? ORDER BY seq LIMIT ?` (fetches limit+1 to detect hasMore),
  with `nextCursor` (last returned seq) or null when the run is exhausted.
- `GET /api/runs/:id/events` with no query returns the full history + replayed state
  (unchanged contract for initial page load). With `?after=&limit=` it returns
  `{ events, after, nextCursor, hasMore }`; limit is clamped to 1..10000. SSE resume
  already used its own `?after=` cursor and is untouched.
- Tests in `events.test.ts`: full read, two-page walk with cursor advancement, terminal
  null cursor. Server now 60 tests.
- Remaining 3.5: multi-tab optimistic lock (graph version + If-Match), structured logger.

## 3.5 Multi-tab optimistic lock

- Added `graphs.version` (migration 8; fresh DDL defaults to 1). `saveGraph(graph, at, expectedVersion?)`
  does a conditional `UPDATE ... WHERE id=? AND version=?` and increments on success; a zero-changes
  result returns `{ ok:false, conflict:true, serverVersion }` instead of overwriting.
- `GET /api/graphs/:id` and list responses now carry `version`; `PUT` honors the `If-Match` header
  and returns `409` with a Chinese conflict message + `serverVersion` on mismatch. `POST /api/graphs`
  returns the created graph with its version and no longer leaks the source graph's version into
  duplicated documents.
- Frontend: `serverVersion` tracked in the graph store; `setGraph` strips the server-injected
  `version` from the editable document. Autosave/flush send `If-Match` and advance version on success.
  On 409 the Inspector shows an amber conflict banner with a "重新载入" button (`reloadGraph`).
- Tests in `graphs.test.ts`: version increments per save, stale conditional save is rejected and the
  newer document is preserved. Server now 62 tests.
- Remaining 3.5: structured logger (pino or equivalent with runId + rotation).

## 3.5 Structured logger (completes 3.5)

- New `packages/server/src/logger.ts`: dependency-free JSON-line logger. Each line is
  `{ ts, level, msg, ...bindings }`. Supports `LOG_LEVEL` (debug/info/warn/error, default
  info) and `LOG_FILE` for durable output with size-based rotation (5 MB, keep 3). `child()`
  produces a bound logger for per-run context (runId, graphId).
- Wired into run start/resume/crash paths and the routing worker (disabled/anthropic
  fallbacks); replaced ad-hoc `console.*` calls. Startup now logs `engine listening`.
- Tests in `logger.test.ts`: JSON shape + bindings, level filtering, file rotation. Server
  now 65 tests. 3.5 is fully complete (migrations, startup backup, events pagination,
  optimistic lock, structured logger).

## 3.6 Monthly budget (completes 3.6)

- Config gains `monthlyBudgetUsd` (nullable soft cap), editable in 设置 → 月度预算.
- New `db.costForMonth(year, month)` sums `node_runs.cost_usd` for finished runs that
  started in the local-time month (running runs excluded, so the current run's prior spend
  on resume isn't double counted — the engine reconstructs it via `totalCostUsd`).
- Engine accepts `monthlyBudgetUsd` + `monthSpentUsd` and emits advisory `power.warning`
  events with `scope: "monthly"` at 80% and 100% of (prior month spend + this run's cost).
  Monthly cap is advisory only — it never trips the line. The server passes the configured
  cap and current-month spend into both `execute` and `resume`.
- Runtime state gained `monthlyBudgetWarned`; the reducer keeps it separate from the per-run
  `budgetWarned` and doesn't let monthly totals overwrite the run cost gauge. ControlPanel
  shows a monthly warning note.
- Tests: core reducer monthly-vs-run separation (core 43), engine warns-but-does-not-trip,
  db.costForMonth by calendar month (server 67). 3.6 is complete.

## 3.7 Evaluation prototype (complete)

- New `db.evalReport({ graphId?, from?, to? })` aggregates finished runs into
  `{ runs, passed, passRate, avgRework, avgDurationMs }`, broken down `byGraph`,
  `byDay` (daily pass-rate trend), and `byPrompt`. "Passed" means run status `done`;
  failed/tripped/halted/cancelled count as not passed. Rework = sum of (node_attempts −
  distinct nodes) per run, averaged. Duration = ended_at − started_at, averaged over
  ended runs.
- `byPrompt` groups runs by a sha1 fingerprint of every agent node's (model + prompt)
  captured in the run snapshot, and assigns stable per-graph labels v1/v2/… in first-seen
  order. This gives before/after comparison when a prompt is edited — the exit condition
  for 3.7. Uses a bounded `evalSnapshots` prepared query (latest 1000 runs).
- New `GET /api/eval?graphId=&from=&to=` endpoint.
- Frontend: `EvalReport` modal (toolbar 评估 chip, filtered to the current graph's id)
  reusing cost-report styling, with pass-rate color tones (ok/warn/alert) on the stat
  cards, daily trend bars, per-line table, and a prompt-version comparison table.
- Tests in `costs.test.ts`: pass rate/rework/duration aggregation, graph filter, prompt
  version grouping with distinct fingerprints. Server now 70 tests; core 43.
- Remaining for later: per-node quality scoring (needs explicit quality signals beyond
  pass/fail), and CSV export of eval data.

## 3.8 Artifact persistence (local blob store + metadata)

- New `packages/server/src/artifact-store.ts`: `ArtifactStore` writes inline content
  (text/json) to `<dir>/<shard>/<runId>/<artifactId>` (deterministic path, no extension;
  MIME lives in DB). Remote/http/data URIs are passed through as `storage:'uri'` — the
  server never fetches arbitrary URLs. Default dir is `artifacts/` next to the DB file,
  overridable via `ARTIFACT_DIR`.
- New `artifacts` table (migration 9; DDL creates it fresh) stores id/run/node/attempt/kind/
  mime/label/size/storage/uri/created_at, with run + node indexes. `db.insertArtifact` is
  idempotent (ON CONFLICT DO NOTHING); `listArtifactsForRun`, `getArtifact`, `listArtifacts`
  (latest-first, paged) query it; `deleteRun` now also removes artifact rows.
- The run-start and resume drain loops call `artifacts.save(...)` + `db.insertArtifact(...)`
  on every `artifact.produced` event, so artifacts outlive the event stream and are queryable
  across runs.
- New endpoints: `GET /api/runs/:id/artifacts`, `GET /api/artifacts?limit=&offset=`, and
  `GET /api/artifacts/:id` (streams local blobs with content-type/disposition, 302-redirects
  for remote URIs).
- Tests: `artifact-store.test.ts` (local write/read, URI passthrough, inline placeholder) and
  `artifacts.test.ts` (per-run/cross-run listing, delete cleanup, idempotent insert). Server
  now 77 tests. `artifacts/` gitignored.
- Remaining 3.8: upgrade the engine's per-node `artifacts: Map<string,string>` to an ArtifactRef
  (currently it still stores text output per node; artifacts ride alongside as events), and a
  frontend cross-run product gallery consuming `GET /api/artifacts`.

## 3.8 Cross-run product gallery (UI)

- New `ProductGallery` modal (toolbar 成品 chip) consumes `GET /api/artifacts` with
  paged loading (60/page, 加载更多) and kind filter chips (全部/图片/视频/音频/文本/数据/文件/链接).
- Cards render inline image thumbnails (link to original), <video>/<audio> players for media,
  and a generic "打开 ↗" tile for text/json/file/uri. Local artifacts resolve through
  `/api/artifacts/:id`; remote/data URIs load directly. Each card shows label, creation time
  and size. Reuses design tokens (steel/power/ink/mono) and the `.seg` segmented control.
- `api.listArtifacts(limit, offset)` and `api.listRunArtifacts(runId)` added alongside the
  `StoredArtifact` interface.
- Remaining 3.8: upgrade the engine's per-node `artifacts: Map<string,string>` to an
  ArtifactRef so downstream nodes can reference typed artifacts directly (instead of text
  output + event-sidecar); object-store (S3/R2) backend behind the same ArtifactStore
  interface for multi-instance deployments.

## Product content lines — Stage A (upload) + Stage B (platform templates)

See `docs/product-content-roadmap.md` for the A–D plan (Taobao/Xiaohongshu 图文).

Stage A — real product images:
- `ArtifactStore.saveBinary()` persists raw uploaded bytes under `artifacts/uploads/<id>`
  (content-addressed id), returning a local `/api/artifacts/:id` URI.
- `POST /api/artifacts/upload` accepts a raw body with content-type, enforces 25MB, stores
  via saveBinary + insertArtifact. Cross-run list now orders by `created_at DESC, rowid DESC`
  as a deterministic tiebreaker.
- Source node UI extracted into `SourceImages.tsx`: click/drag-drop upload zone, thumbnails
  for local+remote images, plus the manual URL field (edit-batched into one undo entry).

Stage B — structured product blocks:
- New core `product.ts`: `ProductBlock` discriminated union (hero/heading/paragraph/quote/
  bullets/specs/image/imageCards/cta/divider) + `ProductDocument` + `parseProductDocument()`
  which extracts a fenced ```product-json block and zod-validates it. Core now 46 tests.
- Templates: existing product template renamed 淘宝商品详情 and its layout agent now emits a
  structured product-json document; new 小红书种草笔记 template (selling → copy → note layout
  → QC, emoji/短句/话题标签 tone). Both reuse the same pipeline and QC/rework loop.
- `FinishedProduct` detects a product document and renders it with `ProductBlocks.tsx`
  (platform-scoped CSS using design tokens); falls back to Markdown otherwise.
- Source brief fields done: SourceConfig now has productName/brand/audience/priceRange/tone/
  prohibited/notes; the engine buildSourceBrief assembles them into a creative brief that
  flows to every downstream writer. When no brief fields are set, raw input passes through
  unchanged (preserves existing test contracts). Inspector renders all fields.
  Server now 79 tests.
- Stage C — export to be production-ready:
  - `lib/product-html.ts` (new): `productDocumentToHtml()` / `markdownToStandaloneHtml()`
    render the finished product as a self-contained inline-styled HTML document; `productToHtml()`
    picks structured vs Markdown. `productToLongImage()` inlines every `<img>` as a data URL and
    renders the content to a 2x long PNG via an SVG `<foreignObject>` (canvas stays untainted).
  - `FinishedProduct` toolbar now offers 导出 HTML / 导出 MD / 导出长图 / 复制富文本 / 复制原文,
    so output can be pasted straight into QIANIU / Xiaohongshu backends.
- Stage D — AI image generation (缺素材时自动出 banner/场景图):
  - New `imageGen` node kind + `ImageGenConfig { model, prompt, size }` in `@agent-world/core`.
  - Worker/provider gained `generateImage()`: OpenAI-compatible providers POST
    `${baseUrl}/images/generations`; the fake worker returns a deterministic placeholder so the
    canvas wiring works without a live image backend.
  - Engine dispatches `imageGen` nodes: calls `worker.generateImage`, persists the bytes via
    `storeBinary` (→ `/api/artifacts/:id`), emits an `image` artifact, and folds the URI into the
    downstream vision model's `images` via the shared `extraImages` resolver. Generation is
    **soft-failed** (run continues) when no image backend is configured, and **skipped entirely**
    when the upstream source already carries real photos (`upstreamSourceHasImages`).
  - Both product templates gained a `banner` (AI 配图) node: `intake → banner → layout`.
  - Web UI: `imageGen` label/meta in the canvas, an Inspector section (model / size / prompt),
    a palette button, and a node bar color.
  - Still deferred (roadmap D-expansion, not in scope here): brand thesaurus / prohibited-word
    validation wiring, multi-version A/B, and evaluation linkage. Engine ArtifactRef upgrade
    remains deferred until multimodal downstream inputs are needed.

## Phase 4 — multimodal, human-in-the-loop, plugin security, MCP, engineering

### 4.5 Multimodal content parts
- `packages/core/src/multimodal.ts` (new): `ContentPart` union
  `{type:"text",text} | {type:"image",image}`, exported from the core index.
- `packages/server/src/worker.ts`: `runAgent` gains optional `content?: ContentPart[]`;
  the fake and routing workers accept it while still preserving `input`/`images`.
- `packages/server/src/engine.ts`: assembles `content` from `input` + upstream source
  `images` before calling the worker, and passes `content` to `runAgent`.
- `packages/server/src/providers/openai-compatible.ts`: `buildUserContent` maps image
  parts to `{type:"image_url"}`; `runAgent` prefers `content`, falling back to
  `input + images`.
- Web canvas `Plants.tsx` + `styles.css`: a source node carrying image raw material
  shows a blue "图 N" badge + tooltip.
- Tests: `engine.multimodal.test.ts`.

### 4.7 Human-in-the-loop
- `core/events.ts`: `gate.verdict` gained optional `decision: approved|rejected|edited`
  and `by`; `run.finished` gained optional `haltedNodeId`/`reason`.
- `core/runtime.ts`: `RuntimeState.haltedNodeId?`; the `run.finished` case sets it.
- `server/engine.ts`: halt locals (`haltNodeId`/`haltReason`); on a gate-exhausted
  `halt` it fires `notifyHalt`; `run.finished` carries `haltedNodeId`/`reason`.
  `ResumeOptions.action` extended to `"continue"|"approve"|"reject"|"edit"|"scrap"`
  with `editOutput?: Record<string,string>`; resume applies the `editOutput` overlay
  and emits `gate.verdict` with `decision`/`by`; `runScheduler` forwards `editOutput`.
- `server/notify.ts` (new): `notifyHalt(n)` POSTs to `RUN_HALT_WEBHOOK` (no-op if unset;
  failures tolerated).
- `server/index.ts`: `/api/runs/:id/resume` accepts `action` (approve/reject/edit/scrap)
  + `editOutput` and forwards to `resume`. Added `disposeIsolatedWorkers()` and
  SIGINT/SIGTERM cleanup.
- Web `ControlPanel.tsx`: halted runs show 批准继续 / 编辑后继续 / 驳回 / 报废 buttons
  (edit opens a prompt); `api.ts` & `store/run.ts` `resumeRun` extended; `styles.css`
  gained `.btn--warn` / `.btn-row--wrap`.
- Tests: `engine.humanloop.test.ts`, `notify.test.ts`.

### 4C.7 Plugin process isolation
- `server/isolation.ts` (new): `trimEnv(declared)` (safe base + declared keys),
  `spawnIsolatedWorker(entry,id,declaredEnv)` (forks `worker-proxy.mjs`),
  `IsolatedWorker` (implements `Worker`, proxies `runAgent`/`judge`/`generateImage`
  over IPC, `dispose()`), `disposeIsolatedWorkers()`. `proxyFetch`/`proxyFs` enforce
  the 4D.7 allowlists.
- `server/worker-proxy.mjs` (new): child entry; overrides `globalThis.fetch` (network
  proxy via the parent allowlist) and exposes a `globalThis.__proxyFs` shim (fs proxy —
  the ESM `node:fs/promises` namespace is read-only, so a cooperative shim is used;
  full per-call interception would need a custom ESM loader).
- `server/worker-plugins.ts`: `WorkerPlugin` gained `isolation?:"in-process"|"subprocess"`,
  `env?:string[]`, `entry?:string`. `loadFrom` forks `.js`/`.mjs` subprocess plugins;
  `.ts` and failures fall back to in-process. `loadWorkerPlugins` records `entry`.
- `server/scripts/sample-worker-plugin.mjs` (new): sample subprocess plugin proving
  env trimming + fs/network proxy.
- `server/permissions.ts`: `matchDomain` now strips the port (`host.split(":")[0]`)
  so `127.0.0.1:PORT` matches `127.0.0.1`.
- Tests: `isolation.test.ts`.

### 4D.7 MCP remote transports + tool permission governance
- `server/mcp.ts`: `McpServerSpec` with `transport: "stdio"|"http"|"sse"`;
  `StdioMcpTransport`, `StreamableHttpMcpTransport`, `SseMcpTransport` (each implements
  connect/disconnect/listTools/callTool). `registerMcpTools(id, client, registerSkill,
  permissions?)` wires each call through `guardToolCall`. `connectMcpServers()` parses
  `MCP_SERVERS` (legacy `{id,command,args}` or rich
  `{id,transport,command?,args?,url?,headers?,permissions?}`).
- `server/permissions.ts`: `evaluateToolCall(permissionConfig, serverId, tool)`,
  `guardToolCall(...)`, `loadPermissionConfig()` (from `MCP_PERMISSIONS`), `matchDomain`.
- `server/engine.ts`: the `executeTool` closure passed to workers calls `guardToolCall`,
  so blocked tools throw `ToolPermissionDenied` before execution.
- `server/index.ts`: `connectMcpServers()` runs at startup, passing per-server
  `permissions` into `registerMcpTools`.
- Tests: `mcp.test.ts` (stdio + http + sse e2e), `permissions.test.ts`.

### 4.9 Engineering (CI, secret scan, Docker, LICENSE, CORS, version)
- `server/security.ts` (new): `applyCors(app, process.env.CORS_ORIGINS)` (allow-list
  from env; allow-all `*` only when `CORS_ORIGINS` is unset — preserves local-dev
  behaviour) and `applySecurityHeaders` (X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy, Permissions-Policy). `index.ts` now calls these instead of
  `app.use("/*", cors())`.
- `LICENSE`: MIT (Copyright (c) 2026 bayernjf).
- `.github/workflows/ci.yml`: a `build` job runs `pnpm -r typecheck` + `pnpm -r build`
  + `pnpm -r --if-present test`; a separate `secrets` job runs gitleaks.
  `.gitleaks.toml` allow-lists test/sample fixtures.
- `Dockerfile` (multi-stage, Node 24, builds core + server, runs `node dist/index.js`)
  + `docker-compose.yml` (port 8791, SQLite volume, `CORS_ORIGINS`/`MCP_SERVERS`/env
  hooks) + `.dockerignore`.
- `CHANGELOG.md` (Keep-a-Changelog); package versions bumped `0.1.0 → 0.2.0`.
- Fixed two latent build blockers that only surfaced under `pnpm -r build` (tests run
  via esbuild and didn't catch them): `engine.ts` `ContentPart` literal widening,
  duplicate `tools` property, and missing `editOutput`/`permissionConfig` on the option
  types; `core/graph.ts` `HttpConnector.url` is now `.url()`-validated.
- Tests: `security.test.ts`.
- Roadmap 4.9 checkboxes ticked.

### Current status (end of Phase 4)
- All selected Phase 4 tracks — 4.5, 4.7, 4C.7, 4D.7, 4.9 — are complete. Only
  **4.8 (docs/community)** remains open.
- `pnpm -r typecheck` green; `pnpm -r build` green; `pnpm -r test` green
  (core 54, server 209).

### Remaining / deferred
- **4.8 docs/community** is the only open Phase 4 item (README quickstart, CONTRIBUTING,
  architecture diagram, badges).
- fs isolation uses a cooperative `__proxyFs` shim rather than a full ESM loader —
  the upgrade path is noted in roadmap 4C.7.
- `ArtifactRef` engine upgrade (per-node typed artifact references) stays deferred
  until multimodal downstream inputs are needed (Stage D).
- Per-node quality scoring and CSV export of eval data remain for later.

## Dangerous-action halt (E.4)

> 危险操作（写文件 / 外部网络 / 删除，即技能 `danger: true`）首次调用时暂停运行，等人 approve/deny 后再续跑。引擎在 `executeTool` 包裹层对“危险且未批准”的工具抛 `HaltRequested`，运行进入 `halted`，`run.finished` 携带 `reason: "dangerous-tool:<name>"` 与 `haltedNodeId`。

**关键文件**
- `packages/server/src/engine.ts`：`executeTool` 回调先 `guardToolCall`（白名单治理），再 `if (isDangerousTool(name) && !approved.has(name)) throw new HaltRequested(name, nodeId)`；catch 后 `haltReason = "dangerous-tool:" + toolName`、`status = "halted"`、节点故意不标完成，便于 resume 重跑。
- `resume()`：危险工具批准通过 `approveTools`（累积 `state.approvedTools` ∪ 本次）以 `tool.approved` 事件持久化，并作为 `init.approvedTools` 重新传入，节点重跑时该工具已在 `approved` 集合内而执行。`isToolHalt = (state.haltedReason ?? "").startsWith("dangerous-tool:")` 区分“危险工具暂停”与“Gate 耗尽暂停”：危险工具暂停**不**置 `approveGate`（否则会把 agent 节点直接标 done 跳过工具），靠 `approveTools` 续跑；Gate 暂停才走 `approveGate`。
- `packages/server/src/permissions.ts`：`isDangerousTool(name)` = `getSkill(name)?.danger === true`；`guardToolCall` 做 host/path 白名单治理。
- `packages/core/src/runtime.ts`：`RuntimeState` 新增 `reason?`，`run.finished` 时写入；前端用 `runtime.reason` 前缀 `dangerous-tool:` 识别危险操作暂停并展示文案。

**Resume 语义**
- `resume({ action: "approve", approveTools: ["fs_write"] })`：累积批准，节点重跑，危险工具因在批准集内而执行，运行跑完。
- `resume({ action: "approve" })`（不带 approveTools）：危险工具仍未被批准 → 再次 `HaltRequested` → 重新进入 `halted`（同一工具、同一 reason）。

**测试**
- `packages/server/src/engine.danger.test.ts`：危险工具未批准 → `halted` 且 `reason = "dangerous-tool:fs_write"`、文件未写；带 `approveTools` resume → 执行工具、写文件、`done`；不带 `approveTools` resume → 重新 `halted`、文件未写。注意测试隔离：test 4 写 `out-noapprove.txt`（而非 `out.txt`），避免被 test 3 的 `out.txt` 污染导致误判。

## Prompt 模块卡 / 输出契约卡 (E.2 / E.3)

> 装备(equip)的技能分三类已落地：`tool`（贡献工具）、`prompt-module`（注入 prompt）、`output-contract`（校验输出）。`Skill.kind` 在 `packages/core/src/skill.ts`，`SkillMount` 支持 per-mount `config` 覆盖。

**E.2 Prompt 模块卡**
- `collectPromptModules(mounts)`（`engine.ts`）：BFS 遍历挂载的 `prompt-module` 技能，合并 per-mount `config`，收集 `config.prompt`；支持 `config.equips`（多级依赖），用 `seen` 集合去重并耐受环。
- 注入点：`runNode` 的 agent 分支先算 `mounts`（`toMount` 归一化为 `SkillMount[]`），再把模块 prompt 追加到 `config.prompt`（标记 `=== 已挂载模块提示 (prompt-module) ===`），随 `runAgent` 进入 agent system prompt。
- 退出标准：单测 `engine.skills.test.ts` 验证「挂载即注入 / 多级 equip 去重 / 含环不死循环」。

**E.3 输出契约卡**
- `getOutputContract(mounts)`：找挂载的 `output-contract` 技能，取 `config.schema`（JSON schema）。
- `validateContract(output, schema)`：剥掉可选 ```` ```json ```` 围栏 → 必须解析为 JSON 对象 → 校验 `required` 字段 + 各 `properties` 的 `type`。返回中文失败原因或 null。
- 校验时机：agent 产出 `result.output` 后、标记 done 前。不达标时：若图里存在「从该 agent 节点出发的 rework 线」（`compile` 已放宽，允许 gate 之外的 **agent** 节点发起 rework），则复用现有 rework 机制——`reworkNotes.set(entry, 原因)` + 发 `packet.sent` 到 rework 边 + 把 loop body 复位为 pending 并重跑；达到 `loop.maxAttempts`（= `retry.maxRetries + 1`）仍不达标 → 节点 `failed`、`errorCode: "VALIDATION"`。
- `compile.ts`：`A rework line can only start from a gate or an agent node`；允许 `e.from === e.to` 仅当 `kind === "rework"`（agent 自返工）；`maxAttempts` 对 agent 取 `retry.maxRetries + 1`。
- 退出标准：单测 `engine.skills.test.ts` 验证「达标→done / 不达标 rework 后恢复→done / 始终不达标→failed + VALIDATION」。

**测试**
- `packages/server/src/engine.skills.test.ts`（5 用例）：E.2 注入 + 多级 equip 去重、E.3 三态。

## 滚动摘要 (E.1)

> 长产线里上游 artifact 累积，agent 输入会爆 token。原先 `inputPolicy.mode = "truncate"` 是硬截断（只留尾部 + 标记）。E.1 新增 `summary` 模式：超阈值时用 LLM 摘要压缩，而不是硬截断。

**输入策略（`packages/core/src/graph.ts` 的 `InputPolicy`）**
- `mode`: `"all" | "last" | "truncate" | "summary"`（新增 `summary`）
- `maxChars`: 摘要 / 截断预算（zod `.min(500)`，可选）

**引擎（`engine.ts`）**
- `inputFor` 改为 `async`：当 `policy.mode === "summary"` 且拼接后的输入 `full.length > maxChars` 时，调用 `worker.summarize({ text, maxChars, model, signal })` 压缩；否则按 `assembleInput` 处理。
- 失败兜底：`worker.summarize` 抛错、返回空、或根本不存在（可选方法）→ 回退 `truncateText(full, max)`（与 `truncate` 模式同一实现）。输入未超阈值 → 直接透传 `full`。
- `truncateText` 从 `assembleInput` 抽出来复用。

**Worker（`worker.ts` + `providers/openai-compatible.ts`）**
- `Worker.summarize` 为**可选**方法：`summarize?(args: { text; maxChars; model?; signal? }) => Promise<string>`。可选意味着旧 worker / 测试无需实现，引擎自动降级到 `truncate`。
- `fakeWorker` 给了确定性实现（保留头尾 + 标记 `[[SUMMARY ...]]`），便于测试识别。
- 真实 worker 用 `streamChat` 做一次非流式压缩（system 提示要求压缩到约 `maxChars` 字符、保留关键事实/数字/命名实体），模型默认 `agnes-2.0-flash`，可由 `model` 参数（来自 `node.agent?.model`）覆盖；非文本模型抛 `ProviderError("UNSUPPORTED")`。

**测试**
- `packages/server/src/engine.summary.test.ts`（4 用例）：摘要压缩替代截断 / summarizer 抛错→回退 truncate / 无 summarizer→回退 truncate / 阈值内透传。

---

## Batch 1 — P1 延后项收尾 (2026-08-27)

> 从 roadmap "已知延后项"中收拢的 3 项快速赢，全部完成。详见 `docs/roadmap-tasks.md` 的 "P1 已知延后项 — 实施计划" 章节。

### 周/月成本聚合视图（P1-1）

- **`db.ts` — `costReport()`** 新增 `byWeek`（`strftime('%Y-W%W')`）和 `byMonth`（`strftime('%Y-%m')`）两个聚合维度，结构同 `byDay`（runs/cost_usd/tokens_in/tokens_out）。返回值加 `byWeek`/`byMonth` 字段。
- **`apps/web/src/lib/api.ts`** — `CostReport` 接口加 `byWeek`/`byMonth` 类型。
- **`CostReport.tsx`** — 新增「日 / 周 / 月」粒度切换 segmented control；智能默认（≤14 天日，≤90 天周，否则月）；条形图数据源随粒度切换，X 轴标签格式化（日 MM-DD / 周 W23 / 月 2026-08）。
- **测试**：`costs.test.ts` 加 byWeek/byMonth 聚合断言（两 run 分属不同周、同一月，验证分组正确、总成本一致）。

### 每节点质量评分（P1-2）

> 数据链路（provider judge → db score 列 → evalReport avgScore）此前已完整，缺的是前端展示和 runtime 跟踪。

- **`core/runtime.ts`** — `NodeRuntime` 新增 `lastVerdict?: { passed, reason, score?, attempt }`；`gate.verdict` reducer 保存最近一次判定结果（含 score）。
- **`apps/web/src/lib/api.ts`** — `EvalSummary` 接口加 `avgScore: number` 字段（db 层已返回，此前前端类型缺失）。
- **`EvalReport.tsx`** — 统计卡片新增「平均质量分」；byGraph 表格和 byPrompt 表格各加「平均质量」列；`fmtScore()` 辅助函数（0 显示 "—"，否则一位小数）。
- **`Inspector.tsx`** — 节点标题栏：当 `rt.lastVerdict.score` 存在时显示质量分徽章（`质量 N/10`，good≥7 绿 / warn≥4 黄 / bad<4 红，hover 显示 reason）。
- **`styles.css`** — 新增 `.chip--score` / `.chip--score-good` / `.chip--score-warn` / `.chip--score-bad` 样式。
- **测试**：core 54 + server 230 全绿（runtime reducer 改动不破坏现有测试）。

### 真实长任务抽网验证（P1-3）

> `sse-resume.test.ts` 此前已实现基于 `?after=` query param 的断网重连测试（commit f3ba54b）。本次补充 `Last-Event-ID` header 方式，覆盖原生 EventSource 行为。

- **`sse-resume.test.ts`** — `collect()` 函数新增 `useHeader` 参数；新增测试用例 "resumes via Last-Event-ID header"：第一次连接读到 seq 6 后断开，第二次连接通过 `Last-Event-ID: 6` header 重连，验证合并后事件无重复、无遗漏、覆盖全部 0-9。
- 两种重连方式（`?after=` query param 和 `Last-Event-ID` header）均已覆盖，服务端同时支持二者（query param 优先）。

### 质量门

- `pnpm -r typecheck`：core + server + web 全绿
- `pnpm -r test`：core 54 + server 230 全绿
- `pnpm -r build`：core + server + web 构建成功

---

## Batch 2 — 基础设施 (2026-08-27)

> P1-4 引擎 ArtifactRef 升级 + P1-5 fs 隔离完整 ESM loader。设计笔记见 `docs/technical-design.md` §13。

### P1-4 引擎 ArtifactRef 升级

**核心改动（`engine.ts`）**
- `SchedulerInit.artifacts` / `ResumeState.artifacts`：`Map<string, string>` → `Map<string, Artifact[]>`
- 新增辅助函数 `setTextArtifact(artifacts, nodeId, text)`：替换节点 artifacts 为单个 text artifact
- 新增辅助函数 `collectUpstreamImages(graph, artifacts, nodeId)`：递归遍历 flow 上游，从 artifacts 中提取所有 image URI（去重）
- 删除 `createImageResolver` + `extraImages` 数组：图片现在统一通过 typed artifacts 流动，不再需要独立的 extraImages 机制

**各节点完成时的 artifacts 写入**
- source/sink/gate(通过)/agent：`setTextArtifact()` — 单个 text artifact
- source 有图片时：额外 push image artifact 到数组（`nodeArts.push(a)`）
- imageGen：`artifacts.set(nodeId, imageArts)` — 纯 image artifact 数组（无 text，output 为空）
- 返工环复位：`artifacts.set(bodyId, [])`（原 `artifacts.delete`）

**`inputFor()` 重构**
- 遍历每个 flow 上游的 `artifacts[]`，按 kind 处理：
  - text/json：取 `content` 加入 parts
  - image：追加 `[图片: label]` 占位行
  - video/audio/file/uri：追加对应占位行
- inputPolicy（all/last/truncate/summary）逻辑不变，作用于拼接后的 parts

**`imagesFor()` 重构**
- 改为 `(nodeId) => collectUpstreamImages(graph, artifacts, nodeId)`
- source 图片和 imageGen 产出的图片都通过 artifacts 流入下游，不再区分来源

**`reconstructState()` 升级**
- `node.finished`：如果该节点无 artifact 或数组为空，补造 text artifact（兼容旧运行）
- `artifact.produced`：push artifact 到数组
- `node.started`：如果 attempt > 之前记录的 attempt 且 artifacts 已存在，清空数组（模拟返工环复位）。**关键约束**：只在已存在时清空，不创建空条目——resume 用 `artifacts.has()` 判断节点是否完成，空条目会导致未完成的 halt 节点被误判为 done

**`resume()` / `approveGate`**
- `approveGate`：从 artifacts 中取 text artifact 的 content（原 `artifacts.get` 返回字符串）
- `editOutput`：`setTextArtifact(state.artifacts, nodeId, text)`（原直接 set 字符串）

**测试**
- 新增 `engine.artifactref.test.ts`（4 用例）：
  1. imageGen 产出的图片流入下游 agent 的 `images` 参数和 `content` parts
  2. reconstructState 构建正确的 typed artifact 数组（source text / imageGen 多图 / agent text）
  3. inputFor 对非文本上游 artifact 生成 `[图片: ...]` 占位
  4. 返工环复位后 agent 的最终 output 是第二次 attempt 的结果
- 修改 `engine.reliability.test.ts`：`artifacts.get("forge")` 改为查找 text artifact 的 content
- 全量回归：core 54 + server 234 全绿（新增 4 个 + 原 230）

### P1-5 fs 隔离完整 ESM loader

**问题**：原 `__proxyFs` 是协作式 shim，插件需主动调用 `globalThis.__proxyFs.read/write`。直接 `import fs from 'node:fs/promises'` 无法被拦截（ESM 命名空间只读）。

**解决方案**：自定义 ESM loader 拦截 `node:fs/promises` 导入，重定向到代理模块。

**新增文件（`packages/server/src/`）**
- `fs-loader.mjs`：ESM loader，`resolve()` hook 拦截 `node:fs/promises` / `fs/promises`，返回 `fs-proxy.mjs` 的 URL（`shortCircuit: true`）
- `fs-proxy.mjs`：代理模块，导出 8 个支持的方法（readFile/writeFile/appendFile/readdir/stat/unlink/mkdir/rm），每个调用 `globalThis.__proxyFs` 对应方法；未实现方法（rename/copyFile/access 等）抛清晰错误提示
- `fs-loader-register.mjs`：`module.register('./fs-loader.mjs', import.meta.url)` 注册 loader

**`isolation.ts` 扩展**
- `proxyFs` 方法：从 2 种操作（read/write）扩展到 8 种（read/write/appendFile/readdir/stat/unlink/mkdir/rm），统一白名单校验 `checkFsPath()`
- `FsPayload` 类型：支持新格式 `{op, path, data?}` + 旧格式 `{path, write?, data?}`（向后兼容）
- `spawnIsolatedWorker`：fork 时加 `execArgv: ['--import', FS_LOADER_REGISTER]`，确保子进程启动时注册 loader

**`worker-proxy.mjs` 扩展**
- `__proxyFs`：从 2 方法扩展到 8 方法（read/write/appendFile/readdir/stat/unlink/mkdir/rm），每个通过 `proxyRequest("fs", {op, ...})` 转发到主进程

**测试验证**
- `sample-worker-plugin.mjs`：去掉 `__proxyFs` 存在性检查，改为直接 `await import("node:fs/promises")` —— 验证 ESM loader 拦截生效
- `isolation.test.ts` 8 用例全绿：fs 白名单内读取成功、白名单外被拦截（"not permitted"）
- 全量回归：234 passed

**已知限制**
- `node:fs`（同步 API）未拦截——同步调用无法通过异步 IPC 代理。插件应使用 `fs/promises`
- 仅 8 种常用 fs 操作被代理，其余方法抛 `not implemented` 错误
- `module.register()` 在 Node 26 有 deprecation warning（建议用 `registerHooks()`），但 Node 24+ 均可用，暂不迁移

### Batch 2 质量门
- `pnpm -r typecheck`：core + server + web 全绿
- `pnpm -r test`：core 54 + server 234 全绿
- `pnpm -r build`：core + server + web 构建成功

---

## Batch 3 — P1-6 视频/音频生成

**日期**：2026-08-27
**分支**：`feature/20260824`
**依赖**：P1-4 ArtifactRef 升级（已完成）

### 概述

新增 `videoGen` 和 `audioGen` 两种节点类型，支持文本生成视频和文本生成音频（TTS）。Worker 接口新增可选方法 `generateVideo()` / `generateAudio()`，无方法时引擎 soft-fail（节点标记 done，零 usage，不阻塞流水线）。openai-compatible provider 实现了基础 API 调用：视频支持 `/videos/generations` 同步返回 + 异步轮询两种格式；音频调用 `/audio/speech` 同步返回二进制。

### core 层变更

**`packages/core/src/graph.ts`**
- `NodeKind` 枚举新增 `"videoGen"` / `"audioGen"`
- 新增 `VideoGenConfig`（model/prompt/duration/aspect/size/n/baseUrl/apiKey）
- 新增 `AudioGenConfig`（model/prompt/voice/format/speed/n/baseUrl/apiKey）
- `GraphNode` 新增可选字段 `videoGen` / `audioGen`
- `compile.ts` 无需额外验证（新节点类型遵循通用 source/sink 检查和环检测）

### server 层变更

**`packages/server/src/worker.ts`**
- 新增 `VideoGenArgs` / `VideoGenResult`（含 durationSec）/ `AudioGenArgs` / `AudioGenResult` 接口
- `Worker` 接口新增可选方法 `generateVideo?()` / `generateAudio?()`（可选，无方法时引擎 soft-fail）
- 假 worker 实现占位：返回小 buffer + 正确 mimeType，honor `n` 参数

**`packages/server/src/providers/openai-compatible.ts`**
- `generateVideo()`：POST `${endpoint}/videos/generations`，支持两种响应：
  - 同步：`{ data: [{ b64_json?, url? }] }`（类似图片）
  - 异步：`{ id, status: "processing" }` → 轮询 `${endpoint}/videos/${id}` 直到 succeeded/failed
  - 300s 超时，支持 per-node baseUrl/apiKey 覆盖
- `generateAudio()`：POST `${endpoint}/audio/speech`，请求体 `{ model, input, voice, response_format, speed }`，同步返回音频二进制，120s 超时

**`packages/server/src/engine.ts`**
- 新增 `videoGen` 处理分支（在 imageGen 之前，避免 TypeScript 类型收窄问题）：
  - 检查 `worker.generateVideo`，无方法则 soft-fail
  - 调用 `worker.generateVideo()` → `storeBinary()` 存储 → `artifact.produced` 事件 → `artifacts.set(nodeId, videoArts)`
  - 错误时 soft-fail（console.warn + done + zeroUsage）
- 新增 `audioGen` 处理分支，结构同 videoGen
- `inputFor()` 已支持 video/audio artifact 的中文占位符 `[视频: ...]` / `[音频: ...]`（ArtifactRef 升级时已预留）

### web 层变更

**`apps/web/src/canvas/Plants.tsx`**
- `KIND_LABEL` 新增 `videoGen: "AI 生视频"` / `audioGen: "AI 生音频"`

**`apps/web/src/store/graph.ts`**
- `DEFAULTS` 新增 `videoGen` / `audioGen` 默认配置

**`apps/web/src/components/Inspector.tsx`**
- 新增 `videoGen` 配置面板：模型/提示词/时长/宽高比/生成数量/自定义端点
- 新增 `audioGen` 配置面板：模型/文本/语音/输出格式/语速/生成数量/自定义端点
- `ArtifactChip` 已预留 video/audio 渲染（`<video>` / `<audio controls>`）

**`apps/web/src/components/FinishedProduct.tsx`**
- 已预留 video/audio 分类和渲染（`videos` / `audios` filter + `<video controls>` / `<audio controls>`）

### 测试

**`packages/server/src/engine.videogen.test.ts`**（4 用例）
1. 单视频产出：artifact.produced 事件 + video/mp4 mimeType + uri
2. 多视频 n=2：2 个 artifact.produced 事件
3. 无 generateVideo 方法时 soft-fail：无 artifact，节点 done，流水线继续到 sink
4. 视频流入下游 agent：inputFor 包含 `[视频: ...]` 占位符

**`packages/server/src/engine.audiogen.test.ts`**（5 用例）
1. 单音频产出：artifact.produced + audio/mpeg
2. wav 格式：audio/wav mimeType
3. 多音频 n=2
4. 无 generateAudio 方法时 soft-fail
5. 音频流入下游 agent：inputFor 包含 `[音频: ...]` 占位符

### 已知限制

- **视频 provider 兼容性**：OpenAI 无公开 video API，`/videos/generations` 是第三方 provider（Replicate 风格、本地 ComfyUI 包装）的非标准端点。实际接入需根据具体 provider 调整请求/响应格式
- **音频仅支持 TTS**：`/audio/speech` 是 OpenAI 标准 TTS 端点。音乐生成（如 `/audio/music`）非标准，暂未实现
- **假 worker 返回占位 buffer**：不是真实可播放的视频/音频文件，仅用于测试流水线和 UI 渲染
- **视频生成慢**：默认 300s 超时，真实视频生成可能需要更长时间

### Batch 3 质量门
- `pnpm -r typecheck`：core + server + web 全绿
- `pnpm -r test`：core 54 + server 243 全绿（新增 9 个测试）
- `pnpm -r build`：core + server + web 构建成功

---

## 阶段 4 收尾 — 4.2 Connector / 4.6 触发方式 / 4.8 文档

**日期**：2026-08-27
**分支**：`feature/20260824`

### 概述

4.2 Connector 和 4.6 触发方式的核心代码在之前的批次中已实现（connectors.ts / triggers.ts / scheduler.ts / ConnectorEditor.tsx / TriggersPanel.tsx），本次补全了 Connector 的"测试连接"功能，并完成了 4.8 文档。

### 4.2 Connector — 测试连接补全

**后端** `packages/server/src/index.ts`
- 新增 `POST /api/connectors/test` 端点：接收 ConnectorConfig，调用 resolveConnector，返回 2000 字符预览 + images 列表 + fullLength
- 错误时返回 502 + error message
- 导入 resolveConnector 和 ConnectorConfig

**前端** `apps/web/src/components/ConnectorEditor.tsx`
- 新增 testConnector() 函数调用 /api/connectors/test
- 主组件新增 testState（idle/loading/ok/error）、testResult、testError 状态
- 新增"测试连接"按钮（connector.type !== "manual" 时显示）
- 结果预览：成功显示文本长度/图片数 + 预览 pre；失败显示错误信息
- 切换接入方式时重置测试状态

**样式** `apps/web/src/styles.css`
- 新增 .connector-test / .connector-test__result / .connector-test__meta / .connector-test__preview / .connector-test__error 样式

### 4.2 Connector — 已有实现回顾

- `packages/core/src/graph.ts`：ConnectorConfig（manual/file/http/form）+ FileConnector（path/encoding/asImages）+ HttpConnector（url/method/headers/auth/extract/body）+ FormConnector（fields）
- `packages/server/src/connectors.ts`：resolveConnector() 实现全部 4 种类型，支持 glob 匹配、JSON 字段提取（dot-path）、base64 编码
- `packages/server/src/engine.ts`：source 节点调用 resolveConnector，重试 CONNECTOR_MAX_RETRIES，失败标记 node.failed
- `apps/web/src/components/ConnectorEditor.tsx`：类型选择 + FileForm/HttpForm/FormForm 配置面板

### 4.6 触发方式 — 已有实现回顾

- `packages/core/src/graph.ts`：TriggerConfig（manual/webhook/cron/event/batch）+ TriggerType 枚举
- `packages/server/src/triggers.ts`：TriggerService 类（restore/list/get/listByGraph/nextRunMap/upsert/remove/fire/fireWebhook/onGraphFinished/onArtifact/fireBatch）
- `packages/server/src/scheduler.ts`：TriggerScheduler 类（in-process cron timer，sync/unsync）
- `packages/server/src/index.ts`：API 路由（GET/POST/DELETE triggers，POST fire，GET next-runs，POST webhook）
- `packages/server/src/db.ts`：runs 表包含 trigger 字段，createRun/listRuns 支持 trigger
- `apps/web/src/components/TriggersPanel.tsx`：触发器管理面板（列表/编辑/删除/手动触发/下次运行时间/运行历史）
- `apps/web/src/lib/api.ts`：listTriggers/createTrigger/deleteTrigger/fireTrigger/triggerNextRuns 方法

### 4.8 文档

**新增文档**
- `docs/extending.md`：扩展指南（5 个章节：Worker/Connector/Skill/Trigger/NodeType，含步骤、接口、测试、常见模式）
- `docs/examples.md`：8 个示例产线模板（改写循环/商品生成/多源聚合/视频广告/表单驱动/A/B 测试/定时报告/webhook 触发）

**完善文档**
- `README.md`：Quick start 扩展为"5-minute first run"（6 步：打开面板/新建产线/配置 provider/编辑图/运行/查看输出），新增 examples.md 和 extending.md 链接
- `CONTRIBUTING.md`：已存在且完善（开发指南/commit 规范/编码约定/测试/PR 流程）
- `docs/technical-design.md`：已存在 776 行（架构/数据模型/API 表面）

### 质量门
- `pnpm -r typecheck`：core + server + web 全绿
- `pnpm -r test`：core 54 + server 243 全绿
- `pnpm -r build`：core + server + web 构建成功

---

## 阶段 4 收尾 — 首次启动引导（Onboarding）

**日期**：2026-08-27
**分支**：`feature/20260824`

### 概述

替代写死的 seed 图自动创建。新用户首次启动时数据库为空，前端显示全屏 Onboarding 引导页面，让用户选择模板或从空白开始创建第一条产线。

### 前端

**`apps/web/src/components/Onboarding.tsx`**（新增）
- 全屏覆盖组件，z-index 1000，居中显示
- Hero 区域：欢迎标题 + 简短介绍（产线隐喻说明）
- 模板选择网格：复用 TemplatePreview SVG 逻辑，展示模板结构缩略图
- "从空白产线开始"按钮
- 提示区域：说明需要配置模型 Provider，未配置时使用假 Worker
- 调用 `api.listTemplates()` 加载模板列表
- `onCreate(templateId?)` 回调：点击模板或空白按钮时触发

**`apps/web/src/App.tsx`**
- 导入 Onboarding 组件
- `graphs.length === 0` 时显示 `<Onboarding onCreate={createGraph} />`
- 创建图后 graphs 不再为空，Onboarding 自动消失
- 使用 React Fragment 包裹 Onboarding 和主应用

**`apps/web/src/styles.css`**
- 新增 .onboarding 系列样式（全屏布局、hero、模板网格、分割线、按钮、提示框）
- .template-grid--onboarding / .template-card--onboarding 适配全屏布局
- .btn--lg 大按钮样式

### 后端

**`packages/server/src/index.ts`**
- 移除启动时自动创建 SEED_GRAPH 的逻辑（`if (!db.getGraph(SEED_GRAPH.id)) db.saveGraph(...)`）
- 移除未使用的 SEED_GRAPH 导入
- POST /api/runs 默认 graphId 逻辑修改：未指定时使用 `db.listGraphs()[0]?.id`，无图时返回 400 "no graphs found — create one first"
- 保留 seed.ts 文件（engine.test.ts 仍引用 SEED_GRAPH）

### 向后兼容
- 已有数据库的用户不受影响（已有图不会被删除）
- 新用户首次启动看到 Onboarding，而非写死的 seed 图
- seed.ts 保留供测试使用

### 质量门
- `pnpm -r typecheck`：core + server + web 全绿
- `pnpm -r test`：core 54 + server 243 全绿
- `pnpm -r build`：core + server + web 构建成功（99 modules）
