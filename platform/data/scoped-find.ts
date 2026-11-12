/** 找机会相关的按用户数据：目标来源（本任务）、运行记录与个人机会（后续任务）。 */
import { isFetchableUrl, normalizeUrl } from "../fetcher/url.ts";
import type { Assessment } from "../find/assess.ts";
import type { DeadlineStatus } from "../find/extract.ts";
import type { Tier } from "../find/tiers.ts";
import { HttpError } from "../http.ts";
import { nominateShared } from "./shared-sources.ts";

export const MAX_USER_SOURCES_PER_GOAL = 20;

export type GoalSource = {
  id: string;
  goalId: string;
  url: string;
  org: string | null;
  tier: "L2" | "L3" | "L4";
  origin: "search" | "user";
  nominatedAt: number | null;
  createdAt: number;
};

type SourceRow = { id: string; goal_id: string; url: string; org: string | null; tier: GoalSource["tier"]; origin: GoalSource["origin"]; nominated_at: number | null; created_at: number };

const toSource = (row: SourceRow): GoalSource => ({
  id: row.id,
  goalId: row.goal_id,
  url: row.url,
  org: row.org,
  tier: row.tier,
  origin: row.origin,
  nominatedAt: row.nominated_at,
  createdAt: row.created_at,
});

const SOURCE_COLUMNS = "id, goal_id, url, org, tier, origin, nominated_at, created_at";

