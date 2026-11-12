/** 当前档案、历史版本与草稿（按用户隔离）。只有确认过的档案才算"当前档案"。 */
import { emptyGoalTarget, emptyProfile, normalizeGoalTarget, normalizeProfile } from "../profile/schema.ts";
import type { GoalTarget, ProfileData } from "../profile/schema.ts";

export type DraftSource = "resume" | "intent" | "both";
export type DraftStatus = "pending" | "confirmed" | "discarded";
export type Draft = {
  id: string;
  goalId: string | null;
  profile: ProfileData;
  target: GoalTarget;
  source: DraftSource;
  status: DraftStatus;
  createdAt: number;
  decidedAt: number | null;
};

type DraftRow = { id: string; goal_id: string | null; profile_json: string; target_json: string; source: DraftSource; status: DraftStatus; created_at: number; decided_at: number | null };

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const toDraft = (row: DraftRow): Draft => ({
  id: row.id,
  goalId: row.goal_id,
  profile: normalizeProfile(parse(row.profile_json)),
  target: normalizeGoalTarget(parse(row.target_json)),
  source: row.source,
  status: row.status,
  createdAt: row.created_at,
  decidedAt: row.decided_at,
});

const DRAFT_COLUMNS = "id, goal_id, profile_json, target_json, source, status, created_at, decided_at";

export function profileFor(db: D1Database, userId: string) {
  async function current(): Promise<{ data: ProfileData; version: number; confirmedAt: number } | null> {
    const row = await db
      .prepare("SELECT data_json, version, confirmed_at FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ data_json: string; version: number; confirmed_at: number }>();
    return row ? { data: normalizeProfile(parse(row.data_json)), version: row.version, confirmedAt: row.confirmed_at } : null;
  }

  /**
   * 写入新版本的两条语句：先把当前版本原样归档，再写新内容、版本号由数据库加一。
   * 放在同一个 batch（事务）里执行，并发确认也不会分到同一个版本号或丢掉内容。
   */
  function writeVersionStatements(data: ProfileData, now: number): D1PreparedStatement[] {
    return [
      db
        .prepare("INSERT INTO profile_versions (id, user_id, version, data_json, confirmed_at) SELECT ?, user_id, version, data_json, confirmed_at FROM profiles WHERE user_id = ?")
        .bind(crypto.randomUUID(), userId),
      db
        .prepare(
          `INSERT INTO profiles (user_id, data_json, version, confirmed_at) VALUES (?, ?, 1, ?)
           ON CONFLICT (user_id) DO UPDATE SET data_json = excluded.data_json, version = profiles.version + 1, confirmed_at = excluded.confirmed_at
           RETURNING version`,
        )
        .bind(userId, JSON.stringify(normalizeProfile(data)), now),
    ];
  }

  function versionFrom(results: D1Result[], index: number): number {
    const row = (results[index]?.results?.[0] ?? null) as { version?: number } | null;
    if (typeof row?.version !== "number") throw new Error("profile version missing");
    return row.version;
  }

  async function confirm(data: ProfileData, now: number): Promise<number> {
    return versionFrom(await db.batch(writeVersionStatements(data, now)), 1);
  }

  /**
   * 确认草稿：占住草稿、归档当前版本、写新版本、写目标画像，全部在一个事务里。
   * 草稿已被处理时，状态更新会把 status 设为 NULL 触发非空约束，整个事务回滚。
   */
  async function confirmDraft(
    draftId: string,
    data: ProfileData,
    goal: { goalId: string; target: GoalTarget } | null,
    now: number,
  ): Promise<{ ok: true; version: number } | { ok: false }> {
    const statements = [
      db
        .prepare("UPDATE profile_drafts SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE NULL END, decided_at = ? WHERE id = ? AND user_id = ?")
        .bind(now, draftId, userId),
      ...writeVersionStatements(data, now),
    ];
    if (goal) {
      statements.push(db
        .prepare("UPDATE goals SET target_json = ? WHERE id = ? AND user_id = ?")
        .bind(JSON.stringify(normalizeGoalTarget(goal.target)), goal.goalId, userId));
    }
    try {
      return { ok: true, version: versionFrom(await db.batch(statements), 2) };
    } catch (error) {
      if (/NOT NULL constraint failed: profile_drafts\.status/.test(String(error))) return { ok: false };
      throw error;
    }
  }

  return {
    current,
    confirm,
    confirmDraft,
    async versions(): Promise<{ version: number; data: ProfileData; confirmedAt: number }[]> {
      const { results } = await db
        .prepare("SELECT version, data_json, confirmed_at FROM profile_versions WHERE user_id = ? ORDER BY version DESC")
        .bind(userId)
        .all<{ version: number; data_json: string; confirmed_at: number }>();
      return results.map((row) => ({ version: row.version, data: normalizeProfile(parse(row.data_json)), confirmedAt: row.confirmed_at }));
    },
    /** 把最近一个历史版本恢复为新版本；当前版本进入历史。无历史返回 null。 */
    async rollback(now: number): Promise<number | null> {
      const previous = await db
        .prepare("SELECT id, data_json FROM profile_versions WHERE user_id = ? ORDER BY version DESC LIMIT 1")
        .bind(userId)
        .first<{ id: string; data_json: string }>();
      if (!previous) return null;
      const results = await db.batch([
        ...writeVersionStatements(normalizeProfile(parse(previous.data_json)), now),
        db.prepare("DELETE FROM profile_versions WHERE id = ? AND user_id = ?").bind(previous.id, userId),
      ]);
      return versionFrom(results, 1);
    },
  };
}

export function draftsFor(db: D1Database, userId: string) {
  return {
    async create(input: { goalId: string | null; profile: ProfileData; target: GoalTarget; source: DraftSource }, now: number): Promise<string> {
      const id = crypto.randomUUID();
      await db
        .prepare("INSERT INTO profile_drafts (id, user_id, goal_id, profile_json, target_json, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)")
        .bind(id, userId, input.goalId, JSON.stringify(input.profile ?? emptyProfile()), JSON.stringify(input.target ?? emptyGoalTarget()), input.source, now)
        .run();
      return id;
    },
    async get(id: string): Promise<Draft | null> {
      const row = await db.prepare(`SELECT ${DRAFT_COLUMNS} FROM profile_drafts WHERE id = ? AND user_id = ?`).bind(id, userId).first<DraftRow>();
      return row ? toDraft(row) : null;
    },
    async list(): Promise<Draft[]> {
      const { results } = await db.prepare(`SELECT ${DRAFT_COLUMNS} FROM profile_drafts WHERE user_id = ? ORDER BY created_at, id`).bind(userId).all<DraftRow>();
      return results.map(toDraft);
    },
    async listPending(): Promise<Draft[]> {
      const { results } = await db
        .prepare(`SELECT ${DRAFT_COLUMNS} FROM profile_drafts WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC, id`)
        .bind(userId)
        .all<DraftRow>();
      return results.map(toDraft);
    },
    /** 只有 pending 的草稿能被处理一次；返回是否由本次调用处理。 */
    async decide(id: string, status: "confirmed" | "discarded", now: number): Promise<boolean> {
      const result = await db
        .prepare("UPDATE profile_drafts SET status = ?, decided_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'")
        .bind(status, now, id, userId)
        .run();
      return result.meta.changes === 1;
    },
  };
}
