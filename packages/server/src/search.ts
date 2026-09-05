import type { SearchConfig } from "@agent-world/core";
import { withRetry } from "./retry.js";
import { outboundProxyDispatcher } from "./ssrf.js";

/**
 * Web search providers for the `search` node. `duckduckgo` works without any
 * API key (HTML endpoint, parsed with tolerant regexes); the other providers
 * resolve their credential **node first, user-level Settings next, env last** —
 * `search.apiKey` over the user's Settings 搜索服务 apiKey over
 * TAVILY_API_KEY / SERPAPI_API_KEY / GOOGLE_API_KEY, and `search.cx` over the
 * user's cx over GOOGLE_CX. A key typed into the Inspector or Settings
 * therefore takes effect on the next run without restarting the server, and
 * both are encrypted before they reach disk (see at-rest.ts).
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export class SearchAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchAuthError";
  }
}

/**
 * User-level web search service from Settings. Same shape as the search
 * node's own credential fields; resolution order is node → user → env.
 */
export interface UserSearchConfig {
  provider?: string;
  apiKey?: string;
  cx?: string;
}

/** Node value wins; the user-level Settings value is next; the env var is the deployment-wide fallback. */
function resolveCredential(
  nodeValue: string | undefined,
  userValue: string | undefined,
  envName: string,
  field: string,
): string {
  const fromNode = nodeValue?.trim();
  if (fromNode) return fromNode;
  const fromUser = userValue?.trim();
  if (fromUser) return fromUser;
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  throw new SearchAuthError(
    `缺少搜索凭证：节点的 ${field} 未填写，用户级设置（Settings → 搜索服务）与环境变量 ${envName} 也未配置（填在节点里无需重启 server）`,
  );
}

/** fetch with the optional outbound proxy dispatcher attached (AGENT_WORLD_PROXY). */
function outboundFetch(url: string, init?: RequestInit): Promise<Response> {
  const dispatcher = outboundProxyDispatcher();
  return fetch(url, { ...(init ?? {}), ...(dispatcher ? { dispatcher } : {}) } as RequestInit);
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .trim();
}

/** DDG result links are redirect wrappers: //duckduckgo.com/l/?uddg=<encoded>&rut=… */
function decodeDdgHref(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) return decodeURIComponent(m[1]!);
  return href.startsWith("http") ? href : "";
}

/** Match every <a …> tag whose class list contains `cls`, returning attrs + inner HTML. */
function anchorsByClass(html: string, cls: string): { attrs: string; inner: string }[] {
  const out: { attrs: string; inner: string }[] = [];
  const re = new RegExp(`<a\\b([^>]*\\bclass="[^"]*\\b${cls}\\b[^"]*"[^>]*)>([\\s\\S]*?)</a>`, "g");
  for (const m of html.matchAll(re)) out.push({ attrs: m[1]!, inner: m[2]! });
  return out;
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchHit[]> {
  const res = await outboundFetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!res.ok) throw new Error(`DuckDuckGo 返回 ${res.status}`);
  const html = await res.text();
  const links = anchorsByClass(html, "result__a");
  // Dogfood 2026-09-01: DDG serves a 202 anomaly/challenge page to scripted
  // clients — the response is "ok" but contains zero results. Fail loudly
  // instead of silently returning an empty hit list.
  //
  // The hint must not oversell retrying: across four dogfood attempts spanning
  // ~2 hours on the same network (runs 9f700bdf / 7bc85525 / fe74e23a /
  // 0f671a90) the challenge page was served every single time, so switching
  // provider is the only fix that has ever worked here. Earlier wording called
  // the block "usually intermittent", which sent operators into a retry loop.
  if (links.length === 0 && /anomaly|challenge|captcha/i.test(html)) {
    throw new Error(
      `DuckDuckGo 返回反爬验证页（无结果）。建议：① 在节点配置改用 tavily/serpapi/google 搜索源（对应密钥走环境变量，重启 server 生效）——已验证唯一可靠解；② 稍后重试仅当反爬确属偶发时有效（实测同一网络下连续 4 次、跨 2 小时均被拦，重试无用）`,
    );
  }
  const snippets = anchorsByClass(html, "result__snippet");
  const hits: SearchHit[] = [];
  for (const [i, link] of links.entries()) {
    if (hits.length >= maxResults) break;
    const href = link.attrs.match(/href="([^"]+)"/)?.[1] ?? "";
    const url = decodeDdgHref(href);
    const title = stripTags(link.inner);
    const snippet = snippets[i] ? stripTags(snippets[i]!.inner) : "";
    if (url && title) hits.push({ title, url, snippet });
  }
  return hits;
}

interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string }[];
}
interface SerpApiResponse {
  organic_results?: { title?: string; link?: string; snippet?: string }[];
}
interface GoogleResponse {
  items?: { title?: string; link?: string; snippet?: string }[];
}