export function sourcesFor(db: D1Database, userId: string) {
  async function findByUrl(goalId: string, url: string): Promise<GoalSource | null> {
    const row = await db
      .prepare(`SELECT ${SOURCE_COLUMNS} FROM goal_sources WHERE user_id = ? AND goal_id = ? AND url = ?`)
      .bind(userId, goalId, url)
      .first<SourceRow>();
    return row ? toSource(row) : null;
  }

  return {
    async list(goalId: string): Promise<GoalSource[]> {
      const { results } = await db
        .prepare(`SELECT ${SOURCE_COLUMNS} FROM goal_sources WHERE user_id = ? AND goal_id = ? ORDER BY created_at, id`)
        .bind(userId, goalId)
        .all<SourceRow>();
      return results.map(toSource);
    },
    async listAll(): Promise<GoalSource[]> {
      const { results } = await db.prepare(`SELECT ${SOURCE_COLUMNS} FROM goal_sources WHERE user_id = ? ORDER BY created_at, id`).bind(userId).all<SourceRow>();
      return results.map(toSource);
    },
    /** 规范化 URL 后去重；目标必须属于本人；用户来源每目标最多 20 条。 */
    async add(goalId: string, input: { url: string; org: string | null; tier: GoalSource["tier"]; origin: GoalSource["origin"] }, now: number): Promise<GoalSource> {
      const url = normalizeUrl(input.url);
      if (!url || !isFetchableUrl(url)) throw new HttpError(400, "请填写有效的公开网址");
      const existing = await findByUrl(goalId, url);
      if (existing) return existing;
      if (input.origin === "user") {
        const count = await db
          .prepare("SELECT COUNT(*) AS n FROM goal_sources WHERE user_id = ? AND goal_id = ? AND origin = 'user'")
          .bind(userId, goalId)
          .first<number>("n");
        if ((count ?? 0) >= MAX_USER_SOURCES_PER_GOAL) throw new HttpError(400, `每个目标最多添加 ${MAX_USER_SOURCES_PER_GOAL} 个来源`);
      }
      const id = crypto.randomUUID();
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO goal_sources (id, user_id, goal_id, url, org, tier, origin, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM goals WHERE id = ? AND user_id = ?)`,
        )
        .bind(id, userId, goalId, url, input.org, input.tier, input.origin, now, goalId, userId)
        .run();
      if (result.meta.changes !== 1) {
        const raced = await findByUrl(goalId, url);
        if (raced) return raced;
        throw new HttpError(404, "目标不存在");
      }
      return { id, goalId, url, org: input.org, tier: input.tier, origin: input.origin, nominatedAt: null, createdAt: now };
    },
    async remove(goalId: string, id: string): Promise<boolean> {
      const result = await db.prepare("DELETE FROM goal_sources WHERE id = ? AND goal_id = ? AND user_id = ?").bind(id, goalId, userId).run();
      return result.meta.changes === 1;
    },
    /** 用户同意分享后提名为共享来源；聚合平台链接不能提名。提名记录不含提名人。 */
    async nominate(goalId: string, id: string, now: number): Promise<boolean> {
      const row = await db
        .prepare(`SELECT ${SOURCE_COLUMNS} FROM goal_sources WHERE id = ? AND goal_id = ? AND user_id = ? AND tier != 'L4'`)
        .bind(id, goalId, userId)
        .first<SourceRow>();
      if (!row) return false;
      await db.prepare("UPDATE goal_sources SET nominated_at = ? WHERE id = ? AND user_id = ?").bind(now, id, userId).run();
      await nominateShared(db, { url: row.url, org: row.org }, now);
      return true;
    },
  };
}

export const OPPORTUNITY_MARKS = ["new", "interested", "dismissed", "done"] as const;
export type OpportunityMark = (typeof OPPORTUNITY_MARKS)[number];

export type OpportunitySource = { url: string; tier: Tier };

export type UserOpportunity = {
  id: string;
  goalId: string;
  key: string;
  title: string;
  org: string | null;
  url: string;
  tier: Tier;
  sources: OpportunitySource[];
  location: string | null;
  kind: string | null;
  deadlineStatus: DeadlineStatus;
  deadlineDate: string | null;
  requirements: string[];
  assessment: Assessment | null;
  mark: OpportunityMark;
  risk: string | null;
  firstSeenAt: number;
  updatedAt: number;
};

export type OpportunityInput = {
  key: string;
  title: string;
  org: string | null;
  url: string;
  tier: Tier;
  source: OpportunitySource;
  location: string | null;
  kind: string | null;
  deadlineStatus: DeadlineStatus;
  deadlineDate: string | null;
  requirements: string[];
  risk: string | null;
};

type OpportunityRow = {
  id: string; goal_id: string; key: string; title: string; org: string | null; url: string; tier: Tier; sources_json: string;
  location: string | null; kind: string | null; deadline_status: DeadlineStatus; deadline_date: string | null; requirements_json: string;
  assessment_json: string | null; mark: OpportunityMark; risk: string | null; first_seen_at: number; updated_at: number;
};

function parseJson<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

const toOpportunity = (row: OpportunityRow): UserOpportunity => ({
  id: row.id,
  goalId: row.goal_id,
  key: row.key,
  title: row.title,
  org: row.org,
  url: row.url,
  tier: row.tier,
  sources: parseJson(row.sources_json, []),
  location: row.location,
  kind: row.kind,
  deadlineStatus: row.deadline_status,
  deadlineDate: row.deadline_date,
  requirements: parseJson(row.requirements_json, []),
  assessment: parseJson(row.assessment_json, null),
  mark: row.mark,
  risk: row.risk,
  firstSeenAt: row.first_seen_at,
  updatedAt: row.updated_at,
});

const OPP_COLUMNS = "id, goal_id, key, title, org, url, tier, sources_json, location, kind, deadline_status, deadline_date, requirements_json, assessment_json, mark, risk, first_seen_at, updated_at";
const TIER_RANK: Record<Tier, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };

export function opportunitiesFor(db: D1Database, userId: string) {
  async function getByKey(goalId: string, key: string): Promise<UserOpportunity | null> {
    const row = await db
      .prepare(`SELECT ${OPP_COLUMNS} FROM user_opportunities WHERE user_id = ? AND goal_id = ? AND key = ?`)
      .bind(userId, goalId, key)
      .first<OpportunityRow>();
    return row ? toOpportunity(row) : null;
  }

  return {
    getByKey,
    async get(id: string): Promise<UserOpportunity | null> {
      const row = await db.prepare(`SELECT ${OPP_COLUMNS} FROM user_opportunities WHERE id = ? AND user_id = ?`).bind(id, userId).first<OpportunityRow>();
      return row ? toOpportunity(row) : null;
    },
    /** 按 (用户, 目标, key) 合并：来源追加、层级取更可信者、非空字段覆盖；用户标记不变。目标必须属于本人。 */
    async upsert(goalId: string, opp: OpportunityInput, now: number): Promise<{ created: boolean; requirementsChanged: boolean }> {
      const existing = await getByKey(goalId, opp.key);
      if (!existing) {
        const result = await db
          .prepare(
            `INSERT OR IGNORE INTO user_opportunities (id, user_id, goal_id, key, title, org, url, tier, sources_json, location, kind, deadline_status, deadline_date, requirements_json, risk, first_seen_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM goals WHERE id = ? AND user_id = ?)`,
          )
          .bind(
            crypto.randomUUID(), userId, goalId, opp.key, opp.title, opp.org, opp.url, opp.tier, JSON.stringify([opp.source]), opp.location, opp.kind,
            opp.deadlineStatus, opp.deadlineDate, JSON.stringify(opp.requirements), opp.risk, now, now, goalId, userId,
          )
          .run();
        const created = result.meta.changes === 1;
        return { created, requirementsChanged: created };
      }
      const sources = existing.sources.some((s) => s.url === opp.source.url) ? existing.sources : [...existing.sources, opp.source];
      const tier = TIER_RANK[opp.tier] < TIER_RANK[existing.tier] ? opp.tier : existing.tier;
      const requirementsChanged = opp.requirements.length > 0 && JSON.stringify(opp.requirements) !== JSON.stringify(existing.requirements);
      const takeDeadline = opp.deadlineStatus !== "unknown";
      await db
        .prepare(
          `UPDATE user_opportunities SET title = ?, org = ?, url = ?, tier = ?, sources_json = ?, location = ?, kind = ?, deadline_status = ?, deadline_date = ?,
             requirements_json = ?, risk = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(
          opp.title || existing.title, opp.org ?? existing.org, existing.url, tier, JSON.stringify(sources), opp.location ?? existing.location, opp.kind ?? existing.kind,
          takeDeadline ? opp.deadlineStatus : existing.deadlineStatus, takeDeadline ? opp.deadlineDate : existing.deadlineDate,
          JSON.stringify(requirementsChanged ? opp.requirements : existing.requirements), opp.risk ?? existing.risk, now, existing.id, userId,
        )
        .run();
      return { created: false, requirementsChanged };
    },
    async setAssessment(goalId: string, key: string, assessment: Assessment, now: number): Promise<void> {
      await db
        .prepare("UPDATE user_opportunities SET assessment_json = ?, score = ?, updated_at = ? WHERE user_id = ? AND goal_id = ? AND key = ?")
        .bind(JSON.stringify(assessment), assessment.score, now, userId, goalId, key)
        .run();
    },
    async setRiskForSource(goalId: string, sourceUrl: string, risk: string, now: number): Promise<void> {
      const { results } = await db
        .prepare(`SELECT ${OPP_COLUMNS} FROM user_opportunities WHERE user_id = ? AND goal_id = ?`)
        .bind(userId, goalId)
        .all<OpportunityRow>();
      for (const row of results.map(toOpportunity)) {
        if (!row.sources.some((source) => source.url === sourceUrl)) continue;
        await db.prepare("UPDATE user_opportunities SET risk = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(risk, now, row.id, userId).run();
      }
    },
    async list(goalId: string, opts: { includeDismissed?: boolean } = {}): Promise<UserOpportunity[]> {
      const { results } = await db
        .prepare(
          `SELECT ${OPP_COLUMNS} FROM user_opportunities WHERE user_id = ? AND goal_id = ? ${opts.includeDismissed ? "" : "AND mark != 'dismissed'"}
           ORDER BY score IS NULL, score DESC, first_seen_at, id`,
        )
        .bind(userId, goalId)
        .all<OpportunityRow>();
      return results.map(toOpportunity);
    },
    async listAll(): Promise<UserOpportunity[]> {
      const { results } = await db.prepare(`SELECT ${OPP_COLUMNS} FROM user_opportunities WHERE user_id = ? ORDER BY goal_id, first_seen_at, id`).bind(userId).all<OpportunityRow>();
      return results.map(toOpportunity);
    },
    async mark(id: string, mark: string): Promise<boolean> {
      if (!(OPPORTUNITY_MARKS as readonly string[]).includes(mark)) throw new HttpError(400, "无效的标记");
      const result = await db.prepare("UPDATE user_opportunities SET mark = ? WHERE id = ? AND user_id = ?").bind(mark, id, userId).run();
      return result.meta.changes === 1;
    },
  };
}
