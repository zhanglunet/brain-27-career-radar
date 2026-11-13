/** 博查 Web Search API 实现（接口格式对照博查官方 MCP 服务器源码）。 */
import { cleanApiKey } from "../llm/deepseek.ts";
import { SearchError } from "./types.ts";
import type { SearchHit, SearchProvider } from "./types.ts";

const ENDPOINT = "https://api.bochaai.com/v1/web-search";

type BochaItem = { name?: unknown; url?: unknown; summary?: unknown; siteName?: unknown; datePublished?: unknown };

const strOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

export function createBochaProvider(opts: { apiKey: string; fetch: typeof fetch; timeoutMs?: number }): SearchProvider {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  return {
    async search(query: string): Promise<SearchHit[]> {
      const apiKey = cleanApiKey(opts.apiKey);
      if (!apiKey) throw new SearchError("博查 key 含有非法字符");
      let response: Response;
      const fetchFn = opts.fetch;
      try {
        response = await fetchFn(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query, summary: true, freshness: "oneYear", count: 10 }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new SearchError("博查请求失败");
      }
      if (!response.ok) throw new SearchError(`博查返回 ${response.status}`);
      let body: { data?: { webPages?: { value?: BochaItem[] } } };
      try {
        body = await response.json();
      } catch {
        throw new SearchError("博查响应不是 JSON");
      }
      if (!body || typeof body !== "object" || !body.data) throw new SearchError("博查响应缺少 data");
      const items = Array.isArray(body.data.webPages?.value) ? body.data.webPages.value : [];
      const hits: SearchHit[] = [];
      for (const item of items) {
        const url = strOrNull(item.url);
        if (!url || !/^https?:\/\//i.test(url)) continue;
        hits.push({
          title: strOrNull(item.name) ?? url,
          url,
          summary: strOrNull(item.summary),
          siteName: strOrNull(item.siteName),
          datePublished: strOrNull(item.datePublished),
        });
      }
      return hits;
    },
  };
}
