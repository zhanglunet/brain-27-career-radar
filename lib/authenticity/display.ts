/**
 * 真实性复核状态的展示口径（单一来源）—— PRD-176/T3（trend #882）。
 *
 * T1 规范：PRD-176/T1《真实性字段与三态（可信/待验证/可疑）规范》§3.3
 * （中央仓库 zhanglunet/trend，adopted/drafts/prd-176-opportunity-authenticity-t1.md）。
 *
 * 四态展示口径（unverified 单列第五态，T1 §2.1：不把"未复核"冒充"复核中"）：
 * | state      | 徽标 | 文案          | 行为                     |
 * | unverified | 灰   | 未复核        | 正常展示                 |
 * | trusted    | 绿   | 已核验·可信   | 正常展示                 |
 * | pending    | 琥珀 | 待验证        | 正常展示 + 建议人工核对  |
 * | suspicious | 红   | 可疑          | 弱化置灰 + 顶部警示，不进推荐位 |
 *
 * 供三处消费（同一口径，防展示漂移）：
 * - 云端机会列表（app/opportunities 徽标 / 筛选项 / 顶部警示文案）；
 * - MCP search_opportunities 的 authenticity_state 字段说明；
 * - 本地 CLI（lib/local-apply）match/status 的「真实性」行。
 *
 * 纯常量 + 纯函数、零依赖：可被 node --test 直接运行，也可被客户端组件导入。
 */

import type { WikiAuthenticityState } from "../wiki/schema.ts";

export type AuthenticityDisplay = {
  /** 徽标短文案（T1 §3.3「文案」列）。 */
  label: string;
  /** 附加提示（空串 = 无附加提示）。 */
  hint: string;
};

/** 四态展示口径（T1 §3.3 表；不得擅自增删状态与文案口径）。 */
export const AUTHENTICITY_DISPLAY: Readonly<
  Record<WikiAuthenticityState, AuthenticityDisplay>
> = {
  unverified: { label: "未复核", hint: "" },
  trusted: { label: "已核验·可信", hint: "" },
  pending: { label: "待验证", hint: "建议人工核对" },
  suspicious: { label: "可疑", hint: "须人工复核，暂勿投递" },
};

/** 非法状态兜底按 unverified 呈现（诚实标注：没有复核记录就说不复核）。 */
export function authenticityDisplay(
  state: unknown,
): AuthenticityDisplay {
  const key = state === "trusted" || state === "pending" || state === "suspicious"
    ? state
    : "unverified";
  return AUTHENTICITY_DISPLAY[key];
}

/** 机会列表顶部警示条文案（当前可见范围内存在 suspicious 时展示，T1 §3.3）。 */
export function suspiciousBannerText(count: number): string {
  if (count <= 0) return "";
  return (
    `注意：机会中有 ${count} 条被标记「可疑」（列表内置灰、排序沉底，不进推荐位）。` +
    `投递前必须人工复核来源；可疑默认不可投，人工改判须留痕（PRD-176/T1 §3.2/§3.3）。`
  );
}
