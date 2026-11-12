/** 每用户每日搜索额度（按上海日期），与大模型额度一样原子占用。 */
import type { UserScope } from "../data/scoped.ts";
import { HttpError, logEvent } from "../http.ts";
import { shanghaiDay } from "../llm/quota.ts";
import type { SearchProvider } from "./types.ts";

export const SEARCH_DAILY_LIMIT = 20;

export function withSearchQuota(provider: SearchProvider, scope: UserScope, userId: string, now: () => number): SearchProvider {
  return {
    async search(query) {
      if (!(await scope.usage.reserveSearch(shanghaiDay(now()), SEARCH_DAILY_LIMIT))) {
        logEvent("platform.search.quota_exceeded", { userId });
        throw new HttpError(429, "今日搜索额度已用完，请明天再试");
      }
      try {
        const hits = await provider.search(query);
        logEvent("platform.search.call", { userId, status: "ok", count: hits.length });
        return hits;
      } catch (error) {
        logEvent("platform.search.call", { userId, status: "failed", reason: error instanceof Error ? error.name : "error" });
        throw error;
      }
    },
  };
}
