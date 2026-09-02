import { z } from "zod";
import { SkillMount } from "./skill.js";

/**
 * A gate's `fail` edge points backwards, so the graph is not a DAG. The invariant
 * that keeps it executable: dropping every rework edge must leave a DAG, and each
 * rework edge must land on an ancestor of its gate within that DAG.
 */
export const NodeKind = z.enum([
  "source",
  "textGen",
  "gate",
  "sink",
  "imageGen",
  "videoGen",
  "audioGen",
  "http",
  "code",
  "branch",
  "map",
  "loop",
  "parallel",
  "table",
  "database",
  "fileParse",
  "translate",
  "ocr",
  "convert",
  "search",
  "notify",
  "vcs",
  "human",
  "subprocess",
  "generic",
]);
export type NodeKind = z.infer<typeof NodeKind>;

/**
 * UI palette grouping for node kinds. The category list/order and the
 * kind → category mapping are shared metadata so every consumer (canvas
 * toolbar, template docs, future node search) stays in sync.
 */
export type NodeCategory =
  | "generation" // AI 生成
  | "control" // 流程控制
  | "data" // 数据处理
  | "integrations" // 集成连接
  | "io"; // 输入输出

export interface NodeCategoryInfo {
  id: NodeCategory;
  label: string;
}

export const NODE_CATEGORIES: NodeCategoryInfo[] = [
  { id: "generation", label: "AI 加工" },
  { id: "control", label: "车间调度" },
  { id: "data", label: "物料处理" },
  { id: "integrations", label: "外接设备" },
  { id: "io", label: "投料出料" },
];

export const NODE_CATEGORY: Record<NodeKind, NodeCategory> = {
  textGen: "generation",
  imageGen: "generation",
  videoGen: "generation",
  audioGen: "generation",
  generic: "generation",
  gate: "control",
  branch: "control",
  map: "control",
  loop: "control",
  parallel: "control",
  subprocess: "control",
  table: "data",
  database: "data",
  fileParse: "data",
  convert: "data",
  translate: "data",
  ocr: "data",
  code: "data",
  http: "integrations",
  search: "integrations",
  notify: "integrations",
  vcs: "integrations",
  human: "integrations",
  source: "io",
  sink: "io",
};

export const EdgeKind = z.enum(["flow", "rework", "error"]);
/**
 * Edge semantics:
 * - flow: forward data flow (predecessor done → successor ready)
 * - rework: quality loop back (gate/textGen rejects → upstream rewrites)
 * - error: failure hand-off (a node that fails routes to a catch node, which
 *   becomes ready as soon as any error predecessor has failed)
 */
export type EdgeKind = z.infer<typeof EdgeKind>;

/** What a gate does once it has burned through `maxAttempts` without passing. */
export const ExhaustedPolicy = z.enum(["pass", "scrap", "halt"]);
export type ExhaustedPolicy = z.infer<typeof ExhaustedPolicy>;

/**
 * Technical-failure retry. Distinct from rework: rework is a quality rejection
 * (bumps attempt number), retry is a transient infra fault (does not).
 */
export const RetryPolicy = z.object({
  maxRetries: z.number().int().min(0).max(10).default(2),
  baseDelayMs: z.number().int().min(0).default(1000),
  maxDelayMs: z.number().int().min(0).default(30000),
});
export type RetryPolicy = z.infer<typeof RetryPolicy>;

/**
 * Controls how upstream artifacts are assembled into this textGen node input.
 * - all: concatenate every upstream output (default)
 * - last: only the most recent upstream output (sequential pipelines)
 * - truncate: concatenate but cap at maxChars, keeping the tail (most recent)
 * - summary: like all, but when the concatenated input exceeds maxChars it is
 *   compressed by an LLM summary (worker.summarize) instead of hard truncation;
 *   falls back to truncate when no summarizer is available or it fails
 */
export const InputPolicy = z.object({
  mode: z.enum(["all", "last", "truncate", "summary"]).default("all"),
  maxChars: z.number().int().min(500).optional(),
});
export type InputPolicy = z.infer<typeof InputPolicy>;

export const TextGenConfig = z.object({
  model: z.string().default("agnes-2.0-flash"),
  prompt: z.string().default(""),
  /** Mounted capability cards — tools, output contracts, prompt modules. */
  skills: z
    .array(z.union([z.string(), SkillMount]))
    .default([])
    .transform((arr) =>
      arr.map((s) => (typeof s === "string" ? { id: s, config: {}, enabled: true } : s)),
    ),
  temperature: z.number().min(0).max(2).default(0.7),
  timeoutMs: z.number().int().min(1000).default(120000),
  /** How to assemble input from upstream outputs. Defaults to concatenating all. */
  inputPolicy: InputPolicy.default({ mode: "all" }),
  /** Optional per-node hard ceiling in USD across all attempts. */
  budgetUsd: z.number().min(0).nullable().optional(),
  /**
   * Free-text layout directives for a product-layout textGen node (e.g. "主图用竖图 3:4
   * 居中；场景图卡 2 列网格"). Appended to the textGen node prompt so the next run honors
   * manual image-position overrides. See `withLayoutDirectives`.
   */
  imageDirectives: z.string().optional(),
  retry: RetryPolicy.default({ maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 }),
});
export type TextGenConfig = z.infer<typeof TextGenConfig>;

