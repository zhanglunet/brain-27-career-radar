/** 数据条款同意记录。 */

export async function recordConsent(db: D1Database, userId: string, version: string, now: number): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO consents (id, user_id, version, accepted_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), userId, version, now)
    .run();
}

export async function hasConsent(db: D1Database, userId: string, version: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 AS ok FROM consents WHERE user_id = ? AND version = ?").bind(userId, version).first()) !== null;
}
