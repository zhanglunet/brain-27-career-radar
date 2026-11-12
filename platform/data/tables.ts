/** 私有库中按用户归属的表登记。新增含 user_id 的表必须登记在这里，否则静态守卫测试失败。 */

/** 账号删除时按此顺序删除 `WHERE user_id = ?` 的行，最后再删 users。 */
export const USER_TABLES = [
  // 这三张表引用 goals，必须排在 goals 之前删除。
  "user_opportunities",
  "find_runs",
  "goal_sources",
  "goals",
  "consents",
  "password_resets",
  "sessions",
  "resumes",
  "profile_versions",
  "profile_drafts",
  "profiles",
  "llm_usage",
] as const;

/** 只含用户 ID、不含私人内容的表；账号删除后保留，用于审计。 */
export const ID_ONLY_TABLES = ["audit_log"] as const;

export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "active" | "disabled";

export type User = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
};

type UserRow = { id: string; email: string; role: UserRole; status: UserStatus; created_at: number };

export const USER_COLUMNS = "id, email, role, status, created_at";

export function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, role: row.role, status: row.status, createdAt: row.created_at };
}
