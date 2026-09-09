# Extending Agent World

Agent World is designed to be extensible at three seams: **workers** (model
providers), **connectors** (data sources), and **skills** (tools agents can
call). This guide shows how to add each.

---

## 1. Adding a Worker (Model Provider)

A worker implements the `Worker` interface in `packages/server/src/worker.ts`.
The engine only knows this interface, so a new provider is a drop-in replacement.

### The interface

```ts
export interface Worker {
  runAgent(args: {
    node: GraphNode;
    config: AgentConfig;
    attempt: number;
    input: string;
    images?: string[];
    content?: ContentPart[];
    tools?: ToolDefinition[];
    executeTool?: ToolExecutor;
    signal?: AbortSignal;
  }): AsyncGenerator<AgentChunk, AgentResult>;

  judge(args: {
    node: GraphNode;
    attempt: number;
    input: string;
    output: string;
    criterion: string;
    signal?: AbortSignal;
  }): Promise<{ passed: boolean; reason: string; score?: number }>;

  generateImage(args: ImageGenArgs): Promise<ImageGenResult[]>;
  generateVideo?(args: VideoGenArgs): Promise<VideoGenResult[]>;  // optional
  generateAudio?(args: AudioGenArgs): Promise<AudioGenResult[]>;  // optional
  summarize?(args: { text: string; maxChars: number; model?: string; signal?: AbortSignal }): Promise<string>;  // optional
}
```

### Step-by-step

1. **Create the file** in `packages/server/src/providers/`, e.g. `anthropic.ts`.
2. **Implement `runAgent`** — it's an async generator that yields `AgentChunk`
   objects (`{ type: "text-delta", text }` or `{ type: "tool-call", ... }`)
   and returns `{ output, usage }`. Stream tokens as they arrive so the board
   shows live transcription.
3. **Implement `judge`** — call the model with a system prompt asking for
   `{ passed, reason, score }` JSON. Parse the output and return it.
4. **Implement `generateImage`** (required) — call the provider's image endpoint,
   return `{ data: Buffer, mimeType, usage }[]`.
5. **Optionally implement** `generateVideo`, `generateAudio`, `summarize`.
   The engine soft-fails gracefully when these are absent.
6. **Register it** in `packages/server/src/providers/index.ts` — add it to the
   `routingWorker` so it's selected by model name prefix.

### Cost metering

Every method returns a `Usage` object:

```ts
interface Usage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  units: Record<string, number>;  // e.g. { images: 1, seconds: 5 }
}
```

Use `computeCost({ units }, pricingFor(model))` from `config.ts` to price
based on the provider's per-unit rates.

### Testing

The deterministic **fake worker** in `worker.ts` is the default for tests.
When you add a worker feature, add a test in `engine.*.test.ts` that uses a
spy worker (see `engine.artifactref.test.ts` for the pattern).

---

## 2. Adding a Connector (Data Source)

Connectors pull raw material into a `source` node. The core schema is in
`packages/core/src/graph.ts` (`ConnectorConfig`), and the resolver is in
`packages/server/src/connectors.ts` (`resolveConnector`).

### Built-in types

| Type | What it does | Config |
|---|---|---|
| `manual` | No connector — use the source's text fields / `sourceInput` | — |
| `file` | Read local files, directories, or globs. `asImages: true` treats matches as images. | `{ path, encoding, asImages }` |
| `http` | GET/POST a URL, extract JSON fields via dot-paths. | `{ url, method, headers, auth, extract, body }` |
| `form` | Show a form before run; answers become source text. | `{ fields: [{ name, label, required }] }` |

### Adding a new connector type

1. **Extend the schema** in `packages/core/src/graph.ts`:
   - Add the type to `ConnectorType` enum.
   - Add a config object (e.g. `DatabaseConnector`).
   - Add it to `ConnectorConfig`.