/** Configuration for an `imageGen` node: calls a text-to-image model to produce
 *  a banner / scene image when the source lacks real product photos. */
export const ImageGenConfig = z.object({
  model: z.string().min(1),
  prompt: z.string().optional(),
  size: z.string().optional(),
  /** Aspect ratio for the generated image; mapped to a provider size when `size` is unset. */
  aspect: z.enum(["1:1", "3:4", "4:3", "16:9"]).optional(),
  /** How many images to produce (1-8). Each becomes its own artifact. */
  n: z.number().int().min(1).max(8).default(1),
  /** Optional per-node endpoint override, e.g. a local SD / ComfyUI OpenAI-compatible server. */
  baseUrl: z.string().optional(),
  /** Optional per-node API key override. Falls back to the provider's key. */
  apiKey: z.string().optional(),
});
export type ImageGenConfig = z.infer<typeof ImageGenConfig>;

/** Configuration for a `videoGen` node: calls a text-to-video model to produce
 *  a short video clip. Provider support varies; the engine soft-fails when the
 *  worker lacks `generateVideo`. */
export const VideoGenConfig = z.object({
  model: z.string().min(1),
  prompt: z.string().optional(),
  /** Duration in seconds (provider-dependent, typically 4-15). */
  duration: z.number().int().min(1).max(60).optional(),
  /** Aspect ratio, e.g. "16:9" / "9:16" / "1:1". Mapped to provider params. */
  aspect: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]).optional(),
  /** Resolution / size string, passed through to the provider when set. */
  size: z.string().optional(),
  /** How many videos to produce (1-4). Each becomes its own artifact. */
  n: z.number().int().min(1).max(4).default(1),
  /** Optional per-node endpoint override. */
  baseUrl: z.string().optional(),
  /** Optional per-node API key override. */
  apiKey: z.string().optional(),
});
export type VideoGenConfig = z.infer<typeof VideoGenConfig>;

/** Configuration for an `audioGen` node: calls a text-to-speech / music model
 *  to produce audio. OpenAI `/audio/speech` is the most common compatible API. */
export const AudioGenConfig = z.object({
  model: z.string().min(1),
  /** Text to synthesize (TTS) or style prompt (music generation). */
  prompt: z.string().optional(),
  /** Voice identifier for TTS (e.g. "alloy", "echo", "fable"). */
  voice: z.string().optional(),
  /** Output format, e.g. "mp3", "wav", "opus", "aac". Defaults to "mp3". */
  format: z.enum(["mp3", "wav", "opus", "aac", "flac"]).default("mp3"),
  /** Speed multiplier (0.25-4.0) for TTS. */
  speed: z.number().min(0.25).max(4).optional(),
  /** How many audio clips to produce (1-4). */
  n: z.number().int().min(1).max(4).default(1),
  /** Optional per-node endpoint override. */
  baseUrl: z.string().optional(),
  /** Optional per-node API key override. */
  apiKey: z.string().optional(),
});
export type AudioGenConfig = z.infer<typeof AudioGenConfig>;

/** Configuration for a `generic` node: auto-dispatches by provider modality.
 *  Users pick any model; the engine detects via `modalityOf` and routes to
 *  runTextGen / generateImage / generateVideo / generateAudio accordingly. */
export const GenericConfig = z.object({
  model: z.string().min(1).default("agnes-2.0-flash"),
  prompt: z.string().optional(),
  /** Optional override; when absent the engine auto-detects via modalityOf(provider, model). */
  modality: z.enum(["text", "image", "video", "audio"]).optional(),

  // textGen params
  skills: z.array(z.union([z.string(), SkillMount])).default([]),
  temperature: z.number().min(0).max(2).optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  inputPolicy: InputPolicy.optional(),
  budgetUsd: z.number().min(0).nullable().optional(),

  // imageGen params
  size: z.string().optional(),
  aspect: z.enum(["1:1", "3:4", "4:3", "16:9"]).optional(),
  n: z.number().int().min(1).max(8).optional(),

  // videoGen params
  duration: z.number().int().min(1).max(60).optional(),

  // audioGen params
  voice: z.string().optional(),
  format: z.enum(["mp3", "wav", "opus", "aac", "flac"]).optional(),
  speed: z.number().min(0.25).max(4).optional(),

  retry: RetryPolicy.optional(),
  // common
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
});
export type GenericConfig = z.infer<typeof GenericConfig>;

