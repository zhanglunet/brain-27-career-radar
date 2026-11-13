/**
 * 公开页面抓取：可抓取性检查 → 缓存 → robots → 手动跟随重定向（每跳复检）→ 按流限长读取
 * → 防注入扫描 → 转文本与链接。只读，不提交任何表单。
 */
import { scanPostingText } from "../../lib/local-apply/posting-guard.ts";
import { getCachedPage, getRobots, putCachedPage, putRobots } from "../data/page-cache.ts";
import type { CachedPage } from "../data/page-cache.ts";
import type { PlatformEnv } from "../env.ts";
import { isPathAllowed, parseRobots } from "./robots.ts";
import { isAggregator } from "../find/tiers.ts";
import { isFetchableUrl } from "./url.ts";

export type FetchedPage = CachedPage;
export type FetchFailure = "not_fetchable" | "aggregator" | "robots" | "http" | "type" | "too_large" | "timeout" | "encoding";

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

const BLOCK_TAGS = new Set(["p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td", "th", "table", "section", "article", "header", "footer", "dt", "dd", "dl", "blockquote", "pre"]);
const DROP_TAGS = ["script", "style", "noscript", "template", "svg", "head"];
/** 只处理前 1,000,000 个字符：正文最多保留 3 万字，再多没有意义，还会拖慢扫描。 */
const MAX_PARSE_CHARS = 1_000_000;

/**
 * 线性扫描去掉注释与 script / style 等整块（未闭合时丢弃到结尾）。
 * 不用 `[\s\S]*?` 一类正则：遇到大量未闭合标签会退化成平方级耗时。
 */
export function removeBlocks(html: string): string {
  const raw = html.length > MAX_PARSE_CHARS ? html.slice(0, MAX_PARSE_CHARS) : html;
  const lower = raw.toLowerCase();
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const j = lower.indexOf("<", i);
    if (j < 0) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, j);
    if (lower.startsWith("<!--", j)) {
      const close = lower.indexOf("-->", j + 4);
      i = close < 0 ? raw.length : close + 3;
      continue;
    }
    const tag = DROP_TAGS.find((name) => lower.startsWith(`<${name}`, j) && !/[a-z0-9-]/.test(lower[j + name.length + 1] ?? ""));
    if (tag) {
      const close = lower.indexOf(`</${tag}`, j + tag.length + 1);
      if (close < 0) break;
      const gt = lower.indexOf(">", close);
      i = gt < 0 ? raw.length : gt + 1;
      continue;
    }
    out += "<";
    i = j + 1;
  }
  return out;
}

type Scan = { title: string | null; text: string; links: { text: string; href: string }[] };

/** 线性扫描标签：块级标签换行、收集 <a href> 链接，其余标签丢弃。输入应已去掉 script / style 等整块。 */
function scanTags(html: string, base: string | null): Scan {
  let text = "";
  let title: string | null = null;
  const links: { text: string; href: string }[] = [];
  const seen = new Set<string>();
  let anchor: { href: string; start: number } | null = null;
  let titleStart = -1;
  let i = 0;
  while (i < html.length) {
    const j = html.indexOf("<", i);
    if (j < 0) {
      text += html.slice(i);
      break;
    }
    text += html.slice(i, j);
    const gt = html.indexOf(">", j + 1);
    if (gt < 0) {
      text += html.slice(j + 1);
      break;
    }
    const inner = html.slice(j + 1, gt);
    const match = /^(\/?)([a-zA-Z][\w:-]*)/.exec(inner);
    i = gt + 1;
    if (!match) continue;
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    if (name === "title") {
      if (!closing) titleStart = text.length;
      else if (titleStart >= 0 && title === null) {
        title = decodeEntities(text.slice(titleStart)).replace(/\s+/g, " ").trim() || null;
        text = text.slice(0, titleStart);
        titleStart = -1;
      }
      continue;
    }
    if (BLOCK_TAGS.has(name)) text += "\n";
    if (name === "a" && base) {
      if (!closing) {
        const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(inner)?.[1];
        anchor = href ? { href, start: text.length } : null;
      } else if (anchor) {
        let resolved: string | null = null;
        try {
          resolved = new URL(decodeEntities(anchor.href), base).href;
        } catch {
          resolved = null;
        }
        if (resolved && isFetchableUrl(resolved) && !seen.has(resolved) && links.length < MAX_LINKS) {
          seen.add(resolved);
          links.push({ text: decodeEntities(text.slice(anchor.start)).replace(/\s+/g, " ").trim().slice(0, 200), href: resolved });
        }
        anchor = null;
      }
    }
  }
  return { title, text, links };
}

