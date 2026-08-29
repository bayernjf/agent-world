# Handoff Archive (frozen 2026-08-27)

> ⚠️ **This file is read-only history.** All content from `handoff.md` as of 2026-08-27 was moved here on the split commit. Do NOT append new entries here — add them to the current `handoff.md` "Recently shipped" section (max 5) or extend [docs/handoff-archive.md](docs/handoff-archive.md) by an explicit "Additions" section if historical context is needed.
>
> Active work / state / next-step tracking lives in the slim `handoff.md` at the repo root.

---

# Handoff (legacy, preserved for reference)

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

---

## 阶段 4 收尾 — 画布多选与视口体验

**日期**：2026-08-27
**分支**：`feature/20260824`

### 概述

从单选升级为多选，支持 Shift+点击、框选（marquee）、批量移动和批量删除。同时修复视口重置问题，实现首次加载自动适应和视口持久化。

### 多选数据层（`apps/web/src/store/graph.ts`）

- 单选 `selectedId` 扩展为 `selectedNodeIds: string[]` + `selectedEdgeIds: string[]` 集合，`selectedId` 保留为派生便利字段（第一个选中节点）
- 新增方法：`toggleNode(id, additive?)`、`toggleEdge(id, additive?)`、`selectNone()`、`selectAllNodes()`、`moveNodes(ids, dx, dy)`（批量相对位移）、`deleteSelected()`（批量删除选中节点和管道）
- `addNode`/`duplicateNode`/`removeNode`/`removeEdge` 同步更新选中集合

### 多选交互层（`apps/web/src/canvas/Canvas.tsx`）

- Shift+点击节点/管道：toggle 选中
- 普通点击未选中节点：单选；点击已选中节点：保持选中（拖拽时批量移动）
- 选中多个节点后拖拽：所有选中节点保持相对位置一起移动（`moveNodes`）
- Delete/Backspace：批量删除所有选中节点和管道
- ⌘/Ctrl+A：全选所有节点
- 点击空白处：清空选中

### 框选（Marquee selection）

- Shift+左键拖拽空白处：画虚线矩形选框，释放时选中框内所有节点
- 选框在内容坐标系渲染（与节点同坐标系）
- 拖拽起点在 pan-surface 上时触发，需避开节点/管道命中区域
- 使用 window 级别的 `pointermove`/`pointerup`/`pointercancel` 监听器（而非 React 合成事件 + pointer capture），避免选框卡住
- `pointercancel` 时清理选框但不提交选中（macOS 触控板手势/系统中断）
- 启动框选时 `preventDefault`，防止原生文本选择/拖拽抢占指针流

### 视口体验

- **首次加载自动适应**：新产线首次加载时画布自动适应所有节点，不会看到空白画布
- **视口持久化**：pan/zoom 状态按产线持久化到 localStorage，刷新或派发新任务不再重置视口
- **移除 `reset()`**：canvas store 中未使用的 `reset()` 方法已删除，"适应"按钮的 fit-to-bounds 替代其功能

### 交互变更

- select 模式下左键拖拽空白处：平移画布（恢复原行为）
- 框选改为 Shift+左键拖拽空白处
- 中键/空格+拖拽：平移画布（不变）

### 质量门
- `pnpm -r typecheck`：core + server + web 全绿
- `pnpm -r test`：core 54 + server 243 全绿
- 浏览器自动化验证：标准框选正常选中节点；pointercancel 正常清理选框

## 阶段 4 收尾 — 产线名重复校验

### 概述
截图发现：数据库里能存两条完全同名的产线（顶部 HUD 与下拉列表里都出现
"小红书种草笔记"），前端也没有拦截。补一个轻量校验：trim + 大小写不敏感，
前后端都拦，已存在的同名行让用户自己改名。

### 规则
- 名字 trim 后比较；空字符串视为非法
- 比较时统一 `toLowerCase()`；CJK 字符不参与大小写折叠（与"小红书"==
  "小红书"行为一致，跨语言混合命名按字面比）
- 重命名自己不允许跟自己冲突（`excludeId = currentId`）
- 已存在的同名旧行不会自动合并/重命名（用户手动处理，避免误删数据）

### 后端 `packages/server/`
- 新模块 `src/graphs-name.ts`：`findGraphIdByName(graphs, name, excludeId?)`，
  纯函数 + 类型，便于单测
- `src/index.ts` 顶部 `import { findGraphIdByName as findGraphIdByNameCore }`，
  在路由内包一层 `findGraphIdByName(name, excludeId?)` 直接喂 `db.listGraphs()`
