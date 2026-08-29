import type { SearchConfig } from "@agent-world/core";

/**
 * Web search providers for the `search` node. `duckduckgo` works without any
 * API key (HTML endpoint, parsed with tolerant regexes); the other providers
 * read their credentials from env vars at run time so no secret is stored in
 * the graph: TAVILY_API_KEY / SERPAPI_API_KEY / GOOGLE_API_KEY + GOOGLE_CX.
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new SearchAuthError(`缺少环境变量 ${name}（${name} 未配置时无法使用该搜索源）`);
  return v;
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
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!res.ok) throw new Error(`DuckDuckGo 返回 ${res.status}`);
  const html = await res.text();
  const links = anchorsByClass(html, "result__a");
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

async function searchTavily(query: string, maxResults: number): Promise<SearchHit[]> {
  const key = requireEnv("TAVILY_API_KEY");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: maxResults }),
  });
  if (res.status === 401 || res.status === 403) throw new SearchAuthError("Tavily API key 无效或过期");
  if (!res.ok) throw new Error(`Tavily 返回 ${res.status}`);
  const json = (await res.json()) as TavilyResponse;
  return (json.results ?? [])
    .filter((r) => r.url && r.title)
    .slice(0, maxResults)
    .map((r) => ({ title: r.title!, url: r.url!, snippet: r.content ?? "" }));
}

async function searchSerpApi(query: string, maxResults: number): Promise<SearchHit[]> {
  const key = requireEnv("SERPAPI_API_KEY");
  const url = `https://serpapi.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) throw new SearchAuthError("SerpAPI key 无效或过期");
  if (!res.ok) throw new Error(`SerpAPI 返回 ${res.status}`);
  const json = (await res.json()) as SerpApiResponse;
  return (json.organic_results ?? [])
    .filter((r) => r.link && r.title)
    .slice(0, maxResults)
    .map((r) => ({ title: r.title!, url: r.link!, snippet: r.snippet ?? "" }));
}

async function searchGoogle(query: string, maxResults: number): Promise<SearchHit[]> {
  const key = requireEnv("GOOGLE_API_KEY");
  const cx = requireEnv("GOOGLE_CX");
  const url =
    `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}` +
    `&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${maxResults}`;
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) throw new SearchAuthError("Google API key 无效或过期");
  if (!res.ok) throw new Error(`Google 返回 ${res.status}`);
  const json = (await res.json()) as GoogleResponse;
  return (json.items ?? [])
    .filter((r) => r.link && r.title)
    .slice(0, maxResults)
    .map((r) => ({ title: r.title!, url: r.link!, snippet: r.snippet ?? "" }));
}

/** Run a web search with the configured provider. Throws SearchAuthError on missing/invalid keys. */
export async function searchWeb(query: string, cfg: SearchConfig): Promise<SearchHit[]> {
  switch (cfg.provider) {
    case "tavily":
      return searchTavily(query, cfg.maxResults);
    case "serpapi":
      return searchSerpApi(query, cfg.maxResults);
    case "google":
      return searchGoogle(query, cfg.maxResults);
    default:
      return searchDuckDuckGo(query, cfg.maxResults);
  }
}