/** Configuration for an `http` node: call an external REST API. */
export const HttpNodeConfig = z.object({
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
  /** Target URL; may contain variable interpolations like `${source.foo}`. */
  url: z.string().min(1),
  /** Extra request headers; values may contain variable interpolations. */
  headers: z.record(z.string()).default({}),
  /** URL query parameters; values may contain variable interpolations. */
  query: z.record(z.string()).default({}),
  /** Request body (string); may contain variable interpolations. */
  body: z.string().optional(),
  /** Request timeout in milliseconds. */
  timeoutMs: z.number().int().min(1000).default(30000),
  /**
   * How to expose the response body. `auto` picks json when Content-Type is
   * JSON. `file` stores the raw bytes as a `file` artifact (e.g. a downloaded
   * PDF / DOCX) so a downstream fileParse node can extract text and images.
   */
  outputMode: z.enum(["json", "text", "file", "auto"]).default("auto"),
  /** Treat non-2xx responses as node failures. */
  failOnError: z.boolean().default(true),
  /** Retry policy for transient failures (network drop, 5xx). 4xx and timeouts configured by timeoutMs are not retried. */
  retry: RetryPolicy.default({ maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 }),
});
export type HttpNodeConfig = z.infer<typeof HttpNodeConfig>;

/** Configuration for a `code` node: runs a JavaScript / Python script in a subprocess.
 *  The script receives one JSON object on stdin (`{"inputs": {<upstreamNodeId>: value}}`)
 *  and must write its result to stdout (a single JSON object/array becomes a `json`
 *  artifact; anything else becomes a `text` artifact). A non-zero exit code fails the node. */
export const CodeNodeConfig = z.object({
  language: z.enum(["javascript", "python"]).default("javascript"),
  /** Script body. See the contract above. */
  code: z.string().default(""),
  /** Kill the subprocess after this many milliseconds. */
  timeoutMs: z.number().int().min(1000).default(30000),
  /** Retry policy for transient failures (subprocess crash, not non-zero exit which is a business error). */
  retry: RetryPolicy.default({ maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 }),
  /** Env var names allowed to reach the sandboxed subprocess (beyond a safe
   *  base of PATH/HOME/TMPDIR/…). The server's own secrets are never forwarded. */
  env: z.array(z.string()).default([]),
  /** Filesystem policy. "sandbox" (default): the subprocess may only read and
   *  write its per-run workdir. "allowlist": additionally grant READ access to
   *  the server's TOOL_FS_ALLOW prefixes — writes stay workdir-only. */
  fs: z.enum(["sandbox", "allowlist"]).default("sandbox"),
  /** Network policy. "none" (default): all network denied. "allowlist" is
   *  reserved for a future SSRF-checked proxy and rejected by the engine
   *  until it actually exists — never pretend to allow. */
  net: z.enum(["none", "allowlist"]).default("none"),
});
export type CodeNodeConfig = z.infer<typeof CodeNodeConfig>;

/** One conditional branch: route downstream when `when` evaluates to truthy. */
export const BranchRule = z.object({
  id: z.string().min(1),
  /** Condition expression, e.g. `"${scraper.ok} == true && ${scraper.count} > 3"`. */
  when: z.string().default("true"),
  /** Downstream node id to route to when this rule matches. */
  target: z.string().min(1),
});
export type BranchRule = z.infer<typeof BranchRule>;

/** Configuration for a `branch` node: if/else-style routing of the packet. */
export const BranchConfig = z.object({
  /** Ordered rules; the first one whose `when` is truthy wins. */
  rules: z.array(BranchRule).default([]),
  /** Downstream node id to route to when no rule matches. Omit to drop the packet. */
  defaultTarget: z.string().optional(),
});
export type BranchConfig = z.infer<typeof BranchConfig>;

/**
 * Configuration for a `map` node: declarative JSON mapping / transformation.
 * The `template` is a JSON document whose string values may contain `${...}`
 * placeholders (e.g. `"title": "编号 ${item.id}"`). Placeholders can reference
 * any upstream node (`${api.data.price}`) and — when iterating or mapping a
 * single source — the current item via `item` (`${item.name}`). A value that
 * is a pure placeholder (`"${item.address}"`) keeps the referenced type
 * (object/array/number), everything else is string interpolation.
 * With `iterate` set, the source value at that JSON path must be an array and
 * the node emits an array with one transformed copy per element.
 */
export const MapConfig = z.object({
  /** Which upstream node to read from. Defaults to the single flow predecessor. */
  source: z.string().optional(),
  /** Optional JSON path into the source value holding an array to iterate (e.g. "data.items"). */
  iterate: z.string().optional(),
  /** Output template: a JSON document (object/array/scalar) with ${...} placeholders. */
  template: z.string().default("{}"),
});
export type MapConfig = z.infer<typeof MapConfig>;

/**
 * Configuration for a `loop` node: executes the downstream sub-graph once per
 * element of an array and aggregates each round's terminal output into a
 * `{ results: [...] }` JSON artifact. Inside the loop body, the current
 * element is available as `item` (via `${item.xxx}` in node configs and as
 * `inputs.item` in code-node scripts).
 */
export const LoopConfig = z.object({
  /** Expression resolving to the array to iterate, e.g. "${api.data}". Defaults to the single flow predecessor's value. */
  items: z.string().optional(),
  /** Hard cap on iterations (safety). Longer arrays are truncated. */
  maxIterations: z.number().int().min(1).max(1000).default(100),
});
export type LoopConfig = z.infer<typeof LoopConfig>;

/**
 * Configuration for a `parallel` node: a barrier join that waits for every
 * flow predecessor to finish and aggregates their outputs into one structured
 * JSON artifact. Branches run concurrently on their own (the engine schedules
 * independent paths in parallel); this node adds explicit aggregation.
 */