- `POST /api/graphs`：在 `db.saveGraph` 之前调用 helper 找冲突，找到则
  返回 `409 { error: "duplicate_name", message, existingId }`
- `PUT /api/graphs/:id`：同样在 `db.saveGraph` 之前调用，传入 `excludeId =
  c.req.param("id")` 排除自身
- `src/graphs-name.test.ts`：6 个用例覆盖空名/精确匹配/大小写/trim/
  无冲突/excludeId

### 前端 `apps/web/`
- `lib/api.ts` 新增 `DuplicateGraphNameError`（带 `existingId` 字段），
  `saveGraph` 与 `createGraph` 在 409 + `error: "duplicate_name"` 时抛出
  这个类型而不是 `GraphConflictError`
- `App.tsx` 引入 `TEMPLATES` 用来在新建时预算"将要用的名字"以提前拦截
- 新增内部工具 `nameTaken(name, excludeId?)`：在本地 `graphs` 上做相同的
  trim + 大小写不敏感比较
- `createGraph(template?)`：能从模板推出默认名时先调 `nameTaken` 拦截
- `renameGraph(id, name)`：先调 `nameTaken(name, id)` 拦截
- 三个调用点（`createGraph` / `duplicateGraph` / `renameGraph` / 删除
  fallback createGraph）的 catch 都识别 `DuplicateGraphNameError` 并把
  服务端的 `e.message` 写到 `setError(...)` 顶部条；其他错误维持原行为

### 已知 gap
- 现有 DB 里已经存在的重复行（用户截图里的两条 "小红书种草笔记"）不会
  被自动清理；新规则只阻止"再插一条"。需要用户手动去 Onboarding /
  列表里改一条的名字
- 模板名如果撞了数据库已有产线，前端会直接拦在弹层不发起请求；后端
  也会兜底 409
- Onboarding 选择模板后立即校验，避免用户看到一个"已经重名"的产线

### 质量门
- `pnpm -r typecheck`：全绿
- `pnpm --filter @agent-world/server exec vitest run graphs-name.test.ts`：6 通过
- 沙箱 listen 限制未能实跑 8791 集成测试；老 server 进程需用户手动
  `kill 89495` 才能用上新版逻辑

## 阶段 4 收尾 — 多模态节点默认模型按 modality 选

### 概述
之前 `imageGen` / `videoGen` / `audioGen` 三种节点的默认 model 字段
是硬编码字符串（"agnes-image" / "video-gen" / "tts-1"），跟用户实际在
「模型设置」里配置的 provider 完全脱节：用户配置里没有这个名字的模型
时，节点能加进来但一派发就报 "model not found"。改成按节点需要的
modality 实时从已启用的 provider / model 里挑。

### 规则
- `agent` → `text`；`imageGen` → `image`；`videoGen` → `video`；
  `audioGen` → `audio`；`source` / `gate` / `sink` 不需要模型
- 优先用用户的"默认模型"，但**仅当它的 modality 匹配该节点**时
- 否则取**第一个已启用**的 provider / model，且 modality 匹配
- 如果一个匹配的都没有 → `addNode` 抛 `NoModelForModalityError`，
  调用方用顶部条告诉用户"请先在「模型设置」中添加一个支持 X 的模型"
- 服务端 `routingWorker` 仍按 model 名查 provider，所以前端只写
  `model` 字段就够；多模态 config 没 `provider` 字段（Zod 不允许），
  也不需要新增

### 改动
- `apps/web/src/store/graph.ts`：
  - `cachedModelOptions: ModelOption[]` 缓存全量 `{ provider, model, modality, enabled }`
  - `refreshDefaultModel()` 拉 `api.getSettings()` 重新扁平化缓存
  - `modalityForKind(kind)` 把 NodeKind 映射到 Modality
  - `defaultModelFor(kind)` 按上面规则挑模型，返回 `{ provider, model, modality } | null`
  - `addNode(kind, x, y)` 在需要模型但找不到时抛 `NoModelForModalityError`
  - 新增 `class NoModelForModalityError extends Error` 暴露 modality
- `apps/web/src/App.tsx`：
  - `addNodeOrReport(kind, x, y)` 包装调用，捕获该错误后写
    `请先在「模型设置」中添加一个支持 X 的模型，再添加该节点。` 到顶部条
  - 命令面板补齐 `add-video` / `add-audio` 两个动作
