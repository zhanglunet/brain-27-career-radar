/**
 * 外部文本完整性门禁（检测版）—— PRD-097/T3 G1。
 *
 * Adapted from MadsLorentzen/ai-job-search (MIT License), tools/posting_guard.py @ d621ebe63549
 * 来源：https://github.com/MadsLorentzen/ai-job-search/blob/d621ebe63549/tools/posting_guard.py
 *
 * 机会正文是第三方文本，会与用户的本地档案一起进入评估/LLM 上下文。
 * "正文是数据、不是指令"不能只靠模型自觉，先用确定性规则把明显的
 * 载荷形态照出来。本模块移植原版的**检测模式清单**（五类）：
 *
 *   1. hidden_block     隐藏 HTML 块：`hidden` 属性、aria-hidden="true"，
 *                       或 style 命中 display:none / visibility:hidden /
 *                       opacity:0 / font-size:0 / color:transparent /
 *                       clip / clip-path / 屏外定位（left/top/text-indent ≤ -1000px）；
 *   2. invisible_tamper 不可见字符篡改信号：bidi override/isolate 任意出现，
 *                       或零宽/BOM 字符夹在两个字母之间（拆词绕扫描）；
 *                       其余不可见字符（词首 BOM、emoji 连接符、RTL 标记、
 *                       软连字符）只计数、不算篡改；
 *   3. instruction_like 指令形行文：面向 agent 而非读者的行（"ignore previous…"、
 *                       "you are an AI…"、"system prompt"、命令调用形态等 17 条模式）；
 *   4. hidden_url       只出现在隐藏内容（注释、script/style 等删除块、隐藏元素）里的 URL；
 *   5. homoglyph        同一个词里拉丁字母与西里尔/希腊字母混排（仿冒拼写）。
 *
 * 与原版的有意差异：
 * - 原版是清洗器（剥离隐藏内容后输出 cleaned text）；本移植**只检测**：
 *   命中只产出 flag + 原因，不删改、不阻断、不改评分，由调用方呈现给用户裁决。
 * - 原版 HTML 遍历器处理 HTML5 隐含结束标签；本移植用简化标签栈，
 *   对畸形 HTML 的边界处理可能与原版略有出入，检测目标（找出隐藏内容）不变。
 * - 输入按 brain-27 的本地 JSON 情报适配：通常是纯文本；含 HTML 时走 HTML 路径。
 */

// ── 不可见字符集（码点与原版逐项一致） ──────────────────────

const ZERO_WIDTH = "​‌‍⁠⁡⁢⁣⁤";
const BIDI = "‎‏‪‫‬‭‮⁦⁧⁨⁩";
const BIDI_TAMPER = "‭‮⁦⁧⁨⁩"; // overrides and isolates
const FORMAT = "­  "; // soft hyphen, line/paragraph separators
const BOM = "﻿";
const INVISIBLE = new Set((ZERO_WIDTH + BIDI + FORMAT + BOM).split(""));
const ZERO_WIDTH_SET = new Set(ZERO_WIDTH.split(""));
const BIDI_TAMPER_SET = new Set(BIDI_TAMPER.split(""));

// ── 隐藏样式（与原版 HIDDEN_STYLE 逐条对应） ─────────────────

