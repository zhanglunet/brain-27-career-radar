/**
 * PRD-150/T2 · 占位符约定（沿用 drafter.ts 现有约定，T1 §3.2）。
 *
 * - 语法：`[待填写：<字段路径>]`，如 `[待填写：basics.email]`；
 * - 缺失**必选**字段：渲染不中断，占位符入文，调用方负责醒目警告
 *   （呼应 PRD-097 G11 的"占位符残留检查"：scanPlaceholders 供后续
 *   `docx check` 子命令复用，本模块只提供扫描，不打印）；
 * - 缺失**可选**字段：按模板空槽规则跳过，不留痕。
 */

/** 占位符前缀（与 drafter.ts 的 PLACEHOLDER 生成物同形，便于统一扫描）。 */
export const PLACEHOLDER_PREFIX = "[待填写：";
export const PLACEHOLDER_SUFFIX = "]";

/** 生成占位符（与 drafter.ts 私有 PLACEHOLDER(slot) 同一约定）。 */
export function placeholder(slot: string): string {
  return `${PLACEHOLDER_PREFIX}${slot}${PLACEHOLDER_SUFFIX}`;
}

/** 扫描文本中的占位符，返回字段路径列表（去重保序）。 */
export function scanPlaceholders(text: string): string[] {
  const re = /\[待填写：([^\]]+)\]/g;
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
