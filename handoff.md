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
- Remaining: export to long-image/HTML/rich-text (C), AI image generation (D). Engine
  ArtifactRef upgrade still deferred until multimodal downstream inputs are needed.
