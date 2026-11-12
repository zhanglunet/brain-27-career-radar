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
