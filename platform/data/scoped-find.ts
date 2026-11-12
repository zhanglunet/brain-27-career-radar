/** 找机会相关的按用户数据：目标来源（本任务）、运行记录与个人机会（后续任务）。 */
import { isFetchableUrl, normalizeUrl } from "../fetcher/url.ts";
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
