/** 平台共享来源与提名：平台级表，不存提名人身份。 */

export type Nomination = { id: string; url: string; org: string | null; createdAt: number };
export type PlatformSource = { id: string; url: string; org: string | null; createdAt: number };

export async function nominateShared(db: D1Database, input: { url: string; org: string | null }, now: number): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO source_nominations (id, url, org, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
    .bind(crypto.randomUUID(), input.url, input.org, now)
    .run();
}

export async function listNominations(db: D1Database, status: "pending" | "approved" | "rejected"): Promise<Nomination[]> {
  const { results } = await db
    .prepare("SELECT id, url, org, created_at FROM source_nominations WHERE status = ? ORDER BY created_at, id")
    .bind(status)
    .all<{ id: string; url: string; org: string | null; created_at: number }>();
  return results.map((row) => ({ id: row.id, url: row.url, org: row.org, createdAt: row.created_at }));
}

/** 只能处理 pending 的提名；批准时写入平台共享来源（同一事务）。 */
export async function decideNomination(db: D1Database, id: string, status: "approved" | "rejected", now: number): Promise<boolean> {
  const statements = [
    db.prepare("UPDATE source_nominations SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'").bind(status, now, id),
  ];
  if (status === "approved") {
    statements.push(db
      .prepare("INSERT OR IGNORE INTO platform_sources (id, url, org, created_at) SELECT ?, url, org, ? FROM source_nominations WHERE id = ? AND status = 'approved' AND decided_at = ?")
      .bind(crypto.randomUUID(), now, id, now));
  }
  const results = await db.batch(statements);
  return results[0].meta.changes === 1;
}

export async function listPlatformSources(db: D1Database): Promise<PlatformSource[]> {
  const { results } = await db
    .prepare("SELECT id, url, org, created_at FROM platform_sources ORDER BY created_at, id")
    .all<{ id: string; url: string; org: string | null; created_at: number }>();
  return results.map((row) => ({ id: row.id, url: row.url, org: row.org, createdAt: row.created_at }));
}