- `apps/web/src/components/CanvasToolbar.tsx`：
  - 接受 `onError?: (msg: string) => void` prop
  - `addAtViewCenter` 用 try/catch 处理 `NoModelForModalityError`，
    通过 `onError` 抛出同一文案
- `apps/web/src/App.tsx` 把 `setError` 注入 `<CanvasToolbar onError={setError} />`

### 已知 gap
- 用户必须先在「模型设置」里添加一个 modality 匹配的模型，
  才能在画布里加 `imageGen` / `videoGen` / `audioGen` 节点；
  这是一道有意为之的护栏（避免加完节点才发现没模型可用）
- 同一 model 名在多个 provider 下都能匹配时，路由层
  `providerForModel` 已有"如果 = defaultModel 就用 defaultProvider"
  的优先逻辑；不在这轮的范围
- 模型卡的 modality 是用户手动选择的（建模型时填），不会被
  自动探测；之后可考虑让"测试连接"把 modality 写回来

### 测试
- `apps/web/src/store/graph.model-default.test.ts`：5 个新用例
  - agent 拿到 defaultModel
  - imageGen 拿到第一个 image 模型
  - 找不到匹配时抛 `NoModelForModalityError`
  - 跳过 disabled provider
  - source / gate / sink 不需要模型（不抛错）
- `apps/web/src/store/graph.undo.test.ts` 的 mock 补上"有 text 模型"，
  否则会因为空配置抛 `NoModelForModalityError`（这本身就是新行为）
- `pnpm -r typecheck` 全绿；web 测试 6/6

### 质量门
- `pnpm -r typecheck`：core + server + web 全绿
- `pnpm --filter @agent-world/web exec vitest run`：6 通过
- `pnpm --filter @agent-world/server exec vitest run graphs-name.test.ts`：6 通过
- 沙箱 EPERM 限制，未能重启 8791 真实复现；老 server 进程需手动
  `kill 89495` 后才能在 UI 触发新逻辑

## 阶段 4 收尾 — 新用户零模型体验：软提示 + 派发硬卡

### 概述
上一轮把"找不到 modality 匹配模型就抛错"做成了"找不到就抛错"，但
新用户什么模型都没配时根本加不了任何节点，体验断裂。这一轮按"设计时
不阻塞、运行时才卡住"重新拆：

- **加节点**：永远成功。找到 modality 匹配就自动用；找不到就把 model
  字段留空，同时 UI 顶部条给一个软提示"该节点需要 X 模型，但当前没
  有配置；节点已添加，请在「模型设置」中添加后再派发。"
- **派发任务**：服务端 `validateModels` 跑一遍，把所有"model 为空 /
  模型未注册 / Provider 已停用"作为 error 诊断返回；只要有 error 就
  **直接 422 拒绝**，message 把首条诊断拼成一句人话；其余放在
  diagnostics 里

### 改动

**前端 `apps/web/`**
- `store/graph.ts`：
  - `addNode` 改成返回 `{ id, missingModality: Modality | null }`，
    不再抛 `NoModelForModalityError`（已删）
  - 找不到 modality 匹配时，model 字段**清空**（不是保留占位
    "video-gen" / "tts-1"），让 dispatch 能正确识别
  - `defaultModelFor` 不再做 demo 兜底；用户没配就如实返回 null
- `App.tsx` / `CanvasToolbar.tsx`：
  - `addNodeOrReport` 检查 `missingModality` 写顶部条软提示
- `components/Inspector.tsx`：
  - agent / imageGen 的模型下拉首项变成 `disabled hidden` 占位项
    `（未配置 — 请先在「模型设置」中添加 X 模型）`，空 model 选中它
    不会写回（onChange 直接 return），避免覆盖

**后端 `packages/server/`**
- `config.ts`：
  - 之前 DEFAULT_CONFIG 里的 `fake` Provider 没有任何 models；现在加
    一个内置 `demo` Provider，type 仍是 `fake`（路由层自动走
    fakeWorker），包含 `demo-chat`/`demo-image`/`demo-video`/
    `demo-audio` 四个 model，modality 各自标注
  - `defaultModel` 改成 `demo-chat`，新用户首次启动不会卡
  - `loadConfig` 的 merge 行为不变：用户 saved config 仍优先；demo
    永远在 merged 列表里（用户可禁用，不能永久删，这是有意为之的护栏）
