/**
 * PRD-017/T2 · Wiki 自维护流水线配置（review comment 3）。
 *
 * T1 评审意见：S2「日报 → Wiki 自动沉淀」只写了"自动起草 → 人工确认"，
 * 没写谁来确认、多久确认——不能留白。本配置把确认人（owner）与
 * 确认时限（SLA）定死在代码里，T3（trend #68 自动沉淀流水线）直接消费。
 */
export type PipelineStageConfig = {
  /** 确认人（账号/角色）。默认仓库所有者，可按需覆盖。 */
  owner: string;
  /** 确认时限（小时）；超期草稿标 overdue 并升级提醒。 */
  slaHours: number;
  /** 入库前是否必须人工确认（S2 纪律）。 */
  requireHumanConfirm: boolean;
};

export const WIKI_PIPELINE_CONFIG = {
  /** S2：每日日报 → Wiki 自动沉淀（trend #68 实现）。 */
  dailyReport: {
    owner: "zhanglunet",
    slaHours: 24,
    requireHumanConfirm: true,
  },
  /** S3：顶会日历变更 → 条目更新。 */
  conferenceCalendar: {
    owner: "zhanglunet",
    slaHours: 168,
    requireHumanConfirm: true,
  },
  /** S1：D1 快照引用（只引用不复制，无需人工确认）。 */
  d1Snapshot: {
    owner: "zhanglunet",
    slaHours: 72,
    requireHumanConfirm: false,
  },
} as const satisfies Record<string, PipelineStageConfig>;

export type WikiPipelineStage = keyof typeof WIKI_PIPELINE_CONFIG;

/** 草稿是否已超 SLA（draftedAtIso 为 ISO 时间字符串）。 */
export function isDraftOverdue(
  draftedAtIso: string,
  stage: WikiPipelineStage,
  now: Date = new Date(),
): boolean {
  const slaMs = WIKI_PIPELINE_CONFIG[stage].slaHours * 3600 * 1000;
  return now.getTime() - new Date(draftedAtIso).getTime() > slaMs;
}
