/** 登录会话：数据库只存令牌的 SHA-256。 */
import { randomToken, sha256Hex } from "../crypto.ts";
import { SESSION_MAX_AGE_SECONDS } from "../http.ts";
import { toUser } from "./tables.ts";
import type { User } from "./tables.ts";

export async function createSession(db: D1Database, userId: string, now: number): Promise<string> {
  const token = randomToken();
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, now, now + SESSION_MAX_AGE_SECONDS * 1000)
    .run();
  return token;
}

/** 只返回未撤销、未过期、且账号为 active 的会话用户。 */
export async function findSessionUser(db: D1Database, token: string, now: number): Promise<User | null> {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.role, u.status, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`,
    )
    .bind(await sha256Hex(token), now)
    .first<Parameters<typeof toUser>[0]>();
  return row ? toUser(row) : null;
}

export async function revokeSession(db: D1Database, token: string, now: number): Promise<void> {
  await db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").bind(now, await sha256Hex(token)).run();
}

export async function revokeUserSessions(db: D1Database, userId: string, now: number): Promise<void> {
  await db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, userId).run();
}