- 新模块 `validate-models.ts`：
  - `validateModels(graph, config): ModelDiagnostic[]`
  - 对每个需要 model 的节点（agent / imageGen / videoGen / audioGen）检查：
    1. 子配置存在
    2. `model` 字段非空 → error：`节点「X」(kind) 还未配置 [modality] 模型`
    3. model 在某 Provider 的 models 列表里（或等于 Provider 名）→ 否则
       error：`模型「X」未在「模型设置」中注册`
    4. owning Provider `enabled !== false` → 否则 error：`Provider 已停用`
    5. `modalities[model]` 与节点期望一致 → 否则 warning（用户可能故意）
  - 内置 `demo` / `fake` Provider 跳过 (3)
- `validate-models.test.ts`：9 个用例覆盖空图 / source-不需 model /
  合法 agent / 空 model / 未注册 / 已停用 Provider / 模态不匹配 /
  内置 demo 通过 / imageGen 空 model
- `index.ts`：
  - `POST /api/compile` 把 `validateModels` 的诊断并入 `diagnostics`
  - `POST /api/runs` 在 `startRun` 之前跑 `validateModels`；有 error
    直接返回 `422 { error, message, diagnostics }`，message 把首条错误
    拼成"X 个节点未配置模型：…请前往「模型设置」补全后再派发。"
  - 全通过时把 warning 诊断作为 `modelWarnings` 一并返回（不阻塞）

### 已知 gap
- 用户手动 disabled 了 demo Provider 且没配任何其他模型时，
  `addNode` 永远返回 missingModality，每加一个节点都软提示；
  派发时也直接 422。属于正确行为，但首次跑通前需要先去 Settings
- 内置 demo 的 4 个 model 也走 `validateModels`：它们登记在 demo
  Provider 里且 `type: "fake"`，被显式 allowlist，所以永远通过；
  不会跟用户的"未配置"语义混淆
- Modality 不一致只给 warning，不阻塞；用户故意拿一个 vision 模型
  当文本模型用也能跑（路由会按 model 名找到 Provider，modality 校验
  只在用户能感知的位置提醒）

### 质量门
- `pnpm -r typecheck`：全绿
- `pnpm --filter @agent-world/web exec vitest run`：6 通过
- `pnpm --filter @agent-world/server exec vitest run`（排除沙箱
  EPERM 的 mcp/connectors/isolation）：228 通过 + 9 个新 validate-models
- 沙箱 listen 限制，未能跑 8791 端到端；老 server 进程需用户手动
  `kill 89495` 后才能用上新版逻辑

## 阶段 4 收尾 — 错误条改中间弹出 Toast + 一键复制

### 概述
之前所有错误走的是顶部 `<p className="banner">` 全宽红条，文字长
了会折断且不能复制，用户要贴报错就只能手敲。改成走现有的 `useToast`
store，但样式从底部弹条换成**屏幕正中央的浮层**，右侧固定一个
「复制」按钮把消息内容塞进剪贴板（兜底走 `document.execCommand`
以兼容 in-app browser 这种 Clipboard API 被禁的环境）。

### 改动
- `apps/web/src/store/toast.ts`：
  - `ToastItem` 增加 `ttlMs` + `actions: ToastAction[]`，旧的
    `undo?: () => void` 字段被 `actions` 统一覆盖
  - `show(message, opts?)` 第二个参数换成 `{ ttlMs?, actions? }`
  - 新增 `copyToClipboard(text)` 导出：优先 `navigator.clipboard`，
    失败时回退 `document.execCommand("copy")`，再失败返回 false
- `apps/web/src/components/Toast.tsx`：
  - 默认 actions 为 `[{ label: "复制", onClick }]`，点完弹一个 1.5s
    的「已复制」反馈 toast（覆盖当前 toast）
  - 已有 undo 路径改为传 `actions: [{ label: "撤销", onClick }]`
- `apps/web/src/styles.css`：
  - `.toast` 从 `bottom: 64px` 改成 `top: 50%; left: 50%;
    transform: translate(-50%, -50%)`，正中央；max-width 560 兜底
    超长消息不撑爆窗口
  - 加 `.toast__message` / `.toast__actions` / `.toast__action`
    三个类：消息自动换行，操作区贴右、按钮 hover 高亮
  - 删掉孤儿 `.banner` 规则
