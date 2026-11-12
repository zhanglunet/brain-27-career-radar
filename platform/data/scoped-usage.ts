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
