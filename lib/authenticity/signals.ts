/**
 * 真实性信号码表（S1–S8）—— PRD-176/T2（trend #881）。
 *
 * T1 规范：PRD-176/T1《真实性字段与三态（可信/待验证/可疑）规范》§三
 * （中央仓库 zhanglunet/trend，adopted/drafts/prd-176-opportunity-authenticity-t1.md，
 * PR 链接 https://github.com/zhanglunet/brain-27-career-radar/pull/63）。
 * 本文件按 T1 §3.1 落地，**不得擅自增删状态枚举、信号码与字段**。
 *
 * 信号分两档（T1 §3.1）：
 * - 硬信号 S1–S4（诈骗/注入底线）：任一命中 → 全局 suspicious；
 * - 软信号 S5–S8（质量疑点）：单独命中 → pending；同维两个及以上 → suspicious。
 *
 * 借鉴声明：三态与独立复核形态借鉴 cloudflare/security-audit-skill（MIT，
 * 已实测许可）；本文件为自研表述，不拷贝其代码。检测模式清单复用本仓库
 * `lib/local-apply/posting-guard.ts`（Adapted from MadsLorentzen/ai-job-search,
 * MIT）的既有实现，不重复造轮子。
 *
 * 纯函数、无副作用：不做任何网络请求（交叉源比对的输入由调用方以证据
 * 原文形式提供），不抛错。
 */

import type { PostingGuardFlag } from "../local-apply/posting-guard.ts";

/** 信号码（T1 §3.1，八项，不得增删）。 */
export type AuthSignalCode = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";

/** 四维分项（T1 §2.2 dims）。 */
export type AuthDim = "org" | "salary_funding" | "contact" | "deadline";

/** 信号 → 归属维度（T1 §3.1 表，逐项一致）。 */
export const SIGNAL_DIM: Readonly<Record<AuthSignalCode, AuthDim>> = {
  S1: "salary_funding",
  S2: "contact",
  S3: "org",
  S4: "org",
  S5: "salary_funding",
  S6: "contact",
  S7: "deadline",
  S8: "org",
};

/** 硬信号（诈骗/注入底线，T1 §3.1）。 */
export const HARD_SIGNALS: readonly AuthSignalCode[] = ["S1", "S2", "S3", "S4"];

export function isHardSignal(code: AuthSignalCode): boolean {
  return HARD_SIGNALS.includes(code);
}

export type AuthSignal = { code: AuthSignalCode; detail: string };

// ── S1 收费要求（复核 agent 文本规则 → salary_funding） ──────

/** 收费词（命中即疑似收费要求）。 */
const FEE_WORDS: RegExp[] = [
  /(保证金|押金|培训费|服务费|报名费|手续费|中介费|建档费|服装费)/,
  /先.{0,6}付(费|款)/,
  /\b(training fee|application fee|processing fee|security deposit|placement fee)\b/i,
  /\bpay(ment)?\b.{0,24}\b(upfront|in advance|before (?:start|onboard))/i,
];

/** 免除语境（"免押金/无保证金/不收取培训费"不算收费要求）。 */
const FEE_NEGATION_ZH = /(免|无需|不用|不收|零费用)/;
const FEE_NEGATION_EN = /\b(no|waive[d]?|free|without)\b/i;

export function detectFeeDemand(text: string): string | null {
  for (const re of FEE_WORDS) {
    const m = re.exec(text);
    if (m === null) continue;
    // 只看命中词前面的紧邻语境：有免除词则视为豁免说明，不算收费要求。
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    if (FEE_NEGATION_ZH.test(before) || FEE_NEGATION_EN.test(before)) continue;
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const lineEnd = text.indexOf("\n", m.index);
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
    return line.slice(0, 120);
  }
  return null;
}

// ── S2 敏感证件索要（复核 agent 文本规则 → contact） ─────────