export const ParallelConfig = z.object({
  /** true → output an object keyed by upstream node id; false → an array of values. */
  asObject: z.boolean().default(false),
  /** Optional JSON path to extract from each upstream value (e.g. "data.text"). */
  pick: z.string().optional(),
});
export type ParallelConfig = z.infer<typeof ParallelConfig>;

/** One row of a table: column name → scalar value. */
export type TableRow = Record<string, string | number | boolean | null>;

/**
 * A `table` node step: an ordered transform over a row set.
 * - parse: turn upstream CSV text (or JSON rows) into a table.
 * - filter: keep rows where `column` satisfies `operator` vs `value`.
 * - sort: order rows by `column`.
 * - aggregate: group rows by `groupBy` (optional) and compute `aggs`.
 * - output: choose the final artifact format (json rows object or CSV text).
 */
export const TableStep = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("parse"),
    /** "csv" parses the text with `delimiter`; "json" parses a JSON array of row objects. */
    format: z.enum(["csv", "json"]).default("csv"),
    /** Whether the first CSV line holds column names. */
    hasHeader: z.boolean().default(true),
    /** Field separator for CSV parsing (e.g. "," or "\t"). */
    delimiter: z.string().min(1).max(4).default(","),
  }),
  z.object({
    op: z.literal("filter"),
    column: z.string().min(1),
    operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "contains"]).default("eq"),
    /** Comparison value (compared numerically when both sides are numbers). */
    value: z.string().default(""),
  }),
  z.object({
    op: z.literal("sort"),
    column: z.string().min(1),
    direction: z.enum(["asc", "desc"]).default("asc"),
  }),
  z.object({
    op: z.literal("aggregate"),
    /** Group by this column; without it the whole table is one group. */
    groupBy: z.string().optional(),
    aggs: z
      .array(
        z.object({
          column: z.string().min(1),
          fn: z.enum(["count", "sum", "avg", "min", "max"]).default("count"),
          /** Output column name; defaults to `${fn}_${column}`. */
          as: z.string().optional(),
        }),
      )
      .min(1),
  }),
  z.object({
    op: z.literal("output"),
    format: z.enum(["json", "csv"]).default("json"),
  }),
]);
export type TableStep = z.infer<typeof TableStep>;

/**
 * Configuration for a `table` node: parse, filter, sort, and aggregate tabular
 * data. The node reads its single flow predecessor (or `source`) and applies
 * the ordered `steps`. Input may be CSV text (parse first), a JSON array of row
 * objects, or `{ rows: [...] }`. The final artifact is `{ rows, count, columns }`;
 * an `output: csv` step additionally produces a CSV text artifact.
 */
export const TableConfig = z.object({
  /** Which upstream node to read from. Defaults to the single flow predecessor. */
  source: z.string().optional(),
  /** Ordered transforms applied to the row set. */
  steps: z.array(TableStep).default([]),
});
export type TableConfig = z.infer<typeof TableConfig>;

/**
 * Configuration for a `database` node: execute SQL against a database and emit
 * the result set. First implementation supports SQLite (zero new dependency —
 * `node:sqlite`). The driver abstraction leaves room for MySQL/PostgreSQL/
 * MongoDB drivers later. Query results are emitted as `{ rows, count, columns }`
 * so they can feed a downstream `table` node directly; DML statements emit
 * `{ affectedRows, lastInsertId }`.
 */
export const DatabaseConfig = z.object({
  /** SQLite database file path. Empty → in-memory database (per-run, volatile). */
  path: z.string().optional(),
  /**
   * Optional setup statements executed once before `sql` (e.g. `CREATE TABLE …;
   * INSERT …;`). Multiple statements separated by `;` are allowed; results are
   * discarded. Enables in-memory pipelines: create a table, then query it.
   */
  setupSql: z.string().default(""),
  /** The main SQL statement (single). Query statements return rows. */
  sql: z.string().default(""),
  /** Positional parameters bound to `?` placeholders in `sql`. */
  positionalParams: z.array(z.unknown()).optional(),
  /** Named parameters bound to `:name` / `@name` / `$name` placeholders in `sql`. */
  namedParams: z.record(z.string(), z.unknown()).optional(),
});
export type DatabaseConfig = z.infer<typeof DatabaseConfig>;

/**
 * Configuration for a `fileParse` node: extract text and embedded images from
 * an upstream `file` artifact. Supported formats: PDF (via unpdf) and Office
 * Open XML documents (DOCX / PPTX, via ZIP + XML extraction). The extracted
 * text becomes a `text` artifact consumed by downstream textGen nodes; extracted
 * images become `image` artifacts.
 */
export const FileParseConfig = z.object({
  /** Which upstream node's `file` artifact to parse. Defaults to the single flow predecessor. */
  source: z.string().optional(),
  /** Maximum embedded images to extract per file (0 = none). */
  maxImages: z.number().int().min(0).max(100).default(20),
});
export type FileParseConfig = z.infer<typeof FileParseConfig>;

/**
 * Configuration for a `translate` node: translate an upstream node's text into
 * a target language via LLM. The translated text becomes a `text` artifact,
 * so any downstream agent can consume it directly. Pairs naturally with a
 * `fileParse` node (extract document text first, then translate it).
 */