2. **Implement the resolver** in `packages/server/src/connectors.ts`:
   - Add a `case` in `resolveConnector`'s switch.
   - Return `{ text: string, images: string[] }`.
   - Throw on failure — the engine retries up to `CONNECTOR_MAX_RETRIES`.
3. **Add UI** in `apps/web/src/components/ConnectorEditor.tsx`:
   - Add a form component (like `FileForm` / `HttpForm`).
   - Add it to the main component's conditional render.
4. **Test** — add a case in `connectors.test.ts`.

### The "test connection" button

The board has a **测试连接** button that calls `POST /api/connectors/test`
with the current config. It returns a 2000-char preview of the pulled text.
New connector types work automatically — the endpoint just calls
`resolveConnector`.

---

## 3. Adding a Skill (Agent Tool)

Skills are capability cards mounted on agent nodes. They're registered in
`packages/server/src/skills/registry.ts`. For the full design — the four kinds,
the permission model, and what is actually enforced — see
[design-skill.md](design-skill.md); §12 there is the authoritative authoring
guide.

### Built-in skills

Five cards ship today, all of kind `tool`: `web_fetch`, `json_extract`,
`current_time`, `fs_write` (danger), `archive_search`.

- **MCP tools** — any MCP server's tools become available automatically
  (`source: "mcp"`, id `mcp:<server>:<tool>`). Configure them in the settings
  panel or the `MCP_SERVERS` env var.
- **Built-in cards** — declared in the registry's `ALL` array, or registered at
  runtime via `registerSkill()`.

### Creating a skill

A card is a `BuiltinSkill`. Note the callable lives in the nested `tool`
object, not at the top level:

```ts
const myTool: BuiltinSkill = {
  id: "my_tool",
  name: "My tool",                  // shown to humans in the card picker
  description: "What this card is for.",
  kind: "tool",                     // "tool" | "prompt-module" | "output-contract" | "judge"
  source: "builtin",                // "builtin" | "local" | "mcp"
  permissions: { network: { domains: ["api.example.com"] }, subprocess: false, env: [] },
  config: {},
  tool: {
    name: "my_tool",                // what the model sees; keep it equal to id
    description: "One line the model reads to decide whether to call this.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    async execute(args) { /* return a value for the model */ },
  },
};
```

Then add it to the registry's `ALL` array (or call `registerSkill(card)` at
startup), and mount it on a node: select an agent node in the board and add the
card in the inspector. On the node, `skills` is a `SkillMount[]` —
`{ id, config, enabled }` — so the same card mounted on two nodes can carry
different per-mount `config`. The legacy `skills: ["my_tool"]` string form is
normalised by `toMount()`.

For `prompt-module` (inject text into the system prompt, with multi-level
`equips` dependencies) and `output-contract` (validate output against a JSON
Schema, rework on failure), the mechanisms are wired but **no built-in cards
exist yet** — see design-skill.md §11.2. The `judge` kind is in the enum but
has no consumption point at all.

### Skill permissions

Declared permissions are a **structured object**, not a string array:

```ts
permissions: {
  network?: { domains: string[] }   // omitted = no network
  fs?: { paths: string[]; read: boolean; write: boolean }
  subprocess?: boolean
  env?: string[]
}
```

**What is actually enforced, precisely** (design-skill.md §11.3 has the full
account — read it before relying on any of this):

- Skills run **in the main server process**. There is no subprocess sandbox for
  them. `isolation.ts` / `IsolatedWorker` isolates **Workers (model provider
  plugins)** via `worker-plugins.ts`, which is a different thing entirely.
- Enforcement in `permissions.ts` is **hardcoded per tool**, not derived from
  the declaration: `opForTool()` only understands `web_fetch` / `web_search`
  (network host) and fs operations. A new card that calls `fetch()` directly is
  **not** stopped by its own `permissions` declaration — its `execute` must
  call `guardedFetch` / the fs guard itself.
