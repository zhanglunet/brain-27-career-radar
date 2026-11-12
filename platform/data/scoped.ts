/**
 * 按用户隔离的数据访问入口。所有用户数据读写都必须经 forUser(db, userId)，
 * 每条 SQL 都绑定闭包中的 userId，调用方无法读写他人的行。
 */
import { normalizeGoalTarget } from "../profile/schema.ts";
import type { GoalTarget, ProfileData } from "../profile/schema.ts";
import { draftsFor, profileFor } from "./scoped-profile.ts";
import type { Draft } from "./scoped-profile.ts";
import { resumesFor } from "./scoped-resumes.ts";
import type { Resume } from "./scoped-resumes.ts";
import { usageFor } from "./scoped-usage.ts";
import { USER_COLUMNS, USER_TABLES, toUser } from "./tables.ts";
import type { User } from "./tables.ts";

export type Goal = { id: string; title: string; description: string; createdAt: number; target: GoalTarget | null };

export type UserExport = {
  exportedAt: number;
  user: User;
  consents: { version: string; acceptedAt: number }[];
  goals: Goal[];
  resumes: Resume[];
  profile: { data: ProfileData; version: number; confirmedAt: number } | null;
  profileVersions: { version: number; data: ProfileData; confirmedAt: number }[];
  drafts: Draft[];
};

type GoalRow = { id: string; title: string; description: string; created_at: number; target_json: string | null };

function parseTarget(json: string | null): GoalTarget | null {
  if (!json) return null;
  try {
    return normalizeGoalTarget(JSON.parse(json));
  } catch {
    return null;
  }
}

const toGoal = (row: GoalRow): Goal => ({ id: row.id, title: row.title, description: row.description, createdAt: row.created_at, target: parseTarget(row.target_json) });
const GOAL_COLUMNS = "id, title, description, created_at, target_json";

export function forUser(db: D1Database, userId: string) {
  const goals = {
    async list(): Promise<Goal[]> {
      const { results } = await db
        .prepare(`SELECT ${GOAL_COLUMNS} FROM goals WHERE user_id = ? ORDER BY created_at, id`)
        .bind(userId)
        .all<GoalRow>();
      return results.map(toGoal);
    },
    async create(input: { title: string; description: string }, now: number): Promise<Goal> {
      const goal = { id: crypto.randomUUID(), title: input.title, description: input.description, createdAt: now, target: null };
      await db
        .prepare("INSERT INTO goals (id, user_id, title, description, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(goal.id, userId, goal.title, goal.description, now)
        .run();
      return goal;
    },
    async get(goalId: string): Promise<Goal | null> {
      const row = await db.prepare(`SELECT ${GOAL_COLUMNS} FROM goals WHERE id = ? AND user_id = ?`).bind(goalId, userId).first<GoalRow>();
      return row ? toGoal(row) : null;
    },
    async setTarget(goalId: string, target: GoalTarget): Promise<boolean> {
      const result = await db
        .prepare("UPDATE goals SET target_json = ? WHERE id = ? AND user_id = ?")
        .bind(JSON.stringify(normalizeGoalTarget(target)), goalId, userId)
        .run();
      return result.meta.changes === 1;
    },
    async remove(goalId: string): Promise<boolean> {
      const result = await db.prepare("DELETE FROM goals WHERE id = ? AND user_id = ?").bind(goalId, userId).run();
      return result.meta.changes === 1;
    },
  };

  return {
    goals,
    usage: usageFor(db, userId),
    resumes: resumesFor(db, userId),
    profile: profileFor(db, userId),
    drafts: draftsFor(db, userId),
    async exportAll(now: number): Promise<UserExport> {
      const row = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(userId).first<Parameters<typeof toUser>[0]>();
      if (!row) throw new Error("user not found");
      const { results: consentRows } = await db
        .prepare("SELECT version, accepted_at FROM consents WHERE user_id = ? ORDER BY accepted_at")
        .bind(userId)
        .all<{ version: string; accepted_at: number }>();
      return {
        exportedAt: now,
        user: toUser(row),
        consents: consentRows.map((consent) => ({ version: consent.version, acceptedAt: consent.accepted_at })),
        goals: await goals.list(),
        resumes: await resumesFor(db, userId).list(),
        profile: await profileFor(db, userId).current(),
        profileVersions: await profileFor(db, userId).versions(),
        drafts: await draftsFor(db, userId).list(),
      };
    },
    /** 一次事务删除该用户在 USER_TABLES 中的全部行、登录失败记录与账号本身。 */
    async deleteAll(): Promise<void> {
      await db.batch([
        db.prepare("DELETE FROM login_attempts WHERE email = (SELECT email FROM users WHERE id = ?)").bind(userId),
        ...USER_TABLES.map((table) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId)),
        db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
      ]);
    },
  };
}

export type UserScope = ReturnType<typeof forUser>;
