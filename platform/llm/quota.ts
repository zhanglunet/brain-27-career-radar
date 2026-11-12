/** 每用户每日大模型额度（按上海日期）。调用一旦发出即计 1 次，成功后再计 token。 */
import { HttpError, logEvent } from "../http.ts";
import type { UserScope } from "../data/scoped.ts";
import type { LlmProvider } from "./types.ts";

export const LLM_DAILY_CALLS = 30;
export const LLM_DAILY_TOKENS = 150_000;

export function shanghaiDay(now: number): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function withDailyQuota(provider: LlmProvider, scope: UserScope, userId: string, now: () => number): LlmProvider {
  return {
    async completeJson(messages) {
      const day = shanghaiDay(now());
      const used = await scope.usage.get(day);
      if (used.calls >= LLM_DAILY_CALLS || used.tokens >= LLM_DAILY_TOKENS) {
        logEvent("platform.llm.quota_exceeded", { userId, count: used.calls });
        throw new HttpError(429, "今日智能体额度已用完，请明天再试");
      }
      await scope.usage.addCall(day);
      const started = now();
      try {
        const result = await provider.completeJson(messages);
        const tokens = result.usage.promptTokens + result.usage.completionTokens;
        await scope.usage.addTokens(day, tokens);
        logEvent("platform.llm.call", { userId, status: "ok", count: tokens, reason: `${now() - started}ms` });
        return result;
      } catch (error) {
        const kind = error instanceof Error && "kind" in error ? String((error as { kind: unknown }).kind) : "error";
        logEvent("platform.llm.call", { userId, status: "failed", reason: kind });
        throw error;
      }
    },
  };
}
