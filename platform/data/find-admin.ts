/** 跨用户的找机会查询：每日刷新候选与管理员的运行列表。只返回 ID、邮箱与统计，不含检索词或机会内容。 */
import { parseRunStats } from "./run-stats.ts";
import type { RunStats } from "./scoped-find.ts";

export const DAILY_ACTIVE_WINDOW_MS = 7 * 86_400_000;

/** 每日刷新候选：账号正常、已同意当前条款、近 7 天登录过、目标已确认画像。 */
export async function listDailyCandidates(db: D1Database, consentVersion: string, now: number): Promise<{ userId: string; goalId: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT g.user_id AS user_id, g.id AS goal_id FROM goals g
         JOIN users u ON u.id = g.user_id
        WHERE u.status = 'active' AND g.target_json IS NOT NULL
          AND EXISTS (SELECT 1 FROM consents c WHERE c.user_id = u.id AND c.version = ?)
          AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.created_at >= ?)
        ORDER BY g.user_id, g.created_at`,
    )
    .bind(consentVersion, now - DAILY_ACTIVE_WINDOW_MS)
    .all<{ user_id: string; goal_id: string }>();
  return results.map((row) => ({ userId: row.user_id, goalId: row.goal_id }));
}

export type AdminRunRow = {
  id: string;
  email: string;
  goalId: string;
  trigger: string;
  status: string;
  stats: RunStats;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export async function listRecentRuns(db: D1Database, limit: number): Promise<AdminRunRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, u.email, r.goal_id, r.trigger, r.status, r.stats_json, r.error, r.created_at, r.started_at, r.finished_at
         FROM find_runs r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(200, limit)))
    .all<{ id: string; email: string; goal_id: string; trigger: string; status: string; stats_json: string; error: string | null; created_at: number; started_at: number | null; finished_at: number | null }>();
  return results.map((row) => ({
    id: row.id,
    email: row.email,
    goalId: row.goal_id,
    trigger: row.trigger,
    status: row.status,
    stats: parseRunStats(row.stats_json),
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
}
