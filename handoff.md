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

- **events.ts** — added `node.reasoning` event (hidden thinking tokens),
  `errorCode` on `node.failed`, optional `cachedTokens`/`reasoningTokens` on `Usage`,
  optional `artifactId`/`metadata` on `packet.sent`.
- **graph.ts** — `AgentConfig` gained `temperature`, `timeoutMs`, `retry` (technical
  retry, distinct from rework attempts). Added `SourceConfig` with a reserved
  `connector` field. Default model changed to `agnes-2.0-flash`.
- **runtime.ts** — reducer handles `node.reasoning`; `NodeRuntime` tracks reasoning
  text per attempt, cached/reasoning token counts, and errorCode. `RuntimeState`
  tracks total token counts (in/out/cached) for the token-vs-cost meter.

### Server (`packages/server`)

- **config.ts** (new) — loads/saves provider config from
  `$AGENT_WORLD_CONFIG`, `~/.agent-world/config.json`, or walks up from cwd looking
  for `agent-world.config.json`. API keys are redacted in the settings API.
- **worker.ts** — `Worker` interface now yields `AgentChunk`
  (text-delta | reasoning-delta | tool-call | tool-result) and returns
  `{ output, usage }`. `judge()` now receives `output` and `criterion`. Fake worker
  updated; it reads criterion for deterministic verdicts.
- **providers/openai-compatible.ts** (new) — one worker covering any OpenAI-
  compatible Chat Completions API (Agnes, OpenAI, Volcengine Ark, vLLM, Ollama).
  Handles SSE streaming, reasoning_content, prompt-cache usage, timeout via
  AbortController, and maps HTTP errors to `ProviderError` codes
  (TIMEOUT/RATE_LIMIT/PROVIDER_ERROR/AUTH/UNKNOWN).
- **providers/index.ts** (new) — `routingWorker()` picks the provider for each node
  by its model name; workers are cached per model.
- **engine.ts** — consumes `AgentChunk`, emits `node.delta`/`node.reasoning`,
  passes `signal` to workers, wraps agent calls in exponential-backoff retry for
  transient errors (retries do NOT increment attempt), passes output+criterion to
  judge. Added `reconstructState()` and `resume()` generator for continuing a
  halted run — yields only new events, seq continues from the existing log.
  Accepts `input` (raw material) for the source node. On rework, the judge's
  rejection reason is appended to the reworked node's next input. Errors pass
  through `sanitizeError()` before landing in the event stream.
- **db.ts** — `runs` gained `trigger` column; `node_runs` gained `reasoning`,
  `error_code`, `cached_tokens`, `reasoning_tokens`. Additive migrations run on
  open. `markZombiesInterrupted()` runs at startup so a server restart doesn't
  leave runs forever "running". `nextSeq()` and `listRuns()` added.
- **index.ts** — uses `routingWorker()`, marks zombies on boot, adds
  `GET/PUT /api/settings`, `GET /api/runs`, `POST /api/runs/:id/resume`
  (continue | scrap), `GET /api/health`. Config file is `agent-world.config.json`
  at repo root (gitignored). SSE loop sends a `: ping` heartbeat every 15s of
  idle so proxies don't drop the connection during long model calls.
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
- **Settings.tsx** (new) — modal to edit default model, provider baseUrl /
  apiKey / models, and per-model input/output unit prices (USD per 1M tokens).
  Keys are redacted; editing replaces them.
- **api.ts** — `resumeRun`, `getSettings`, `saveSettings`; `startRun` takes
  optional dispatch `input`.
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
  cacheRead } }` (USD per 1M tokens) once the rates are known. The UI now shows
  token counts until a price is set; once set, the 电费 view and budget trip
  activate automatically off `costUsd`.
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
pnpm -r test        # 13 core + 6 server, all green
pnpm -r typecheck   # all green
```

## Canvas notes (unchanged from Phase 0)

- `PacketLayer.tsx` draws trucks on a canvas overlay that must sit on the same
  letterboxed box as the SVG (`fitOf` in `Canvas.tsx`).
- Trucks live in refs behind one animation loop; never put them in React state.
- The de-dup set is keyed by `edgeId:seq` and resets on `runId` change.
- Deselect is on the backdrop rect, not the `<svg>`.
