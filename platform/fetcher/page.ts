/**
 * 公开页面抓取：可抓取性检查 → 缓存 → robots → 手动跟随重定向（每跳复检）→ 按流限长读取
 * → 防注入扫描 → 转文本与链接。只读，不提交任何表单。
 */
import { scanPostingText } from "../../lib/local-apply/posting-guard.ts";
import { getCachedPage, getRobots, putCachedPage, putRobots } from "../data/page-cache.ts";
import type { CachedPage } from "../data/page-cache.ts";
import type { PlatformEnv } from "../env.ts";
import { isPathAllowed, parseRobots } from "./robots.ts";
import { isFetchableUrl } from "./url.ts";

export type FetchedPage = CachedPage;
export type FetchFailure = "not_fetchable" | "robots" | "http" | "type" | "too_large" | "timeout";

export const USER_AGENT = "Mozilla/5.0 (compatible; JobAgentPlatform/1.0)";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 30_000;
const MAX_LINKS = 200;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;

type FetchDeps = { now(): number; fetch: typeof fetch };

class Failure extends Error {
  reason: FetchFailure;

  constructor(reason: FetchFailure) {
    super(reason);
    this.reason = reason;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return match;
  });
}

const BLOCK = /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|dt|dd|dl|blockquote|pre)\b[^>]*>/gi;

export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() || null : null;
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(BLOCK, "\n")
    .replace(/<[^>]+>/g, "");
  const text = decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/[ \t 　]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title, text: [...text].slice(0, MAX_TEXT).join("") };
}

export function extractLinks(html: string, base: string): { text: string; href: string }[] {
  const links: { text: string; href: string }[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href: string;
    try {
      href = new URL(decodeEntities(match[1]), base).href;
    } catch {
      continue;
    }
    if (!isFetchableUrl(href) || seen.has(href)) continue;
    seen.add(href);
    links.push({ text: decodeEntities(match[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim().slice(0, 200), href });
    if (links.length >= MAX_LINKS) break;
  }
  return links;
}

async function robotsAllows(env: Pick<PlatformEnv, "PRIVATE_DB">, deps: FetchDeps, target: string): Promise<boolean> {
  const url = new URL(target);
  const host = url.hostname.toLowerCase();
  let rules = await getRobots(env.PRIVATE_DB, host, deps.now());
  if (!rules) {
    rules = { disallow: [], allow: [] };
    try {
      const response = await deps.fetch(`${url.origin}/robots.txt`, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 200) rules = parseRobots((await response.text()).slice(0, 200_000));
    } catch {
      // 取不到 robots.txt 视为允许
    }
    await putRobots(env.PRIVATE_DB, host, rules, deps.now());
  }
  return isPathAllowed(rules, `${url.pathname}${url.search}`);
}

async function readLimited(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Failure("too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder("utf-8").decode(bytes.slice(0, 4096));
  const label = contentType.match(/charset=([\w-]+)/i)?.[1] ?? head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(label.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function load(env: Pick<PlatformEnv, "PRIVATE_DB">, deps: FetchDeps, url: string): Promise<FetchedPage> {
  let current = url;
  for (let hop = 0; ; hop += 1) {
    if (!isFetchableUrl(current)) throw new Failure("not_fetchable");
    if (!(await robotsAllows(env, deps, current))) throw new Failure("robots");
    let response: Response;
    try {
      response = await deps.fetch(current, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9" },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new Failure(name === "TimeoutError" || name === "AbortError" ? "timeout" : "http");
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (hop >= MAX_REDIRECTS) throw new Failure("http");
      current = new URL(response.headers.get("location") as string, current).href;
      continue;
    }
    if (!response.ok) throw new Failure("http");
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^(text\/html|text\/plain)\b/i.test(contentType)) throw new Failure("type");
    const raw = decode(await readLimited(response), contentType);
    const isHtml = /text\/html/i.test(contentType);
    const { title, text } = isHtml ? htmlToText(raw) : { title: null, text: [...raw].slice(0, MAX_TEXT).join("") };
    return {
      url,
      finalUrl: current,
      title,
      text,
      links: isHtml ? extractLinks(raw, current) : [],
      flagged: scanPostingText(raw).flags.length > 0,
    };
  }
}

export async function fetchPublicPage(
  env: Pick<PlatformEnv, "PRIVATE_DB">,
  deps: FetchDeps,
  url: string,
): Promise<{ ok: true; page: FetchedPage } | { ok: false; reason: FetchFailure }> {
  if (!isFetchableUrl(url)) return { ok: false, reason: "not_fetchable" };
  const cached = await getCachedPage(env.PRIVATE_DB, url, deps.now());
  if (cached) return { ok: true, page: cached };
  try {
    const page = await load(env, deps, url);
    await putCachedPage(env.PRIVATE_DB, page, deps.now());
    return { ok: true, page };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, reason: error.reason };
    throw error;
  }
}