- Server-level env vars intersect with the declaration:
  `TOOL_NETWORK_ALLOW`, `TOOL_FS_ALLOW`, `TOOL_SUBPROCESS_ALLOW`.
- `danger: true` triggers a deterministic human approval on every call (the run
  halts, resumes after approve). This is the one guarantee that does not depend
  on sandboxing — use it for anything irreversible or externally visible.

---

## 4. Adding a Trigger (Automatic Run)

Triggers start a graph run without clicking the run button. They're stored in
`graph.triggers` and managed by `TriggerService` (`packages/server/src/triggers.ts`).

### Built-in trigger types

| Type | How it fires | Config |
|---|---|---|
| `webhook` | `POST /api/graphs/:id/webhook` with a secret | `{ webhookSecret }` |
| `cron` | Scheduled by `TriggerScheduler` (in-process) | `{ cron: "0 9 * * *" }` |
| `event` | When another graph finishes or an artifact is produced | `{ eventSource: { kind: "graph"|"artifact", id } }` |
| `batch` | One run per row from CSV or inline rows | `{ batch: { source: "csv"|"rows", path?, rows? } }` |

### Managing triggers

- **API**: `GET/POST /api/graphs/:id/triggers`, `DELETE /api/graphs/:id/triggers/:tid`
- **Manual fire**: `POST /api/graphs/:id/triggers/:tid/fire` (with optional payload)
- **Next runs**: `GET /api/graphs/:id/triggers/next-runs` (cron only)
- **UI**: the **触发器** panel in the board (top bar button)

### The run's `trigger` field

Every run records its trigger source in the `runs.trigger` column. The run
history panel shows it (manual / webhook / cron / event / batch + trigger id).

---

## 5. Adding a Node Type

Node types are defined in `packages/core/src/graph.ts` (`NodeKind` enum).
To add a new one:

1. Add the kind to `NodeKind`.
2. Add a config object (e.g. `MyNodeConfig`) and an optional field on `GraphNode`.
3. Create a handler file `packages/server/src/nodes/<kind>.ts` exporting a
   `async function <kind>Node(ctx: NodeRunContext, node, nodeId, attempt)`.
   Register it in the `NODE_HANDLERS` table at the top of
   `packages/server/src/engine.ts` (kinds missing from the table fall back to
   the agent/textGen handler — add an explicit entry unless your node is a
   text-generation variant).
   > Exceptions: `notify` intentionally stays inline in `runNode` (see the
   > comment there — an async boundary defers error-edge dispatch by a
   > microtask and breaks the "notify failure → catch node" contract).
4. Add a config panel in `apps/web/src/components/Inspector.tsx`.
5. Add a label in `apps/web/src/canvas/Plants.tsx` (`KIND_LABEL`).
6. Add a default in `apps/web/src/store/graph.ts` (`DEFAULTS`).
7. Add tests in `packages/server/src/engine.*.test.ts`.

See the `videoGen` / `audioGen` implementation (Batch 3) as a complete
reference — it touches exactly these seven points.

---

## Common Patterns

### Streaming text to the board

Yield `{ type: "text-delta", text }` chunks from `runAgent`. The board
appends them to the node's output in real time. Return the full `output` in
the final `AgentResult`.

### Retrying on failure

The engine handles technical-failure retries via `RetryPolicy`
(`maxRetries`, `baseDelayMs`, `maxDelayMs`). Throw a normal `Error` from
your worker method and the engine retries. Quality rework is separate —
that's the `gate` node's job.

### Soft-failing optional features

`generateVideo`, `generateAudio`, and `summarize` are optional on the `Worker`
interface. When absent, the engine logs a warning and marks the node `done`
with zero usage. This lets providers without video/audio support still work.

### Storing binary artifacts

Call `opts.storeBinary(data, mimeType, filename)` from the engine branch.
It returns a URI (local file path or S3 URL depending on `StorageBackend`).
Wrap it in an `Artifact` and emit `artifact.produced`.
