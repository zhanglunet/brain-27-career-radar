/**
 * PRD-019/T4 · 摘要开关与阈值配置（trend #84）。
 *
 * T1 设计（trend #78 / brain-27 PR #18 §四）：summary.enabled（总开关）、
 * summary.top_n、summary.upcoming_days；`?full=1` 单次回全量，兼容老调用方。
 *
 * 本模块提供类型化配置对象 + 默认值 + 校验，由 listOpportunities 消费
 * （见 summary.ts）。配置关闭（enabled=false）时回全量列表；
 * full=true（`?full=1`）始终回全量，不受开关影响。
 *
 * 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），可被 node --test 直接运行。
 */

/** 摘要模式配置。 */
export type SummaryConfig = {
  /**
   * 总开关：true → 摘要模式；false → 全量列表。
   * 默认 true（T1 §四）。
   */
  enabled: boolean;
  /** Top N 数量，默认 10（T1 §四 summary.top_n）。 */
  topN: number;
  /** "临近"天数窗口，默认 30（T1 §四 summary.upcoming_days）。 */
  upcomingDays: number;
};

/** 默认配置（T1 §四）。 */
export const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
  enabled: true,
  topN: 10,
  upcomingDays: 30,
};

const TOP_N_MIN = 1;
const TOP_N_MAX = 50;
const DAYS_MIN = 1;
const DAYS_MAX = 365;

/**
 * 合并用户配置与默认值并校验；非法值抛错。
 * 接受 Partial，缺省项走默认值。
 */
export function resolveSummaryConfig(
  partial?: Partial<SummaryConfig>,
): SummaryConfig {
  const cfg: SummaryConfig = { ...DEFAULT_SUMMARY_CONFIG, ...(partial ?? {}) };
  if (typeof cfg.enabled !== "boolean") {
    throw new Error(`非法 enabled（须为 boolean）: ${String(partial?.enabled)}`);
  }
  if (
    !Number.isInteger(cfg.topN) ||
    cfg.topN < TOP_N_MIN ||
    cfg.topN > TOP_N_MAX
  ) {
    throw new Error(
      `非法 topN（须为 ${TOP_N_MIN}..${TOP_N_MAX} 的整数）: ${String(partial?.topN)}`,
    );
  }
  if (
    !Number.isInteger(cfg.upcomingDays) ||
    cfg.upcomingDays < DAYS_MIN ||
    cfg.upcomingDays > DAYS_MAX
  ) {
    throw new Error(
      `非法 upcomingDays（须为 ${DAYS_MIN}..${DAYS_MAX} 的整数）: ${String(partial?.upcomingDays)}`,
    );
  }
  return cfg;
}