- `apps/web/src/App.tsx`：
  - 删 `const [error, setError] = useState<string | null>(null)`
  - 新 `showError(msg)` 调 `useToast.getState().show(msg, { ttlMs: 6000 })`
    （错误比 undo 信息更重要，给 6s 留足读 + 复制时间）
  - 所有 `setError(...)` / `setError(null)` 替换；JSX 里的
    `<p className="banner">` 删掉
  - `<CanvasToolbar onError={...} />` 改用 `showError`
- `apps/web/src/canvas/Canvas.tsx`：
  - `flashDeleted` 用新的 `actions` 数组

### 已知 gap
- 错误 toast 6s 自动消失；如果用户没来得及复制就被关了，可以
  再触发一次（任何同源操作都重新弹）
- 复制反馈「已复制」覆盖了原 toast；新 toast 不带 actions（避免
  无限叠加）。如果失败则原 toast 维持 6s 不动，用户可手动抄
- 移动端没有特殊处理；窄屏 max-width 走 `min(560px, calc(100vw - 48px))`

### 质量门
- `pnpm -r typecheck`：全绿
- `pnpm --filter @agent-world/web exec vitest run`：13 通过
  （含新增的 toast.test.ts：5 个 store 用例 + 2 个 copyToClipboard 用例）
- 沙箱 EPERM 限制，未在 8791 端到端复现；老 server 进程需手动
  `kill 89495` 后才能用上新版

## 阶段 4 收尾 — 多模态 picker：真实 provider 优先，老图自动迁移

### 概述
之前的 `defaultModelFor` 写出来后没考虑到两个真实坑：
1. 排序问题：默认 config 把 `fake` / `demo` 排在前，用户配的
   `agnes` 在后，于是 `find(o => o.modality === wanted)` 会先命中
   `demo-image` 而不是用户的 `agnes-image-2.0-flash`
2. 老图：用户已经有几条"小红书种草笔记"等图，节点里 model 字段
   是历史硬编码的 `agnes-image` / `video-gen` / `tts-1`，新加的
   `addNode` 只管新节点，老节点 Inspector 看到的还是占位

修法：
- picker 优先非 `demo`/`fake` 的 provider，再退回 demo
- `setGraph` 跑一次 `migrateGraphModels`：老 placeholder / 空 model /
   未知 model 全部按 modality 重选；变更后 scheduleSave 持久化

### 改动
- `apps/web/src/store/graph.ts`：
  - `defaultModelFor(kind, cached?, defaultModel?)` 增加可选参数
    方便被 `migrateGraphModels` 复用；新增"真实 provider 优先于
    demo"的查找顺序
  - 新增 `remapNodeModel(node, cached, defaultModel)`：把单个节点
    的 model 字段重新选择；当前 model 在缓存中能命中就保持，否则
    走 picker，picker 也没有就清空（与 addNode 的"找不到就清空"
    行为一致）
  - 新增 `migrateGraphModels(graph, cached, defaultModel)`：遍历
    节点，按需迁移并返回是否变更
  - `setGraph(graph)` 在 set 之前跑一次迁移；变更时 scheduleSave
    持久化（避免下次加载又重新迁移）
  - `addNode` 在 cache 为空时 fire-and-forget 调 `refreshDefaultModel`
    并在 await 完后再次跑 migration（覆盖"打开后第一秒就点添加"
    的竞态）
- 测试：
  - `graph.migrate.test.ts`（新）5 个用例：老 placeholder 重选 /
    真 model 保持 / 无 picker 时清空 / 多节点混合迁移 / 不需要
    model 的 kind 不动
  - `graph.model-default.test.ts` 加 1 个回归：demo + 真实 provider
    共存时真实 provider 胜出
  - 19 个 web vitest 全绿

### 已知 gap
- 迁移触发点只有 `setGraph`（即从服务端加载 / 切图）。`addNode`
  走单独的迁移分支，且依赖 `refreshDefaultModel` 解析后的真实
  cache。如果用户首次加载就立刻点添加（cache 还没填），会先弹
  软提示"未配置"；cache 一旦就位就自动 re-pick 并 scheduleSave
- 真实 provider 优先意味着：如果用户**故意**把 demo 设为默认
  model 并且有 demo-image，仍然会先匹配 demo-image（fromDefault
  路径）；不会退到真实 provider。这是 by design
- `addNode` 第一次 fire `refreshDefaultModel` 时如果当前已经
  命中"真实 model 优先"的逻辑，则返回值就是真实 model；新加
  的节点也不会被 demo 污染

### 质量门
- `pnpm -r typecheck`：全绿
- `pnpm --filter @agent-world/web exec vitest run`：19 通过
- `pnpm --filter @agent-world/server exec vitest run`（排除沙箱
  EPERM）：228 通过