async function searchTavily(query: string, cfg: SearchConfig, user?: UserSearchConfig): Promise<SearchHit[]> {
  const key = resolveCredential(cfg.apiKey, user?.apiKey, "TAVILY_API_KEY", "apiKey");
  const res = await outboundFetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: cfg.maxResults }),
  });
  if (res.status === 401 || res.status === 403) throw new SearchAuthError("Tavily API key 无效或过期");
  if (!res.ok) throw new Error(`Tavily 返回 ${res.status}`);
  const json = (await res.json()) as TavilyResponse;
  return (json.results ?? [])
    .filter((r) => r.url && r.title)
    .slice(0, cfg.maxResults)
    .map((r) => ({ title: r.title!, url: r.url!, snippet: r.content ?? "" }));
}

async function searchSerpApi(query: string, cfg: SearchConfig, user?: UserSearchConfig): Promise<SearchHit[]> {
  const key = resolveCredential(cfg.apiKey, user?.apiKey, "SERPAPI_API_KEY", "apiKey");
  // Audit L6: SerpAPI only authenticates via the api_key query parameter (no
  // header option). It stays in the query, but is protected by TLS in transit
  // and is never placed in logs or error messages (the throws below are static).
  const url = `https://serpapi.com/search?q=${encodeURIComponent(query)}&num=${cfg.maxResults}&api_key=${encodeURIComponent(key)}`;
  const res = await outboundFetch(url);
  if (res.status === 401 || res.status === 403) throw new SearchAuthError("SerpAPI key 无效或过期");
  if (!res.ok) throw new Error(`SerpAPI 返回 ${res.status}`);
  const json = (await res.json()) as SerpApiResponse;
  return (json.organic_results ?? [])
    .filter((r) => r.link && r.title)
    .slice(0, cfg.maxResults)
    .map((r) => ({ title: r.title!, url: r.link!, snippet: r.snippet ?? "" }));
}

async function searchGoogle(query: string, cfg: SearchConfig, user?: UserSearchConfig): Promise<SearchHit[]> {
  const key = resolveCredential(cfg.apiKey, user?.apiKey, "GOOGLE_API_KEY", "apiKey");
  const cx = resolveCredential(cfg.cx, user?.cx, "GOOGLE_CX", "cx");
  // Audit L6: the Google Custom Search JSON API accepts its key only as the
  // ?key= query parameter (no Authorization header). TLS protects it in
  // transit and the URL is never logged or surfaced in thrown errors.
  const url =
    `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}` +
    `&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${cfg.maxResults}`;
  const res = await outboundFetch(url);
  if (res.status === 401 || res.status === 403) throw new SearchAuthError("Google API key 无效或过期");
  if (!res.ok) throw new Error(`Google 返回 ${res.status}`);
  const json = (await res.json()) as GoogleResponse;
  return (json.items ?? [])
    .filter((r) => r.link && r.title)
    .slice(0, cfg.maxResults)
    .map((r) => ({ title: r.title!, url: r.link!, snippet: r.snippet ?? "" }));
}

/**
 * Run a web search with the configured provider, retrying transient faults.
 * Throws SearchAuthError on missing/invalid keys.
 *
 * The user-level service (Settings → 搜索服务) participates two ways:
 *  - credentials: node apiKey/cx → user-level → env var;
 *  - backend: a user-configured provider replaces the node's provider when the
 *    node sits on the keyless duckduckgo default (which is dead in practice —
 *    anti-bot). A node that explicitly picks a keyed provider keeps its choice,
 *    so per-node overrides still work.
 */
export async function searchWeb(query: string, cfg: SearchConfig, user?: UserSearchConfig): Promise<SearchHit[]> {
  try {
    return await withRetry(
      () => {
        const provider =
          user?.provider && cfg.provider === "duckduckgo" ? user.provider : cfg.provider;
        switch (provider) {
          case "tavily":
            return searchTavily(query, cfg, user);
          case "serpapi":
            return searchSerpApi(query, cfg, user);
          case "google":
            return searchGoogle(query, cfg, user);
          default:
            return searchDuckDuckGo(query, cfg.maxResults);
        }
      },
      cfg.retry,
      (err) => !(err instanceof SearchAuthError),
    );
  } catch (err) {
    if (err instanceof SearchAuthError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    // undici reports unreachable hosts/blocked networks as a bare "fetch failed"
    // — surface an actionable hint instead (dogfood 2026-09-01: DDG is not
    // directly reachable without an outbound proxy in some networks).
    if (/fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR/i.test(msg)) {
      throw new Error(
        `${msg} —— 本机网络无法直连该搜索源。可选：① 改用 tavily/serpapi/google 搜索源并在节点里填 apiKey（留空则回落环境变量 TAVILY_API_KEY / SERPAPI_API_KEY / GOOGLE_API_KEY+GOOGLE_CX，节点内填写无需重启 server）；② 为 server 进程配置出站代理后重启（环境变量 AGENT_WORLD_PROXY，注意 SSRF 校验语义变化，见 docs/design-code-sandbox.md）`,
      );
    }
    throw err;
  }
}