export const TranslateConfig = z.object({
  /** Which upstream node's text to translate. Defaults to the single flow predecessor. */
  source: z.string().optional(),
  /** Target language, free-form, e.g. "简体中文", "English", "日本語". */
  target: z.string().min(1).default("简体中文"),
  /** Model id; defaults to the graph's fallback model when omitted. */
  model: z.string().optional(),
  /** Sampling temperature — lower keeps translations faithful. */
  temperature: z.number().min(0).max(2).default(0.2),
  /** Optional per-node spend cap in USD. */
  budgetUsd: z.number().nonnegative().optional(),
  /** Retry policy for transient LLM failures (TIMEOUT / RATE_LIMIT / PROVIDER_ERROR). */
  retry: RetryPolicy.default({ maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 }),
});
export type TranslateConfig = z.infer<typeof TranslateConfig>;

/**
 * Configuration for an `ocr` node: run OCR (tesseract.js — WASM, no native
 * deps) over an upstream node's `image` artifacts and emit the recognised text
 * as a `text` artifact. Pairs naturally with a `fileParse` node (extract
 * embedded images from a PDF/DOCX/PPTX first, then OCR them) or an `imageGen`
 * node (read text back out of a generated image).
 */
export const OcrConfig = z.object({
  /** Which upstream node's images to recognise. Defaults to the single flow predecessor. */
  source: z.string().optional(),
  /** Tesseract language code(s), comma-separated (e.g. "eng", "chi_sim", "chi_sim+eng"). */
  lang: z.string().min(1).default("eng"),
  /**
   * Where to fetch `.traineddata.gz` language files from: an official-CDN URL or
   * a local directory (air-gapped). Unset uses the official CDN. HTTP(S) sources
   * are checked against the operator allowlist at run time, never before.
   */
  langPath: z.string().min(1).optional(),
  /**
   * Override for the tesseract worker script — a local path, or an allowlisted
   * host. Leave unset under Node: the runtime resolves the bundled script, and
   * a worker_threads URL here would be rejected outright.
   */
  workerPath: z.string().min(1).optional(),
  /** Override for the tesseract-core WASM, same rules as `workerPath`. */
  corePath: z.string().min(1).optional(),
});
export type OcrConfig = z.infer<typeof OcrConfig>;

/**
 * Configuration for a `convert` node: convert an upstream artifact into
 * another format. Supported conversions:
 * - pdf → image (`to: "image"`): extract every embedded image from a PDF —
 *   scanned pages come out as one image each, pairing naturally with `ocr`.
 * - image → png / jpeg (`to: "png" | "jpeg"`): re-encode upstream image
 *   artifacts (format detected by magic bytes; quality only applies to jpeg).
 */
export const ConvertConfig = z.object({
  /** Which upstream node to convert. Defaults to the single flow predecessor. */
  source: z.string().optional(),
  /** Target format: "image" = extract embedded images from a PDF, "png"/"jpeg" = re-encode images. */
  to: z.enum(["image", "png", "jpeg"]),
  /** JPEG encoding quality, 1-100. Only used when `to` is "jpeg". */
  quality: z.number().int().min(1).max(100).default(85),
});
export type ConvertConfig = z.infer<typeof ConvertConfig>;

/**
 * Configuration for a `search` node: run a web search and emit the results as
 * `text` (readable list) + `json` artifacts. `duckduckgo` needs no API key
 * (default). For the other providers the credential resolves **node value first,
 * then the server env** (`apiKey` → TAVILY_API_KEY / SERPAPI_API_KEY /
 * GOOGLE_API_KEY, `cx` → GOOGLE_CX), so a key typed into the node works without
 * restarting the server and one deployment can serve several accounts. A node
 * `apiKey` is encrypted before it touches disk, so it never appears in
 * plaintext in graphs.doc, version snapshots or run snapshots.
 *
 * There is deliberately no `baseUrl` override here: the search adapters fetch
 * through the proxy-aware path but not through `guardedFetch`, so a
 * user-controlled host would open an SSRF surface the http node does not have.
 *
 * When `query` is empty the upstream text artifact is searched instead — pairs
 * with an textGen node that generates queries.
 */
export const SearchConfig = z.object({
  /** Static search query; falls back to the upstream text artifact when empty. */
  query: z.string().default(""),
  /** Search backend. */
  provider: z.enum(["duckduckgo", "tavily", "serpapi", "google"]).default("duckduckgo"),
  /** Maximum number of results to return. */
  maxResults: z.number().int().min(1).max(20).default(5),
  /** Provider key for this node; falls back to the provider's env var. */
  apiKey: z.string().optional(),
  /** Google Custom Search engine id (provider = google); falls back to GOOGLE_CX. */
  cx: z.string().optional(),
  /** Retry policy for transient failures (network drop, 5xx). Auth and provider rejections are not retried. */
  retry: RetryPolicy.default({ maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 }),
});
export type SearchConfig = z.infer<typeof SearchConfig>;