- 沙箱 EPERM，未在 8791 端到端复现；老 server 进程需手动
  `kill 89495` 后才能用上新版

## 阶段 4 收尾 — 删除被节点使用的模型：二次弹窗 + 选替代

### 概述
之前删 model 不管有没有节点在用，都是同一个简单二次确认，用户得自己
去画布里一个一个改。现在按"是否被使用"分两条路径：
- 没节点用：原简单二次确认（保留行为）
- 有节点用：二次弹窗里**列出所有被影响的节点**（按 kind 分组），
  配一个**同 modality 的替代模型下拉**，点"确认替换并删除"一次性
  改完所有节点的 model 并从 Provider 配置里删掉
- 没同 modality 候选模型：下拉显示禁用项，按钮文案变成"确认清空
  并删除"，确认后所有相关节点的 model 清空（派发时会再校验拦截）

### 改动
- `apps/web/src/components/Settings.tsx`：
  - 引入 `useGraph` + `GraphNode` / `NodeKind` 类型
  - 新增 state `deleteReplacement: string`（dialog 里的下拉选中值）
  - 新增 helpers：
    - `nodesUsingModel(provider, model)`：从 graph store 找所有用了
      这 model 的节点
    - `replacementCandidates(provider, model, modality)`：从当前
      `config.providers` 找同 modality、非自身、可启用的候选
    - `kindModality(kind)`：NodeKind → Modality
    - `applyModelReplacement(nodeId, kind, newModel)`：走
      `useGraph.updateNode` 把 model 字段重写
  - 删除按钮 click 时顺手预算候选并 seed 下拉，避免 dialog 打开后
    下拉是空的
  - 删 model 的 confirm modal 拆成两个分支：affected.length === 0
    走原简单 confirm；> 0 走新的 replacement dialog（按 kind 分
    组列出节点、含下拉、文案按是否有候选切换）
- `apps/web/src/styles.css`：
  - 新增 `.modal-confirm__list` / `.modal-confirm__list-kind` /
    `.modal-confirm__field` 三个类，承接新 dialog 的列表和下拉
- 测试：
  - 没新增独立测试（Settings 是高度耦合的展示组件，单独 mock
    graph store 收益低）；现有 19 个 web vitest 全绿覆盖了
    graph store 的 `updateNode` / `addNode` / migration 等关键路径

### 已知 gap
- "被使用"判断只看当前打开的图；用户多产线时其他图的节点不会
  被改，删了 model 后那些图派发时才会触发 validateModels 拦下
  （同一 model 可能没在候选里所以也清不了）
- Provider 类型为 `fake` 的内置 demo 不会进入候选列表（因为
  `p.enabled === false` 之外的过滤实际只走 modality 匹配 — 真正
  的 demo 现在 default 是 enabled，会被列出来当候选，符合"演示
  也能当兜底"的语义）
- 改 model 字段走 `useGraph.updateNode` 走 scheduleSave（500ms
  防抖），用户如果在保存前关页面，新 model 字段可能没落盘；这
  跟画布编辑一致
- 用户在 dialog 打开后切换了图，affected 列表会显示旧图的节点
  （因为我们只在 confirm 时实时查 graph store）；这是 by design，
  列表本身就是实时算的

### 质量门
- `pnpm -r typecheck`：全绿
- `pnpm --filter @agent-world/web exec vitest run`：19 通过
- 沙箱 EPERM，未在 8791 端到端复现

## 阶段 4 收尾 — AI 视频/音频节点：模型字段改为下拉（与文本/生图一致）

### 概述
`videoGen` / `audioGen` 节点的 Inspector 里"模型"是自由文本输入框，
跟 `agent` / `imageGen` 的下拉不一致。而且没配音频模型时这个输入框
还是让用户输一个不存在的名字——只有派发时才报 404，体验割裂。统一
改成下拉，按 modality 过滤；没候选时显示禁用占位「（未配置 — 请先
在「模型设置」中添加 X 模型）」，与已有 addNode 软提示 + 派发硬校验
对齐。

