/** 页面缓存与 robots 缓存：平台级表，只存公开页面内容，不含任何用户信息。 */
import type { RobotsRules } from "../fetcher/robots.ts";

export type CachedPage = {
  url: string;
  finalUrl: string;
  title: string | null;
  text: string;
  links: { text: string; href: string }[];
  flagged: boolean;
};

export const PAGE_TTL_MS = 86_400_000;

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export async function getCachedPage(db: D1Database, url: string, now: number): Promise<CachedPage | null> {
  const row = await db
    .prepare("SELECT url, final_url, title, text, links_json, flagged FROM page_cache WHERE url = ? AND status = 'ok' AND fetched_at > ?")
    .bind(url, now - PAGE_TTL_MS)
    .first<{ url: string; final_url: string | null; title: string | null; text: string | null; links_json: string; flagged: number }>();
  if (!row) return null;
  return { url: row.url, finalUrl: row.final_url ?? row.url, title: row.title, text: row.text ?? "", links: parseJson(row.links_json, []), flagged: row.flagged === 1 };
}

export async function putCachedPage(db: D1Database, page: CachedPage, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO page_cache (url, fetched_at, status, final_url, title, text, links_json, flagged) VALUES (?, ?, 'ok', ?, ?, ?, ?, ?)
       ON CONFLICT (url) DO UPDATE SET fetched_at = excluded.fetched_at, status = 'ok', final_url = excluded.final_url, title = excluded.title,
         text = excluded.text, links_json = excluded.links_json, flagged = excluded.flagged`,
    )
    .bind(page.url, now, page.finalUrl, page.title, page.text, JSON.stringify(page.links), page.flagged ? 1 : 0)
    .run();
}

export async function getRobots(db: D1Database, host: string, now: number): Promise<RobotsRules | null> {
  const row = await db
    .prepare("SELECT rules_json FROM robots_cache WHERE host = ? AND fetched_at > ?")
    .bind(host, now - PAGE_TTL_MS)
    .first<{ rules_json: string }>();
  return row ? parseJson(row.rules_json, { disallow: [], allow: [] }) : null;
}

export async function putRobots(db: D1Database, host: string, rules: RobotsRules, now: number): Promise<void> {
  await db
    .prepare("INSERT INTO robots_cache (host, fetched_at, rules_json) VALUES (?, ?, ?) ON CONFLICT (host) DO UPDATE SET fetched_at = excluded.fetched_at, rules_json = excluded.rules_json")
    .bind(host, now, JSON.stringify(rules))
    .run();
}

/** 每个网址最近一次成功抓取的时间（没抓过为 0），用于候选轮转。 */
export async function lastFetchedAt(db: D1Database, urls: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (let i = 0; i < urls.length; i += 50) {
    const chunk = urls.slice(i, i + 50);
    const { results } = await db
      .prepare(`SELECT url, fetched_at FROM page_cache WHERE url IN (${chunk.map(() => "?").join(", ")})`)
      .bind(...chunk)
      .all<{ url: string; fetched_at: number }>();
    for (const row of results) result.set(row.url, row.fetched_at);
  }
  return result;
}