/**
 * Configuration for a `notify` node: send a message to a chat channel or an
 * email address and emit the delivery result as a `json` artifact. Group-bot
 * providers (feishu/dingtalk/wecom) take the bot's webhook URL in the node
 * config — one graph can notify different groups; email reads SMTP credentials
 * from env (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM) so the
 * password never enters the graph. When `message` is empty the upstream text
 * artifact is sent instead — the classic "search → summarize → notify" tail.
 */
export const NotifyConfig = z.object({
  /** Delivery channel. */
  provider: z.enum(["feishu", "dingtalk", "wecom", "slack", "email"]),
  /**
   * Output format. "text" (default) sends plain text; "markdown" sends a
   * rendered message — dingtalk/wecom use their native markdown msgtype,
   * feishu wraps the message in an interactive card's markdown element.
   * Email always sends plain text (HTML rendering needs a markdown lib, P2).
   */
  format: z.enum(["text", "markdown"]).default("text"),
  /** Static message body; falls back to the upstream text artifact when empty. */
  message: z.string().default(""),
  /** Group-bot webhook URL (feishu / dingtalk / wecom). */
  webhookUrl: z.string().url().optional(),
  /** DingTalk signed-bot secret (optional, only for dingtalk). */
  secret: z.string().optional(),
  /** Recipient email address (provider = email). */
  to: z.string().email().optional(),
  /** Email subject; defaults to the node name. */
  subject: z.string().optional(),
  /** Slack channel id (provider = slack). */
  channel: z.string().optional(),
  /** Retry policy for transient delivery failures (network/5xx). Auth and provider-rejected errors are not retried. */
  retry: RetryPolicy.default({ maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 }),
});
export type NotifyConfig = z.infer<typeof NotifyConfig>;

/**
 * Configuration for a `vcs` node: perform a version-control action on GitHub
 * or GitLab (create PR/MR, comment on an issue/PR, trigger a workflow/pipeline,
 * list issues) and emit the API result as a `json` artifact. The credential
 * resolves **node value first, then the server env** (`token` → GITHUB_TOKEN /
 * GITLAB_TOKEN, `baseUrl` → GITLAB_API_URL), so a token typed into the node
 * works without restarting the server and one graph can act on two accounts. A
 * node `token` is encrypted before it touches disk, so it never appears in
 * plaintext in graphs.doc, version snapshots or run snapshots.
 *
 * A node-controlled `baseUrl` is safe here (and only here among these adapters)
 * because every vcs request goes through `guardedFetch`, so a self-hosted
 * GitLab host is still subject to the same SSRF checks as the http node.
 *
 * `body`/`title` fall back to the upstream text artifact when empty — pairs
 * with an textGen node that drafts a PR description or issue body.
 *
 * Future providers (Bitbucket, Gitea, …) fit the same provider/action shape;
 * the four actions here cover the bulk of automation needs.
 */
export const VcsConfig = z.object({
  /** VCS provider. */
  provider: z.enum(["github", "gitlab"]).default("github"),
  /** Action to perform. */
  action: z.enum(["create_pr", "comment_issue", "trigger_workflow", "list_issues"]),
  /** Access token for this node; falls back to GITHUB_TOKEN / GITLAB_TOKEN. */
  token: z.string().optional(),
  /** Self-hosted GitLab API base (e.g. https://git.corp.example/api/v4); falls back to GITLAB_API_URL. */
  baseUrl: z
    .string()
    .url()
    // `.url()` alone accepts opaque schemes ("git.corp:8080" parses as scheme
    // `git`), which would fail later inside the SSRF guard with a message about
    // an empty hostname. Say what is actually wrong, at the field.
    .refine((u) => /^https?:\/\//i.test(u), "baseUrl must be an http(s) URL")
    .optional(),
  /** GitHub: repo owner (e.g. "bayernjf"). */
  owner: z.string().optional(),
  /** GitHub: repo name (e.g. "one-world"). */
  repo: z.string().optional(),
  /** GitLab: project id or URL-encoded path (e.g. 42 or "group/proj"). */
  projectId: z.string().optional(),
  /** PR/MR title (create_pr); defaults to the node name. */
  title: z.string().optional(),
  /** PR/MR/issue body; falls back to the upstream text artifact when empty. */
  body: z.string().default(""),
  /** Source branch for create_pr (e.g. "feature/x"). */
  head: z.string().optional(),
  /** Target branch for create_pr (e.g. "main"). */
  base: z.string().optional(),
  /** Issue/PR number for comment_issue. */
  number: z.number().int().positive().optional(),
  /** Workflow id (GitHub) or pipeline ref (GitLab) for trigger_workflow. */
  workflowId: z.string().optional(),
  /** Ref (branch) to trigger the workflow/pipeline on. */
  ref: z.string().optional(),
  /** Workflow/pipeline inputs. */
  inputs: z.record(z.string()).optional(),
  /** Issue state filter for list_issues. */
  state: z.enum(["open", "closed", "all"]).optional(),
  /** Which upstream node to take body/title from. Defaults to the single flow predecessor. */
  source: z.string().optional(),
  /** Retry policy for transient API failures. */
  retry: RetryPolicy.default({ maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 }),
});
export type VcsConfig = z.infer<typeof VcsConfig>;

/**
 * Configuration for a `human` node: pause the run at an arbitrary point and
 * wait for an operator's decision. The upstream text is shown to the operator
 * as the pending review; `prompt` is an optional instruction displayed above it.
 * On approve/edit the node passes (edited content replaces the upstream text);
 * on reject the node fails (routing to an `error` edge when one exists, or the
 * run fails).
 */
export const HumanConfig = z.object({
  /** Instruction/prompt shown to the operator, e.g. "确认这段文案是否可以发布"。 */
  prompt: z.string().default(""),
});
export type HumanConfig = z.infer<typeof HumanConfig>;

/**
 * Subprocess node: call another saved graph as a sub-flow (function-call
 * semantics). The upstream text becomes the sub-flow's source input; every
 * sink node of the sub-flow feeds the subprocess node's output back up.
 */
export const SubprocessConfig = z.object({
  /** Graph id of the sub-flow to call (a different row in the graphs table). */
  graphId: z.string().min(1),
  /** Max call depth, guarding against mutual recursion. Default 3. */
  maxDepth: z.number().int().min(1).max(10).default(3),
});
export type SubprocessConfig = z.infer<typeof SubprocessConfig>;

export const GateConfig = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  criterion: z.string().default(""),
  onExhausted: ExhaustedPolicy.default("halt"),
  /**
   * Optional quality bar (0-10). When set and the judge returns a score below
   * it, the gate fails regardless of the boolean verdict — this is how a quality
   * score "links back" into the gate decision and feeds the eval report.
   */
  minScore: z.number().min(0).max(10).optional(),
  /**
   * Optional brand-term coverage bar (0-1). When set, the gate computes how
   * many of the upstream brand terms appear in the artifact and fails (sending
   * it back upstream to rewrite) if coverage is below this threshold.
   */
  minBrandCoverage: z.number().min(0).max(1).optional(),
});
export type GateConfig = z.infer<typeof GateConfig>;