### 改动
- `apps/web/src/components/Inspector.tsx`：
  - 引入 `Modality` 类型
  - 新增 `allModelOptions`：扁平所有启用 Provider 的 model 并带
    modality 字段，过滤掉内置 `fake`（保留 `demo`，演示模型仍然
    兜底可见）
  - `modelOptions` 保持原行为（不过滤 modality），给 agent / imageGen
    沿用，避免行为回退
  - 新增 `videoModelOptions` / `audioModelOptions` 两个按 modality
    过滤的子集，分别给 videoGen / audioGen 的 select
  - `videoGen` 的"视频模型"输入框改成 `<select>`，结构与 agent /
    imageGen 一致：禁用占位 + 候选列表 + `(当前)` 兜底项
  - `audioGen` 的"音频模型"输入框改成 `<select>`，同上
  - 两个 select 的占位文案按 `node.videoGen.model` / `node.audioGen.model`
    是否为空切换：「（未配置 — 请先在「模型设置」中添加 X 模型）」vs
    「（请选择）」
  - `onChange` 在 value 为 `__unset__` 时直接 return，避免误写空串
    把当前值擦掉

### 已知 gap
- 用户没配该 modality 模型时，select 只有占位一项可看；没有额外
  顶栏 nudge（addNode 时的 toast 软提示已覆盖新加节点的情况，
  老节点的 model 字段也已经被 `migrateGraphModels` 清空）
- 真正"在 Inspector 显眼处加一个去设置的链接"留给后续：如果用户
  反馈需要，再加
- `modelOptions`（agent / imageGen 用）依然不过滤 modality；故意
  保留这个灵活性（用户可以拿视觉模型当文本模型跑，被 engine
  校验为 warning）

### 质量门
- `pnpm -r typecheck`：全绿
- `pnpm --filter @agent-world/web exec vitest run`：19 通过
- 沙箱 EPERM，未在 8791 端到端复现

## 阶段 4 收尾 — Inspector 4 个 kind 的模型下拉严格按 modality 过滤

### 概述
上一轮把 `videoGen` / `audioGen` 的"模型"输入框改成下拉，但因为
只声明了 `videoModelOptions` / `audioModelOptions`，agent / imageGen
的下拉里 `textModelOptions` / `imageModelOptions` 是 undefined —
tsc 报 4 个 `Cannot find name` 错误，提交不出去。这次补齐 4 个
modality 切片，统一严格过滤；同时把 agent 的占位文案从泛化的
"添加" 改成 "添加文本模型"，跟 image / video / audio 风格对齐。

### 改动
- `apps/web/src/components/Inspector.tsx`：
  - 新增 `textModelOptions` / `imageModelOptions` 两个按 modality
    过滤的子集（之前只有 `videoModelOptions` / `audioModelOptions`）
  - 删除遗留的 `modelOptions`（旧的不过滤版本，已无任何引用）
  - 更新上方注释：之前说"agent / imageGen 保留 legacy any modality"
    的逻辑不再成立——4 个 select 现在都按 modality 严格过滤，跟
    "每个 kind 只驱动一种模态" 的语义对齐
  - agent select 的占位文案：`"（未配置 — 请先在「模型设置」中添加）"`
    → `"（未配置 — 请先在「模型设置」中添加文本模型）"`，与
    image / video / audio 三处文案风格统一
  - 4 个 select 的 `.map` / `.some` 已经引用对应切片，本轮只补
    定义 + 改注释 + 改占位文案，结构不动

### 行为验证（脚本 `/tmp/verify-inspector.mjs`）
用 `agent-world.config.json` 真实配置跑：
- `text` 切片：2 项（`agnes-2.0-flash`, `agnes-2.5-flash`）
- `image` 切片：2 项（`agnes-image-2.0-flash`, `agnes-image-2.1-flash`）
- `video` 切片：2 项（`agnes-video-v2.0`, `agnes-video-2.5-flash`）
- `audio` 切片：0 项 → 触发 "未配置" 占位

### 已知 gap
- 用户在没配某模态模型时，select 只能看到占位项；新建节点时的
  toast 软提示 + 派发时的硬校验已经覆盖，新加节点时不会出现
  "选了个不存在的模型" 的死路
- 老节点（imageGen.model === `agnes-image` 这种历史硬编码）已经被
  `migrateGraphModels` 清空；老 worker fallback 也已经撤掉

### 质量门
- `pnpm --filter @agent-world/web exec tsc --noEmit`：全绿
- `pnpm --filter @agent-world/web exec vitest run`：19 通过
- 沙箱 EPERM，未在 8791 端到端复现

## Additions (post-2026-08-27)

> Entries rolled out of the active `handoff.md` "Recently shipped" list to keep it at 5 items.