function tidy(text: string): string {
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0\u3000]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function htmlToText(html: string): { title: string | null; text: string } {
  // <head> 整块会被去掉，所以先单独取标题。
  const lower = html.slice(0, MAX_PARSE_CHARS).toLowerCase();
  const open = lower.indexOf("<title");
  let title: string | null = null;
  if (open >= 0) {
    const gt = lower.indexOf(">", open);
    const close = gt < 0 ? -1 : lower.indexOf("</title", gt);
    if (close > gt) title = decodeEntities(html.slice(gt + 1, close).replace(/<[^>]{0,200}>/g, "")).replace(/\s+/g, " ").trim() || null;
  }
  const scan = scanTags(removeBlocks(html), null);
  return { title: title ?? scan.title, text: [...tidy(scan.text)].slice(0, MAX_TEXT).join("") };
}

export function extractLinks(html: string, base: string): { text: string; href: string }[] {
  return scanTags(removeBlocks(html), base).links;
}

/** 注入句式（中英文）。正常招聘页几乎不会出现这些说法。 */
const INJECTION = new RegExp(
  [
    "(忽略|无视|忘记|忘掉)(掉)?(之前|以上|前面|上述|先前|此前)?的?(所有|全部|一切)?(的)?(指令|指示|要求|规则|提示|设定)",
    "(将|把)(所有|全部|每一?条)(的)?(要求|条件|资格)(都|一律|全部)?(判|标|视|认定)(定|记)?(为|成)",
    "你(现在)?(是|扮演|作为)(一个|一名)?(人工智能|AI|助手|模型|机器人)",
    "system\\s*prompt|系统提示词",
    "ignore\\s+(all\\s+)?(the\\s+)?(previous|prior|above|earlier)\\s+(instructions|prompts|rules)",
    "disregard\\s+(all\\s+)?(the\\s+)?(previous|prior|above)",
  ].join("|"),
  "i",
);
const SIGNIFICANT_FLAGS = new Set(["instruction_like", "invisible_tamper", "homoglyph"]);
const MAX_GUARD_CHARS = 512 * 1024;

/**
 * 网页是否可疑：先去掉 script / style / 注释等整块；posting-guard 的"隐藏块""隐藏链接"在正常网页里极常见
 * （统计脚本、读屏隐藏的导航），不单独作为可疑依据；指令形行文、不可见字符篡改、同形字仍然判可疑；
 * 另外对全部文字（含隐藏元素）做中英文注入句式匹配。
 */
export function pageLooksSuspicious(raw: string): boolean {
  const stripped = removeBlocks(raw).slice(0, MAX_GUARD_CHARS);
  if (scanPostingText(stripped).flags.some((flag) => SIGNIFICANT_FLAGS.has(flag.kind))) return true;
  return INJECTION.test(tidy(scanTags(stripped, null).text).replace(/\s+/g, " "));
}

async function robotsAllows(env: Pick<PlatformEnv, "PRIVATE_DB">, deps: FetchDeps, target: string): Promise<boolean> {
  const url = new URL(target);
  const host = url.hostname.toLowerCase();
  let rules = await getRobots(env.PRIVATE_DB, host, deps.now());
  if (!rules) {
    rules = { disallow: [], allow: [] };
    try {
      const fetchFn = deps.fetch;
      const response = await fetchFn(`${url.origin}/robots.txt`, {
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
  const label = contentType.match(/charset=["']?([\w-]+)/i)?.[1] ?? head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label.toLowerCase());
  } catch {
    // 运行时不支持该编码（例如某些环境不支持 gbk）：与其送一堆乱码给模型，不如跳过这一页。
    throw new Failure("encoding");
  }
  const text = decoder.decode(bytes);
  let replacements = 0;
  for (const char of text) if (char === "\ufffd") replacements += 1;
  if (replacements > Math.max(20, text.length * 0.01)) throw new Failure("encoding");
  return text;
}

async function load(env: Pick<PlatformEnv, "PRIVATE_DB">, deps: FetchDeps, url: string): Promise<FetchedPage> {
  let current = url;
  for (let hop = 0; ; hop += 1) {
    if (!isFetchableUrl(current)) throw new Failure("not_fetchable");
    if (isAggregator(current)) throw new Failure("aggregator");
    if (!(await robotsAllows(env, deps, current))) throw new Failure("robots");
    let response: Response;
    try {
      const fetchFn = deps.fetch;
      response = await fetchFn(current, {
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
      flagged: pageLooksSuspicious(raw),
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