const HIDDEN_STYLE =
  /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d]*[1-9])|font-size\s*:\s*0(?:\.0+)?(?:px|pt|em|rem|%)?(?![\d.])|color\s*:\s*transparent|clip\s*:\s*rect\(\s*0|clip-path\s*:\s*inset\(\s*100%|(?:left|top|text-indent)\s*:\s*-\d{4,}px/i;

const PRESTRIP = /<!DOCTYPE[^>]*>|<\?[^>]*\?>/gi;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const DROP_BLOCKS = /<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s=/\\"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
const VOID_TAGS = new Set([
  "br", "img", "input", "meta", "link", "hr", "wbr", "source", "area",
  "base", "col", "embed", "param", "track",
]);
const BLOCK_TAGS = new Set([
  "p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr",
  "br", "section", "article", "header", "footer", "table", "thead",
  "tbody", "blockquote", "pre", "dd", "dt", "dl", "nav", "main", "aside",
  "figure", "form", "fieldset", "legend", "address", "hr", "td", "th",
  "option",
]);
const IMPLIED_END = new Set(["p", "li", "dd", "dt", "tr", "td", "th", "option"]);
const HTML_HINT = /<\s*(html|body|div|p)\b/i;

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

// 指令形行文模式（与原版 INSTRUCTION_PATTERNS 逐条对应，不分大小写）。
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore (all|any|the|previous|prior|above|earlier)\b/i,
  /\byou are (?:an?|the) (?:ai(?![\w-])|ai (?:assistant|agent|model|language model)|assistant|llm|language model)\b/i,
  /\bsystem prompt\b/i,
  /\bdo not (tell|inform|mention)( this)? to the user\b/i,
  /\b(run|execute) the following (command|commands|script|code|shell|instruction|instructions|steps)\b/i,
  /\bas an ai(?![\w-])/i,
  /^\s*(assistant|system|user)\s*:/i,
  /<\|/,
  /\[INST\]/,
  /###\s*(system|instruction)/i,
  /\b(curl|wget|ssh|scp)\b/i,
  /\.env\b/,
  /settings\.json/,
  /allowed-tools/,
  /\btool_use\b|\bfunction_call\b/,
];

const WORD_RE = /[\p{L}\p{N}_]+/gu;
const LATIN_RE = /[A-Za-z]/;
const CONFUSABLE_RE = /[Ѐ-ӿͰ-Ͽ]/;

const EXCERPT = 120;
const LINE_MAX = 200;

// ── 对外类型 ─────────────────────────────────────────────────

export type PostingGuardFlagKind =
  | "hidden_block"
  | "instruction_like"
  | "invisible_tamper"
  | "hidden_url"
  | "homoglyph";

export type PostingGuardFlag = {
  kind: PostingGuardFlagKind;
  /** 命中摘录或计数说明（已截断）。 */
  detail: string;
};

export type PostingGuardResult = {
  flags: PostingGuardFlag[];
  /** 不可见字符按类计数；无命中则对应键缺失。原版口径：只计数不必然是问题。 */
  invisibleChars: { zero_width?: number; bidi?: number; format?: number; bom?: number };
  /** 篡改信号数：bidi override/isolate + 词内零宽/BOM。 */
  invisibleFlagged: number;
  /** 可见正文中的 URL 总数（供对照 hidden_url）。 */
  visibleUrlCount: number;
};

// ── 小工具 ───────────────────────────────────────────────────

function fold(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\xa0\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  // 仅处理最常见的几类实体（摘录展示用，不做完整 HTML 实体解码）。
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripInvisible(text: string): string {
  let out = "";
  for (const ch of text) if (!INVISIBLE.has(ch)) out += ch;
  return out;
}

// ── 不可见字符（原版 clean_text 的计数部分） ─────────────────

function countInvisible(text: string): {
  counts: PostingGuardResult["invisibleChars"];
  flagged: number;
} {
  const counts: PostingGuardResult["invisibleChars"] = {};
  const tally = (key: keyof typeof counts, chars: string) => {
    let n = 0;
    for (const c of chars) n += text.split(c).length - 1;
    if (n > 0) counts[key] = n;
  };
  tally("zero_width", ZERO_WIDTH);
  tally("bidi", BIDI);
  tally("format", FORMAT);
  tally("bom", BOM);

  let flagged = 0;
  const chars = [...text];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (BIDI_TAMPER_SET.has(ch)) {
      flagged += 1;
    } else if (ZERO_WIDTH_SET.has(ch) || ch === BOM) {
      const before = i > 0 ? chars[i - 1] : "";
      const after = i + 1 < chars.length ? chars[i + 1] : "";
      if (/\p{L}/u.test(before) && /\p{L}/u.test(after)) flagged += 1;
    }
  }
  return { counts, flagged };
}

// ── HTML 隐藏内容分离（原版 clean_html 的简化移植） ──────────

function parseAttrs(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of raw.matchAll(ATTR)) {
    out.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

function isHidden(rawAttrs: string): boolean {
  const attrs = parseAttrs(rawAttrs);
  if (attrs.has("hidden")) return true;
  if ((attrs.get("aria-hidden") ?? "").trim().toLowerCase() === "true") return true;
  return HIDDEN_STYLE.test(attrs.get("style") ?? "");
}

function splitHtml(markup: string): {
  visible: string;
  hiddenText: string;
  hiddenBlocks: string[];
} {
  const hiddenParts: string[] = [];
  const hiddenBlocks: string[] = [];

  const collect = (chunk: string): string => {
    const inner = chunk.replace(/<!--|-->|<[^>]+>/g, " ");
    hiddenParts.push(decodeEntities(inner));
    return " ";
  };

  let work = markup.replace(PRESTRIP, " ");
  work = work.replace(COMMENT, (m) => collect(m));
  work = work.replace(DROP_BLOCKS, (m) => collect(m));

  const visible: string[] = [];
  const hiddenBuf: string[] = [];
  const stack: string[] = [];
  let hiddenAt: number | null = null;
  let pos = 0;

  const emit = (text: string) => {
    (hiddenAt === null ? visible : hiddenBuf).push(text);
  };
  const flushHidden = () => {
    const block = fold(decodeEntities(hiddenBuf.join("")));
    hiddenBuf.length = 0;
    hiddenAt = null;
    if (block) {
      hiddenBlocks.push(block.slice(0, EXCERPT));
      hiddenParts.push(block);
    }
  };
  const popTo = (index: number) => {
    stack.length = index;
    if (hiddenAt !== null && hiddenAt >= stack.length) flushHidden();
  };
  const lastIndex = (name: string): number => {
    for (let i = stack.length - 1; i >= 0; i -= 1) if (stack[i] === name) return i;
    return -1;
  };

  for (const m of work.matchAll(TAG)) {
    emit(work.slice(pos, m.index));
    pos = m.index + m[0].length;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const rawAttrs = m[3];
    if (BLOCK_TAGS.has(name)) emit("\n");
    if (closing) {
      const index = lastIndex(name);
      if (index >= 0) popTo(index);
      continue;
    }
    if (VOID_TAGS.has(name)) continue;
    if (IMPLIED_END.has(name) && stack[stack.length - 1] === name) {
      popTo(stack.length - 1);
    } else if (name !== "br" && BLOCK_TAGS.has(name) && stack[stack.length - 1] === "p") {
      popTo(stack.length - 1);
    }
    stack.push(name);
    if (hiddenAt === null && isHidden(rawAttrs)) hiddenAt = stack.length - 1;
  }
  emit(work.slice(pos));
  if (hiddenAt !== null) flushHidden();

  return {
    visible: fold(decodeEntities(visible.join(""))),
    hiddenText: hiddenParts.join("\n"),
    hiddenBlocks,
  };
}

// ── 主扫描（原版 scan + verdict 的检测部分） ─────────────────

/**
 * 扫描机会正文，返回命中标记。纯函数、无副作用：不删改入参、不抛错。
 * 正文通常是纯文本；含 HTML 特征时按 HTML 路径分离隐藏内容再扫。
 */
export function scanPostingText(raw: string): PostingGuardResult {
  let visible = raw;
  let hiddenText = "";
  let hiddenBlocks: string[] = [];
  if (HTML_HINT.test(raw)) {
    const split = splitHtml(raw);
    visible = split.visible;
    hiddenText = split.hiddenText;
    hiddenBlocks = split.hiddenBlocks;
  }

  const { counts, flagged } = countInvisible(visible);
  const visibleText = stripInvisible(visible);
  const hiddenClean = stripInvisible(hiddenText);

  const flags: PostingGuardFlag[] = [];

  for (const block of hiddenBlocks) {
    flags.push({ kind: "hidden_block", detail: block });
  }

  const seen = new Set<string>();
  for (const line of `${visibleText}\n${hiddenClean}`.split("\n")) {
    const stripped = line.trim();
    if (!stripped || seen.has(stripped)) continue;
    if (INSTRUCTION_PATTERNS.some((p) => p.test(stripped))) {
      seen.add(stripped);
      flags.push({ kind: "instruction_like", detail: stripped.slice(0, LINE_MAX) });
    }
  }

  const hiddenUrls: string[] = [];
  for (const url of hiddenClean.match(URL_RE) ?? []) {
    if (!hiddenUrls.includes(url)) hiddenUrls.push(url);
  }
  for (const url of hiddenUrls) {
    flags.push({ kind: "hidden_url", detail: url });
  }

  if (flagged > 0) {
    flags.push({
      kind: "invisible_tamper",
      detail: `${flagged} 个不可见字符呈篡改形态（bidi override/isolate 或词内零宽/BOM）`,
    });
  }

  const homoglyphs: string[] = [];
  for (const word of `${visibleText}\n${hiddenClean}`.match(WORD_RE) ?? []) {
    if (LATIN_RE.test(word) && CONFUSABLE_RE.test(word) && !homoglyphs.includes(word)) {
      homoglyphs.push(word);
    }
  }
  for (const word of homoglyphs) {
    flags.push({ kind: "homoglyph", detail: word });
  }

  return {
    flags,
    invisibleChars: counts,
    invisibleFlagged: flagged,
    visibleUrlCount: (visibleText.match(URL_RE) ?? []).length,
  };
}
