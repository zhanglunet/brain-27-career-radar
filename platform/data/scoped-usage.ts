/** 每日大模型用量（按用户隔离）。 */

export function usageFor(db: D1Database, userId: string) {
  return {
    async get(day: string): Promise<{ calls: number; tokens: number }> {
      const row = await db
        .prepare("SELECT calls, tokens FROM llm_usage WHERE user_id = ? AND day = ?")
        .bind(userId, day)
        .first<{ calls: number; tokens: number }>();
      return { calls: row?.calls ?? 0, tokens: row?.tokens ?? 0 };
    },
    /** 原子地占用一次调用额度：未超限时 calls + 1 并返回 true，超限返回 false。 */
    async reserveCall(day: string, maxCalls: number, maxTokens: number): Promise<boolean> {
      const row = await db
        .prepare(
          `INSERT INTO llm_usage (user_id, day, calls, tokens) VALUES (?, ?, 1, 0)
           ON CONFLICT (user_id, day) DO UPDATE SET calls = calls + 1 WHERE calls < ? AND tokens < ?
           RETURNING calls`,
        )
        .bind(userId, day, maxCalls, maxTokens)
        .first<{ calls: number }>();
      return row !== null;
    },
    /** 原子地占用一次搜索额度：未超限时 searches + 1 并返回 true。 */
    async reserveSearch(day: string, max: number): Promise<boolean> {
      const row = await db
        .prepare(
          `INSERT INTO llm_usage (user_id, day, calls, tokens, searches) VALUES (?, ?, 0, 0, 1)
           ON CONFLICT (user_id, day) DO UPDATE SET searches = searches + 1 WHERE searches < ?
           RETURNING searches`,
        )
        .bind(userId, day, max)
        .first<{ searches: number }>();
      return row !== null;
    },
    async addCall(day: string): Promise<void> {
      await db
        .prepare("INSERT INTO llm_usage (user_id, day, calls, tokens) VALUES (?, ?, 1, 0) ON CONFLICT (user_id, day) DO UPDATE SET calls = calls + 1")
        .bind(userId, day)
        .run();
    },
    async addTokens(day: string, tokens: number): Promise<void> {
      await db
        .prepare("INSERT INTO llm_usage (user_id, day, calls, tokens) VALUES (?, ?, 0, ?) ON CONFLICT (user_id, day) DO UPDATE SET tokens = tokens + excluded.tokens")
        .bind(userId, day, Math.max(0, Math.floor(tokens)))
        .run();
    },
  };
}