export const ConnectorType = z.enum(["manual", "file", "http", "form", "database"]);
export type ConnectorType = z.infer<typeof ConnectorType>;

/** Pulls text/images from the local filesystem (path or glob). */
export const FileConnector = z.object({
  path: z.string(),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  /** Treat matched files as images (emit image URLs) instead of text. */
  asImages: z.boolean().default(false),
});
export type FileConnector = z.infer<typeof FileConnector>;

/** Fetches data over HTTP(S); optional field extraction maps the response to source text. */
export const HttpConnector = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string()).optional(),
  auth: z.object({ type: z.enum(["basic", "bearer"]), token: z.string() }).optional(),
  /** If set, only these dot-paths of the response become the source text. */
  extract: z.array(z.string()).optional(),
  body: z.unknown().optional(),
});
export type HttpConnector = z.infer<typeof HttpConnector>;

/** A form the user fills before a run; answers are injected as source text. */
export const FormConnector = z.object({
  fields: z
    .array(
      z.object({
        name: z.string(),
        label: z.string().optional(),
        required: z.boolean().default(false),
      }),
    )
    .default([]),
});
export type FormConnector = z.infer<typeof FormConnector>;

/** Pulls rows from a SQL database; the query result becomes the source text. */
export const DatabaseConnector = z.object({
  /** sqlite only for now (Node built-in driver, zero deps, no secret in config). */
  driver: z.enum(["sqlite"]).default("sqlite"),
  /** SQLite database file path (resolved like the file connector's paths). */
  path: z.string(),
  /** Read-only query; must be a single SELECT / WITH…SELECT — writes are rejected. */
  query: z.string(),
  /** Optional bind parameters (positional `?` placeholders), for injection safety. */
  params: z.array(z.unknown()).optional(),
  /** Result serialization: json (pretty) or csv (header row + value rows). */
  format: z.enum(["json", "csv"]).default("json"),
});
export type DatabaseConnector = z.infer<typeof DatabaseConnector>;

/** Declarative data source for a source node. Replaces the old free-form connector stub. */
export const ConnectorConfig = z.object({
  type: ConnectorType,
  file: FileConnector.optional(),
  http: HttpConnector.optional(),
  form: FormConnector.optional(),
  database: DatabaseConnector.optional(),
});
export type ConnectorConfig = z.infer<typeof ConnectorConfig>;

/**
 * A document attached to a source node. The bytes are already in the artifact
 * store (`POST /api/artifacts/upload` returns this shape); the node only points
 * at them, so the graph stays a set of references like `images`.
 */