- `c69788a` — **feat(web)**: **Inspector 模型未配置时显示去设置入口**。
- `373a059` — **feat(mcp-server)**: **MCP Server P1 增强——HTTP/SSE 传输 + Resources + Prompts**。Streamable HTTP 传输（`POST /mcp` 按 `Accept` 头返回 JSON 或 SSE、`GET /mcp` SSE 流宣告 endpoint、notification 202、`AGENT_WORLD_MCP_TRANSPORT=http`/`--http` 切换、`AGENT_WORLD_MCP_PORT` 端口）；Resources（`resources/list`/`templates`/`read`，graph:// run:// artifact:// 三类 URI 模板，二进制产物返回下载地址）；Prompts（`prompts/list`/`get`，run_pipeline / analyze_pipeline / create_from_template 三个引导提示词，graphId/input 参数插值）；initialize 能力声明 tools+resources+prompts，版本 0.2.0。协议级测试 22/22 + 真实 socket 端到端冒烟（沙箱已可 listen）。
- — **feat(core/server/web)**: **通用化 Phase 1 P0 收官——映射/循环/并行聚合三大节点**（`2b41f21`/`63f3077`/`7b1ceb9`/`ae8d658`）。core 新增 NodeKind.map/loop/parallel + schema + `transformJson`（JSON 模板递归映射，纯占位符保留类型）；server：map 做 JSON 模板映射与 iterate 数组批量转换（校验失败 VALIDATION）、loop 内联执行下游子图每轮注入 `item` 上下文并聚合 `{results:[...]}`（body 失败传播、maxIterations 防呆、嵌套安全、借 running 计数防 run 提前收口）、parallel 做 barrier 结构化聚合（asObject/pick）；agent 输入在循环体内自动追加循环项；web 工具栏/Inspector 面板/标签/配色。core 6 + server 12 个新测试（engine.map/loop/parallel-join）。
- `0b3b603` — **feat(server)**: **安全四项全部落地**——(1) settings 按用户隔离：settings 表（迁移 16）+ loadConfig(userId)/saveConfig(userId)，DB 行 > 旧文件基线 > 内置默认，provider key 互不可见；(2) HTTP 节点 SSRF 防护：共享 ssrf.ts（fetch 时 DNS 解析后按 IP 校验，DNS-rebinding 免疫），`ALLOW_PRIVATE_NETWORK=1` 逃生口；(3) cookie `Secure`：`SECURE_COOKIES` env 覆盖 + production 默认开 + localhost 豁免；(4) webhook 触发器空 secret → 400。运行期按用户解析配置用 AsyncLocalStorage（runAsUser，并发 run 互不串）。新增 16 个测试（config 隔离、app 层 API、cookie、SSRF、webhook）。
- `01a4ac7` — **feat(mcp-server)**: **MCP Server P0 MVP** 落地——新包 `packages/mcp-server`（stdio JSON-RPC 传输，零新依赖，与现有手写 MCP Client 同风格）；6 个工具（list_graphs/get_graph/run_graph/get_run_status/list_artifacts/get_artifact）；`AGENT_WORLD_URL`/`AGENT_WORLD_TOKEN` 环境变量；协议级端到端冒烟通过（initialize → tools/list → tools/call）；7 个 JSON-RPC 单元测试。
- `78c0651` — **feat(core/server/web)**: Phase 1 P0 第二闭环——**代码执行节点 + 条件分支节点**。core 新增 NodeKind.code/branch + schema + 安全条件表达式求值器（无 eval）；server 代码节点跑 JS/Python 子进程（stdin JSON 进 / stdout JSON 或文本出 / 超时与退出码处理），分支节点按首个命中规则路由 + 分支感知调度器（skipped 剪枝、packet 驱动就绪、汇合点保留）；web 工具栏 / Inspector 面板 / 标签；6 个 core 条件测试 + 4 个代码节点 + 5 个分支节点 server 测试。
- `c0dd67d` — **fix(server)**: `/api/proxy` 要求登录并拒绝内网地址（回环 / RFC1918 / 云元数据 / IPv6 本地段），重定向逐跳复检，堵未认证 SSRF
- `835a383` — **fix(server)**: 用户隔离迁移（14）对 pre-migration 旧库幂等化
- `e3e2f88` — **test(server)**: 测试适配 user-scoped DB 与 auth API（server 套件转绿）
- `17dfbf9` — **refactor(server)**: 删除从未被引用的 SKIP_AUTH 白名单（消除免鉴权脚枪）
