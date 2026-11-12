/**
 * 公开 D1 的唯一访问入口：只读查询。私有平台永不写公开库，
 * 静态守卫测试保证其他文件不出现 PUBLIC_DB、本文件不出现写语句。
 */

export type PublicOpportunity = {
  id: string;
  name: string;
  org: string;
  kind: string;
  location: string;
  deadline: string;
  url: string;
};

export async function listPublicOpportunities(db: D1Database, limit: number): Promise<PublicOpportunity[]> {
  const clamped = Math.min(100, Math.max(1, Math.floor(limit) || 1));
  const { results } = await db
    .prepare("SELECT id, name, org, kind, location, deadline, url FROM opportunities WHERE published = 1 ORDER BY id LIMIT ?")
    .bind(clamped)
    .all<PublicOpportunity>();
  return results;
}

export type PublicOpportunityMatch = PublicOpportunity & {
  deadlineStatus: string;
  deadlineAt: string | null;
  authenticityState: string;
};

/** 按词匹配已发布的公开机会（名称、机构、地点、标签），参数全部绑定。 */
export async function searchPublicOpportunities(db: D1Database, terms: string[], limit: number): Promise<PublicOpportunityMatch[]> {
  const words = [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, 10);
  if (!words.length) return [];
  const clamped = Math.min(50, Math.max(1, Math.floor(limit) || 1));
  const clause = words.map(() => "(name LIKE ? OR org LIKE ? OR location LIKE ? OR tags_json LIKE ?)").join(" OR ");
  const params = words.flatMap((word) => Array(4).fill(`%${word.split(/[%_]/).join("")}%`));
  const { results } = await db
    .prepare(
      `SELECT id, name, org, kind, location, deadline, url, deadline_status, deadline_at, authenticity_state
         FROM opportunities WHERE published = 1 AND (${clause}) ORDER BY id LIMIT ?`,
    )
    .bind(...params, clamped)
    .all<PublicOpportunity & { deadline_status: string; deadline_at: string | null; authenticity_state: string }>();
  return results.map((row) => ({
    id: row.id,
    name: row.name,
    org: row.org,
    kind: row.kind,
    location: row.location,
    deadline: row.deadline,
    url: row.url,
    deadlineStatus: row.deadline_status,
    deadlineAt: row.deadline_at,
    authenticityState: row.authenticity_state,
  }));
}