export const SourceFile = z.object({
  uri: z.string().min(1),
  /** Original filename — shown in the inspector and carried onto the artifact. */
  label: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type SourceFile = z.infer<typeof SourceFile>;

export const SourceConfig = z.object({
  /** Reference image URLs fed to vision-capable downstream textGen nodes. */
  images: z.array(z.string()).optional(),
  /** Uploaded documents. The engine materializes each one as a kind="file"
   *  artifact at dispatch, which is what a downstream fileParse node reads —
   *  without this, a "投文件" source node had no way to produce a file at all
   *  (dogfood 2026-09-01: tpl-contract-review). */
  files: z.array(SourceFile).optional(),
  /** Product name / short title used in generated content. */
  productName: z.string().optional(),
  /** Brand or shop name. */
  brand: z.string().optional(),
  /** Target audience, e.g. "20-30岁通勤女生". */
  audience: z.string().optional(),
  /** Price positioning, e.g. "中端 99-199 元". */
  priceRange: z.string().optional(),
  /** Desired tone, e.g. "真诚种草、口语化". */
  tone: z.string().optional(),
  /** Comma/newline separated words or claims that must not appear. */
  prohibited: z.string().optional(),
  /** Comma/newline separated brand words the writer should weave in. */
  brandTerms: z.string().optional(),
  /** Free-form extra notes for the writers. */
  notes: z.string().optional(),
  /** Declarative data source (file/http/form). When set, the engine pulls raw
   *  material from it instead of relying on the manual text fields above. */
  connector: ConnectorConfig.optional(),
  /** Future: expected input schema for this source. */
  inputSchema: z.unknown().optional(),
});
export type SourceConfig = z.infer<typeof SourceConfig>;

/**
 * Node ids end up interpolated into artifact keys (`${id}-text`, `${id}-img0`,
 * …) that the storage layer joins onto a base directory, so they must be a
 * tight charset with no path separators or traversal segments. Client-side
 * generators (web store, template instantiation) already produce this shape.
 */
export const NodeId = z
  .string()
  .regex(/^[A-Za-z0-9]+[A-Za-z0-9._-]*$/, "id must be [A-Za-z0-9._-], start with an alphanumeric")
  .max(64);
export type NodeId = z.infer<typeof NodeId>;

export const GraphNode = z.object({
  id: NodeId,
  kind: NodeKind,
  name: z.string().min(1),
  /** Canvas position of the plant's centre, in view units. */
  x: z.number(),
  y: z.number(),
  textGen: TextGenConfig.optional(),
  gate: GateConfig.optional(),
  imageGen: ImageGenConfig.optional(),
  videoGen: VideoGenConfig.optional(),
  audioGen: AudioGenConfig.optional(),
  generic: GenericConfig.optional(),
  http: HttpNodeConfig.optional(),
  code: CodeNodeConfig.optional(),
  branch: BranchConfig.optional(),
  map: MapConfig.optional(),
  loop: LoopConfig.optional(),
  parallel: ParallelConfig.optional(),
  table: TableConfig.optional(),
  database: DatabaseConfig.optional(),
  fileParse: FileParseConfig.optional(),
  translate: TranslateConfig.optional(),
  ocr: OcrConfig.optional(),
  convert: ConvertConfig.optional(),
  search: SearchConfig.optional(),
  notify: NotifyConfig.optional(),
  vcs: VcsConfig.optional(),
  human: HumanConfig.optional(),
  subprocess: SubprocessConfig.optional(),
  source: SourceConfig.optional(),
});
export type GraphNode = z.infer<typeof GraphNode>;

export const GraphEdge = z.object({
  id: z.string().min(1),
  from: z.string(),
  to: z.string(),
  kind: EdgeKind,
});
export type GraphEdge = z.infer<typeof GraphEdge>;

export const TriggerType = z.enum(["manual", "webhook", "cron", "event", "batch"]);
export type TriggerType = z.infer<typeof TriggerType>;

/**
 * A trigger that can start a graph run automatically. The execution logic
 * (webhook endpoint, cron scheduler, event bus, batch runner) is wired in the
 * server; this schema only captures configuration.
 */
export const TriggerConfig = z.object({
  id: z.string().min(1),
  type: TriggerType,
  /** Cron expression; required when type === "cron". */
  cron: z.string().optional(),
  /** Shared secret validated by the webhook endpoint; required when type === "webhook". */
  webhookSecret: z.string().optional(),
  /** For type === "event": which graph/artifact event starts this run. */
  eventSource: z.object({ kind: z.enum(["graph", "artifact"]), id: z.string() }).optional(),
  /** For type === "batch": how input rows are sourced. */
  batch: z
    .object({
      source: z.enum(["csv", "rows"]),
      path: z.string().optional(),
      rows: z.array(z.record(z.string())).optional(),
    })
    .optional(),
  /** Whether the trigger is currently active. */
  enabled: z.boolean().default(true),
});
export type TriggerConfig = z.infer<typeof TriggerConfig>;

export const Graph = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  /** Automatic run triggers (webhook/cron/event/batch). Absent = manual only. */
  triggers: z.array(TriggerConfig).optional(),
  /**
   * Graph-level default variables (key → JSON value). Persisted values from a
   * prior run (the `graph_variables` table) override these at run start.
   * Nodes can read them via `${var.xxx}` and agents can update them through the
   * built-in `set_variable` / `get_variable` tools.
   */
  variables: z.record(z.unknown()).optional(),
});
export type Graph = z.infer<typeof Graph>;

export function nodeById(graph: Graph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

export function outgoing(graph: Graph, id: string, kind?: EdgeKind): GraphEdge[] {
  return graph.edges.filter((e) => e.from === id && (!kind || e.kind === kind));
}

export function incoming(graph: Graph, id: string, kind?: EdgeKind): GraphEdge[] {
  return graph.edges.filter((e) => e.to === id && (!kind || e.kind === kind));
}
