/** 账号、邀请码、重置令牌、登录失败计数与审计。 */
import { randomToken, sha256Hex } from "../crypto.ts";
import { HttpError } from "../http.ts";
import { USER_COLUMNS, toUser } from "./tables.ts";
import type { User, UserRole, UserStatus } from "./tables.ts";

const DAY = 86_400_000;
const INVITE_TTL_MS = 7 * DAY;
const RESET_TTL_MS = DAY;
const LOCK_WINDOW_MS = 15 * 60_000;
const LOCK_THRESHOLD = 5;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function createUser(
  db: D1Database,
  input: { email: string; passwordHash: string; role: UserRole; status: UserStatus },
  now: number,
): Promise<User> {
  const id = crypto.randomUUID();
  const email = normalizeEmail(input.email);
  try {
    await db
      .prepare("INSERT INTO users (id, email, password_hash, role, status, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, email, input.passwordHash, input.role, input.status, now, input.status === "active" ? now : null)
      .run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new HttpError(409, "该邮箱已注册");
    throw error;
  }
  return { id, email, role: input.role, status: input.status, createdAt: now };
}

/** 仅用于注册失败时的补偿：只删除仍为 pending 的用户行。 */
export async function deleteUserRow(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM users WHERE id = ? AND status = 'pending'").bind(userId).run();
}

export async function findUserByEmail(db: D1Database, email: string): Promise<(User & { passwordHash: string }) | null> {
  const row = await db
    .prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<{ id: string; email: string; role: UserRole; status: UserStatus; created_at: number; password_hash: string }>();
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export async function findUserById(db: D1Database, id: string): Promise<User | null> {
  const row = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<Parameters<typeof toUser>[0]>();
  return row ? toUser(row) : null;
}

export async function findPasswordHash(db: D1Database, userId: string): Promise<string | null> {
  return db.prepare("SELECT password_hash FROM users WHERE id = ?").bind(userId).first<string>("password_hash");
}

export async function listUsers(db: D1Database, status?: UserStatus): Promise<User[]> {
  const statement = status
    ? db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE status = ? ORDER BY created_at`).bind(status)
    : db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at`);
  const { results } = await statement.all<Parameters<typeof toUser>[0]>();
  return results.map(toUser);
}

export async function setUserStatus(db: D1Database, userId: string, status: UserStatus, now: number): Promise<void> {
  const column = status === "active" ? "approved_at" : status === "disabled" ? "disabled_at" : null;
  const sql = column
    ? `UPDATE users SET status = ?, ${column} = ? WHERE id = ?`
    : "UPDATE users SET status = ? WHERE id = ?";
  const statement = column ? db.prepare(sql).bind(status, now, userId) : db.prepare(sql).bind(status, userId);
  await statement.run();
}

export async function countActiveAdmins(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").first<number>("n")) ?? 0;
}

export async function setPassword(db: D1Database, userId: string, passwordHash: string): Promise<void> {
  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(passwordHash, userId).run();
}

export async function createInvite(db: D1Database, createdBy: string, now: number): Promise<string> {
  const code = randomToken(12);
  await db
    .prepare("INSERT INTO invites (code_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(code), createdBy, now, now + INVITE_TTL_MS)
    .run();
  return code;
}

export async function consumeInvite(db: D1Database, code: string, userId: string, now: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE invites SET used_by = ?, used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?")
    .bind(userId, now, await sha256Hex(code.trim()), now)
    .run();
  return result.meta.changes === 1;
}

export async function createResetToken(db: D1Database, userId: string, adminId: string, now: number): Promise<string> {
  const token = randomToken();
  await db
    .prepare("INSERT INTO password_resets (token_hash, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, adminId, now, now + RESET_TTL_MS)
    .run();
  return token;
}

export async function consumeResetToken(db: D1Database, token: string, now: number): Promise<string | null> {
  const hash = await sha256Hex(token);
  const result = await db
    .prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .bind(now, hash, now)
    .run();
  if (result.meta.changes !== 1) return null;
  return db.prepare("SELECT user_id FROM password_resets WHERE token_hash = ?").bind(hash).first<string>("user_id");
}

export async function recordLoginFailure(db: D1Database, email: string, now: number): Promise<void> {
  await db.prepare("INSERT INTO login_attempts (email, attempted_at) VALUES (?, ?)").bind(normalizeEmail(email), now).run();
}

export async function isLoginLocked(db: D1Database, email: string, now: number): Promise<boolean> {
  const failures = await db
    .prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND attempted_at > ?")
    .bind(normalizeEmail(email), now - LOCK_WINDOW_MS)
    .first<number>("n");
  return (failures ?? 0) >= LOCK_THRESHOLD;
}

export async function clearLoginFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE email = ?").bind(normalizeEmail(email)).run();
}

export async function audit(
  db: D1Database,
  entry: { actorUserId: string | null; action: string; targetUserId: string | null },
  now: number,
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_log (id, actor_user_id, action, target_user_id, at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), entry.actorUserId, entry.action, entry.targetUserId, now)
    .run();
}