const SENSITIVE_PATTERNS: RegExp[] = [
  /(身份证|护照)原件/,
  /(银行|储蓄)(卡|账户|账号)/,
  /(账户|卡|支付)密码/,
  /验证码/,
  /\b(original|physical)\b.{0,12}\b(id card|identity card|passport)\b/i,
  /\b(bank account|bank card)\b.{0,30}\b(number|details|password|pin)\b/i,
  /\b(otp|one[- ]time (?:code|password)|verification code)\b/i,
];

export function detectSensitiveRequest(text: string): string | null {
  for (const re of SENSITIVE_PATTERNS) {
    const m = re.exec(text);
    if (m === null) continue;
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const lineEnd = text.indexOf("\n", m.index);
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
    return line.slice(0, 120);
  }
  return null;
}

// ── S3 域名仿冒（posting-guard homoglyph + 域名比对 → org） ──

/** 取 URL 的 host（小写；去协议/凭据/端口/路径）。 */
export function extractHost(url: string): string {
  const raw = url.trim().toLowerCase();
  const withoutProto = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const hostPart = withoutProto.split(/[/?#]/)[0] ?? "";
  const withoutCreds = hostPart.includes("@") ? hostPart.slice(hostPart.lastIndexOf("@") + 1) : hostPart;
  const host = withoutCreds.split(":")[0] ?? "";
  return host.replace(/\.+$/, "");
}

/** 注册域（naive：末两段标签；T2 最小实现，够用于示例比对）。 */
export function registrableDomain(host: string): string {
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  return labels.slice(-2).join(".");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** 域名"形近"阈值：去标点后编辑距离 ≤ 2（T2 可调，T1 定形状）。 */
const CONFUSABLE_DISTANCE = 2;

/**
 * 仿冒判定：机会页 host 与官方域名的注册域不同，但去标点后形近。
 * 同注册域（子域）不算仿冒——那是一致，属 R1。
 */
export function isConfusableDomain(urlHost: string, officialDomain: string): boolean {
  const host = registrableDomain(urlHost);
  const official = registrableDomain(officialDomain);
  if (host.length === 0 || official.length === 0 || host === official) return false;
  const flat = (s: string) => s.replace(/[.-]/g, "");
  const a = flat(host);
  const b = flat(official);
  if (a === b) return false; // 仅标点差异（example.edu vs example.edü 等同形情形由 homoglyph 捕获）
  return levenshtein(a, b) <= CONFUSABLE_DISTANCE;
}

// ── S4 / S3：posting-guard flag 映射（T1 §3.1 S3/S4 来源） ───

const GUARD_FLAG_TO_SIGNAL: Readonly<
  Record<PostingGuardFlag["kind"], { code: AuthSignalCode; label: string }>
> = {
  hidden_block: { code: "S4", label: "隐藏内容命中" },
  instruction_like: { code: "S4", label: "指令形行文命中" },
  invisible_tamper: { code: "S4", label: "不可见字符篡改命中" },
  hidden_url: { code: "S4", label: "隐藏 URL 命中" },
  homoglyph: { code: "S3", label: "同形异源拼写命中" },
};

/**
 * posting-guard 五类 flag → S3/S4 信号。
 * 云端对快照执行同型检测（T1 §3.1 S4 来源）；本地缓存侧（T3/T4 展示与
 * 拦截）也用同一映射，保证两端口径一致。
 */
export function signalsFromGuardFlags(flags: readonly PostingGuardFlag[]): AuthSignal[] {
  const out: AuthSignal[] = [];
  for (const flag of flags) {
    const mapped = GUARD_FLAG_TO_SIGNAL[flag.kind];
    if (mapped === undefined) continue;
    const detail = `${mapped.label}（${flag.kind}）：${flag.detail}`.slice(0, 160);
    if (!out.some((s) => s.code === mapped.code && s.detail === detail)) {
      out.push({ code: mapped.code, detail });
    }
  }
  return out;
}

// ── S8 阈值（T2 可调） ───────────────────────────────────────

/** sources.consecutive_failures 超过该阈值即 S8（T1 §3.1：源不稳定）。 */
export const S8_FAILURE_THRESHOLD = 3;
